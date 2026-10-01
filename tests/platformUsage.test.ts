import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, secretHint } from '../api/_platformUsage/crypto.js';
import { detectPlatformEnvironment, isNeonConnectionString } from '../api/_platformUsage/environment.js';
import { NEON_FREE_LIMITS } from '../api/_platformUsage/neon.js';
import { remainingCooldownSeconds, statusFromMetrics, type PlatformMetric } from '../api/_platformUsage/types.js';
import {
  buildVercelMetrics,
  collectVercelUsage,
  describeShape,
  sumBuckets,
  vercelDeclarativeMetrics,
  VERCEL_BYTE_FIELDS,
  VERCEL_GB_HOUR_FIELDS,
  VERCEL_HOBBY_LIMITS,
  VERCEL_USAGE_TYPE,
} from '../api/_platformUsage/vercel.js';

const NEON_URL = 'postgresql://u:p@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const LOCAL_URL = 'postgres://novora:novora@127.0.0.1:5432/novora';

test('环境识别: Vercel + Neon 两个开关独立，本地部署一律不启用', () => {
  const onVercel = detectPlatformEnvironment({ VERCEL: '1' }, NEON_URL);
  assert.equal(onVercel.runtime, 'vercel');
  assert.equal(onVercel.database, 'neon');
  assert.equal(onVercel.vercel, true);
  assert.equal(onVercel.neon, true);
  assert.equal(onVercel.local, false);

  const vercelOnly = detectPlatformEnvironment({ VERCEL: '1' }, LOCAL_URL);
  assert.equal(vercelOnly.vercel, true);
  assert.equal(vercelOnly.neon, false);

  // 关键约束：本地跑同一套代码、即使 DATABASE_URL 指向 Neon，也不启用任何面板。
  const localWithNeon = detectPlatformEnvironment({}, NEON_URL);
  assert.equal(localWithNeon.local, true);
  assert.equal(localWithNeon.vercel, false);
  assert.equal(localWithNeon.neon, false);

  const localWithPostgres = detectPlatformEnvironment({}, LOCAL_URL);
  assert.equal(localWithPostgres.local, true);
  assert.equal(localWithPostgres.vercel, false);
  assert.equal(localWithPostgres.neon, false);
  assert.equal(localWithPostgres.database, 'postgres');

  const unknownDatabase = detectPlatformEnvironment({ VERCEL: '1' }, undefined);
  assert.equal(unknownDatabase.database, 'unknown');
  assert.equal(unknownDatabase.neon, false);
});

test('Neon 连接串识别与 dbAdapter 判据一致', () => {
  assert.equal(isNeonConnectionString(NEON_URL), true);
  assert.equal(isNeonConnectionString('postgres://u:p@host/db?channel_binding=require'), true);
  assert.equal(isNeonConnectionString(LOCAL_URL), false);
  assert.equal(isNeonConnectionString(''), false);
  assert.equal(isNeonConnectionString(undefined), false);
});

test('凭据加密: 可逆、随机 IV、错误密钥或被篡改时拒绝解密', () => {
  const secret = 'unit-test-secret';
  const encrypted = encryptSecret('napi_abcdefghijklmnop', secret);
  assert.notEqual(encrypted, 'napi_abcdefghijklmnop');
  assert.equal(decryptSecret(encrypted, secret), 'napi_abcdefghijklmnop');

  // 相同明文两次加密的密文必须不同（随机 IV）。
  assert.notEqual(encryptSecret('same', secret), encryptSecret('same', secret));

  assert.equal(decryptSecret(encrypted, 'another-secret'), null);
  assert.equal(decryptSecret('v1.not-base64!!.x.y', secret), null);
  assert.equal(decryptSecret('', secret), null);

  const parts = encrypted.split('.');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64url')].join('.');
  assert.equal(decryptSecret(tampered, secret), null);
});

test('凭据提示只保留尾 4 位', () => {
  assert.equal(secretHint('napi_1234567890abcd'), '••••abcd');
  assert.equal(secretHint('   '), '');
  assert.ok(!secretHint('napi_1234567890abcd').includes('123456'));
});

test('Neon 免费额度常量与官方文档一致', () => {
  assert.equal(NEON_FREE_LIMITS.computeCuHours, 100);
  assert.equal(NEON_FREE_LIMITS.storageBytes, 500_000_000);
  assert.equal(NEON_FREE_LIMITS.transferBytes, 5_000_000_000);
});

