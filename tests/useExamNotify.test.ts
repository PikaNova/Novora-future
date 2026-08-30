import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useExamNotify } from '../src/hooks/useExamNotify.js';
import type { ExamItem } from '../src/types/index.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

function examNamed(name: string): ExamItem {
  const start = Date.now() - 5_000;
  const localIso = (time: number) =>
    new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  return {
    id: 'exam-1',
    name,
    startTime: localIso(start),
    endTime: localIso(start + 10 * 60_000),
    enabled: true,
    order: 0,
  };
}

test('useExamNotify: an edited exam replacement emits a fresh notification', () => {
  const observed: Array<ReturnType<typeof useExamNotify>['notification']> = [];

  function Probe({ exam }: { exam: ExamItem | null }) {
    const result = useExamNotify(exam);
    observed.push(result.notification);
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  try {
    act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, { exam: examNamed('Original') }));
    });

    assert.ok(
      observed.some((notification) => notification?.phase === 'started' && notification.exam.name === 'Original'),
      'the first exam should immediately reach its start checkpoint',
    );

    const rerenderStart = observed.length;
    act(() => {
      renderer?.update(React.createElement(Probe, { exam: examNamed('Updated') }));
    });

    assert.ok(
      observed.slice(rerenderStart).some((notification) => notification?.phase === 'started'),
      'the edited exam must not be swallowed by the old notification key',
    );
    const latestStarted = observed
      .filter((notification): notification is NonNullable<typeof notification> => notification?.phase === 'started')
      .at(-1);
    assert.equal(latestStarted?.exam.name, 'Updated');
  } finally {
    act(() => renderer?.unmount());
  }
});
