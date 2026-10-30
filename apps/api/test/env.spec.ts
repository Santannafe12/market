import { validateEnv } from '../src/config/env';

describe('validateEnv', () => {
  const base = {
    JWT_SECRET: 'j'.repeat(32),
    DATABASE_URL: 'postgresql://market:market@localhost:5432/market',
    WEB_ORIGIN: 'http://localhost:5173',
    AUDIT_HMAC_SECRET: 'a'.repeat(32),
  };

  it('requires an audit secret that is long and distinct from the jwt secret', () => {
    expect(validateEnv(base).auditHmacSecret).toBe(base.AUDIT_HMAC_SECRET);
    expect(() => validateEnv({ ...base, AUDIT_HMAC_SECRET: 'short' })).toThrow(/AUDIT_HMAC_SECRET/);
    expect(() => validateEnv({ ...base, AUDIT_HMAC_SECRET: '' })).toThrow(/AUDIT_HMAC_SECRET/);
    expect(() => validateEnv({ ...base, AUDIT_HMAC_SECRET: base.JWT_SECRET })).toThrow(/different/);
  });
});
