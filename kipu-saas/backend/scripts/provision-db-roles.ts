/**
 * Asigna las contraseñas de los roles PostgreSQL de la aplicación
 * (`app_user`, y opcionalmente `app_superadmin`) a partir de variables de
 * entorno. Es también el mecanismo de ROTACIÓN: correrlo de nuevo con otro
 * valor cambia la contraseña.
 *
 * Por qué existe: las migraciones de Prisma están versionadas en el
 * repositorio, así que NUNCA pueden contener una contraseña literal — sería
 * una credencial pública e idéntica en todos los despliegues. La migración
 * inicial crea los roles (para que existan los GRANTs y las policies de
 * RLS) pero sin contraseña; este script es el único lugar donde se les
 * asigna una, leída del entorno.
 *
 * Fail-closed: hasta que esto corra, `app_user` existe pero no puede
 * autenticarse bajo `scram-sha-256`/`md5`. Preferimos que la aplicación
 * falle al conectar antes que arrancar con una credencial conocida.
 *
 * Uso:
 *   APP_USER_PASSWORD='...' npm run db:provision-roles
 *
 * Variables:
 *   DATABASE_URL             (requerida) conexión de administración, con permiso
 *                            para ALTER ROLE. Es la misma que usa `prisma migrate`.
 *   APP_USER_PASSWORD        (requerida) contraseña para `app_user`, el rol sin
 *                            BYPASSRLS con el que corre la aplicación.
 *   APP_SUPERADMIN_PASSWORD  (opcional) si se define, habilita `app_superadmin`
 *                            (LOGIN + contraseña). Ese rol tiene BYPASSRLS y ve
 *                            los datos de TODOS los tenants: dejarlo sin definir
 *                            lo mantiene NOLOGIN, que es lo correcto mientras
 *                            ningún módulo lo use.
 *
 * Este script nunca imprime el valor de una contraseña.
 */
import 'dotenv/config';
import { Client } from 'pg';

const MIN_PASSWORD_LENGTH = 16;

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. Defínela (por ejemplo en backend/.env) y volvé a correr el script. No se usa ningún valor por defecto a propósito: una contraseña por defecto sería tan pública como una escrita en el repositorio.`,
    );
  }
  return value;
}

/**
 * Rechaza contraseñas que en la práctica no protegen nada. No valida
 * "complejidad" (mayúsculas/símbolos, criterio hoy desaconsejado), sino lo
 * único que importa acá: longitud suficiente y que no sea uno de los
 * valores de ejemplo que este mismo cambio vino a eliminar.
 */
function assertUsablePassword(name: string, value: string): void {
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${name} es demasiado corta: se requieren al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  const rejected = [
    'app_user_dev_password',
    'app_superadmin_dev_password',
    'postgres',
    'password',
    'changeme',
    'change-me',
  ];
  if (rejected.includes(value.toLowerCase())) {
    throw new Error(
      `${name} tiene un valor de ejemplo/conocido. Generá uno aleatorio, por ejemplo con: openssl rand -base64 32`,
    );
  }
}

async function main(): Promise<void> {
  const adminUrl = readRequiredEnv('DATABASE_URL');
  const appUserPassword = readRequiredEnv('APP_USER_PASSWORD');
  assertUsablePassword('APP_USER_PASSWORD', appUserPassword);

  const superadminPassword = process.env.APP_SUPERADMIN_PASSWORD?.trim();
  if (superadminPassword) {
    assertUsablePassword('APP_SUPERADMIN_PASSWORD', superadminPassword);
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // `ALTER ROLE` no acepta parámetros ($1), y un bloque `DO` tampoco. Por
    // eso el statement se construye con `format('%I', %L)` de Postgres, en un
    // `SELECT` que SÍ acepta parámetros: la contraseña viaja como parámetro
    // hasta `format`, que la escapa del lado del servidor. En ningún momento
    // se concatena el valor dentro del SQL desde JavaScript.
    const alterRole = async (role: string, password: string) => {
      const exists = await client.query(
        'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1',
        [role],
      );
      if (exists.rowCount === 0) {
        throw new Error(
          `El rol ${role} no existe. Corré primero las migraciones: npx prisma migrate deploy`,
        );
      }
      const built = await client.query<{ stmt: string }>(
        `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
        [role, password],
      );
      await client.query(built.rows[0].stmt);
    };

    /**
     * Re-aplica los GRANTs sobre el schema `public`.
     *
     * Por qué hace falta acá y no alcanza con la migración inicial: los
     * GRANTs son POR BASE DE DATOS, y no viajan en un `pg_dump
     * --no-privileges` (que es el que documenta el runbook, para no arrastrar
     * los owners del servidor de origen). Después de restaurar un backup, el
     * rol `app_user` existe a nivel de cluster pero no tiene ningún permiso
     * sobre las tablas restauradas: la aplicación levanta y falla con
     * "permission denied for table organizations".
     *
     * Correr `prisma migrate deploy` NO lo arregla: las migraciones ya vienen
     * registradas en `_prisma_migrations` dentro del dump, así que no se
     * vuelven a ejecutar. Por eso el paso de provisioning —que el runbook y
     * el entrypoint ya ejecutan siempre— es el lugar correcto para esto.
     *
     * Es idempotente: volver a otorgar un permiso que ya existe no falla.
     */
    const grantSchemaPrivileges = async (role: string) => {
      const stmts = await client.query<{ stmt: string }>(
        `SELECT unnest(ARRAY[
           format('GRANT USAGE ON SCHEMA public TO %I', $1::text),
           format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', $1::text),
           format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', $1::text)
         ]) AS stmt`,
        [role],
      );
      for (const { stmt } of stmts.rows) {
        await client.query(stmt);
      }
    };

    await alterRole('app_user', appUserPassword);
    await grantSchemaPrivileges('app_user');
    console.log(
      '✔ app_user: contraseña asignada y permisos sobre public re-aplicados (rol sin BYPASSRLS, RLS activo).',
    );

    if (superadminPassword) {
      await alterRole('app_superadmin', superadminPassword);
      await grantSchemaPrivileges('app_superadmin');
      console.log(
        '✔ app_superadmin: HABILITADO con contraseña. Atención: este rol tiene BYPASSRLS y accede a los datos de todos los tenants.',
      );
    } else {
      console.log(
        'ℹ app_superadmin: sin APP_SUPERADMIN_PASSWORD definida → se deja NOLOGIN (correcto mientras ningún módulo lo use).',
      );
    }

    console.log(
      '\nRecordá que RUNTIME_DATABASE_URL debe usar app_user con esta misma contraseña.',
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // Solo el mensaje: un stack completo de `pg` puede incluir la cadena de
  // conexión (y por lo tanto la contraseña) en algunos modos de error.
  console.error(
    `\n✖ No se pudieron provisionar los roles: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
