# Build from the repo root: docker build -f backend/Dockerfile .
# (needs both backend/ and the sibling mcp-jira-server/ in the build context,
# since the backend spawns mcp-jira-server as a subprocess by relative path)
FROM node:22-alpine

# git is required at runtime: prBot.js shells out to it via simple-git.
RUN apk add --no-cache git

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
COPY mcp-jira-server/package.json mcp-jira-server/package-lock.json ./mcp-jira-server/
RUN npm --prefix backend ci --omit=dev \
 && npm --prefix mcp-jira-server ci --omit=dev

COPY backend/ ./backend/
COPY mcp-jira-server/ ./mcp-jira-server/

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/server.js"]
