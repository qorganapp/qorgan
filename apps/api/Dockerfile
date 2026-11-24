# API. Контекст сборки — корень репозитория: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @qorgan/api
COPY apps/api apps/api
RUN pnpm --filter @qorgan/api build

# Только production-зависимости — они и попадают в итоговый образ.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter @qorgan/api

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /repo/apps/api
COPY --from=deps /repo/node_modules /repo/node_modules
COPY --from=deps /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
