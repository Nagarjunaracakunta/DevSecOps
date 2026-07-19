import { execFile } from "node:child_process";

export const DEFAULT_DEMO_GITHUB_REPO = "Nagarjunaracakunta/devsecops-demo-target";

export function configuredGithubRepo() {
  return process.env.GITHUB_REPO || DEFAULT_DEMO_GITHUB_REPO;
}

export function resolveGithubToken() {
  if (process.env.GITHUB_TOKEN) return Promise.resolve(process.env.GITHUB_TOKEN);
  if (process.env.GH_TOKEN) return Promise.resolve(process.env.GH_TOKEN);
  return new Promise((resolve) => {
    execFile("gh", ["auth", "token"], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}
