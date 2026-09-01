# Container images

One parameterised Dockerfile builds every application. `turbo prune` reduces the build
context to the target application and its workspace dependencies, so an unrelated change
does not invalidate the install layer.

## docker/Dockerfile.app

```dockerfile
# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
ARG APP
COPY . .
RUN pnpm dlx turbo prune "${APP}" --docker

FROM base AS installer
ARG APP
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter="${APP}"

FROM node:${NODE_VERSION} AS runner
ARG APP
ENV NODE_ENV=production
ENV APP=${APP}
ENV PORT=3000
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
USER nextjs

# Next.js standalone output already contains the pruned node_modules.
COPY --from=installer --chown=nextjs:nodejs /repo/apps/${APP}/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=installer --chown=nextjs:nodejs /repo/apps/${APP}/public ./apps/${APP}/public

EXPOSE 3000
CMD ["sh", "-c", "node apps/${APP}/server.js"]
```

The image contains no configuration. `API_URL` and the other public values are read at
container start and injected into the document by `RuntimeEnvScript`, so the same image
is promoted from development to production.

## docker-compose.yml

One service per application plus the gateway.

Note what changes here: `mfe.port` is a **development** concern only. Each container
listens on 3000 and is addressed by service name, so compose sets
`APP_HOST_TEMPLATE=http://{name}:3000` and the port from the `mfe` block is not used at
all. The registry still drives the routing table — the prefix comes from `mfe.basePath` —
but the target host does not.

```yaml
x-app: &app
  build:
    context: .
    dockerfile: docker/Dockerfile.app
  environment:
    API_URL: ${API_URL}
    ENVIRONMENT: ${ENVIRONMENT}
  restart: unless-stopped

services:
  shell:
    <<: *app
    build:
      context: .
      dockerfile: docker/Dockerfile.app
      args:
        APP: shell
    expose:
      - "3000"

  billing:
    <<: *app
    build:
      context: .
      dockerfile: docker/Dockerfile.app
      args:
        APP: billing
    expose:
      - "3000"

  gateway:
    build:
      context: .
      dockerfile: docker/Dockerfile.gateway
    environment:
      GATEWAY_PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - shell
      - billing
```

## Gateway in compose

Inside compose, applications are reached by service name rather than `localhost`. The
gateway in `files/gateway.md` already reads `APP_HOST_TEMPLATE` for this, defaulting to
`http://localhost:{port}` so local development is unchanged. Set

```yaml
APP_HOST_TEMPLATE: http://{name}:3000
```

on the gateway service, as the compose file above does.

## docker/Dockerfile.gateway

The complete file. The `apps/*/package.json` copies are mandatory — `loadApps` reads them
at boot, so a gateway image without them exits immediately — and there is one such line
per application:

```dockerfile
# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable
WORKDIR /repo

FROM base AS installer
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY gateway ./gateway
COPY packages/mfe ./packages/mfe
COPY apps/shell/package.json ./apps/shell/package.json
COPY apps/<app>/package.json ./apps/<app>/package.json
RUN pnpm install --filter gateway... --prod --frozen-lockfile

FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
ENV GATEWAY_PORT=3000
WORKDIR /repo

RUN addgroup -g 1001 -S nodejs && adduser -S gateway -u 1001
COPY --from=installer --chown=gateway:nodejs /repo ./
USER gateway

EXPOSE 3000
CMD ["node", "gateway/index.js"]
```

## The Docker surface is unverified

Nothing in this skill builds or runs an image, so both Dockerfiles and the compose file
are the least-tested part of the template. Say so in the generated `AGENTS.md` rather than
implying they have been exercised. If the user wants them verified, that is a
`docker compose build` away and worth doing explicitly.
