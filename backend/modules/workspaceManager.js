import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SEC_103 } from "./demoScenarios.js";

const ROOT = path.join(os.tmpdir(), "devsecops-copilot-runs");

function execFile(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} exited ${code}`)));
  });
}

function allowedSource() {
  return process.env.CODEX_TARGET_REPOSITORY || SEC_103.repositoryPath;
}

export async function createWorkspace(runId, scenario = SEC_103) {
  const source = allowedSource();
  if (source !== scenario.repositoryPath && source !== process.env.CODEX_TARGET_REPOSITORY) {
    throw new Error("Target repository is not allowlisted");
  }
  if (path.resolve(source) === path.resolve(process.cwd())) throw new Error("Refusing to operate on the application repository");
  await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
  const runRoot = await fs.mkdtemp(path.join(ROOT, `${runId.slice(0, 8)}-`));
  const workspace = path.join(runRoot, "repository");
  const localSource = !/^https?:\/\//i.test(source) && !/^git@/i.test(source);
  const hasLocalGit = localSource
    ? await fs.stat(path.join(source, ".git")).then(() => true).catch(() => false)
    : false;
  if (localSource && !hasLocalGit) {
    await fs.cp(source, workspace, {
      recursive: true,
      filter: (candidate) => !candidate.split(path.sep).includes("node_modules")
    });
    await execFile("git", ["init", "-b", scenario.baseBranch], workspace);
    await execFile("git", ["config", "user.email", "devsecops-demo@example.com"], workspace);
    await execFile("git", ["config", "user.name", "DevSecOps Demo"], workspace);
    await execFile("git", ["add", "."], workspace);
    await execFile("git", ["commit", "-m", "chore: materialize bundled vulnerable target"], workspace);
  } else {
    await execFile("git", ["clone", "--no-hardlinks", "--branch", scenario.baseBranch, "--single-branch", source, workspace], runRoot);
  }
  const baseCommitSha = await execFile("git", ["rev-parse", "HEAD"], workspace);
  return { runRoot, workspace, baseCommitSha, source };
}

export async function cleanupWorkspace(runRoot) {
  if (!runRoot) return;
  const resolved = path.resolve(runRoot);
  if (!resolved.startsWith(path.resolve(ROOT) + path.sep)) throw new Error("Refusing cleanup outside run root");
  await fs.rm(resolved, { recursive: true, force: true });
}

export function assertInsideWorkspace(workspace, candidate) {
  const root = path.resolve(workspace);
  const target = path.resolve(candidate);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path escapes the target workspace");
  return target;
}
