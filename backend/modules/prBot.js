// Automated PR bot: given a Jira ticket key, pulls the ticket + logs from the
// Jira MCP server, applies a rule-specific automated fix to the affected file
// in watched-repo, commits it on a fix/<ticket-key> branch, and either opens
// a real GitHub PR (if GITHUB_TOKEN + GITHUB_REPO are set) or returns a
// dry-run preview of what the PR would contain.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";
import { getTicket, getLogs } from "./mcpJiraClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..", "watched-repo");

function detectRuleId(ticket) {
  const text = `${ticket.summary} ${ticket.description}`.toLowerCase();
  if (text.includes("api key") || text.includes("secret") || text.includes("hardcoded")) return "hardcoded-secret";
  if (text.includes("eval(") || text.includes("rce") || text.includes("code execution")) return "eval-usage";
  if (text.includes("sql injection")) return "sql-string-concat";
  if (text.includes("timeout") && text.includes("gateway")) return "gateway-timeout";
  if (text.includes("pool exhausted") || text.includes("connection pool")) return "db-pool-leak";
  if (text.includes("disk space") || text.includes("disk usage")) return "disk-cleanup";
  if (text.includes("cannot read propert")) return "null-check";
  return null;
}

function fixHardcodedSecret(content) {
  return content
    .replace(
      'const stripeApiKey = "sk_live_51Hxxxxxxxxxxxxxxxxxxxx"; // hardcoded secret',
      "const stripeApiKey = process.env.STRIPE_API_KEY; // now sourced from environment"
    )
    .replace(
      "console.log(`Charging ${customerId} amount ${amount} with key ${stripeApiKey}`);",
      "console.log(`Charging ${customerId} amount ${amount}`); // no longer logs the secret"
    );
}

function fixEvalUsage(content) {
  let fixed = content.replace(
    "  const result = eval(userExpression); // arbitrary code execution risk",
    "  const result = safeEvaluate(userExpression); // replaced eval() with a restricted-scope evaluator"
  );
  if (!fixed.includes("function safeEvaluate")) {
    fixed = fixed.replace(
      "function renderTemplate(userExpression, context) {",
      [
        "function safeEvaluate(expression) {",
        "  // Only allow simple arithmetic — no identifiers, no property access, no globals.",
        '  if (!/^[0-9+\\-*/(). \\s]*$/.test(expression)) {',
        '    throw new Error("Unsafe expression rejected");',
        "  }",
        '  return Function(`"use strict"; return (${expression})`)();',
        "}",
        "",
        "function renderTemplate(userExpression, context) {",
      ].join("\n")
    );
  }
  return fixed;
}

function fixSqlConcat(content) {
  return content
    .replace(
      `const query = "SELECT * FROM users WHERE name = '" + name + "'";`,
      'const query = "SELECT * FROM users WHERE name = ?";'
    )
    .replace(
      "  return db.query(query);",
      "  return db.query(query, [name]); // parameterized to prevent SQL injection"
    );
}

function fixGatewayTimeout(content) {
  return content.replace(
    `async function chargeViaGateway(gateway, chargeRequest) {
  const response = await gateway.post("/charge", chargeRequest, { timeoutMs: 5000 });
  return response;
}`,
    `async function chargeViaGateway(gateway, chargeRequest, attempt = 1) {
  try {
    return await gateway.post("/charge", chargeRequest, { timeoutMs: 8000 });
  } catch (err) {
    if (attempt < 3 && err.code === "ETIMEDOUT") {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      return chargeViaGateway(gateway, chargeRequest, attempt + 1); // retry with backoff instead of failing on the first timeout
    }
    throw err;
  }
}`
  );
}

function fixDbPoolLeak(content) {
  return content.replace(
    `async function withConnection(pool, fn) {
  const conn = await pool.acquire();
  return fn(conn);
}`,
    `async function withConnection(pool, fn) {
  const conn = await pool.acquire();
  try {
    return await fn(conn);
  } finally {
    pool.release(conn); // always release, even on error — fixes the pool exhaustion leak
  }
}`
  );
}

function fixDiskCleanup(content) {
  return content.replace(
    "const oldFiles = files.filter((f) => f.mtimeMs > cutoff);",
    "const oldFiles = files.filter((f) => f.mtimeMs < cutoff); // fixed: select files OLDER than the retention cutoff, not newer"
  );
}

