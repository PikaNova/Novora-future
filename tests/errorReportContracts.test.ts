import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildErrorReportFingerprint,
  sanitizeErrorReportContext,
  sanitizeErrorReportPath,
  sanitizeErrorReportPayload,
  sanitizeErrorReportText,
} from '../src/shared/errorReportContracts.js';

test('error report text removes credentials, personal identifiers, and control characters', () => {
  const result = sanitizeErrorReportText(
    'Authorization: Bearer abc123 password=secret email test@example.com phone 13800138000\u0000',
  );
  assert.equal(result, '<redacted> <redacted> email <redacted> phone <redacted>');
});

test('error report context uses an operational allowlist', () => {
  const result = sanitizeErrorReportContext({
    requestId: 'req-1',
    operation: 'read',
    retryable: true,
    userName: '张三',
    examTitle: '期中考试',
    token: 'secret',
    huge: 'x'.repeat(500),
  });
  assert.deepEqual(result, { requestId: 'req-1', operation: 'read', retryable: true });
});

test('error report paths drop query data and normalize dynamic identifiers', () => {
  assert.equal(
    sanitizeErrorReportPath(
      'https://school.example/api/exams/123/records/550e8400-e29b-41d4-a716-446655440000?token=secret',
    ),
    '/api/exams/<number>/records/<uuid>',
  );
});

test('error report fingerprints remain stable across dynamic message values', () => {
  const first = buildErrorReportFingerprint({
    type: 'api',
    errorName: 'ApiError',
    message: 'record 123 failed',
    route: '/exam/123',
  });
  const second = buildErrorReportFingerprint({
    type: 'api',
    errorName: 'ApiError',
    message: 'record 456 failed',
    route: '/exam/456',
  });
  assert.equal(first, second);
});

test('sanitized payload contains only software diagnostics', () => {
  const payload = sanitizeErrorReportPayload({
    instanceId: 'instance-1',
    deviceId: 'device-1',
    type: 'api',
    level: 'critical',
    message: 'request failed for exam title 期中考试',
    appVersion: '2.7.5',
    context: { operation: 'read', examTitle: '期中考试' },
    schoolName: '示例学校',
  } as never);
  assert.ok(payload);
  assert.equal(payload.schoolName, '示例学校');
  assert.equal(payload.host, null);
  assert.equal(payload.userAgent, null);
  assert.equal(payload.province, null);
  assert.equal(payload.tz, null);
  assert.equal(payload.lang, null);
  assert.deepEqual(payload.context, { operation: 'read' });
  assert.equal(payload.level, 'critical');
  assert.equal(payload.schemaVersion, 1);
});
