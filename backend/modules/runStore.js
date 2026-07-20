import { randomUUID } from "node:crypto";

export const RUN_STATUSES = [
  "queued", "collecting_evidence", "creating_workspace", "investigating",
  "root_cause_found", "generating_test", "reproduction_failed",
  "incident_reproduced", "generating_patch", "verifying", "reviewing",
  "awaiting_approval", "publishing", "completed", "failed", "rejected"
];

const TRANSITIONS = {
  queued: ["collecting_evidence", "failed"],
  collecting_evidence: ["creating_workspace", "failed"],
  creating_workspace: ["investigating", "failed"],
  investigating: ["root_cause_found", "failed"],
  root_cause_found: ["generating_test", "failed"],
  generating_test: ["incident_reproduced", "reproduction_failed", "failed"],
  incident_reproduced: ["generating_patch", "failed"],
  generating_patch: ["verifying", "failed"],
  verifying: ["reviewing", "failed"],
  reviewing: ["awaiting_approval", "failed"],
  awaiting_approval: ["publishing", "rejected", "failed"],
  publishing: ["completed", "failed"],
  reproduction_failed: [],
  completed: [],
  failed: [],
  rejected: []
};

export class InMemoryRunStore {
  #runs = new Map();

  create(input) {
    const now = new Date().toISOString();
    const run = {
      id: randomUUID(),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      timeline: [{ status: "queued", timestamp: now }],
      approved: false,
      ...input
    };
    this.#runs.set(run.id, run);
    return structuredClone(run);
  }

  get(id) {
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : null;
  }

  update(id, patch) {
    const current = this.#runs.get(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.#runs.set(id, updated);
    return structuredClone(updated);
  }

  transition(id, status, patch = {}) {
    if (!RUN_STATUSES.includes(status)) throw new Error(`Unknown run status: ${status}`);
    const current = this.#runs.get(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    if (!TRANSITIONS[current.status]?.includes(status)) {
      throw new Error(`Invalid run transition: ${current.status} -> ${status}`);
    }
    const timestamp = new Date().toISOString();
    return this.update(id, {
      ...patch,
      status,
      timeline: [...current.timeline, { status, timestamp }]
    });
  }

  delete(id) {
    return this.#runs.delete(id);
  }
}

export const runStore = new InMemoryRunStore();
