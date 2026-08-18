# Despliegue y operación

Guía para poner KIPU en producción. Cubre lo que el sistema **exige** para
arrancar, cómo se comprueba que está sano, cómo se respalda y cómo se
recupera.

> Alcance: SaaS comercial. La facturación electrónica (SIN, CUF/CUIS/CUFD,
> XML, firma digital) **no está implementada** y queda fuera de este
> documento.

---

## 1. Requisitos

| Componente | Versión | Notas |
|---|---|---|
| PostgreSQL | 16+ | Con RLS. La app se conecta con `app_user`, sin `BYPASSRLS`. |
| Redis | 7+ | Colas BullMQ (auditoría, emails). Conviene AOF activado. |
| Node.js | 22 | Solo si se despliega sin Docker. |

---

## 2. Variables de entorno

El backend **valida la configuración al arrancar** y se niega a levantar si
algo falta o es inseguro (`src/config/env.validation.ts`). Es deliberado:
mejor no arrancar que arrancar inseguro.

### Obligatorias siempre

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Conexión de administración (migraciones y provisioning). Rol con permiso DDL. |
| `RUNTIME_DATABASE_URL` | Conexión de la app. **Debe** ser `app_user` (sin `BYPASSRLS`) y distinta de `DATABASE_URL`. |
| `REDIS_URL` | Redis de las colas. |
| `JWT_ACCESS_SECRET` | Firma del access token. Distinto del refresh. |
| `JWT_REFRESH_SECRET` | Firma del refresh. |
| `APP_USER_PASSWORD` | Contraseña de `app_user`, usada por `db:provision-roles`. |

### Obligatorias con `NODE_ENV=production`

| Variable | Regla |
|---|---|
| `CORS_ORIGINS` | Lista explícita separada por coma (`https://app.kipu.bo`). No se acepta `*`. Usar `none` si ninguna web la consume. |
| `EMAIL_PROVIDER` | Debe ser `smtp`. `console` solo escribe el email en el log y se rechaza en producción. |
| `EMAIL_SMTP_HOST` / `EMAIL_SMTP_PORT` / `EMAIL_FROM` | Requeridas cuando el proveedor es `smtp`. |
| `JWT_*_SECRET` | Mínimo 32 caracteres, y no puede ser un valor de ejemplo conocido. |

### Opcionales

| Variable | Default | Cuándo cambiarla |
|---|---|---|
| `TRUST_PROXY` | `false` | `true` **solo** si hay un reverse proxy delante que fija `X-Forwarded-For`. Activarlo sin proxy permite falsear la IP y esquivar el rate limiting. |
| `PORT` | `4200` | |
| `APP_SUPERADMIN_PASSWORD` | *(vacío)* | Solo para habilitar el rol `app_superadmin` (`BYPASSRLS`) cuando exista el backoffice. Vacío = queda `NOLOGIN`. |

Generar cada secreto con:

```bash
openssl rand -base64 32
```

**Ningún secreto vive en el repositorio.** `.env.example` es una plantilla
con valores vacíos; `docker-compose.yml` los toma del entorno y falla de
entrada si faltan.

---

## 3. Primer despliegue

```bash
# 1. Migraciones (crean los roles app_user/app_superadmin, sin contraseña).
npx prisma migrate deploy

# 2. Contraseña de app_user desde el entorno. Sin este paso la app NO puede
#    conectarse: es fail-closed a propósito.
npm run db:provision-roles

# 3. Catálogo de permisos y plan gratuito (idempotente).
npx prisma db seed

# 4. Arrancar.
node dist/src/main.js
```

Con Docker, `docker-entrypoint.sh` ya encadena los pasos 1–3.

### Rotar la contraseña de `app_user`

```bash
APP_USER_PASSWORD='<nueva>' npm run db:provision-roles
# y actualizar RUNTIME_DATABASE_URL con el mismo valor antes de reiniciar
```

---

## 4. Health checks

| Endpoint | Qué responde | Para qué sirve |
|---|---|---|
| `GET /health` | `200` siempre que el proceso viva. No toca dependencias. | **Liveness.** Es el que debe mirar el orquestador para decidir si reinicia el contenedor. |
| `GET /health/ready` | `200` si Postgres y Redis responden; `503` con el detalle si no. | **Readiness.** Es el que debe mirar el balanceador para decidir si manda tráfico. |

