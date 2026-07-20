import { spawn } from "node:child_process";

export const COMMANDS = Object.freeze({
  install: ["npm", ["install", "--ignore-scripts"]],
  ci: ["npm", ["ci", "--ignore-scripts"]],
  test: ["npm", ["test"]],
  regression: ["node", ["--test", "test/sec-103-regression.test.js"]],
  lint: ["npm", ["run", "lint"]],
  security: ["npm", ["run", "security"]],
  diff: ["git", ["diff", "--no-ext-diff", "--"]],
  status: ["git", ["status", "--short"]],
  baseCommit: ["git", ["rev-parse", "HEAD"]]
});

export function isAllowedCommand(name) {
  return Object.hasOwn(COMMANDS, name);
}

export function runVerification(name, cwd, { timeoutMs = 120_000, maxOutput = 50_000 } = {}) {
  if (!isAllowedCommand(name)) throw new Error(`Command is not allowlisted: ${name}`);
  const [command, args] = COMMANDS[name];
  const started = Date.now();
  return new Promise((resolve) => {
    const env = { ...process.env, CI: "1", npm_config_ignore_scripts: "true" };
    // A verification command can itself be launched from this project's
    // node:test suite. Do not let Node mistake the nested target runner for
    // one of the parent runner's managed child processes.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => (current + chunk.toString()).slice(-maxOutput);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ command: [command, ...args].join(" "), exitCode: null, stdout, stderr, durationMs: Date.now() - started, passed: false, error: error.message });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(" "),
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        passed: exitCode === 0
      });
    });
  });
}
