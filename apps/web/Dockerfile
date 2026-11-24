# Web. Контекст сборки — корень репозитория: docker build -f apps/web/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @qorgan/web
COPY apps/web apps/web
RUN pnpm --filter @qorgan/web exec ng build

# Caddy отдаёт статику и проксирует /api на сервис api (см. deploy/Caddyfile).
FROM caddy:2-alpine
COPY apps/web/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist/qorgan-app/browser /srv
EXPOSE 8080
