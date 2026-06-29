# syntax=docker/dockerfile:1
# Next.js 15 storefront — production image (standalone output).
# Build context = repo root:  docker build -f apps/storefront/Dockerfile -t sac-storefront .
# NEXT_PUBLIC_* değişkenleri build-time'da gömülür → build ARG olarak verin.

# ---- builder: monorepo install + next build (standalone) -------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /repo

# NEXT_PUBLIC_* build-time'da bundle'a girer.
ARG NEXT_PUBLIC_MEDUSA_BACKEND_URL
ARG NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_DEFAULT_REGION=tr
ENV NEXT_PUBLIC_MEDUSA_BACKEND_URL=$NEXT_PUBLIC_MEDUSA_BACKEND_URL \
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=$NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_DEFAULT_REGION=$NEXT_PUBLIC_DEFAULT_REGION \
    NODE_ENV=production

COPY package.json package-lock.json turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/storefront/package.json apps/storefront/
RUN npm ci

COPY . .
RUN npm run build --workspace=@dtc/storefront

# ---- runner: standalone server, non-root -----------------------------------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=8000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone server + statik varlıklar (monorepo izleme yolu korunur).
COPY --from=builder --chown=nextjs:nodejs /repo/apps/storefront/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/storefront/public ./apps/storefront/public

USER nextjs
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/'+(process.env.NEXT_PUBLIC_DEFAULT_REGION||'tr')).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/storefront/server.js"]
