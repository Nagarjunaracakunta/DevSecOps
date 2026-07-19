# Build from the frontend directory: docker build -t frontend ./frontend
# VITE_BACKEND_URL must be supplied at build time (Vite bakes env vars into
# the bundle) — pass it via --build-arg, e.g. the backend's Cloud Run URL.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev serve@14
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "npx serve -s dist -l ${PORT}"]
