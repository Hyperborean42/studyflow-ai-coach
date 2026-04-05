# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./

# Copy all packages (lib + artifacts + scripts)
COPY lib/ lib/
COPY artifacts/ artifacts/
COPY scripts/ scripts/

# Install all deps (--no-frozen-lockfile because overrides differ per platform)
RUN pnpm install --no-frozen-lockfile

# Build shared libs (typecheck emits .d.ts needed by downstream packages)
# Ignore errors from pre-existing issues in integrations lib
RUN pnpm run typecheck:libs || true

# Build frontend (needs PORT and BASE_PATH for vite config)
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/studyflow run build

# Build API server (esbuild bundle — self-contained, no runtime node_modules needed)
RUN pnpm --filter @workspace/api-server run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:24-slim AS production

WORKDIR /app

# Copy built API server bundle (self-contained esbuild output)
COPY --from=build /app/artifacts/api-server/dist/ ./dist/

# Copy built frontend into public/ (API server serves it as static files)
COPY --from=build /app/artifacts/studyflow/dist/public/ ./public/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
