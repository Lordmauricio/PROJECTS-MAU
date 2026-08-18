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
# Volcado completo, comprimido, con formato custom (permite restore parcial).
pg_dump --format=custom --no-owner --no-privileges \
  --file="kipu-$(date +%F-%H%M).dump" "$DATABASE_URL"
```

Recomendado: diario automatizado + retención de 30 días, con el volcado
fuera de la máquina de la base. Verificar periódicamente que un restore
funciona — un backup que nunca se restauró no es un backup.

### Restauración

```bash
createdb kipu_saas
pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" kipu-....dump

# Los roles NO viajan en el dump (--no-owner): recrearlos y provisionarlos.
npx prisma migrate deploy
npm run db:provision-roles
```

### Qué NO se restaura solo

- **Roles y contraseñas de Postgres**: los crean las migraciones sin
  contraseña; se asignan con `db:provision-roles`.
- **Políticas de RLS**: viajan en las migraciones, no en el dump de datos.
  Después de restaurar, confirmar con `npm run verify:tenant-isolation`.

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

## 8. Limitación conocida del entorno de esta fase

El `docker compose config` se validó correctamente, pero **no se pudo
ejecutar `docker compose build`**: el entorno donde se preparó esta fase no
tiene daemon de Docker (`dial unix /var/run/docker.sock: no such file or
directory`). Los cambios en `Dockerfile` y `docker-compose.yml` están
revisados y son sintácticamente válidos, pero el build de las imágenes debe
probarse en una máquina con Docker antes del primer despliegue real.
