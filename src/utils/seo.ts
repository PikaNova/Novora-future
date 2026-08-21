import { getAppSettings } from './appSettings';

const PAGE_LABELS: Array<{ path: string; label: string }> = [
  { path: '/', label: '考试看板' },
  { path: '/exam', label: '考试' },
  { path: '/login', label: '登录' },
  { path: '/admin', label: '管理后台' },
  { path: '/settings', label: '系统设置' },
  { path: '/preferences', label: '偏好设置' },
  { path: '/local-settings', label: '本地设置' },
];

function setMeta(name: string, content: string, property = false) {
  const key = property ? 'property="' + name + '"' : 'name="' + name + '"';
  let el = document.head.querySelector('meta[' + key + ']') as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(property ? 'property' : 'name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function applyPageSeo(pathname: string) {
  const init = getAppSettings().exam.initialization;
  const schoolName = init.schoolName?.trim() ?? '';
  const seo = init.seo ?? { titleSuffix: '', description: '', keywords: '', siteUrl: '' };
  const page = PAGE_LABELS.find((item) => pathname === item.path || pathname.startsWith(item.path + '/')) ?? PAGE_LABELS[0];
  const suffix = seo.titleSuffix?.trim() || page.label;
  const title = schoolName ? schoolName + ' · ' + suffix : 'Novora · ' + page.label;
  document.title = title;
  const description = seo.description?.trim() || (schoolName ? schoolName + '考试安排与教室大屏管理平台' : 'Novora 学校考试管理与教室大屏平台');
  setMeta('description', description);
  if (seo.keywords?.trim()) setMeta('keywords', seo.keywords.trim());
  const siteUrl = seo.siteUrl?.trim() || (typeof window !== 'undefined' ? window.location.origin : '');
  if (siteUrl) {
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:url', siteUrl + pathname, true);
    setMeta('og:type', 'website', true);
  }
  let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', siteUrl ? siteUrl + pathname : window.location.href);
}
