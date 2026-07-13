# Build context must be the repo root, e.g.:
#   docker build -f packages/pdf-service/Dockerfile .
#
# The isolated PDF-rendering component (REQUIREMENTS §2.5) — the only
# place in this repo that runs headless Chromium. Kept as its own image/
# Deployment specifically so the API and Worker no longer need
# Playwright's build-time egress or Chromium's OS-level footprint at all;
# see helm/nexus-scheduler's pdf-service NetworkPolicy for the "no
# egress" enforcement this split enables.
#
# TODO(REQUIREMENTS §3/§9.1/§10): swap `node:20-slim` for an Iron Bank
# Node image where available, run in FIPS mode, and apply the applicable
# DISA STIG hardening baseline. This is a placeholder base image.

FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/pdf/package.json packages/pdf/package.json
COPY packages/pdf-service/package.json packages/pdf-service/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY packages/pdf packages/pdf
COPY packages/pdf-service packages/pdf-service
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/pdf
RUN npm run build --workspace=packages/pdf-service

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Headless Chromium via Playwright, installed into a fixed,
# world-readable path so the non-root `nexus` user (created next) can
# still launch it.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN groupadd --system nexus && useradd --system --gid nexus --home-dir /app nexus

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/pdf/package.json packages/pdf/package.json
COPY --from=build /app/packages/pdf/dist packages/pdf/dist
# `playwright` isn't hoisted to the root node_modules copied above —
# npm's workspace install nests it under packages/pdf/node_modules
# instead (deterministically, per package-lock.json), so Node's ESM
# resolution from packages/pdf/dist/*.js can't find it without this.
COPY --from=build /app/packages/pdf/node_modules packages/pdf/node_modules
COPY --from=build /app/packages/pdf-service/package.json packages/pdf-service/package.json
COPY --from=build /app/packages/pdf-service/dist packages/pdf-service/dist

# --with-deps installs Chromium plus the OS-level shared libraries it
# needs (fonts, libnss3, etc.) via apt — requires network access at
# *build* time only; the renderer itself never makes outbound requests
# at runtime, which is exactly what this component's NetworkPolicy
# enforces (REQUIREMENTS §2.5/§10). For a true air-gapped build, replace
# this with a base image that already bundles the matching Chromium
# build instead of reaching out to the Playwright CDN.
RUN npx --prefix packages/pdf playwright install --with-deps chromium \
    && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

USER nexus
EXPOSE 4100
CMD ["node", "packages/pdf-service/dist/index.js"]
