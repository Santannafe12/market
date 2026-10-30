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

  // Comma-separated, so a deploy can allow the production frontend and its preview URL.
  const webOrigins = (env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
  if (webOrigins.length === 0) {
    throw new Error('WEB_ORIGIN is required');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  // Demo routines run only when a deploy opts in with the exact value "true".
  const seedOnBoot = env.SEED_ON_BOOT === 'true';
  const demoEnsure = env.DEMO_ENSURE === 'true';
  // On by default: reads settle due lots first. Only the exact value "false" turns it off.
  const settleOnRead = env.SETTLE_ON_READ !== 'false';
  // Vercel sets VERCEL=1. A Function is frozen between requests, so no interval runs there.
  const serverless = env.VERCEL === '1';

  return {
    jwtSecret,
    auditHmacSecret,
    databaseUrl,
    webOrigins,
    port,
    seedOnBoot,
    demoEnsure,
    settleOnRead,
    serverless,
  };
}

export type AppEnv = ReturnType<typeof validateEnv>;