test('读数状态阈值: 80% 警告、95% 严重、100% 超限', () => {
  const metric = (percent: number | null): PlatformMetric => ({
    key: 'k',
    label: 'l',
    used: percent ?? 0,
    limit: 100,
    unit: 'u',
    percent,
  });
  assert.equal(statusFromMetrics([metric(0)]), 'ok');
  assert.equal(statusFromMetrics([metric(79.9)]), 'ok');
  assert.equal(statusFromMetrics([metric(80)]), 'warning');
  assert.equal(statusFromMetrics([metric(94.9)]), 'warning');
  assert.equal(statusFromMetrics([metric(95)]), 'critical');
  assert.equal(statusFromMetrics([metric(120)]), 'critical');
  // 没有上限的指标不参与判定。
  assert.equal(statusFromMetrics([metric(null)]), 'ok');
  // 取最差的一条。
  assert.equal(statusFromMetrics([metric(10), metric(96)]), 'critical');
});

test('刷新冷却: 由上次刷新时间推算剩余秒数，向上取整', () => {
  const now = 1_000_000;
  assert.equal(remainingCooldownSeconds(null, now), 0);
  assert.equal(remainingCooldownSeconds(undefined, now), 0);
  assert.equal(remainingCooldownSeconds(0, now), 0);
  // 刚刷新过：整整一分钟。
  assert.equal(remainingCooldownSeconds(now, now), 60);
  assert.equal(remainingCooldownSeconds(now - 30_000, now), 30);
  // 不足一秒也要算 1 秒，避免按钮提前可用、点了又吃一个 429。
  assert.equal(remainingCooldownSeconds(now - 59_001, now), 1);
  assert.equal(remainingCooldownSeconds(now - 60_000, now), 0);
  assert.equal(remainingCooldownSeconds(now - 120_000, now), 0);
});

// 2026-10-01 真实账号返回的字段名与量级（已脱敏为同一数量级）。
const REAL_BUCKETS = [
  { bandwidth_outgoing_bytes: 50_000_000, function_execution_successful_gb_hours: 0.2 },
  { bandwidth_outgoing_bytes: '2181634', function_execution_error_gb_hours: 0.096626631111111 },
];

test('Vercel 分桶求和: 逐桶累加，数值字符串也认，缺失与非数值按 0', () => {
  assert.equal(sumBuckets(REAL_BUCKETS, VERCEL_BYTE_FIELDS), 52_181_634);
  assert.ok(Math.abs(sumBuckets(REAL_BUCKETS, VERCEL_GB_HOUR_FIELDS) - 0.296626631111111) < 1e-9);

  assert.equal(sumBuckets([{ a: 1 }, { a: 2 }, { a: 3 }], ['a']), 6);
  assert.equal(sumBuckets([{ a: null }, {}, 'junk', { a: 'nope' }], ['a']), 0);
  assert.equal(sumBuckets(undefined, ['a']), 0);
  assert.equal(sumBuckets({ a: 1 }, ['a']), 0);
});

test('Vercel 读数: 用真实字段名换算出已用量与百分比', () => {
  assert.deepEqual(buildVercelMetrics(REAL_BUCKETS), [
    {
      key: 'fast_data_transfer',
      label: 'Fast Data Transfer',
      used: 0.052,
      limit: 100,
      unit: 'GB',
      percent: 0.05,
    },
    {
      key: 'provisioned_memory',
      label: 'Provisioned Memory',
      used: 0.297,
      limit: 360,
      unit: 'GB-hrs',
      percent: 0.08,
    },
  ]);
  // Active CPU 不在读数里——该接口不返回它，显示 0 会让人误以为没用量。
  assert.equal(
    buildVercelMetrics(REAL_BUCKETS).some((metric) => metric.key === 'active_cpu'),
    false,
  );
});

