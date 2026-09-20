# Build once; runtime never changes the database schema.
FROM node:24-alpine AS builder
WORKDIR /app
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=${DATABASE_URL}
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npm run build

# Dedicated migration image, invoked explicitly before promotion.
FROM builder AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME="0.0.0.0"
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Seguro extra: Next copia .env/.env.production al standalone para `next start`
# (build/index.js writeStandaloneDirectory). .dockerignore ya los saca del
# contexto, pero si eso cambia jamás deben quedar en la imagen publicada —
# los valores reales siempre llegan por el entorno del contenedor.
RUN rm -f ./.env ./.env.production ./.env.*
# Fail-fast schema check before starting the server (no Prisma CLI in this image).
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-preflight.mjs ./scripts/docker-preflight.mjs
RUN mkdir -p ./public/uploads ./storage/payment-proofs ./storage/repair-evidence ./.next/cache && chown -R nextjs:nodejs ./public/uploads ./storage ./.next/cache
USER nextjs
EXPOSE 3000
CMD ["node", "scripts/docker-preflight.mjs"]
