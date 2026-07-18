# DevSecOps Copilot

Built for the Namaste Dev hackathon (Akshay Saini). An AI-style DevSecOps
pipeline that ties together three pieces:

1. **Jira MCP server** (`mcp-jira-server/`) — a standalone [MCP](https://modelcontextprotocol.io)
   server exposing mock Jira tickets (description, comment/activity history,
   and attached error logs/stack traces) via three tools: `list_tickets`,
   `get_ticket`, `get_logs`. No real Jira account needed — it reads from
   `mcp-jira-server/data/tickets.json`. It's a real MCP server, so it can also
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

The Express + Socket.IO backend (`backend/server.js`) wires all three
together and streams live updates to a React/Vite dashboard.

## Project layout

```
mcp-jira-server/   standalone MCP server (mock Jira data)
backend/           Express + Socket.IO API, code analyzer, PR bot
  watched-repo/    demo files with intentional vulnerabilities to scan/fix
frontend/          React/Vite dashboard (3 panels: tickets, code findings, PR activity)
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

Click a ticket, then **Auto-fix & open PR**. Without GitHub credentials
configured this runs in dry-run mode: it still creates the `fix/<ticket-key>`
branch and commit locally in `backend/watched-repo/` (a real git repo, unless
git isn't installed) and shows you the diff and PR title/body it would have
posted, checking back out to `main` afterward.

### Opening real GitHub PRs

Set these before starting the backend to have the bot push and open a real PR
instead of a dry run:

```bash
export GITHUB_TOKEN=ghp_xxx      # needs repo scope
export GITHUB_REPO=owner/repo    # a repo you can push fix/* branches to
```

### Using the Jira MCP server standalone

It's a normal stdio MCP server, so it can be added to any MCP client, e.g.
Claude Code:

```bash
claude mcp add jira-mock -- node /path/to/mcp-jira-server/index.js
```

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
