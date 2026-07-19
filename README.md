# DevSecOps Copilot

Built for the Namaste Dev hackathon (Akshay Saini). An AI-style DevSecOps
pipeline that ties together four pieces:

1. **Jira MCP server** (`mcp-jira-server/`) — a standalone [MCP](https://modelcontextprotocol.io)
   server exposing Jira tickets via `list_tickets`, `get_ticket`, `get_logs`,
   and `create_ticket`. Uses **real Jira Cloud** (REST API v3) when
   `JIRA_BASE_URL`/`JIRA_EMAIL`/`JIRA_API_TOKEN`/`JIRA_PROJECT_KEY` are all
   set; otherwise falls back to mock data (`mcp-jira-server/data/tickets.json`)
   so the demo runs with zero config. It's a real MCP server, so it can also
   be plugged into Claude Code/Desktop directly.
2. **Real-time source code analyzer** (`backend/modules/codeAnalyzer.js`) —
   watches `backend/watched-repo/` with `chokidar` and flags issues (hardcoded
   secrets, `eval()`, SQL string concatenation, etc.) the moment a file
   changes.
3. **Automated PR bot** (`backend/modules/prBot.js`) — given a Jira ticket
   key, correlates it to the affected file, applies a rule-specific automated
   fix, commits it on a `fix/<ticket-key>` branch via `simple-git`, and opens
   a GitHub PR via Octokit — or, with no `GITHUB_TOKEN`/`GITHUB_REPO`
   configured, returns a dry-run preview of the branch/diff/PR body instead.
4. **Log-incident-to-Jira-ticket pipeline** (`backend/modules/incidentAnalyzer.js`,
   `backend/modules/llmDrafter.js`) — scans error logs (mock Splunk/
   Elasticsearch-style data by default), drafts a Jira ticket (summary,
   description, priority) per incident using Groq or Gemini (whichever's
   `GROQ_API_KEY`/`GEMINI_API_KEY` is set — Groq is tried first) or a
   deterministic rule-based draft if neither is set, shows you the draft to
   review, and creates the ticket via the Jira MCP server's `create_ticket`
   tool once you confirm.

The Express + Socket.IO backend (`backend/server.js`) wires all four
together and streams live updates to a React/Vite dashboard.

## Project layout

```
mcp-jira-server/   standalone MCP server (real Jira Cloud or mock data)
backend/           Express + Socket.IO API, code analyzer, PR bot, incident pipeline
  Dockerfile       container image (build from repo root — see Deploying below)
  watched-repo/    demo files with intentional vulnerabilities to scan/fix
  data/            mock log/incident data for the incident pipeline
frontend/          React/Vite dashboard (tickets, code findings, PR activity, log incidents)
  Dockerfile       multi-stage build — static assets served via `serve`
infra/             Terraform: Cloud Run, Artifact Registry, Secret Manager, WIF for GCP
.github/workflows/ GitHub Actions: builds + deploys both images to Cloud Run on push
```

## Running locally

Three terminals (or run backend + frontend; the backend spawns the MCP
server itself as a subprocess, so you don't need to start it separately).

```bash
# 1. Backend (also spawns the Jira MCP server as a child process)
cd backend
npm install
npm run dev        # http://localhost:4000

# 2. Frontend
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Open http://localhost:5173. You should see:
- **Jira Tickets** (left) — SEC-101/102/103, fetched live from the MCP server
- **Ticket Detail** (middle) — description, comment history, attached logs,
  and an **"Auto-fix & open PR"** button
- **Live Code Findings** (right, top) — updates in real time if you edit any
  file in `backend/watched-repo/`
- **PR Activity** (right, bottom) — appends every PR the bot opens
- **Log Incidents** (bottom, full width) — click **"Scan for incidents"** to
  see mock error-log incidents with an LLM-drafted (or rule-based) ticket
  preview, then **"Create Jira ticket"** to confirm and create it

Click a ticket, then **Auto-fix & open PR**. Without GitHub credentials
configured this runs in dry-run mode: it still creates the `fix/<ticket-key>`
branch and commit locally in `backend/watched-repo/` (a real git repo, unless
git isn't installed) and shows you the diff and PR title/body it would have
posted, checking back out to `main` afterward.

### Opening real GitHub PRs

The bot needs a **dedicated, empty repo** to manage — not this app's own repo.
It force-syncs its local `watched-repo/` clone to that repo's `main` and
force-pushes `fix/*` branches to it, so pointing it at a repo with unrelated
history would get overwritten.

1. Create a new empty repo on GitHub (no README/license), e.g.
   `your-username/devsecops-copilot-demo-target`.
2. Create a [fine-grained PAT](https://github.com/settings/tokens) scoped to
   just that repo, with **Contents: Read/write** and **Pull requests:
   Read/write** permissions.
3. Set these before starting the backend:
   ```bash
   export GITHUB_TOKEN=github_pat_xxx
   export GITHUB_REPO=your-username/devsecops-copilot-demo-target
   ```
4. First "Auto-fix & open PR" click will seed that repo's `main` with the 3
   demo files automatically, then open the PR against it.

### Using real Jira Cloud instead of mock tickets

Set all four before starting the backend:
```bash
export JIRA_BASE_URL=https://yourcompany.atlassian.net   # site root only, no path/query
export JIRA_EMAIL=you@yourcompany.com
export JIRA_API_TOKEN=...   # id.atlassian.com/manage-profile/security/api-tokens
export JIRA_PROJECT_KEY=SEC # your project's key, not necessarily "SEC"
```
`list_tickets`/`get_ticket`/`get_logs`/`create_ticket` all switch to hitting
the real API. Since attachments aren't always practical to seed via
automation, `get_logs`/the PR bot's file-correlation also fall back to
scanning the ticket **description** for one of the known demo filenames
(`paymentService.js`, `templateRenderer.js`, `userSearch.js`) if no attached
log file is found.

### Log-incident-to-Jira-ticket pipeline

Works with zero config (deterministic rule-based ticket drafts from the mock
log data in `backend/data/mockLogs.json`). To have an LLM draft the
summary/description/priority instead:
```bash
export GROQ_API_KEY=...     # console.groq.com — free tier, no card required (tried first)
# or
export GEMINI_API_KEY=...   # aistudio.google.com (note: some Google Cloud-issued
                             # keys need billing enabled even for "free tier" quota)
```
Click **"Scan for incidents"** in the dashboard, review each drafted ticket,
then **"Create Jira ticket"** — this calls the same Jira MCP server (real or
mock, per the config above), so tickets created here show up in your real
Jira project if one is configured.

### Using the Jira MCP server standalone

It's a normal stdio MCP server, so it can be added to any MCP client, e.g.
Claude Code:

```bash
claude mcp add jira-mock -- node /path/to/mcp-jira-server/index.js
```

## Deploying to GCP Cloud Run (Terraform + GitHub Actions)

This is the cost-optimized option: Cloud Run scales to zero when idle, so it
costs nothing between demo sessions, unlike an always-on host.

### One-time setup

1. Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install) and
   run `gcloud auth login` and `gcloud auth application-default login`.
2. Create (or pick) a GCP project and note its project ID. Make sure billing
   is linked (required even to use free-tier quota).
3. ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars
   # edit terraform.tfvars: at minimum set project_id and github_repo
   terraform init
   terraform plan    # review what it's about to create
   terraform apply
   ```
   This provisions: Artifact Registry, two Cloud Run services (backend +
   frontend, deployed initially with a placeholder image), Secret Manager
   secrets (placeholder values), and a Workload Identity Federation setup
   scoped to your GitHub repo so Actions can deploy without a stored key.
4. Note the outputs — you'll need `workload_identity_provider` and
   `deployer_service_account_email` for the next step.
5. In your GitHub repo → **Settings → Secrets and variables → Actions →
   Variables** tab, add these repo variables (none of these are secret
   values, they're just config — plain "Variables", not "Secrets"):
   | Name | Value |
   |---|---|
   | `GCP_PROJECT_ID` | your project ID |
   | `GCP_REGION` | e.g. `us-central1` |
   | `GCP_ARTIFACT_REPO` | `devsecops-copilot` (or your `repo_name` var) |
   | `GCP_BACKEND_SERVICE` | `devsecops-backend` |
   | `GCP_FRONTEND_SERVICE` | `devsecops-frontend` |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | the `workload_identity_provider` output |
   | `GCP_DEPLOYER_SA_EMAIL` | the `deployer_service_account_email` output |
6. Populate the real secret values (these actually are secrets — set via
   `gcloud`, never through Terraform variables or GitHub Actions logs):
   ```bash
   echo -n "github_pat_xxx" | gcloud secrets versions add github-token --data-file=- --project=YOUR_PROJECT_ID
   echo -n "your-jira-api-token" | gcloud secrets versions add jira-api-token --data-file=- --project=YOUR_PROJECT_ID
   echo -n "your-groq-key" | gcloud secrets versions add groq-api-key --data-file=- --project=YOUR_PROJECT_ID
   ```
7. Push to `main` (or run the workflow manually from the Actions tab) —
   GitHub Actions builds both images, pushes them to Artifact Registry, and
   deploys both Cloud Run services.

### After first deploy

Tighten CORS to the real frontend URL instead of `*`: set `cors_origin` in
`terraform.tfvars` to the `frontend_url` Terraform output, then
`terraform apply` again (or `gcloud run services update devsecops-backend
--set-env-vars CORS_ORIGIN=https://your-frontend-url`).

### Cost notes

- Both services scale to **zero** instances when idle (`min_instance_count = 0`)
  — no compute cost between uses.
- `max_instance_count = 2` on both caps any runaway scaling cost.
- Artifact Registry's cleanup policy keeps only the 5 most recent image
  versions per repo, so storage cost stays flat instead of growing forever.
- Consider setting a [budget alert](https://cloud.google.com/billing/docs/how-to/budgets)
  on the project so you get notified well before the $300 credit runs out.
- When you're done with the hackathon: `cd infra && terraform destroy` tears
  down every resource this created.

## Alternative: Render + Vercel

Simpler to set up manually (no Terraform/Docker), but Render's free tier
sleeps after 15 minutes idle and wakes slowly, and doesn't scale to zero the
way Cloud Run does cost-wise. Push this repo to GitHub, then:
- **Backend** → Render → New Web Service → Build Command
  `npm install --prefix backend && npm install --prefix mcp-jira-server`,
  Start Command `npm --prefix backend start`. Set the same env vars as above
  in Render's Environment tab.
- **Frontend** → Vercel → import the repo with Root Directory `frontend`, set
  `VITE_BACKEND_URL` to the Render URL.

## Demo script for the hackathon

1. Show the three mock Jira tickets (SEC-101 hardcoded key, SEC-102 eval RCE,
   SEC-103 SQL injection) already appearing in **Live Code Findings** —
   the code analyzer found them without being told.
2. Click SEC-101, walk through the description/comments/logs pulled live via
   MCP.
3. Click **Auto-fix & open PR** — show the generated diff and PR body that
   references the ticket and cites the log evidence.
4. Edit `backend/watched-repo/paymentService.js` live to show the findings
   panel update in real time via the socket connection.
5. Scroll to **Log Incidents**, click **Scan for incidents** — show the
   LLM-drafted ticket preview for a production error-log incident, then
   **Create Jira ticket** to show it land in Jira for reference/triage.