No usar `/health/ready` como liveness: una caída de Postgres reiniciaría el
backend en bucle sin arreglar nada.

---

## 5. Backups y recuperación

Lo que hay que respaldar es **PostgreSQL**. Redis solo guarda trabajo en
tránsito (emails y auditoría encolados); perderlo no pierde datos de
negocio, aunque conviene AOF para no perder jobs en un reinicio.

### Respaldo

```bash
# OJO con la URL: `DATABASE_URL` lleva `?schema=public`, que es un parámetro
# de Prisma. libpq lo rechaza ("invalid URI query parameter: schema"), así
# que hay que recortarlo — eso hace `${DATABASE_URL%%\?*}`.
pg_dump --format=custom --no-owner --no-privileges \
  --file="kipu-$(date +%F-%H%M).dump" "${DATABASE_URL%%\?*}"
```

Recomendado: diario automatizado + retención de 30 días, con el volcado
fuera de la máquina de la base. Verificar periódicamente que un restore
funciona — un backup que nunca se restauró no es un backup.

### Restauración

```bash
createdb kipu_saas_restore
RESTORE_URL="postgresql://postgres:...@localhost:5432/kipu_saas_restore"

pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" kipu-....dump

# IMPRESCINDIBLE. El dump se toma con --no-privileges, así que NO trae los
# GRANTs: `app_user` existe (es un rol del cluster) pero se queda sin ningún
# permiso sobre las tablas restauradas, y la app arranca y falla con
# "permission denied for table organizations".
#
# `prisma migrate deploy` NO alcanza para esto: las migraciones ya vienen
# registradas en `_prisma_migrations` dentro del dump, así que no se vuelven
# a ejecutar y los GRANT de la migración inicial nunca corren. Es
# `db:provision-roles` el que re-aplica permisos y contraseña.
DATABASE_URL="$RESTORE_URL?schema=public" npm run db:provision-roles
```

Después, verificar antes de mandar tráfico:

```bash
# Debe devolver 42 tablas con RLS y 43 policies (mismo número que el origen).
psql "$RESTORE_URL" -tAc "SELECT count(*) FILTER (WHERE relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'"
psql "$RESTORE_URL" -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public'"
```

### Qué viaja y qué no en el dump

| Elemento | ¿Viaja? | Qué hacer |
|---|---|---|
| Datos y schema | Sí | — |
| **Policies de RLS y `FORCE ROW LEVEL SECURITY`** | **Sí** | Verificado en un restore real: 42 tablas / 43 policies, idénticas al origen. |
| Historial de migraciones (`_prisma_migrations`) | Sí | Por eso `migrate deploy` queda en no-op tras un restore. |
| **GRANTs sobre las tablas** | **No** (`--no-privileges`) | `npm run db:provision-roles` los re-aplica. |
| **Rol `app_user` y su contraseña** | **No** (es del cluster, y `--no-owner`) | Ídem: `db:provision-roles`. |

> Este procedimiento se ensayó completo (dump → restore en base nueva →
> provisioning → arranque de la app → login con un usuario restaurado) y los
> dos primeros puntos de la tabla surgieron justamente de ese ensayo: la
> versión anterior de este documento afirmaba lo contrario sobre las policies
> y omitía el problema de los GRANTs.

---

## 6. Seguridad en producción

Ya aplicado en el código:

- **CORS** restringido por `CORS_ORIGINS`; sin lista, ningún navegador puede
  consumir la API.
- **helmet**: `nosniff`, `X-Frame-Options`, HSTS, CSP, y sin `X-Powered-By`.
- **Rate limiting**: 120 req/min global; `login` 10/min, `password-reset`
  (request y confirm) 5/min, `refresh`/`logout` 30/min. Los health checks
  quedan exentos. Los límites son **por IP**: si varios usuarios comparten
  una NAT, no conviene bajarlos sin antes poner un proxy que reporte la IP
  real (`TRUST_PROXY=true`).
- **Errores**: las excepciones no controladas devuelven un `500` genérico con
  un `errorId`; el detalle (stack, mensajes de Postgres/Prisma) va solo al
  log del servidor. En producción tampoco se devuelve el detalle de
  validación.
- **RLS**: la app corre como `app_user`, sin `BYPASSRLS`; `PrismaService`
  falla al arrancar si detecta lo contrario.

Pendiente a nivel de infraestructura (fuera del código):

