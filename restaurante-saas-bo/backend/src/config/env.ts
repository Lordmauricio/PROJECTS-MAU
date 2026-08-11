import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  sinProvider: (process.env.SIN_PROVIDER ?? "mock") as "mock" | "soap",
  sinWsdlBaseUrl: process.env.SIN_WSDL_BASE_URL ?? "",
  sinApiKey: process.env.SIN_API_KEY ?? "",
};
