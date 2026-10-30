const { Client } = require('pg');
const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const { assertSafeTestTarget } = require('./assert-test-database');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const testUrl = assertSafeTestTarget(process.env);

async function ensureDatabase() {
  const url = new URL(testUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/market';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName.replaceAll('"', '')}"`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  await ensureDatabase();
  const result = spawnSync(
    'npx prisma migrate deploy --schema=prisma/schema.prisma',
    {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'inherit',
      shell: true,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
