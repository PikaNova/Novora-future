import assert from 'node:assert/strict';
import test from 'node:test';
import { customSubjectToTemplate, customTimeToPattern } from '../src/components/major-batch/majorBatchAdd.helpers.js';

test('school subject presets are exposed as school templates', () => {
  const template = customSubjectToTemplate({
    id: 'subjects-1',
    name: '理科组',
    subjects: ['物理', '化学'],
    custom: true,
    updatedAt: 1,
    order: 0,
  });

  assert.equal(template.source, 'school');
  assert.equal(template.category, 'school');
  assert.deepEqual(template.subjects, ['物理', '化学']);
});

test('school time presets are exposed as school patterns', () => {
  const pattern = customTimeToPattern({
    id: 'times-1',
    name: '上午场',
    slots: [{ start: '08:00', end: '10:00', dayOffset: 0 }],
    custom: true,
    updatedAt: 1,
    order: 0,
  });

  assert.equal(pattern.source, 'school');
  assert.equal(pattern.category, 'school');
  assert.deepEqual(pattern.slots, [{ start: '08:00', end: '10:00', dayOffset: 0 }]);
});
