# Backend /ingest untuk Cloud Run. Build dari ROOT repo (butuh workspace
# @solamax/shared): gcloud run deploy --source .   (atau docker build .)
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @solamax/backend...
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @solamax/shared build \
  && pnpm --filter @solamax/backend prisma:generate \
  && pnpm --filter @solamax/backend build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Sederhana & deterministik: bawa workspace ter-build apa adanya (node_modules
# berisi devDeps → image lebih besar; bisa dioptimalkan nanti, bukan blocker staging).
COPY --from=build /app /app
WORKDIR /app/apps/backend
EXPOSE 8080
CMD ["node", "dist/main.js"]
