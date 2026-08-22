// 大型考试冲突检测：时间重叠 + 年级/班级适用范围重叠（复用仪表盘原有判定，供多处展示）。
import type { MajorExam } from '../types';

type ConflictScan = { labels: string[]; itemKeys: Set<string> };

function scanConflicts(majors: MajorExam[]): ConflictScan {
  const items = majors.flatMap((major) => major.items.filter((item) => item.enabled).map((item) => ({ major, item })));
  const labels: string[] = [];
  const itemKeys = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const left = items[index];
    for (let rightIndex = index + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      if (left.major.id === right.major.id) continue;
      const timeOverlap =
        new Date(left.item.startTime).getTime() < new Date(right.item.endTime).getTime() &&
        new Date(left.item.endTime).getTime() > new Date(right.item.startTime).getTime();
      if (!timeOverlap) continue;
      const gradeOverlap =
        !left.major.targetGradeIds?.length ||
        !right.major.targetGradeIds?.length ||
        left.major.targetGradeIds.some((id) => right.major.targetGradeIds?.includes(id));
      const classOverlap =
        !left.major.targetClassIds?.length ||
        !right.major.targetClassIds?.length ||
        left.major.targetClassIds.some((id) => right.major.targetClassIds?.includes(id));
      if (gradeOverlap && classOverlap) {
        labels.push(`${left.major.name} / ${right.major.name}`);
        itemKeys.add(`${left.major.id}:${left.item.id}`);
        itemKeys.add(`${right.major.id}:${right.item.id}`);
      }
    }
  }
  return { labels, itemKeys };
}

/** 返回冲突组标签列表，如 ["语文 / 数学"]（用于顶部横幅）。 */
export function findMajorConflicts(majors: MajorExam[]): string[] {
  return scanConflicts(majors).labels;
}

/** 返回参与冲突的「majorId:itemId」键集合（用于列表行级高亮/角标）。 */
export function findMajorConflictItemKeys(majors: MajorExam[]): Set<string> {
  return scanConflicts(majors).itemKeys;
}
