# Dashboard (Next.js standalone) untuk Cloud Run.
# Build dari ROOT repo (butuh pnpm workspace lockfile):
#   docker build -f apps/dashboard/Dockerfile -t <img> .
# Root Dockerfile (backend) sengaja TIDAK dipakai di sini.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile --filter @solamax/dashboard...
COPY apps/dashboard apps/dashboard
# Dummy env HANYA saat build: db.ts membuat pg.Pool saat import (dipakai adapter
# Auth.js) sehigga butuh connection string ADA — TIDAK konek (semua halaman data
# force-dynamic, nol query saat build). Env runtime di-set Cloud Run, bukan ini.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-only-not-used \
    AUTH_TRUST_HOST=true
RUN pnpm --filter @solamax/dashboard build

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
# Output standalone Next (monorepo → server.js bersarang di apps/dashboard/).
COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public
EXPOSE 8080
CMD ["node", "apps/dashboard/server.js"]
