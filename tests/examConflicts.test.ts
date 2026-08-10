import assert from 'node:assert/strict';
import test from 'node:test';
import { findMajorConflicts, findMajorConflictItemKeys } from '../src/utils/examConflicts.js';
import type { MajorExam } from '../src/types/index.js';

function major(id: string, name: string, items: Array<{ id: string; startTime: string; endTime: string }>, targetGradeIds: string[] = []): MajorExam {
  return {
    id, name, targetGradeIds, targetClassIds: [],
    items: items.map((item) => ({ id: item.id, name: 'x', startTime: item.startTime, endTime: item.endTime, enabled: true, order: 0 })),
    createdAt: 0, updatedAt: 0,
  } as unknown as MajorExam;
}

test('findMajorConflicts: reports overlapping same-grade majors', () => {
  const majors = [
    major('m1', '语文', [{ id: 'i1', startTime: '2026-08-10T09:00:00', endTime: '2026-08-10T11:00:00' }], ['g1']),
    major('m2', '数学', [{ id: 'i2', startTime: '2026-08-10T10:00:00', endTime: '2026-08-10T12:00:00' }], ['g1']),
  ];
  assert.deepEqual(findMajorConflicts(majors), ['语文 / 数学']);
  const keys = findMajorConflictItemKeys(majors);
  assert.equal(keys.has('m1:i1'), true);
  assert.equal(keys.has('m2:i2'), true);
});

test('findMajorConflicts: ignores non-overlapping and same-major items', () => {
  const majors = [
    major('m1', '语文', [
      { id: 'i1', startTime: '2026-08-10T09:00:00', endTime: '2026-08-10T11:00:00' },
      { id: 'i2', startTime: '2026-08-10T14:00:00', endTime: '2026-08-10T16:00:00' },
    ], ['g1']),
  ];
  assert.deepEqual(findMajorConflicts(majors), []);
});

test('findMajorConflicts: different grades do not conflict', () => {
  const majors = [
    major('m1', '语文', [{ id: 'i1', startTime: '2026-08-10T09:00:00', endTime: '2026-08-10T11:00:00' }], ['g1']),
    major('m2', '数学', [{ id: 'i2', startTime: '2026-08-10T10:00:00', endTime: '2026-08-10T12:00:00' }], ['g2']),
  ];
  assert.deepEqual(findMajorConflicts(majors), []);
  assert.equal(findMajorConflictItemKeys(majors).size, 0);
});
