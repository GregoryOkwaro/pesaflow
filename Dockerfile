# Web image: the Next.js server (port 3000).
#   docker build -t pesaflow-web .
# The background worker has its own file (Dockerfile.worker) because hosts such as
# Render build a Dockerfile's last stage and can't pick a target.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Next.js standalone output (small, only traced files)
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
