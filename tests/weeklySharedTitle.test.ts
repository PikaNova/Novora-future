import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCopiedPlanTitle } from '../src/components/weekly/weeklyShared.js';

test('buildCopiedPlanTitle: prepends target class and appends suffix', () => {
  assert.equal(buildCopiedPlanTitle('周测', '1班', '2班', '期中复习'), '2班 · 周测 · 期中复习');
});

test('buildCopiedPlanTitle: replaces source class name inside base name', () => {
  assert.equal(buildCopiedPlanTitle('1班 · 周测', '1班', '2班', ''), '2班 · 周测');
});

test('buildCopiedPlanTitle: no suffix keeps behavior unchanged', () => {
  assert.equal(buildCopiedPlanTitle('周测', '1班', '2班', ''), '2班 · 周测');
  assert.equal(buildCopiedPlanTitle('周测', '', '2班', ''), '2班 · 周测');
});
