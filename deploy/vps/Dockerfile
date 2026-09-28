FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN groupadd --system nazraa && useradd --system --gid nazraa --home /app nazraa
COPY --from=build --chown=nazraa:nazraa /app/package.json /app/package-lock.json ./
COPY --from=build --chown=nazraa:nazraa /app/node_modules ./node_modules
COPY --from=build --chown=nazraa:nazraa /app/.next ./.next
COPY --from=build --chown=nazraa:nazraa /app/public ./public
COPY --from=build --chown=nazraa:nazraa /app/deploy/vps/worker.mjs ./worker.mjs
USER nazraa
EXPOSE 3000
CMD ["npm", "run", "start"]