function fixNullCheck(content) {
  return content.replace(
    `function process(message) {
  return handleNotification(message.payload.user.id, message.payload.template);
}`,
    `function process(message) {
  const user = message?.payload?.user;
  if (!user?.id) {
    console.warn("Skipping notification: missing user id", { messageId: message?.id });
    return null;
  }
  return handleNotification(user.id, message.payload.template);
}`
  );
}

const FIXERS = {
  "hardcoded-secret": fixHardcodedSecret,
  "eval-usage": fixEvalUsage,
  "sql-string-concat": fixSqlConcat,
  "gateway-timeout": fixGatewayTimeout,
  "db-pool-leak": fixDbPoolLeak,
  "disk-cleanup": fixDiskCleanup,
  "null-check": fixNullCheck,
};

const KNOWN_WATCHED_FILES = [
  "paymentService.js",
  "templateRenderer.js",
  "userSearch.js",
  "payment-api/src/gatewayClient.js",
  "auth-service/src/db/pool.js",
  "file-storage-service/src/retentionJob.js",
  "notification-worker/src/worker.js",
];

// Each of the 4 operational-incident rules maps to exactly one demo file, so
// when the ticket text doesn't literally mention the filename (common when
// an LLM paraphrases the incident rather than quoting the raw stack trace),
// fall back to the rule's known file instead of giving up.
const RULE_DEFAULT_FILE = {
  "gateway-timeout": "payment-api/src/gatewayClient.js",
  "db-pool-leak": "auth-service/src/db/pool.js",
  "disk-cleanup": "file-storage-service/src/retentionJob.js",
  "null-check": "notification-worker/src/worker.js",
};

// The mock tickets carry an explicit affectedFile/affectedLine field; real
// Jira tickets won't, so fall back to scanning the fetched logs text (or the
// ticket description, since attachments aren't always available) for one of
// the known demo filenames — e.g. "at chargeCustomer
// (watched-repo/paymentService.js:3:9)" — and finally to the rule's known
// default file.
function detectAffectedFile(ticket, logs, ruleId) {
  if (ticket.affectedFile) return ticket.affectedFile;
  const text = `${logs.stacktrace || ""}\n${logs.raw || ""}\n${ticket.description || ""}`;
  const found = KNOWN_WATCHED_FILES.find((file) => text.includes(file));
  return found ?? RULE_DEFAULT_FILE[ruleId] ?? null;
}

// Accepts "owner/repo" but also tolerates a full URL/.git suffix/trailing
// slash, since it's easy to paste the wrong form into an env var.
function normalizeGithubRepoSlug(raw) {
  if (!raw) return null;
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function buildRemoteUrl() {
  const token = process.env.GITHUB_TOKEN;
  const repo = normalizeGithubRepoSlug(process.env.GITHUB_REPO);
  if (!token || !repo) return null;
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

async function ensureRemoteConfigured(git, remoteUrl) {
  const remotes = await git.getRemotes();
  if (remotes.some((r) => r.name === "origin")) {
    await git.remote(["set-url", "origin", remoteUrl]);
  } else {
    await git.addRemote("origin", remoteUrl);
  }
}

// git push over a flaky egress path occasionally fails transfer mid-stream
// ("index-pack failed") even when auth/refs are fine — one retry clears it.
async function pushWithRetry(git, args, attempts = 2) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await git.push(args);
    } catch (err) {
      if (attempt === attempts) throw err;
    }
  }
}

// Keeps the local main in sync with the remote's main so fix branches are
// always cut from the real base — and, on the very first run against a
// brand-new empty target repo, seeds it with the local demo files instead.
async function syncWithRemoteMain(git) {
  try {
    await git.fetch("origin", "main");
    await git.checkout("main");
    await git.reset(["--hard", "origin/main"]);
  } catch {
    await git.checkout("main");
    await pushWithRetry(git, ["-u", "origin", "main"]);
  }
}

