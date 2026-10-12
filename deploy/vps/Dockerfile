FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN groupadd --system nazraa && useradd --system --gid nazraa --home /app nazraa
COPY --from=build --chown=nazraa:nazraa /app/package.json /app/package-lock.json ./
COPY --from=build --chown=nazraa:nazraa /app/node_modules ./node_modules
COPY --from=build --chown=nazraa:nazraa /app/.next ./.next
COPY --from=build --chown=nazraa:nazraa /app/public ./public
# `next start` reloads runtime config. Copying only .next silently restored
# the default 1 MB Server Action limit despite the build's 8 MB config.
COPY --from=build --chown=nazraa:nazraa /app/next.config.ts ./next.config.ts
COPY --from=build --chown=nazraa:nazraa /app/deploy/vps/worker.mjs ./worker.mjs
COPY --from=build --chown=nazraa:nazraa /app/deploy/vps/realtime.mjs ./realtime.mjs
USER nazraa
EXPOSE 3000
CMD ["npm", "run", "start"]
