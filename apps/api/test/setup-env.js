const path = require('path');
const dotenv = require('dotenv');
const { assertSafeTestTarget } = require('./assert-test-database');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

process.env.DATABASE_URL = assertSafeTestTarget(process.env);
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test-jwt-secret-must-be-32-characters-min';
if (
  !process.env.AUDIT_HMAC_SECRET ||
  process.env.AUDIT_HMAC_SECRET.length < 32 ||
  process.env.AUDIT_HMAC_SECRET === process.env.JWT_SECRET
) {
  process.env.AUDIT_HMAC_SECRET = 'test-audit-hmac-secret-32-characters-min';
}
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
process.env.PORT = process.env.PORT ?? '3000';
// The suite calls settlement directly. A live 5s tick would close lots the other tests still hold open.
process.env.SETTLEMENT_INTERVAL_MS = '3600000';
// Demo routines stay off; the seed suite calls DemoSeed itself.
process.env.SEED_ON_BOOT = 'false';
process.env.DEMO_ENSURE = 'false';
