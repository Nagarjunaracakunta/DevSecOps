// Automated PR bot: given a Jira ticket key, pulls the ticket + logs from the
// Jira MCP server, applies a rule-specific automated fix to the affected file
// in watched-repo, commits it on a fix/<ticket-key> branch, and either opens
// a real GitHub PR (if GITHUB_TOKEN + GITHUB_REPO are set) or returns a
// dry-run preview of what the PR would contain.
import fs from "node:fs/promises";
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

const FIXERS = {
  "hardcoded-secret": fixHardcodedSecret,
  "eval-usage": fixEvalUsage,
  "sql-string-concat": fixSqlConcat,
};

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
    await git.push(["-u", "origin", "main"]);
  }
}

async function ensureRepoInitialized() {
  const git = simpleGit(REPO_DIR);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    await git.init();
    await git.branch(["-M", "main"]);
  }
  // Set every time, not just on first init — a fresh container (e.g. Render's
  // ephemeral disk after a redeploy) has no global git identity configured,
  // so relying on a one-time setup step is fragile.
  await git.addConfig("user.email", "devsecops-bot@example.com");
  await git.addConfig("user.name", "DevSecOps Copilot Bot");
  if (!isRepo) {
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

  const filePath = path.join(REPO_DIR, ticket.affectedFile);
  const original = await fs.readFile(filePath, "utf8");
  const fixed = fixer(original);
  if (fixed === original) {
    throw new Error(`Fixer for ${ruleId} made no changes to ${ticket.affectedFile} — pattern not found`);
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
  await git.add(ticket.affectedFile);
  const commitMessage = `fix(${ticket.key}): ${ticket.summary}`;
  await git.commit(commitMessage);

  const title = `[${ticket.key}] ${ticket.summary}`;
  const body = buildPrBody(ticket, logs, ruleId);

  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = normalizeGithubRepoSlug(process.env.GITHUB_REPO);

  let result;
  if (githubToken && githubRepo) {
    const [owner, repo] = githubRepo.split("/");
    await git.push(["-u", "origin", branchName, "--force"]);
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
    file: ticket.affectedFile,
    diff: { before: original, after: fixed },
  };
}
