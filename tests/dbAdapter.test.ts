import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSqlText, createDbClient, isNeonEndpoint } from '../api/_dbAdapter.js';

const NEON_URL =
  'postgresql://neondb_owner:secret@ep-xxx.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const LOCAL_URL = 'postgres://novora:novora@db:5432/novora';

test('isNeonEndpoint routes Neon cloud URLs to the neon driver', () => {
  assert.equal(isNeonEndpoint(NEON_URL), true);
  assert.equal(isNeonEndpoint('postgresql://u:p@pg.neon.tech/db'), true);
});

test('isNeonEndpoint routes local Postgres URLs to the pg driver', () => {
  assert.equal(isNeonEndpoint(LOCAL_URL), false);
  assert.equal(isNeonEndpoint('postgresql://u:p@localhost:5432/novora?sslmode=disable'), false);
  assert.equal(isNeonEndpoint(''), false);
});

test('buildSqlText turns tagged-template holes into numbered pg placeholders', () => {
  const strings = ['SELECT * FROM exam_data WHERE id = ', ' AND name = ', ''];
  assert.equal(buildSqlText(strings, [1, 'x']), 'SELECT * FROM exam_data WHERE id = $1 AND name = $2');
  assert.equal(buildSqlText(['SELECT 1'], []), 'SELECT 1');
});

test('createDbClient returns a callable client with transaction for both drivers', () => {
  for (const url of [LOCAL_URL, NEON_URL]) {
    const sql = createDbClient(url);
    assert.equal(typeof sql, 'function');
    assert.equal(typeof sql.transaction, 'function');
  }
});
