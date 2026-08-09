import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTBOX_MAX_ATTEMPTS, outboxRetryDelayMs } from '../api/_emailQueue.js';

test('outboxRetryDelayMs: first retry waits 1 minute, second retry waits 5 minutes', () => {
  assert.equal(outboxRetryDelayMs(1), 60_000);
  assert.equal(outboxRetryDelayMs(2), 300_000);
});

test('outboxRetryDelayMs: at max attempts returns Infinity (no more retries)', () => {
  assert.equal(outboxRetryDelayMs(OUTBOX_MAX_ATTEMPTS), Number.POSITIVE_INFINITY);
  assert.equal(outboxRetryDelayMs(5), Number.POSITIVE_INFINITY);
});

test('outboxRetryDelayMs: defensive default for zero or negative attempts', () => {
  assert.equal(outboxRetryDelayMs(0), 60_000);
  assert.equal(outboxRetryDelayMs(-1), 60_000);
});

test('OUTBOX_MAX_ATTEMPTS is exactly 3 so retry policy stays strict', () => {
  assert.equal(OUTBOX_MAX_ATTEMPTS, 3);
});
