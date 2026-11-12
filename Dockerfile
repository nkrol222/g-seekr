# Multi-arch (amd64 + arm64: argus is a Raspberry Pi 5) without emulation.
# The build stage runs on the builder's own platform: its output is plain JavaScript, and
# the production dependencies have no native code or install scripts (node:sqlite is built
# into Node), so they work unchanged on either architecture. The runtime stage has no RUN
# step, so nothing executes on the target platform while building.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.base.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run build && npm prune --omit=dev && mkdir -p /out/data

# Run: node:sqlite needs Node 22.13 or later, which node:22-alpine is
FROM node:22-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=5056
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build --chown=node:node /out/data /data
# Runs as node (1000:1000) unless compose sets user:; /data must be writable by whoever it is
USER node
VOLUME /data
EXPOSE 5056
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
