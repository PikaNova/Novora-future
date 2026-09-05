import assert from 'node:assert/strict';
import test from 'node:test';
import { authSql, ensureAuthTables } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { NOVORA_SCHEMA_VERSION, readSchemaMigrationState } from '../../api/_schemaMigration.js';
import { isDatabaseInt8, rowShape } from '../../api/_validation.js';

type DatabaseInt8Row = { updated_at: number | string };

test('schema migration: records versions and success logs for both components', async () => {
  await ensureTableOnce();
  await ensureAuthTables();

  const state = await readSchemaMigrationState(authSql());
  assert.equal(state.version, NOVORA_SCHEMA_VERSION);
  assert.equal(state.matches, true);
  assert.equal(state.versions.auth, NOVORA_SCHEMA_VERSION);
  assert.equal(state.versions.exams, NOVORA_SCHEMA_VERSION);

  for (const component of ['auth', 'exams'] as const) {
    const log = state.migrations.find((item) => item.component === component && item.status === 'success');
    assert.ok(log, `expected a successful ${component} migration log`);
    assert.equal(log?.version, NOVORA_SCHEMA_VERSION);
    assert.ok(log?.requestId, 'migration log must include a request id');
    assert.ok(log?.durationMs != null && log.durationMs >= 0, 'migration log must include duration');
  }
});

test('schema migration: repeated initialization does not duplicate schema rows', async () => {
  await ensureTableOnce();
  await ensureAuthTables();
  const before = (await database()`
      SELECT
        (SELECT COUNT(*)::int FROM app_schema_versions) AS version_count,
        (SELECT COUNT(*)::int FROM app_schema_migration_logs) AS log_count
    `) as unknown as Array<{ version_count: number; log_count: number }>;

  await ensureTableOnce();
  await ensureAuthTables();

  const after = (await database()`
      SELECT
        (SELECT COUNT(*)::int FROM app_schema_versions) AS version_count,
        (SELECT COUNT(*)::int FROM app_schema_migration_logs) AS log_count
    `) as unknown as Array<{ version_count: number; log_count: number }>;

  assert.equal(Number(after[0]?.version_count), 2);
  assert.equal(Number(after[0]?.version_count), Number(before[0]?.version_count));
  assert.equal(Number(after[0]?.log_count), Number(before[0]?.log_count));
});

test('database write: BIGINT timestamps survive the driver boundary', async () => {
  await ensureTableOnce();
  const bigintValue = 4102444800000;
  await database()`UPDATE exam_data SET updated_at=${bigintValue} WHERE id=1`;
  const rows = (await database()`SELECT updated_at FROM exam_data WHERE id=1`) as unknown as Array<{
    updated_at: unknown;
  }>;
  const guard = rowShape<DatabaseInt8Row>({
    updated_at: isDatabaseInt8,
  });
  assert.equal(guard(rows[0]), true, 'BIGINT must arrive as a safe number or decimal string');
  assert.equal(Number(rows[0]?.updated_at), bigintValue);
});
