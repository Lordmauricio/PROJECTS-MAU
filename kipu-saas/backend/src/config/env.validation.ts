/**
 * Validación de las variables de entorno EN EL ARRANQUE.
 *
 * Por qué al arrancar y no donde se usan: hasta ahora una variable mal
 * puesta se descubría en runtime, en el peor momento posible — un
 * `CORS_ORIGINS` vacío en producción no falla, simplemente deja la API
 * abierta; un `JWT_ACCESS_SECRET` corto tampoco falla, solo hace los tokens
 * más fáciles de romper. Acá el proceso se niega a levantar y dice
 * exactamente qué falta, que es el comportamiento correcto para un
 * despliegue: mejor no arrancar que arrancar inseguro.
 *
 * Nunca imprime el valor de un secreto, solo su nombre.
 */

/** Longitud mínima para un secreto de firma. 32 bytes de entropía real. */
const MIN_SECRET_LENGTH = 32;

/**
 * Valores que alguna vez estuvieron en el repositorio o son ejemplos
 * obvios. Si aparecen en producción es que alguien copió la plantilla sin
 * reemplazarla.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'change-me-long-random-secret',
  'change-me-different-long-random-secret',
  'app_user_dev_password',
  'app_superadmin_dev_password',
  'REEMPLAZAR',
  'changeme',
  'secret',
  'password',
]);

export interface KipuEnv {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  /** Orígenes permitidos por CORS. Vacío = ninguno (fail-closed en producción). */
  corsOrigins: string[];
  /** `true` cuando la app corre detrás de un reverse proxy que fija X-Forwarded-For. */
  trustProxy: boolean;
}

function fail(errors: string[]): never {
  throw new Error(
    `Configuración inválida — el proceso no arranca:\n${errors
      .map((e) => `  • ${e}`)
      .join(
        '\n',
      )}\n\nRevisá backend/.env (o las variables del contenedor). Ver docs/deployment.md.`,
  );
}

/**
 * Se ejecuta desde `ConfigModule.forRoot({ validate })`, así que corre antes
 * de que se instancie ningún provider. Devuelve el env tal cual (Nest exige
 * devolver el objeto de configuración); los valores ya normalizados se leen
 * después con `loadKipuEnv`.
 */
export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const env = raw as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const errors: string[] = [];

  const required = (name: string) => {
    const value = env[name];
    if (!value || value.trim() === '') {
      errors.push(`Falta ${name}.`);
      return undefined;
    }
    return value;
  };

  // Conexiones: siempre obligatorias, en cualquier entorno.
  required('DATABASE_URL');
  const runtimeUrl = required('RUNTIME_DATABASE_URL');
  required('REDIS_URL');

  // Los dos secretos de firma.
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = required(name);
    if (!value) continue;
    if (KNOWN_PLACEHOLDER_SECRETS.has(value)) {
      errors.push(
        `${name} tiene un valor de ejemplo conocido. Generá uno con: openssl rand -base64 32`,
      );
    } else if (isProduction && value.length < MIN_SECRET_LENGTH) {
      errors.push(
        `${name} es demasiado corto para producción (mínimo ${MIN_SECRET_LENGTH} caracteres).`,
      );
    }
  }

  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    errors.push(
      'JWT_ACCESS_SECRET y JWT_REFRESH_SECRET no pueden ser iguales: son dominios de firma distintos.',
    );
  }

  // RUNTIME_DATABASE_URL nunca debe ser el mismo rol admin que corre las
  // migraciones. `PrismaService` ya verifica BYPASSRLS conectándose, pero
  // esto lo detecta antes, sin depender de que la base esté disponible.
  if (runtimeUrl && env.DATABASE_URL && runtimeUrl === env.DATABASE_URL) {
    errors.push(
      'RUNTIME_DATABASE_URL no puede ser igual a DATABASE_URL: la app debe conectarse con app_user (sin BYPASSRLS) para que RLS aplique.',
    );
  }

  // CORS: en producción exigimos lista explícita. Sin esto, la API queda
  // abierta a cualquier origen y nadie se entera.
  const corsRaw = env.CORS_ORIGINS?.trim();
  if (isProduction && !corsRaw) {
    errors.push(
      'Falta CORS_ORIGINS. En producción hay que declarar explícitamente los orígenes del frontend (separados por coma), o "none" si la API no se consume desde un navegador.',
    );
  }
  if (corsRaw && corsRaw !== 'none' && corsRaw !== '*') {
    for (const origin of corsRaw.split(',').map((o) => o.trim())) {
      if (!origin) continue;
      try {
        new URL(origin);
      } catch {
        errors.push(
          `CORS_ORIGINS contiene un origen inválido: "${origin}". Usá la forma https://dominio.com (sin path).`,
        );
      }
    }
  }
  if (isProduction && corsRaw === '*') {
    errors.push(
      'CORS_ORIGINS="*" no está permitido en producción: sería equivalente a no tener CORS.',
    );
  }

  // Si se eligió SMTP real, las credenciales tienen que estar.
  if (env.EMAIL_PROVIDER === 'smtp') {
    for (const name of ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_FROM']) {
      if (!env[name]?.trim()) {
        errors.push(`EMAIL_PROVIDER=smtp requiere ${name}.`);
      }
    }
  }
  if (isProduction && (env.EMAIL_PROVIDER ?? 'console') === 'console') {
    errors.push(
      'EMAIL_PROVIDER=console en producción solo escribe los emails en el log, no los envía. Configurá EMAIL_PROVIDER=smtp.',
    );
  }

  if (errors.length > 0) fail(errors);
  return raw;
}

/** Lee la configuración ya validada, normalizada al tipo que usa la app. */
export function loadKipuEnv(env: NodeJS.ProcessEnv): KipuEnv {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const corsRaw = env.CORS_ORIGINS?.trim();
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: Number(env.PORT ?? 4200),
    corsOrigins:
      !corsRaw || corsRaw === 'none'
        ? []
        : corsRaw
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean),
    // Solo se confía en X-Forwarded-* si se declara explícitamente: creerle
    // a esa cabecera sin un proxy delante permitiría falsear la IP del
    // cliente y esquivar el rate limiting.
    trustProxy: env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1',
  };
}