- **TLS**: el backend no termina TLS. Va detrás de un proxy/plataforma que lo
  haga, y ahí mismo conviene poner `TRUST_PROXY=true`.
- **Rotación de secretos**: definir periodicidad para JWT y `app_user`.

---

## 7. Logs

Salida estándar del proceso (formato de NestJS). Un `500` se registra como:

```
[HttpException] [<errorId>] POST /sales -> 500: <mensaje real>
```

El `errorId` es el mismo que recibió el cliente, así que un usuario que
reporta un error permite ubicar la traza exacta.

---

## 8. Runbook de go-live

Secuencia exacta para el primer despliegue. Cada paso indica cómo saber que
salió bien antes de pasar al siguiente.

### 8.1 Antes de tocar el servidor

- [ ] Dominio y certificado TLS listos (el backend **no** termina TLS).
- [ ] Servidor SMTP real con credenciales válidas — el backend se niega a
      arrancar en producción con `EMAIL_PROVIDER=console`.
- [ ] Decidido dónde corre el reverse proxy. Si va en el mismo host, dejar
      `HTTP_BIND_ADDR=127.0.0.1` (default) y `TRUST_PROXY=true`.

### 8.2 Preparar el `.env` de la raíz

```bash
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -base64 32)
APP_USER_PASSWORD=$(openssl rand -base64 32)
JWT_ACCESS_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
CORS_ORIGINS=https://app.tu-dominio.bo
NEXT_PUBLIC_API_URL=https://api.tu-dominio.bo
TRUST_PROXY=true
EMAIL_SMTP_HOST=smtp.tu-proveedor.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=...
EMAIL_SMTP_PASSWORD=...
EMAIL_FROM=no-reply@tu-dominio.bo
EOF
chmod 600 .env
```

`NEXT_PUBLIC_API_URL` se resuelve **en build**: cambiarla después obliga a
reconstruir la imagen del frontend, no basta con reiniciar.

**Verificación:** `docker compose config >/dev/null` termina sin error. Si
falta una variable, falla acá y no a mitad del arranque.

### 8.3 Levantar

```bash
docker compose build
docker compose up -d
docker compose ps        # los 4 servicios en "healthy"/"running"
docker compose logs -f backend
```

En los logs del backend deben verse, en orden: migraciones aplicadas,
`app_user: contraseña asignada y permisos sobre public re-aplicados`, seed
del catálogo, y `KIPU SAAS backend escuchando en el puerto 4200 (production)`.

Si aparece `Configuración inválida — el proceso no arranca`, el mensaje dice
exactamente qué variable falta: corregir el `.env` y `docker compose up -d`
otra vez.

### 8.4 Verificación post-deploy

```bash
curl -fsS http://127.0.0.1:4200/health          # {"status":"ok",...}
curl -fsS http://127.0.0.1:4200/health/ready    # database:ok, cache:ok
```

- [ ] `/health/ready` devuelve `200` con `database` y `cache` en `ok`.
- [ ] Las cabeceras traen `X-Content-Type-Options`, `X-Frame-Options`,
      `Strict-Transport-Security` y no traen `X-Powered-By`.
- [ ] Un `Origin` ajeno **no** recibe `Access-Control-Allow-Origin`.
- [ ] Registrar una organización de prueba, hacer una venta y emitir un
      recibo; el PDF baja con `Content-Type: application/pdf` y dice
      `DOCUMENTO COMERCIAL NO FISCAL`.
- [ ] Llega el email de bienvenida (si no, revisar SMTP: el fallo queda en
      `email_logs` con `status=FAILED`, sin afectar la operación comercial).
- [ ] `psql` desde fuera del servidor a `:5432` **no** conecta (el compose lo
      publica solo en `127.0.0.1`).
- [ ] Borrar la organización de prueba o dejar constancia de que es de prueba.

### 8.5 Primer backup

No dar el go-live por cerrado sin haber hecho **y restaurado** un backup —
ver §5. El procedimiento completo está ensayado, incluido el paso de
`db:provision-roles` que sin él deja la base restaurada sin permisos.

---

## 9. Pruebas pendientes: requieren un daemon de Docker

Todo lo de este documento se validó ejecutándolo de verdad, **salvo lo que
necesita Docker corriendo**. En el entorno donde se preparó esta fase no hay
daemon (`docker info` → `dial unix /var/run/docker.sock: no such file or
directory`), así que lo siguiente queda explícitamente **pendiente de correr
en el servidor real**. No están simuladas ni marcadas como hechas.

