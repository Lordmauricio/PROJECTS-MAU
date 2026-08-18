FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# `NEXT_PUBLIC_*` se resuelve EN BUILD, no en runtime: Next.js la incrusta en
# el bundle que descarga el navegador. Cambiar la URL de la API después
# exige reconstruir la imagen, no basta con reiniciar el contenedor.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# `output: "standalone"` (next.config.ts) arma en `.next/standalone` un
# servidor con solo las dependencias que realmente usa — por eso acá no se
# copia `node_modules`.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Igual que el backend: no correr como root. La imagen de node ya trae el
# usuario `node` (uid 1000).
USER node

EXPOSE 3000

# Usa el `fetch` global de Node 22 en vez de curl, para no tener que instalar
# nada extra en la imagen.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
