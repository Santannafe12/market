const path = require('path');
const dotenv = require('dotenv');
const { assertSafeTestTarget } = require('./assert-test-database');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

process.env.DATABASE_URL = assertSafeTestTarget(process.env);
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test-jwt-secret-must-be-32-characters-min';
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
process.env.PORT = process.env.PORT ?? '3000';