| # | Prueba | Comando | Resultado esperado |
|---|---|---|---|
| D1 | Build de las imágenes | `docker compose build` | Ambas imágenes construyen sin error. Es la primera que hay que correr: valida el `COPY scripts/` del backend (sin él, el entrypoint falla) y el `output: standalone` del frontend. |
| D2 | El `.dockerignore` funciona | `docker run --rm --entrypoint sh kipu-saas-backend -c 'ls -a /app'` | **No** debe aparecer `.env` ni `node_modules` del host. |
| D3 | Arranque completo | `docker compose up -d && docker compose ps` | Los 4 servicios `healthy`. |
| D4 | Healthcheck del contenedor | `docker inspect --format '{{.State.Health.Status}}' <backend>` | `healthy` tras el `start_period` de 60s. |
| D5 | Orden de dependencias | `docker compose up -d` desde cero | El backend no arranca antes de que Postgres/Redis estén `healthy`; el frontend espera al backend. |
| D6 | Persistencia | `docker compose down && docker compose up -d` | Los datos siguen ahí (volúmenes `kipu_postgres_data` / `kipu_redis_data`). `down -v` sí los borra. |
| D7 | Restart policy | `docker kill <backend>` | El contenedor vuelve solo (`unless-stopped`). |
| D8 | Usuario no-root | `docker exec <backend> id` y `<frontend> id` | `uid=1000(node)` en ambos, no `uid=0(root)`. |
| D9 | Rotación de logs | `docker inspect --format '{{.HostConfig.LogConfig}}' <backend>` | `max-size:10m`, `max-file:3`. |
| D10 | Puertos no expuestos | `ss -tlnp \| grep -E '5432\|6379'` | Escuchando en `127.0.0.1`, nunca en `0.0.0.0`. |

Lo que **sí** se ejecutó de verdad, sin Docker, está en §10.

---

## 10. Qué se validó ejecutándolo (sin Docker)

Ensayo completo de la secuencia del `docker-entrypoint.sh` sobre una base
**limpia**, con `NODE_ENV=production` y todas las variables de producción,
corriendo el mismo `dist/src/main.js` que corre en el contenedor:

| Área | Verificación | Resultado |
|---|---|---|
| Migraciones | `prisma migrate deploy` sobre base vacía | 12 migraciones aplicadas; roles creados **sin** contraseña (`app_user` LOGIN, `app_superadmin` NOLOGIN). |
| Provisioning | `npm run db:provision-roles` | Contraseña asignada y GRANTs aplicados. |
| Seed | `prisma db seed` | 39 permisos y 4 planes. |
| Arranque | `node dist/src/main.js` con `NODE_ENV=production` | Levanta y loguea `Prisma conectado (rol app_user, RLS activo)`. |
| Liveness | `GET /health` | `200 {"status":"ok","uptime":N}`. |
| Readiness | `GET /health/ready` | `200 {"database":"ok","cache":"ok"}`. |
| Cabeceras | `curl -D-` | CSP, HSTS, `nosniff`, `X-Frame-Options`; sin `X-Powered-By`. |
| CORS | Origen permitido vs. ajeno | El permitido se refleja; el ajeno no recibe la cabecera. |
| Errores | Ruta inexistente / body inválido | `404` y `400` sin stack trace ni detalle de validación (modo producción). |
| Flujo comercial | Registro → producto → stock → venta → recibo → PDF | Venta `PAID` por 100; recibo `REC-1` con `DOCUMENTO COMERCIAL NO FISCAL`; PDF de 2.5 KB. |
| Email con SMTP caído | Host SMTP inexistente a propósito | 3 reintentos, `email_logs.status=FAILED`, **sin afectar** ninguna operación comercial. |
| Apagado | `SIGTERM` | Cierra limpio en 3 s (importante para `docker stop`). |
| Backup | `pg_dump` con la URL recortada | Dump de 165 KB. |
| Restore | Restore en base nueva + provisioning | Datos completos, 196 GRANTs, RLS con 42 tablas / 43 policies. |
| RLS post-restore | Consulta con y sin contexto de tenant | Con el tenant correcto ve su venta; con uno inexistente ve 0 filas. |
| App sobre el restore | Arranque + login de un usuario restaurado | `readiness ok` y login correcto. |
