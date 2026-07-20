import { spawn } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { configuredGithubRepo, resolveGithubToken } from "./githubConfig.js";

function normalizeSlug(raw = "") {
  return raw.trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function git(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `git exited ${code}`)));
  });
}

export function buildPullRequestBody(run) {
  const resultLine = (result) => `${result?.command || "not run"} — exit ${result?.exitCode ?? "n/a"} (${result?.passed ? "passed" : "failed"})`;
  return [
    `## ${run.ticketKey}: verified incident repair`,
    "",
    "### Root cause",
    run.rootCause?.summary || "Not recorded",
    "",
    "### Incident evidence",
    `- Source: ${run.evidence?.logs?.source || "unknown"}`,
    `- Affected file: ${(run.affectedFiles || []).join(", ")}`,
    `- Reproduction input: \`${run.evidence?.reproduction?.maliciousInput || "redacted"}\``,
    "",
    "### Files changed",
    ...(run.filesChanged || []).map((file) => `- \`${file}\``),
    "",
    "### Verification",
    `- Before patch: ${resultLine(run.beforePatchTest)}`,
    `- After patch: ${resultLine(run.afterPatchTest)}`,
    `- Full suite: ${resultLine(run.fullTestResult)}`,
    `- Lint: ${resultLine(run.lintResult)}`,
    `- Security: ${resultLine(run.securityResult)}`,
    "",
    "### Independent review",
    run.reviewResult?.summary || "Not recorded",
    "",
    "### Remaining risks",
    "Confirm the production database driver uses `?` placeholders before merge.",
    "",
    "_Prepared by OpenAI Codex and published only after human approval._"
  ].join("\n");
}

export async function publishVerifiedRun(run) {
  if (!run.approved) throw new Error("Human approval is required before publication");
  if (run.status !== "publishing") throw new Error("Run is not ready for publication");
  const branch = `codex/sec-103-${run.id.slice(0, 8)}`;
  const title = `[SEC-103] Parameterize user search query`;
  const body = buildPullRequestBody(run);
  const token = await resolveGithubToken();
  const slug = normalizeSlug(configuredGithubRepo());

  if (!token || !slug.includes("/")) {
    return { dryRun: true, branch, title, body, url: null };
  }

  const expected = normalizeSlug(configuredGithubRepo());
  if (slug !== expected) throw new Error("GitHub repository is not the configured target");
  const [owner, repo] = slug.split("/");
  const remote = `https://github.com/${slug}.git`;
  const authEnv = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`
  };
  await git(run.workspace, ["config", "user.email", "devsecops-copilot@example.com"]);
  await git(run.workspace, ["config", "user.name", "DevSecOps Copilot"]);
  await git(run.workspace, ["checkout", "-b", branch]);
  await git(run.workspace, ["add", "--", "src/userSearch.js", "test/sec-103-regression.test.js"]);
  await git(run.workspace, ["commit", "-m", "fix(SEC-103): parameterize user search query"]);
  await git(run.workspace, ["push", remote, `HEAD:refs/heads/${branch}`], authEnv);

  const octokit = new Octokit({ auth: token });
  const existing = await octokit.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open" });
  if (existing.data.length) return { dryRun: false, branch, title, body, url: existing.data[0].html_url };
  const created = await octokit.pulls.create({ owner, repo, head: branch, base: process.env.CODEX_TARGET_BASE_BRANCH || "main", title, body });
  return { dryRun: false, branch, title, body, url: created.data.html_url };
}
