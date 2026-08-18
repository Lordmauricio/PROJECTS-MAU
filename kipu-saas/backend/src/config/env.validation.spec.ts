import { loadKipuEnv, validateEnv } from './env.validation';

/**
 * La validación de entorno es lo único que separa "la app no arranca" de
 * "la app arranca insegura y nadie se entera". Estos tests fijan
 * exactamente qué configuraciones se rechazan.
 */
describe('Validación de variables de entorno', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:x@localhost:5432/kipu?schema=public',
    RUNTIME_DATABASE_URL:
      'postgresql://app_user:y@localhost:5432/kipu?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
  };

  const prod = (extra: Record<string, string> = {}) => ({
    ...base,
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.kipu.bo',
    EMAIL_PROVIDER: 'smtp',
    EMAIL_SMTP_HOST: 'smtp.example.com',
    EMAIL_SMTP_PORT: '587',
    EMAIL_FROM: 'no-reply@kipu.bo',
    ...extra,
  });

  it('acepta una configuración de producción completa', () => {
    expect(() => validateEnv(prod())).not.toThrow();
  });

  it('acepta desarrollo sin CORS_ORIGINS ni SMTP (no son obligatorios fuera de producción)', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it.each([
    'DATABASE_URL',
    'RUNTIME_DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ])('rechaza si falta %s', (missing) => {
    const env: Record<string, string> = { ...base };
    delete env[missing];
    expect(() => validateEnv(env)).toThrow(new RegExp(`Falta ${missing}`));
  });

  it('rechaza un secreto que quedó con el valor de ejemplo del repositorio', () => {
    expect(() =>
      validateEnv({
        ...base,
        JWT_ACCESS_SECRET: 'change-me-long-random-secret',
      }),
    ).toThrow(/valor de ejemplo conocido/);
  });

  it('rechaza secretos cortos SOLO en producción', () => {
    expect(() =>
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'corto' }),
    ).not.toThrow();
    expect(() => validateEnv(prod({ JWT_ACCESS_SECRET: 'corto' }))).toThrow(
      /demasiado corto para producción/,
    );
  });

  it('rechaza que los dos secretos JWT sean el mismo', () => {
    const same = 'c'.repeat(40);
    expect(() =>
      validateEnv({
        ...base,
        JWT_ACCESS_SECRET: same,
        JWT_REFRESH_SECRET: same,
      }),
    ).toThrow(/no pueden ser iguales/);
  });

  it('rechaza que la app corra con el mismo rol admin de las migraciones (rompería RLS)', () => {
    expect(() =>
      validateEnv({ ...base, RUNTIME_DATABASE_URL: base.DATABASE_URL }),
    ).toThrow(/no puede ser igual a DATABASE_URL/);
  });

  it('en producción exige CORS_ORIGINS y prohíbe el comodín', () => {
    const noCors = prod();
    delete (noCors as Record<string, unknown>).CORS_ORIGINS;
    expect(() => validateEnv(noCors)).toThrow(/Falta CORS_ORIGINS/);
    expect(() => validateEnv(prod({ CORS_ORIGINS: '*' }))).toThrow(
      /no está permitido en producción/,
    );
  });

  it('rechaza un origen de CORS mal formado', () => {
    expect(() => validateEnv({ ...base, CORS_ORIGINS: 'app.kipu.bo' })).toThrow(
      /origen inválido/,
    );
  });

  it('exige credenciales cuando EMAIL_PROVIDER=smtp, y rechaza console en producción', () => {
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'smtp' })).toThrow(
      /requiere EMAIL_SMTP_HOST/,
    );
    expect(() => validateEnv(prod({ EMAIL_PROVIDER: 'console' }))).toThrow(
      /solo escribe los emails en el log/,
    );
  });

  it('el mensaje de error nunca incluye el valor del secreto', () => {
    const secret = 'super-secreto-que-no-debe-aparecer';
    try {
      validateEnv({
        ...base,
        JWT_ACCESS_SECRET: secret,
        NODE_ENV: 'production',
      });
      throw new Error('debía fallar');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  describe('loadKipuEnv', () => {
    it('parsea la lista de orígenes y trata "none"/vacío como ninguno', () => {
      expect(
        loadKipuEnv({ CORS_ORIGINS: 'https://a.com, https://b.com' })
          .corsOrigins,
      ).toEqual(['https://a.com', 'https://b.com']);
      expect(loadKipuEnv({ CORS_ORIGINS: 'none' }).corsOrigins).toEqual([]);
      expect(loadKipuEnv({}).corsOrigins).toEqual([]);
    });

    it('trust proxy es opt-in explícito', () => {
      expect(loadKipuEnv({}).trustProxy).toBe(false);
      expect(loadKipuEnv({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
      expect(loadKipuEnv({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    });
  });
});
