# Base images through mirror.gcr.io, like the hub: the VPS pulls anonymously
# and Docker Hub answers 429 on busy days.
FROM mirror.gcr.io/library/node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build

FROM mirror.gcr.io/library/node:24-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM mirror.gcr.io/library/node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NETKY_DATA_DIR=/data NODE_NO_WARNINGS=1
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/.output ./.output
COPY --chown=node:node package.json ./
COPY --chown=node:node src/core ./src/core
COPY --chown=node:node src/worker ./src/worker
COPY --chown=node:node scripts/start.mjs ./scripts/start.mjs
# A named volume mounted here inherits this ownership on first use.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/v1/stats >/dev/null || exit 1
CMD ["node", "scripts/start.mjs"]
