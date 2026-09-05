import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionDeviceCommand,
  isDeviceCommandExpired,
  transitionDeviceCommand,
  type DeviceCommand,
} from '../src/shared/deviceContracts.js';

const base: DeviceCommand = {
  id: 'cmd-1',
  action: 'pause',
  createdAt: 100,
  status: 'pending',
  expiresAt: 1_000,
};

test('device command state machine accepts the delivery lifecycle', () => {
  assert.equal(canTransitionDeviceCommand('pending', 'claimed'), true);
  assert.equal(canTransitionDeviceCommand('claimed', 'acknowledged'), true);
  const claimed = transitionDeviceCommand(base, 'claimed', 200);
  assert.equal(claimed?.status, 'claimed');
  assert.equal(claimed?.claimedAt, 200);
  const acknowledged = claimed && transitionDeviceCommand(claimed, 'acknowledged', 300);
  assert.equal(acknowledged?.acknowledgedAt, 300);
});

test('device command state machine rejects duplicate terminal transitions', () => {
  assert.equal(transitionDeviceCommand({ ...base, status: 'acknowledged' }, 'acknowledged', 200), null);
  assert.equal(transitionDeviceCommand({ ...base, status: 'failed' }, 'claimed', 200), null);
  assert.equal(transitionDeviceCommand(base, 'acknowledged', 200)?.status, 'acknowledged');
  assert.equal(transitionDeviceCommand(base, 'expired', 200)?.status, 'expired');
});

test('expired commands are identified at the boundary', () => {
  assert.equal(isDeviceCommandExpired(base, 999), false);
  assert.equal(isDeviceCommandExpired(base, 1_000), true);
  assert.equal(isDeviceCommandExpired({ expiresAt: undefined }, 10), false);
});

test('failed commands retain a bounded reason', () => {
  const failed = transitionDeviceCommand(base, 'failed', 200, 'network timeout');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.failureReason, 'network timeout');
  assert.ok((transitionDeviceCommand(base, 'failed', 200, 'x'.repeat(600))?.failureReason?.length ?? 0) <= 500);
});
