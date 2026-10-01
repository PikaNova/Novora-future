import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, secretHint } from '../api/_platformUsage/crypto.js';
import { detectPlatformEnvironment, isNeonConnectionString } from '../api/_platformUsage/environment.js';
import { NEON_FREE_LIMITS } from '../api/_platformUsage/neon.js';
import { statusFromMetrics, type PlatformMetric } from '../api/_platformUsage/types.js';
import {
  collectVercelUsage,
  collectNamedUsage,
  normalizeUsage,
  vercelDeclarativeMetrics,
  VERCEL_HOBBY_LIMITS,
  VERCEL_USAGE_TYPES,
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

test('Vercel 解析: 只在指标名与单位都可识别时给出数字', () => {
  const payload = {
    usage: [
      { name: 'Fast Data Transfer', value: 42, unit: 'GB' },
      { name: 'Active CPU', value: 1.5, unit: 'hours' },
      { name: 'Provisioned Memory', value: 30, unit: 'GB-hours' },
      { name: 'Mystery Metric', value: 7, unit: 'quux' },
    ],
  };
  const entries: Array<{ name: string; value: number; unit: string | null }> = [];
  collectNamedUsage(payload, entries);
  assert.equal(entries.length, 4);

  const transfer = entries.find((entry) => entry.name === 'Fast Data Transfer');
  assert.ok(transfer);
  assert.equal(normalizeUsage(transfer, 'bytes')! / 1_000_000_000, 42);

  const cpu = entries.find((entry) => entry.name === 'Active CPU');
  assert.ok(cpu);
  assert.equal(normalizeUsage(cpu, 'seconds'), 1.5 * 3600);

  const mystery = entries.find((entry) => entry.name === 'Mystery Metric');
  assert.ok(mystery);
  // 单位无法识别时必须返回 null，宁可回落 unsupported 也不猜。
  assert.equal(normalizeUsage(mystery, 'bytes'), null);
  assert.equal(normalizeUsage({ name: 'x', value: 1, unit: null }, 'seconds'), null);
  assert.equal(normalizeUsage({ name: 'x', value: 1, unit: 'GiB' }, 'bytes'), 1024 ** 3);
});

test('Vercel 兜底读数: 只列官方 Hobby 额度，不给百分比', () => {
  const metrics = vercelDeclarativeMetrics();
  assert.deepEqual(
    metrics.map((metric) => [metric.key, metric.limit, metric.unit, metric.percent]),
    [
      ['fast_data_transfer', 100, 'GB', null],
      ['active_cpu', 4, 'CPU-hrs', null],
      ['provisioned_memory', 360, 'GB-hrs', null],
    ],
  );
  // 文档里已移除 Edge Requests，这里不应再作为额度出现。
  assert.equal(
    VERCEL_HOBBY_LIMITS.some((spec) => /edge/i.test(spec.namePattern.source)),
    false,
  );
});

test('Neon 免费额度常量与官方文档一致', () => {
  assert.equal(NEON_FREE_LIMITS.computeCuHours, 100);
  assert.equal(NEON_FREE_LIMITS.storageBytes, 500_000_000);
  assert.equal(NEON_FREE_LIMITS.transferBytes, 5_000_000_000);
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

test('Vercel 请求必须带 type 与 from：缺 type 时接口直接 400', async () => {
  const { result, calls } = await withStubbedFetch(
    () => ({ status: 200, body: { usage: [{ name: 'Fast Data Transfer', value: 12, unit: 'GB' }] } }),
    () => collectVercelUsage({ token: 't', now: Date.parse('2026-10-01T00:00:00Z') }),
  );

  assert.equal(result.status, 'ok');
  assert.equal(result.metrics.length, 1);
  assert.equal(result.metrics[0].used, 12);
  assert.equal(result.metrics[0].percent, 12);
  assert.equal(calls.length, VERCEL_USAGE_TYPES.length);
  for (const url of calls) {
    assert.match(url, /[?&]type=/);
    assert.match(url, /[?&]from=/);
    assert.match(url, /[?&]to=/);
  }
});

test('Vercel 报错时带出平台原话，而不是只说 HTTP 400', async () => {
  const { result } = await withStubbedFetch(
    () => ({ status: 400, body: { error: { message: 'Invalid request: missing required property `type`.' } } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(result.status, 'error');
  assert.match(result.message, /missing required property/);
});

test('Vercel 401/403 归类为凭据问题', async () => {
  const { result } = await withStubbedFetch(
    () => ({ status: 403, body: { error: { message: 'forbidden' } } }),
    () => collectVercelUsage({ token: 'bad' }),
  );
  assert.equal(result.status, 'credential_error');
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
