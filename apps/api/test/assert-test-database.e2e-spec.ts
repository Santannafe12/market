const { assertSafeTestTarget, assertTestDatabaseUrl } = require('./assert-test-database') as {
  assertSafeTestTarget: (env: Record<string, string | undefined>) => string;
  assertTestDatabaseUrl: (connectionString: string | undefined) => { name: string };
};

const applicationUrl = 'postgresql://market:market@localhost:5432/market';
const testUrl = 'postgresql://market:market@localhost:5432/market_test';

describe('test database guard', () => {
  it('allows market_test when it is distinct from the application database', () => {
    expect(assertSafeTestTarget({ DATABASE_URL: applicationUrl, DATABASE_URL_TEST: testUrl })).toBe(
      testUrl,
    );
    expect(assertTestDatabaseUrl(testUrl).name).toBe('market_test');
  });

  it('allows market_test when the application URL is unset', () => {
    expect(assertSafeTestTarget({ DATABASE_URL_TEST: testUrl })).toBe(testUrl);
  });

  it('refuses when the test URL is the same database as the application', () => {
    expect(() =>
      assertSafeTestTarget({
        DATABASE_URL: applicationUrl,
        DATABASE_URL_TEST: applicationUrl,
      }),
    ).toThrow(/same database/);
  });

  it('refuses a database that is not explicitly a test database', () => {
    expect(() => assertTestDatabaseUrl('postgresql://market:market@localhost:5432/market')).toThrow(
      /_test/,
    );
    expect(() =>
      assertSafeTestTarget({
        DATABASE_URL: applicationUrl,
        DATABASE_URL_TEST: 'postgresql://market:market@db.example.com:5432/production',
      }),
    ).toThrow(/_test/);
  });

  it('treats localhost and 127.0.0.1 as the same server', () => {
    expect(() =>
      assertSafeTestTarget({
        DATABASE_URL: 'postgresql://market:market@localhost:5432/market_test',
        DATABASE_URL_TEST: 'postgresql://market:market@127.0.0.1:5432/market_test',
      }),
    ).toThrow(/same database/);
  });
});
