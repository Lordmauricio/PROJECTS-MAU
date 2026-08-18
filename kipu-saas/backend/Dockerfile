FROM node:22-slim AS base
WORKDIR /app
# `openssl` lo necesita Prisma; `curl` lo usa el HEALTHCHECK de más abajo.
RUN apt-get update -y && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# `scripts/` es imprescindible en runtime: `docker-entrypoint.sh` corre
# `scripts/provision-db-roles.ts` para asignarle la contraseña a `app_user`
# después de las migraciones. Sin este COPY el contenedor arranca y falla en
# el entrypoint.
COPY --from=build /app/scripts ./scripts
COPY package.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# La imagen de node ya trae el usuario `node` (uid 1000). Correr como root
# significa que cualquier ejecución de código arbitraria dentro del
# contenedor arranca con privilegios totales sobre él.
USER node

EXPOSE 4200

# Liveness a nivel de contenedor: consulta el endpoint que NO toca
# dependencias, para que una caída de Postgres no dispare un reinicio en
# bucle del backend (para eso está /health/ready, que mira el balanceador).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4200/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
