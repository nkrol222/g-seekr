# Build: the React UI (Vite) and the server (tsc), then drop the dev dependencies
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.base.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run build && npm prune --omit=dev

# Run: node:sqlite needs Node 22.13 or later, which node:22-alpine is
FROM node:22-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=5056
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
# Runs as node (1000:1000) unless compose sets user:; /data must be writable by whoever it is
USER node
VOLUME /data
EXPOSE 5056
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
