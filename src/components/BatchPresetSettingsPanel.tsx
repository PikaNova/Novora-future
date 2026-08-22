import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import Mascot from './Mascot';
import TimeRangePickerModal from './TimeRangePickerModal';
import { COMMON_EXAM_SUBJECTS, normalizeSubjectList, normalizeSubjectName } from '../data/subjects';
import type { MajorBatchSubjectGroup, MajorBatchTimeGroup, MajorBatchTimeSlot } from '../utils/appSettings';
import {
  APP_SETTINGS_CHANGED_EVENT,
  getAppSettings,
  updateExamSettings,
  updateMajorBatchSettings,
} from '../utils/appSettings';
import { fetchExamsFromServer, saveMajorBatchPresets } from '../services/examService';
import { notify } from '../services/notify';
import { confirmDialog } from '../services/appDialog';
import '../styles/batch-preset-settings-panel.css';

function makeSubjectGroupId() {
  return `batch_subject_group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeTimeGroupId() {
  return `batch_time_group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeSlotKey() {
  return `slot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

type DraftSlot = MajorBatchTimeSlot & { key: string };

/**
 * Admin settings panel for managing the custom subject groups and time
 * groups used by the "batch add sub-exams" workflow. Lets admins create,
 * reorder, and delete presets outside of the batch-add modal itself.
 */
export default function BatchPresetSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const [subjectGroups, setSubjectGroups] = useState<MajorBatchSubjectGroup[]>(
    () => getAppSettings().exam.majorBatchPresets.subjectGroups,
  );
  const [timeGroups, setTimeGroups] = useState<MajorBatchTimeGroup[]>(
    () => getAppSettings().exam.majorBatchPresets.timeGroups,
  );

  const [newSubjectName, setNewSubjectName] = useState('');
  const [customSubjectName, setCustomSubjectName] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  const [newTimeName, setNewTimeName] = useState('');
  const [timeEditRow, setTimeEditRow] = useState<string | null>(null);
  const timeEditAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [draftSlots, setDraftSlots] = useState<DraftSlot[]>([
    { key: makeSlotKey(), start: '08:30', end: '09:30', dayOffset: 0 },
  ]);

  useEffect(() => {
    const sync = () => {
      const settings = getAppSettings().exam.majorBatchPresets;
      setSubjectGroups(settings.subjectGroups);
      setTimeGroups(settings.timeGroups);
    };
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    void fetchExamsFromServer()
      .then((payload) => {
        if (payload?.majorBatchPresets) {
          updateExamSettings({
            majorBatchPresets: {
              subjectGroups: (payload.majorBatchPresets.subjectGroups ?? []) as MajorBatchSubjectGroup[],
              timeGroups: (payload.majorBatchPresets.timeGroups ?? []) as MajorBatchTimeGroup[],
              updatedAt: Number(payload.majorBatchPresets.updatedAt ?? 0),
            },
            updatedAt: payload.updatedAt,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const local = getAppSettings().majorBatch;
    const localGroups = (local.subjectGroups ?? []).filter((group) => group.subjects.length > 0);
    const localTimeGroups = (local.timeGroups ?? []).filter((group) => group.slots.length > 0);
    if (!localGroups.length && !localTimeGroups.length) return;
    const names = [
      ...localGroups.map((group) => '科目组：' + group.name),
      ...localTimeGroups.map((group) => '时间组：' + group.name),
    ]
      .slice(0, 12)
      .join('、');
    void confirmDialog({
      title: '导入本机预设到学校云端',
      message: '检测到本机保存的旧预设，导入后将全校共享（按名称去重）：' + names + '。确认导入？',
    }).then((ok) => {
      if (!ok) return;
      const current = getAppSettings().exam.majorBatchPresets;
      const seen = new Set<string>();
      const mergeGroups = (
        base: MajorBatchSubjectGroup[] | MajorBatchTimeGroup[],
        extra: Array<MajorBatchSubjectGroup | MajorBatchTimeGroup>,
        kind: string,
      ) => {
        const merged = [...base];
        for (const item of extra) {
          const key = item.name.trim();
          if (!key || seen.has(kind + key)) continue;
          seen.add(kind + key);
          if (!merged.some((group) => group.name.trim() === key))
            merged.push({ ...item, order: merged.length } as MajorBatchSubjectGroup & MajorBatchTimeGroup);
        }
        return merged;
      };
      const next = {
        subjectGroups: mergeGroups(current.subjectGroups, localGroups, 's') as MajorBatchSubjectGroup[],
        timeGroups: mergeGroups(current.timeGroups, localTimeGroups, 't') as MajorBatchTimeGroup[],
      };
      void saveMajorBatchPresets(next)
        .then((saved) => {
          updateExamSettings({
            majorBatchPresets: {
              subjectGroups: saved.subjectGroups as MajorBatchSubjectGroup[],
              timeGroups: saved.timeGroups as MajorBatchTimeGroup[],
              updatedAt: saved.updatedAt,
            },
            updatedAt: saved.updatedAt,
          });
          updateMajorBatchSettings({ subjectGroups: [], timeGroups: [] });
          setSubjectGroups(saved.subjectGroups as MajorBatchSubjectGroup[]);
          setTimeGroups(saved.timeGroups as MajorBatchTimeGroup[]);
          notify('success', '本机预设已导入学校云端并清空本地。');
        })
        .catch((error) => notify('error', error instanceof Error ? error.message : '本机预设导入失败'));
    });
  }, []);

  const commit = (patch: { subjectGroups?: MajorBatchSubjectGroup[]; timeGroups?: MajorBatchTimeGroup[] }) => {
    if (patch.subjectGroups) setSubjectGroups(patch.subjectGroups);
    if (patch.timeGroups) setTimeGroups(patch.timeGroups);
    const next = {
      subjectGroups: patch.subjectGroups ?? subjectGroups,
      timeGroups: patch.timeGroups ?? timeGroups,
    };
    void saveMajorBatchPresets(next)
      .then((saved) =>
        updateExamSettings({
          majorBatchPresets: {
            subjectGroups: saved.subjectGroups as MajorBatchSubjectGroup[],
            timeGroups: saved.timeGroups as MajorBatchTimeGroup[],
            updatedAt: saved.updatedAt,
          },
          updatedAt: saved.updatedAt,
        }),
      )
      .catch((error) => notify('error', error instanceof Error ? error.message : '学校预设保存失败'));
  };

  const moveSubjectGroup = (id: string, direction: -1 | 1) => {
    const index = subjectGroups.findIndex((item) => item.id === id);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= subjectGroups.length) return;
    const next = [...subjectGroups];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const reordered = next.map((item, i) => ({ ...item, order: i }));
    commit({ subjectGroups: reordered });
  };

  const moveTimeGroup = (id: string, direction: -1 | 1) => {
    const index = timeGroups.findIndex((item) => item.id === id);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= timeGroups.length) return;
    const next = [...timeGroups];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const reordered = next.map((item, i) => ({ ...item, order: i }));
    commit({ timeGroups: reordered });
  };

  const deleteSubjectGroup = (id: string) => {
    const next = subjectGroups.filter((item) => item.id !== id).map((item, i) => ({ ...item, order: i }));
    commit({ subjectGroups: next });
  };

  const deleteTimeGroup = (id: string) => {
    const next = timeGroups.filter((item) => item.id !== id).map((item, i) => ({ ...item, order: i }));
    commit({ timeGroups: next });
  };

  const addSubjectGroup = () => {
    const subjects = normalizeSubjectList(selectedSubjects);
    if (!subjects.length) return;
    const next: MajorBatchSubjectGroup = {
      id: makeSubjectGroupId(),
      name: newSubjectName.trim() || `常用科目组 ${subjectGroups.length + 1}`,
      subjects,
      custom: true,
      updatedAt: Date.now(),
      order: subjectGroups.length,
    };
    const nextGroups = [...subjectGroups, next];
    commit({ subjectGroups: nextGroups });
    setNewSubjectName('');
    setSelectedSubjects([]);
  };
  const addCustomSubject = () => {
    const subject = normalizeSubjectName(customSubjectName.trim());
    if (!subject) return;
    setSelectedSubjects((value) => (value.includes(subject) ? value : [...value, subject]));
    setCustomSubjectName('');
  };
  const toggleSubject = (subject: string) => {
    setSelectedSubjects((value) =>
      value.includes(subject) ? value.filter((item) => item !== subject) : [...value, subject],
    );
  };

  const addSlotRow = () => {
    const last = draftSlots[draftSlots.length - 1];
    setDraftSlots((rows) => [
      ...rows,
      { key: makeSlotKey(), start: last?.start ?? '08:30', end: last?.end ?? '09:30', dayOffset: last?.dayOffset ?? 0 },
    ]);
  };

  const updateSlotRow = (key: string, patch: Partial<MajorBatchTimeSlot>) => {
    setDraftSlots((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeSlotRow = (key: string) => {
    setDraftSlots((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows));
  };

  const addTimeGroup = () => {
    const slots = draftSlots.map(({ start, end, dayOffset }) => ({
      start,
      end,
      dayOffset: Math.max(0, Math.round(Number(dayOffset ?? 0))),
    }));
    if (slots.some((slot) => !slot.start || !slot.end)) return;
    const next: MajorBatchTimeGroup = {
      id: makeTimeGroupId(),
      name: newTimeName.trim() || `常用时间组 ${timeGroups.length + 1}`,
      slots,
      custom: true,
      updatedAt: Date.now(),
      order: timeGroups.length,
    };
    const nextGroups = [...timeGroups, next];
    commit({ timeGroups: nextGroups });
    setNewTimeName('');
    setDraftSlots([{ key: makeSlotKey(), start: '08:30', end: '09:30', dayOffset: 0 }]);
  };

  return (
    <div className="batch-preset-panel">
      <div className="batch-preset-source">
        <span className="batch-preset-source__single">学校预设 · 全校共享</span>
      </div>
      <section className="batch-preset-section">
        <div className="batch-preset-section__head">
          <strong>常用科目组</strong>
          <span>用于批量添加分考试时快速选择科目组合，与批量添加弹窗中的设置共享</span>
        </div>
        {subjectGroups.length === 0 ? (
          <p className="set-note">
            <Mascot className="mascot-inline" size={28} alt="" />
            暂无自定义科目组，可在下方创建。
          </p>
        ) : (
          <ul className="batch-preset-list">
            {subjectGroups.map((item, index) => (
              <li key={item.id} className="batch-preset-item">
                <div className="batch-preset-item__info">
                  <strong>{item.name}</strong>
                  <div className="batch-preset-chips">
                    {item.subjects.map((subject) => (
                      <span key={subject} className="batch-preset-chip">
                        {subject}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="batch-preset-item__actions">
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === 0}
                    onClick={() => moveSubjectGroup(item.id, -1)}
                    aria-label="上移"
                  >
                    ↑
                  </button>
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === subjectGroups.length - 1}
                    onClick={() => moveSubjectGroup(item.id, 1)}
                    aria-label="下移"
                  >
                    ↓
                  </button>
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    type="button"
                    disabled={!canEdit}
                    onClick={() => deleteSubjectGroup(item.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="batch-preset-form">
            <input
              className="admin-input"
              value={newSubjectName}
              onChange={(event) => setNewSubjectName(event.target.value)}
              placeholder="科目组名称"
              maxLength={30}
            />
            <div className="batch-preset-subjects">
              {COMMON_EXAM_SUBJECTS.map((subject) => {
                const selected = selectedSubjects.includes(subject);
                return (
                  <button
                    type="button"
                    key={subject}
                    aria-pressed={selected}
                    className={`batch-preset-subject${selected ? ' is-selected' : ''}`}
                    onClick={() => toggleSubject(subject)}
                  >
                    {subject}
                  </button>
                );
              })}
            </div>
            <p className="batch-preset-subjects-hint">点击科目名称多选，已选 {selectedSubjects.length} 门</p>
            {selectedSubjects.length > 0 && (
              <div className="batch-preset-selected">
                {selectedSubjects.map((subject) => (
                  <span className="batch-preset-selected-chip" key={subject}>
                    {subject}
                    <button type="button" aria-label={`移除${subject}`} onClick={() => toggleSubject(subject)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="batch-preset-custom-subject">
              <input
                className="admin-input"
                value={customSubjectName}
                onChange={(event) => setCustomSubjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCustomSubject();
                  }
                }}
                placeholder="自定义科目名称"
                maxLength={20}
              />
              <button className="admin-btn" type="button" onClick={addCustomSubject}>
                添加自定义科目
              </button>
            </div>
            <button className="admin-btn" type="button" onClick={addSubjectGroup}>
              新建科目组
            </button>
          </div>
        )}
      </section>

      <section className="batch-preset-section">
        <div className="batch-preset-section__head">
          <strong>常用时间组</strong>
          <span>用于批量添加分考试时快速选择场次安排，与批量添加弹窗中的设置共享</span>
        </div>
        {timeGroups.length === 0 ? (
          <p className="set-note">
            <Mascot className="mascot-inline" size={28} alt="" />
            暂无自定义时间组，可在下方创建。
          </p>
        ) : (
          <ul className="batch-preset-list">
            {timeGroups.map((item, index) => (
              <li key={item.id} className="batch-preset-item">
                <div className="batch-preset-item__info">
                  <strong>{item.name}</strong>
                  <div className="batch-preset-chips">
                    {item.slots.map((slot, slotIndex) => (
                      <span key={slotIndex} className="batch-preset-chip">
                        {slot.dayOffset ? `第${slot.dayOffset + 1}天 ` : ''}
                        {slot.start}–{slot.end}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="batch-preset-item__actions">
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === 0}
                    onClick={() => moveTimeGroup(item.id, -1)}
                    aria-label="上移"
                  >
                    ↑
                  </button>
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === timeGroups.length - 1}
                    onClick={() => moveTimeGroup(item.id, 1)}
                    aria-label="下移"
                  >
                    ↓
                  </button>
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    type="button"
                    disabled={!canEdit}
                    onClick={() => deleteTimeGroup(item.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="batch-preset-form">
            <input
              className="admin-input"
              value={newTimeName}
              onChange={(event) => setNewTimeName(event.target.value)}
              placeholder="时间组名称"
              maxLength={30}
            />
            <div className="batch-preset-slot-rows">
              {draftSlots.map((row) => (
                <div key={row.key} className="batch-preset-slot-row">
                  <label>
                    第几天
                    <input
                      className="admin-input"
                      type="number"
                      min={0}
                      max={9}
                      value={row.dayOffset ?? 0}
                      onChange={(event) => updateSlotRow(row.key, { dayOffset: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <button
                    type="button"
                    className="batch-preset-slot-time"
                    ref={row.key === timeEditRow ? timeEditAnchorRef : undefined}
                    onClick={() => setTimeEditRow(row.key)}
                  >
                    <Clock3 size={14} aria-hidden="true" />
                    {row.start} – {row.end}
                  </button>
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    type="button"
                    disabled={draftSlots.length <= 1}
                    onClick={() => removeSlotRow(row.key)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="batch-preset-form__actions">
              <button className="admin-btn" type="button" onClick={addSlotRow}>
                + 添加场次
              </button>
              <button className="admin-btn admin-btn--primary" type="button" onClick={addTimeGroup}>
                新建时间组
              </button>
            </div>
          </div>
        )}
      </section>
      {timeEditRow &&
        (() => {
          const row = draftSlots.find((item) => item.key === timeEditRow);
          if (!row) return null;
          return (
            <TimeRangePickerModal
              open
              mode="time"
              title="设置场次时间"
              startValue={row.start}
              endValue={row.end}
              anchorRef={timeEditAnchorRef}
              allowCrossDay={false}
              onCancel={() => setTimeEditRow(null)}
              onConfirm={(start, end) => {
                updateSlotRow(timeEditRow, { start, end });
                setTimeEditRow(null);
              }}
            />
          );
        })()}
    </div>
  );
}
