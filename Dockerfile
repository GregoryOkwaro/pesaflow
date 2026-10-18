# Two images from one Dockerfile:
#   docker build --target web    -t pesaflow-web .     # Next.js server (port 3000)
#   docker build --target worker -t pesaflow-worker .  # background jobs + migrations

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- web: Next.js standalone output (small, only traced files)
FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 pesaflow
COPY --from=build --chown=pesaflow /app/.next/standalone ./
COPY --from=build --chown=pesaflow /app/.next/static ./.next/static
COPY --from=build --chown=pesaflow /app/public ./public
USER pesaflow
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ---- worker: runs migrations on start, then processes jobs
FROM node:24-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 1001 pesaflow
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=pesaflow tsconfig.json ./
COPY --chown=pesaflow drizzle ./drizzle
COPY --chown=pesaflow src ./src
USER pesaflow
CMD ["sh", "-c", "npx tsx src/server/db/migrate.ts && npx tsx src/server/jobs/worker.ts"]
