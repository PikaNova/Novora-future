export function buildSeoTitle(schoolName: string, titleSuffix: string): string | null {
  const suffix = titleSuffix || '考试看板';
  return schoolName ? schoolName + ' · ' + suffix : null;
}

export const SEO_FALLBACK_DESCRIPTION = 'Novora 学校考试管理与教室大屏平台';

export function buildSeoDescription(schoolName: string, description: string): string {
  return description || (schoolName ? schoolName + '考试安排与教室大屏管理平台' : SEO_FALLBACK_DESCRIPTION);
}
