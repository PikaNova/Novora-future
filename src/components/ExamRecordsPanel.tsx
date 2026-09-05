import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import '../styles/exam-records.css';

type RecordStatus = 'draft' | 'published' | 'ongoing' | 'ended' | 'archived';
type RecordSource = 'regular' | 'quick';

type ExamRecord = {
  id: string;
  name: string;
  status: Exclude<RecordStatus, 'ongoing'>;
  displayStatus: RecordStatus;
  targetGradeIds: string[];
  targetClassIds: string[];
  source: RecordSource;
  itemCount: number;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  startAt: number | null;
  endAt: number | null;
};

type ApiResponse = {
  ok?: boolean;
  data?: ExamRecord[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  error?: string;
};

type Props = {
  grades: SchoolGrade[];
  classes: SchoolClass[];
};

const STATUS_OPTIONS: Array<{ value: '' | RecordStatus; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '待开始' },
  { value: 'ongoing', label: '进行中' },
  { value: 'ended', label: '已结束' },
  { value: 'archived', label: '历史归档' },
];

function tokenHeaders(): HeadersInit {
  const token = localStorage.getItem('admin_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatTime(value: number | null): string {
  if (!value || !Number.isFinite(value)) return '未设置时间';
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function statusLabel(status: RecordStatus): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? '未知状态';
}

function scopeLabel(record: ExamRecord, grades: SchoolGrade[], classes: SchoolClass[]): string {
  if (!record.targetGradeIds.length && !record.targetClassIds.length) return '全校';
  const gradeNames = record.targetGradeIds.map((id) => grades.find((grade) => grade.id === id)?.name ?? id).slice(0, 2);
  const classNames = record.targetClassIds.map((id) => classes.find((item) => item.id === id)?.name ?? id).slice(0, 2);
  const labels = [...gradeNames, ...classNames];
  return `${labels.join('、')}${record.targetGradeIds.length + record.targetClassIds.length > labels.length ? ' 等' : ''}`;
}

export default function ExamRecordsPanel({ grades, classes }: Props) {
  const [records, setRecords] = useState<ExamRecord[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | RecordStatus>('');
  const [gradeId, setGradeId] = useState('');
  const [source, setSource] = useState<'' | RecordSource>('');
  const [timeScope, setTimeScope] = useState<'all' | 'upcoming' | 'past'>('all');
  const [createdBy, setCreatedBy] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ resource: 'records', page: String(page), pageSize: String(pageSize) });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    if (gradeId) {
      params.set('gradeId', gradeId);
      const classIds = classes.filter((item) => item.gradeId === gradeId).map((item) => item.id);
      if (classIds.length) params.set('classIds', classIds.join(','));
    }
    if (source) params.set('source', source);
    if (timeScope !== 'all') params.set('time', timeScope);
    if (createdBy.trim()) params.set('createdBy', createdBy.trim());
    try {
      const response = await fetch(`/api/exams?${params.toString()}`, {
        headers: tokenHeaders(),
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '考试列表读取失败');
      setRecords(Array.isArray(payload.data) ? payload.data : []);
      setTotal(Number(payload.total) || 0);
      setTotalPages(Number(payload.totalPages) || 0);
    } catch (caught) {
      setRecords([]);
      setTotal(0);
      setTotalPages(0);
      setError(caught instanceof Error ? caught.message : '考试列表读取失败');
    } finally {
      setLoading(false);
    }
  }, [classes, createdBy, gradeId, page, pageSize, query, source, status, timeScope]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords, refreshKey]);

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <main className="exam-records-panel">
      <header className="exam-records-panel__header">
        <div>
          <span className="exam-records-panel__eyebrow">考试管理</span>
          <h2>全部考试</h2>
          <p>按状态、范围和时间快速定位考试记录。</p>
        </div>
        <button
          className="admin-btn admin-btn--ghost exam-records-panel__refresh"
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading}
          aria-label="刷新考试列表"
          title="刷新考试列表"
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新
        </button>
      </header>

      <section className="exam-records-filters" aria-label="考试筛选">
        <label className="exam-records-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索考试</span>
          <input
            value={query}
            onChange={(event) => updateFilter(setQuery, event.target.value)}
            placeholder="搜索名称或编号"
            type="search"
          />
        </label>
        <label>
          <span>状态</span>
          <select value={status} onChange={(event) => updateFilter(setStatus, event.target.value)}>
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>年级</span>
          <select value={gradeId} onChange={(event) => updateFilter(setGradeId, event.target.value)}>
            <option value="">全部年级</option>
            {grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>来源</span>
          <select value={source} onChange={(event) => updateFilter(setSource, event.target.value)}>
            <option value="">全部来源</option>
            <option value="regular">正式考试</option>
            <option value="quick">快速考试</option>
          </select>
        </label>
        <label>
          <span>时间</span>
          <select value={timeScope} onChange={(event) => updateFilter(setTimeScope, event.target.value)}>
            <option value="all">全部时间</option>
            <option value="upcoming">即将开始</option>
            <option value="past">已结束</option>
          </select>
        </label>
        <label>
          <span>创建人</span>
          <input
            className="exam-records-creator-input"
            value={createdBy}
            onChange={(event) => updateFilter(setCreatedBy, event.target.value.replace(/[^0-9]/g, ''))}
            placeholder="创建人编号"
            inputMode="numeric"
          />
        </label>
      </section>

      {error && <div className="exam-records-feedback is-error">{error}</div>}
      {loading ? (
        <div className="exam-records-feedback">正在读取考试记录…</div>
      ) : records.length === 0 ? (
        <div className="exam-records-empty">
          <ClipboardList size={30} aria-hidden="true" />
          <strong>没有匹配的考试</strong>
          <span>调整筛选条件，或先在大型考试页面创建考试。</span>
        </div>
      ) : (
        <section className="exam-records-table-wrap" aria-label="考试记录">
          <div className="exam-records-table" role="table">
            <div className="exam-records-table__row is-head" role="row">
              <span role="columnheader">考试</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">适用范围</span>
              <span role="columnheader">时间</span>
              <span role="columnheader">科目</span>
              <span role="columnheader">创建人</span>
            </div>
            {records.map((record) => (
              <div className="exam-records-table__row" role="row" key={record.id}>
                <div className="exam-records-name" role="cell">
                  <strong title={record.name || record.id}>{record.name || '未命名考试'}</strong>
                  <code>{record.id}</code>
                </div>
                <span className={`exam-records-status is-${record.displayStatus}`} role="cell">
                  {statusLabel(record.displayStatus)}
                </span>
                <span className="exam-records-scope" role="cell">
                  {scopeLabel(record, grades, classes)}
                </span>
                <span className="exam-records-time" role="cell">
                  <CalendarClock size={14} aria-hidden="true" />
                  {record.startAt ? `${formatTime(record.startAt)} - ${formatTime(record.endAt)}` : '时间待定'}
                </span>
                <span className="exam-records-count" role="cell">
                  {record.itemCount} 科 · {record.source === 'quick' ? '快速' : '正式'}
                </span>
                <span className="exam-records-creator" role="cell">
                  {record.createdBy == null ? '系统' : `#${record.createdBy}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="exam-records-pagination">
        <span>共 {total} 场</span>
        <div>
          <button
            className="admin-btn admin-btn--ghost"
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
            aria-label="上一页"
            title="上一页"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{totalPages ? `${page} / ${totalPages}` : '1 / 1'}</strong>
          <button
            className="admin-btn admin-btn--ghost"
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={!totalPages || page >= totalPages || loading}
            aria-label="下一页"
            title="下一页"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </main>
  );
}
