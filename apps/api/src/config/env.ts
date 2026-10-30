export function validateEnv(env: NodeJS.ProcessEnv) {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  const auditHmacSecret = env.AUDIT_HMAC_SECRET ?? '';
  if (auditHmacSecret.length < 32) {
    throw new Error('AUDIT_HMAC_SECRET must be at least 32 characters');
  }
  if (auditHmacSecret === jwtSecret) {
    throw new Error('AUDIT_HMAC_SECRET must be different from JWT_SECRET');
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const webOrigin = env.WEB_ORIGIN;
  if (!webOrigin) {
    throw new Error('WEB_ORIGIN is required');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return { jwtSecret, auditHmacSecret, databaseUrl, webOrigin, port };
}

export type AppEnv = ReturnType<typeof validateEnv>;
