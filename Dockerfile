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
RUN mkdir -p ./public/uploads ./storage/payment-proofs ./.next/cache && chown -R nextjs:nodejs ./public/uploads ./storage ./.next/cache
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
