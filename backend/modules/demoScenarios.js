import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SEC_103 = Object.freeze({
  id: "sec-103-sql-injection",
  ticketKey: "SEC-103",
  repositoryPath: path.resolve(__dirname, "..", "..", "devsecops-demo-target-main"),
  baseBranch: process.env.CODEX_TARGET_BASE_BRANCH || "main",
  affectedFile: "src/userSearch.js",
  maliciousInput: "' OR '1'='1",
  finding: {
    ruleId: "sql-string-concat",
    severity: "high",
    file: "src/userSearch.js",
    function: "searchUsersByName",
    message: "SQL query structure is changed by untrusted input"
  }
});

export function getScenario(id = SEC_103.id) {
  if (id !== SEC_103.id) throw new Error(`Unsupported scenario: ${id}`);
  return SEC_103;
}

export function validateRunRequest(input = {}) {
  const ticketKey = input.ticketKey || SEC_103.ticketKey;
  const scenarioId = input.scenarioId || SEC_103.id;
  if (ticketKey !== SEC_103.ticketKey) throw new Error("Only ticket SEC-103 is allowed");
  if (scenarioId !== SEC_103.id) throw new Error("Only the SEC-103 SQL-injection scenario is allowed");
  if (input.repositoryUrl && input.repositoryUrl !== process.env.CODEX_TARGET_REPOSITORY) {
    throw new Error("Arbitrary repositories are not allowed");
  }
  if (input.prompt) throw new Error("Arbitrary prompts are not allowed");
  return getScenario(scenarioId);
}
