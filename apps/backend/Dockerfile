# syntax=docker/dockerfile:1
# Medusa v2 backend — production image.
# Build context = repo root:  docker build -f apps/backend/Dockerfile -t sac-backend .
# Not: bu ortamda docker yok; CI / host'ta build edilir. Resmi Medusa
# production desenini izler (.medusa/server self-contained output).

# ---- builder: monorepo install + medusa build ------------------------------
FROM node:22-bookworm-slim AS builder
ENV NODE_ENV=development
# Native bağımlılıklar (sharp vb.) için derleme araçları.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Workspace manifest'leri önce (install cache).
COPY package.json package-lock.json turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/storefront/package.json apps/storefront/
RUN npm ci

# Kaynaklar + backend build (.medusa/server üretir).
COPY . .
RUN npm run build --workspace=@dtc/backend

# Built server'ın prod bağımlılıklarını kur (self-contained çıktı).
WORKDIR /repo/apps/backend/.medusa/server
RUN npm install --omit=dev

# ---- runner: minimal runtime, non-root -------------------------------------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=9000
WORKDIR /app

# Non-root kullanıcı.
RUN groupadd --system --gid 1001 medusa \
    && useradd --system --uid 1001 --gid medusa medusa

COPY --from=builder --chown=medusa:medusa /repo/apps/backend/.medusa/server ./

USER medusa
EXPOSE 9000

# Readiness: framework /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Başlangıç: önce migration, sonra server. (Tek instance için uygundur; çok
# instance'ta migration'ı ayrı bir release-job olarak çalıştırın.)
CMD ["sh", "-c", "npx medusa db:migrate && npx medusa start"]
