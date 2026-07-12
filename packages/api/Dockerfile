# Build context must be the repo root (npm workspaces need the whole
# monorepo), e.g.: docker build -f packages/api/Dockerfile .
#
# TODO(REQUIREMENTS §3/§9.1/§10): swap `node:20-slim` for an Iron Bank
# Node image where available, run in FIPS mode, and apply the applicable
# DISA STIG hardening baseline before this goes anywhere near production.
# This base image is a placeholder to get the scaffold building/running.

FROM node:20-slim AS build
WORKDIR /app

# Prisma's schema/query engine binaries are linked against OpenSSL and
# need it present to detect the right build to use — `node:20-slim`
# doesn't ship it. Without this, `prisma generate`/`db push` silently
# guess a version ("Prisma failed to detect the libssl/openssl version")
# and can fail outright at either build or run time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/pdf/package.json packages/pdf/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY packages/pdf packages/pdf
COPY packages/api packages/api
RUN npm run prisma:generate --workspace=packages/shared
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/pdf
RUN npm run build --workspace=packages/api

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# See the build stage above — @prisma/client needs OpenSSL present at
# runtime too, for every query it makes.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# PDF report rendering (REQUIREMENTS §2.5) uses headless Chromium via
# Playwright, installed below into a fixed, world-readable path so the
# non-root `nexus` user (created next) can still launch it.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN groupadd --system nexus && useradd --system --gid nexus --home-dir /app nexus

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/prisma packages/shared/prisma
COPY --from=build /app/packages/pdf/package.json packages/pdf/package.json
COPY --from=build /app/packages/pdf/dist packages/pdf/dist
# `playwright` isn't hoisted to the root node_modules copied above —
# npm's workspace install nests it under packages/pdf/node_modules
# instead (deterministically, per package-lock.json), so Node's ESM
# resolution from packages/pdf/dist/*.js can't find it without this.
COPY --from=build /app/packages/pdf/node_modules packages/pdf/node_modules
COPY --from=build /app/packages/api/package.json packages/api/package.json
COPY --from=build /app/packages/api/dist packages/api/dist

# --with-deps installs Chromium plus the OS-level shared libraries it
# needs (fonts, libnss3, etc.) via apt — requires network access at
# *build* time only; the renderer itself never makes outbound requests
# (REQUIREMENTS §2.5/§10). For a true air-gapped build, replace this with
# a base image that already bundles the matching Chromium build instead
# of reaching out to the Playwright CDN.
RUN npx --prefix packages/pdf playwright install --with-deps chromium \
    && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

USER nexus
EXPOSE 3000
CMD ["node", "packages/api/dist/index.js"]