async function ensureRepoInitialized() {
  const git = simpleGit(REPO_DIR);
  // NOTE: git.checkIsRepo() walks up parent directories, so it reports
  // `true` even when watched-repo/ has no .git of its own — it was just
  // detecting this app's own outer repo. That meant every git operation
  // here (checkout/commit/push, and remote reconfiguration once a
  // GitHub token is set) was silently running against the real app repo
  // instead of an isolated one. Check for watched-repo/.git directly instead.
  const hasOwnGitDir = existsSync(path.join(REPO_DIR, ".git"));
  if (!hasOwnGitDir) {
    await git.init();
    await git.branch(["-M", "main"]);
  }
  // Set every time, not just on first init — a fresh container (e.g. Render's
  // ephemeral disk after a redeploy) has no global git identity configured,
  // so relying on a one-time setup step is fragile.
  await git.addConfig("user.email", "devsecops-bot@example.com");
  await git.addConfig("user.name", "DevSecOps Copilot Bot");
  // Some cloud egress paths negotiate HTTP/2 with GitHub in a way that
  // corrupts the git-receive-pack stream ("index-pack failed" / "did not
  // receive expected object" on push) even for tiny payloads. Forcing
  // HTTP/1.1 for this repo's git operations is the standard workaround.
  await git.addConfig("http.version", "HTTP/1.1");
  if (!hasOwnGitDir) {
    await git.add(".");
    await git.commit("chore: initial import of watched-repo demo files");
  }

  const remoteUrl = buildRemoteUrl();
  if (remoteUrl) {
    await ensureRemoteConfigured(git, remoteUrl);
    await syncWithRemoteMain(git);
  }

  return git;
}

function buildPrBody(ticket, logs, ruleId) {
  return [
    `**Jira ticket:** ${ticket.key} — ${ticket.summary}`,
    `**Priority:** ${ticket.priority}`,
    "",
    "### Description",
    ticket.description,
    "",
    "### Evidence (from attached logs)",
    "```",
    logs.stacktrace,
    "```",
    "",
    `### Automated fix applied`,
    `Rule: \`${ruleId}\``,
    "",
    "_Opened automatically by the DevSecOps Copilot PR bot._",
  ].join("\n");
}

export async function createFixPr(ticketKey) {
  const ticket = await getTicket(ticketKey);
  const logs = await getLogs(ticketKey);

  const ruleId = detectRuleId(ticket);
  const fixer = ruleId && FIXERS[ruleId];
  if (!fixer) {
    throw new Error(`No automated fixer available for ticket ${ticketKey}`);
  }

  const affectedFile = detectAffectedFile(ticket, logs, ruleId);
  if (!affectedFile) {
    throw new Error(
      `Could not determine which watched-repo file ${ticketKey} relates to. ` +
        `Make sure the ticket's attachments/description mention one of: ${KNOWN_WATCHED_FILES.join(", ")}`
    );
  }

  const filePath = path.join(REPO_DIR, affectedFile);
  const original = await fs.readFile(filePath, "utf8");
  const fixed = fixer(original);
  if (fixed === original) {
    throw new Error(`Fixer for ${ruleId} made no changes to ${affectedFile} — pattern not found`);
  }

  const git = await ensureRepoInitialized();
  await git.checkout("main");
  const branchName = `fix/${ticket.key.toLowerCase()}`;

  // Always cut the fix branch fresh from the current main rather than reusing
  // a stale local branch from an earlier run in this same container.
  const branches = await git.branchLocal();
  if (branches.all.includes(branchName)) {
    await git.deleteLocalBranch(branchName, true);
  }
  await git.checkoutLocalBranch(branchName);

  await fs.writeFile(filePath, fixed, "utf8");
  await git.add(affectedFile);
  const commitMessage = `fix(${ticket.key}): ${ticket.summary}`;
  await git.commit(commitMessage);

  const title = `[${ticket.key}] ${ticket.summary}`;
  const body = buildPrBody(ticket, logs, ruleId);

  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = normalizeGithubRepoSlug(process.env.GITHUB_REPO);

  let result;
  if (githubToken && githubRepo) {
    const [owner, repo] = githubRepo.split("/");
    await pushWithRetry(git, ["-u", "origin", branchName, "--force"]);
    const octokit = new Octokit({ auth: githubToken });
    let pr;
    try {
      ({ data: pr } = await octokit.pulls.create({ owner, repo, title, head: branchName, base: "main", body }));
    } catch (err) {
      const alreadyExists = err.status === 422 && /already exists/i.test(JSON.stringify(err.response?.data ?? ""));
      if (!alreadyExists) throw err;
      const { data: existing } = await octokit.pulls.list({ owner, repo, head: `${owner}:${branchName}`, state: "open" });
      if (!existing.length) throw err;
      [pr] = existing;
    }
    result = { dryRun: false, url: pr.html_url, branch: branchName, title, body };
  } else {
    result = { dryRun: true, branch: branchName, title, body };
  }

  await git.checkout("main");
  return {
    ...result,
    ticketKey: ticket.key,
    ruleId,
    file: affectedFile,
    diff: { before: original, after: fixed },
  };
}