test('Vercel 兜底读数: 只列官方 Hobby 额度，不给百分比', () => {
  assert.deepEqual(
    vercelDeclarativeMetrics().map((metric) => [metric.key, metric.limit, metric.unit, metric.percent]),
    [
      ['fast_data_transfer', 100, 'GB', null],
      ['active_cpu', 4, 'CPU-hrs', null],
      ['provisioned_memory', 360, 'GB-hrs', null],
    ],
  );
  assert.equal(VERCEL_HOBBY_LIMITS.fastDataTransferGb, 100);
  assert.equal(VERCEL_HOBBY_LIMITS.activeCpuHours, 4);
  assert.equal(VERCEL_HOBBY_LIMITS.provisionedMemoryGbHours, 360);
});

test('Vercel 解析失败时回显结构骨架，只含键名不含数值', () => {
  assert.equal(
    describeShape({ data: { activeCpu: 2, note: 'x' }, list: [1, 2] }),
    '{ data: { activeCpu: number, note: string }, list: [number] }',
  );
  assert.equal(describeShape(null), 'null');
  assert.equal(describeShape([]), '[]');
});

/** 用一次性的 fetch 替身驱动适配器；每次调用都返回全新的 Response（响应体只能读一次）。 */
async function withStubbedFetch<T>(
  handler: (url: string) => { status: number; body: unknown },
  run: () => Promise<T>,
): Promise<{ result: T; calls: string[] }> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const okBody = { granularity: 'day', lastUpdate: '2026-10-01T00:00:00Z', data: REAL_BUCKETS };

test('Vercel 请求: 必须带 type/from/to；team_ 走 teamId，其它走 slug', async () => {
  const plain = await withStubbedFetch(
    () => ({ status: 200, body: okBody }),
    () => collectVercelUsage({ token: 't', now: Date.parse('2026-10-01T12:00:00Z') }),
  );
  assert.equal(plain.calls.length, 1);
  assert.match(plain.calls[0], new RegExp(`[?&]type=${VERCEL_USAGE_TYPE}`));
  assert.match(plain.calls[0], /[?&]from=/);
  assert.match(plain.calls[0], /[?&]to=/);
  assert.equal(/[?&](teamId|slug)=/.test(plain.calls[0]), false);

  const byId = await withStubbedFetch(
    () => ({ status: 200, body: okBody }),
    () => collectVercelUsage({ token: 't', teamId: 'team_abc123' }),
  );
  assert.match(byId.calls[0], /[?&]teamId=team_abc123/);
  assert.equal(/[?&]slug=/.test(byId.calls[0]), false);

  const bySlug = await withStubbedFetch(
    () => ({ status: 200, body: okBody }),
    () => collectVercelUsage({ token: 't', teamId: 'jinzhiyuan0327s-projects' }),
  );
  assert.match(bySlug.calls[0], /[?&]slug=jinzhiyuan0327s-projects/);
  assert.equal(/[?&]teamId=/.test(bySlug.calls[0]), false);
});

test('Vercel 端到端: 正常响应换算成读数与状态', async () => {
  const { result } = await withStubbedFetch(
    () => ({ status: 200, body: okBody }),
    () => collectVercelUsage({ token: 't', now: Date.parse('2026-10-01T12:00:00Z') }),
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.observedAt, Date.parse('2026-10-01T12:00:00Z'));
  assert.equal(result.metrics.length, 2);
  assert.match(result.message, /未返回 Active CPU/);
  assert.equal(result.metrics[0].used, 0.052);
});

test('Vercel 失败态: 403 凭据问题、400 带出平台原话、空列表与未知结构各有提示', async () => {
  const forbidden = await withStubbedFetch(
    () => ({ status: 403, body: { error: { message: 'forbidden' } } }),
    () => collectVercelUsage({ token: 'bad' }),
  );
  assert.equal(forbidden.result.status, 'credential_error');

  const badRequest = await withStubbedFetch(
    () => ({ status: 400, body: { error: { message: 'Invalid request: missing required property `type`.' } } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(badRequest.result.status, 'error');
  assert.match(badRequest.result.message, /missing required property/);

  const empty = await withStubbedFetch(
    () => ({ status: 200, body: { granularity: 'day', lastUpdate: '2026-10-01T00:00:00Z', data: [] } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(empty.result.status, 'unsupported');
  assert.match(empty.result.message, /用量列表为空/);

  const unknown = await withStubbedFetch(
    () => ({ status: 200, body: { granularity: 'day', rows: [] } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(unknown.result.status, 'unsupported');
  assert.match(unknown.result.message, /rows/);
});
