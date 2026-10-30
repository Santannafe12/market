const DEFAULT_TEST_DATABASE_URL = 'postgresql://market:market@localhost:5432/market_test';

function databaseIdentity(connectionString) {
  if (!connectionString) {
    throw new Error('Refusing to run tests without a database URL.');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Refusing to run tests with an invalid database URL.');
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) {
    throw new Error('Refusing to run tests against a database URL without a database name.');
  }

  let host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '127.0.0.1' || host === '::1') {
    host = 'localhost';
  }

  return { name, host, port: url.port || '5432' };
}

function assertTestDatabaseUrl(connectionString) {
  const identity = databaseIdentity(connectionString);
  if (!/_test$/i.test(identity.name)) {
    throw new Error(
      `Refusing to run tests against database "${identity.name}". The test database name must end with "_test".`,
    );
  }
  return identity;
}

const APPLICATION_DATABASE_URL = 'MARKET_APPLICATION_DATABASE_URL';

function assertSafeTestTarget(env) {
  const testUrl = env.DATABASE_URL_TEST || DEFAULT_TEST_DATABASE_URL;
  const testDb = databaseIdentity(testUrl);

  if (env[APPLICATION_DATABASE_URL] === undefined) {
    env[APPLICATION_DATABASE_URL] = env.DATABASE_URL || '';
  }

  const applicationUrl = env[APPLICATION_DATABASE_URL];
  if (applicationUrl) {
    const appDb = databaseIdentity(applicationUrl);
    const sameDatabase =
      appDb.host === testDb.host && appDb.port === testDb.port && appDb.name === testDb.name;
    if (sameDatabase) {
      throw new Error(
        'DATABASE_URL_TEST points at the same database as DATABASE_URL. Refusing to migrate or truncate it.',
      );
    }
  }

  assertTestDatabaseUrl(testUrl);
  return testUrl;
}

module.exports = {
  DEFAULT_TEST_DATABASE_URL,
  assertSafeTestTarget,
  assertTestDatabaseUrl,
};
