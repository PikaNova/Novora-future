import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors.js';
import { telemetryConfig } from './_telemetryConfig.js';

/**
 * 检查更新：读取 GitHub 最新发布版本，与客户端当前版本比较。
 * - 更新仓库默认 https://github.com/PikaNova/Novora，可用环境变量 GITHUB_REPO 覆盖。
 * - 可选 GITHUB_TOKEN 提升速率限制（私有仓库必填）。
 * - 结果在服务端内存缓存 5 分钟，降低 GitHub API 调用。
 */

const DEFAULT_REPOSITORY_URL = 'https://github.com/PikaNova/Novora';
const DOCS_UPDATE_URL = 'https://docs.pikachu2026.space/guide/12-maintenance';
const CACHE_TTL = 5 * 60 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface LatestInfo {
  latest: string | null;
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  source: 'release' | 'tag' | 'none';
}

let cache: { at: number; repo: string; data: LatestInfo } | null = null;

function normalizeRepository(value: string): string {
  const input = value
    .trim()
    .replace(/\/$/, '')
    .replace(/\.git$/i, '');
  let repo = input;

  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'github.com') throw new Error('仅支持 GitHub 仓库地址');
    repo = url.pathname.replace(/^\/+|\/+$/g, '');
  } catch (error) {
    if (/^https?:\/\//i.test(input)) throw error;
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('GITHUB_REPO 必须是 GitHub 仓库地址或 owner/repo');
  }
  return repo;
}

function parseSemver(v: string): [number, number, number] {
  const core = String(v).trim().replace(/^v/i, '').split('-')[0].split('+')[0];
  const parts = core.split('.').map((n) => parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** 返回 -1 (a<b) / 0 / 1 (a>b) */
function cmpSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'exam-board-update-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function fetchLatest(repo: string): Promise<LatestInfo> {
  // 1) 优先 releases/latest
  const relRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers: ghHeaders() },
    8000,
  );
  if (relRes.ok) {
    const r = (await relRes.json()) as { tag_name?: unknown; body?: unknown; published_at?: unknown };
    const tag = typeof r?.tag_name === 'string' ? r.tag_name : null;
    if (tag) {
      return {
        latest: tag.replace(/^v/i, ''),
        releaseUrl: DOCS_UPDATE_URL,
        notes: typeof r?.body === 'string' && r.body.trim() ? r.body.trim().slice(0, 4000) : null,
        publishedAt: typeof r?.published_at === 'string' ? r.published_at : null,
        source: 'release',
      };
    }
  }
  // 2) 回退 tags（尚未发布 release 时）
  const tagRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/tags?per_page=100`,
    { headers: ghHeaders() },
    8000,
  );
  if (tagRes.ok) {
    const tags = (await tagRes.json()) as Array<{ name?: unknown }>;
    if (Array.isArray(tags) && tags.length > 0) {
      const names = tags.map((t) => String(t?.name || '')).filter(Boolean);
      names.sort((a, b) => cmpSemver(b, a)); // 降序，取最大
      const top = names[0];
      if (top) {
        return {
          latest: top.replace(/^v/i, ''),
          releaseUrl: DOCS_UPDATE_URL,
          notes: null,
          publishedAt: null,
          source: 'tag',
        };
      }
    }
  }
  // 3) 无 release 也无 tag
  if (!relRes.ok && relRes.status !== 404) {
    throw new Error(`GitHub API ${relRes.status}`);
  }
  return { latest: null, releaseUrl: DOCS_UPDATE_URL, notes: null, publishedAt: null, source: 'none' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!applyCors(req, res, { methods: ['GET'], public: true })) return;
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const repositoryUrl = process.env.GITHUB_REPO || DEFAULT_REPOSITORY_URL;
  const currentRaw = Array.isArray(req.query.current) ? req.query.current[0] : req.query.current;
  const current = typeof currentRaw === 'string' && currentRaw ? currentRaw.replace(/^v/i, '') : '0.0.0';

  try {
    const repo = normalizeRepository(repositoryUrl);
    let data: LatestInfo;
    if (cache && cache.repo === repo && Date.now() - cache.at < CACHE_TTL) {
      data = cache.data;
    } else {
      data = await fetchLatest(repo);
      cache = { at: Date.now(), repo, data };
    }

    const hasUpdate = !!data.latest && cmpSemver(current, data.latest) < 0;
    res.status(200).json({
      ok: true,
      repo,
      current,
      latest: data.latest,
      hasUpdate,
      releaseUrl: data.releaseUrl,
      notes: data.notes,
      publishedAt: data.publishedAt,
      source: data.source,
    });
  } catch (error: unknown) {
    try {
      const authorUrl = `${telemetryConfig.baseUrl}/api/update-check?current=${encodeURIComponent(current)}`;
      const authorRes = await fetchWithTimeout(authorUrl, { headers: { Accept: 'application/json' } }, 8000);
      if (authorRes.ok) {
        const author = await authorRes.json().catch(() => null);
        const latest = author && typeof author.latest === 'string' ? author.latest : null;
        if (latest) {
          res.status(200).json({
            ok: true,
            repo: 'author',
            current,
            latest,
            hasUpdate: cmpSemver(current, latest) < 0,
            releaseUrl:
              typeof author.releaseUrl === 'string' && author.releaseUrl ? author.releaseUrl : DOCS_UPDATE_URL,
            notes: typeof author.notes === 'string' ? author.notes : null,
            publishedAt: typeof author.publishedAt === 'string' ? author.publishedAt : null,
            source: 'author',
          });
          return;
        }
      }
    } catch {
      /* fall through to 502 */
    }
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : '检查更新失败' });
  }
}
