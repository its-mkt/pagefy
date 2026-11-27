// 운영 기록 (Supabase 함수 공용 — Node·Deno 둘 다 되게 fetch 만 쓴다, node: 모듈 금지)
// - 생성 요청마다 pagefy_runs 에 한 줄 (함수가 직접 잰 비용 — 월 상한 판단의 기준)
// - 월 상한: pagefy_settings.monthly_cap_usd. 넘으면 새 생성을 막고, 관리자가 그 달만 풀 수 있다 (unblocked_month)
// - 실패 알림: PAGEFY_NOTIFY_URL(광고 인사이트 Apps Script 웹앱)로 보낸다. 같은 종류는 1시간에 한 번만
// 표 정의: supabase/migrations/20261124_pagefy_ops.sql (RLS 켬·정책 없음 → service_role 로만 읽고 씀)
import type { StreamEvent } from '../shared/types.ts';
import { type AdminSettingsRequest, type AdminStats, type BudgetInfo, type FeedbackRequest, FEEDBACK_AREAS, budgetOf, monthKST, monthStartISO, nextMonth } from '../shared/ops.ts';

export interface OpsConfig {
  /** Supabase 프로젝트 주소 (SUPABASE_URL) */
  url: string;
  /** service_role 키 (SUPABASE_SERVICE_ROLE_KEY — 함수에 자동으로 들어 있음) */
  key: string;
  /** 실패 알림 웹앱 주소·비밀값·받는 사람 (없으면 알림 안 보냄) */
  notifyUrl?: string;
  notifySecret?: string;
  notifyTo?: string[];
}

/** 환경변수에서 설정 읽기. Supabase 주소·키가 없으면 null (로컬 서버 등 — 기록·상한 끔) */
export function opsConfigFrom(env: (k: string) => string | undefined): OpsConfig | null {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  const to = (env('PAGEFY_NOTIFY_TO') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { url, key, notifyUrl: env('PAGEFY_NOTIFY_URL') || undefined, notifySecret: env('PAGEFY_NOTIFY_SECRET') || undefined, notifyTo: to.length ? to : undefined };
}

async function rest<T>(cfg: OpsConfig, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    signal: init.signal ?? AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`운영 기록 DB ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

// ───── 설정·상한 ─────

async function readSettings(cfg: OpsConfig): Promise<{ capUsd: number; unblockedMonth: string | null }> {
  const rows = await rest<{ key: string; value: unknown }[]>(cfg, 'pagefy_settings?select=key,value');
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const cap = Number(get('monthly_cap_usd'));
  const ub = get('unblocked_month');
  return { capUsd: Number.isFinite(cap) && cap > 0 ? cap : 100, unblockedMonth: typeof ub === 'string' ? ub : null };
}

async function spentIn(cfg: OpsConfig, month: string): Promise<number> {
  const rows = await rest<{ cost_usd: number | string }[]>(cfg, `pagefy_runs?select=cost_usd&at=gte.${encodeURIComponent(monthStartISO(month))}&at=lt.${encodeURIComponent(monthStartISO(nextMonth(month)))}`);
  return rows.reduce((n, r) => n + Number(r.cost_usd || 0), 0);
}

let budgetCache: { at: number; info: BudgetInfo } | null = null;

/** 이번 달 사용액·상한 (30초 기억 — 섹션 요청이 몰려도 DB 를 매번 읽지 않게) */
export async function getBudget(cfg: OpsConfig, fresh = false): Promise<BudgetInfo> {
  const month = monthKST();
  if (!fresh && budgetCache && budgetCache.info.month === month && Date.now() - budgetCache.at < 30_000) return budgetCache.info;
  const [s, spent] = await Promise.all([readSettings(cfg), spentIn(cfg, month)]);
  const info = budgetOf(month, s.capUsd, spent, s.unblockedMonth);
  budgetCache = { at: Date.now(), info };
  return info;
}

/** 상한에 걸렸으면 막는 문구, 아니면 null. DB 를 못 읽으면 막지 않는다 (기록 장애로 업무가 멈추지 않게) */
export async function budgetBlock(cfg: OpsConfig | null): Promise<string | null> {
  if (!cfg) return null;
  try {
    const b = await getBudget(cfg);
    return b.blocked ? `이번 달 사용 한도($${b.capUsd})에 도달해 새로 만들 수 없습니다 (사용 $${b.spentUsd.toFixed(2)}). 마케팅팀 Pagefy 관리자에게 한도 해제를 요청하세요.` : null;
  } catch (err) {
    console.error('[ops] 한도 확인 실패 — 막지 않고 진행', err);
    return null;
  }
}

export async function saveSettings(cfg: OpsConfig, req: AdminSettingsRequest, by: string): Promise<BudgetInfo> {
  const rows: { key: string; value: unknown; updated_by: string; updated_at: string }[] = [];
  const now = new Date().toISOString();
  if (req.capUsd !== undefined) {
    const cap = Number(req.capUsd);
    if (!Number.isFinite(cap) || cap < 1 || cap > 10000) throw new Error('월 상한은 1~10000 달러로 정하세요.');
    rows.push({ key: 'monthly_cap_usd', value: Math.round(cap * 100) / 100, updated_by: by, updated_at: now });
  }
  if (req.unblock !== undefined) rows.push({ key: 'unblocked_month', value: req.unblock ? monthKST() : null, updated_by: by, updated_at: now });
  if (rows.length) await rest(cfg, 'pagefy_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) });
  return getBudget(cfg, true);
}

// ───── 사용 기록 ─────

export interface RunInfo {
  email: string;
  action: 'plan' | 'section' | 'review';
  product?: string;
  channel?: string;
}

function kindOf(message: string): string {
  if (/시간 제한|time ?limit|timeout/i.test(message)) return 'timeout';
  if (/거절|refus/i.test(message)) return 'refusal';
  if (/Claude API|API 키|요청 한도|연결하지 못/.test(message)) return 'api';
  return 'other';
}

/**
 * 생성 한 번을 기록한다: send 를 감싸 done·error 이벤트에서 비용·결과를 모으고, finish() 에서 DB 에 쓴다.
 * 기록 실패는 생성에 영향을 주지 않는다 (콘솔에만)
 */
export function trackRun(cfg: OpsConfig | null, info: RunInfo, send: (e: StreamEvent) => void) {
  const t0 = Date.now();
  let cost = 0;
  let model: string | undefined;
  let status: 'ok' | 'error' | 'cancelled' | null = null;
  let error: string | undefined;
  const wrapped = (e: StreamEvent) => {
    if (e.type === 'done') {
      status = 'ok';
      cost = e.usage.costUsd;
      model = e.model;
    } else if (e.type === 'error') {
      status = 'error';
      error = e.message;
      cost = e.usage?.costUsd ?? cost;
      model = e.model ?? model;
    }
    send(e);
  };
  const finish = async (aborted: boolean, thrown?: { message: string; costUsd?: number; model?: string }) => {
    if (thrown) {
      status = 'error';
      error = thrown.message;
      cost = thrown.costUsd ?? cost;
      model = thrown.model ?? model;
    }
    if (aborted && status !== 'ok') status = 'cancelled';
    const row = {
      email: info.email,
      action: info.action,
      product: info.product?.slice(0, 200) ?? null,
      channel: info.channel ?? null,
      model: model ?? null,
      cost_usd: cost,
      status: status ?? 'error',
      error_kind: status === 'error' && error ? kindOf(error) : null,
      error: error?.slice(0, 1000) ?? null,
      duration_ms: Date.now() - t0,
    };
    if (!status) row.error = '응답이 끝나지 않음 (연결 끊김)';
    if (!cfg) return;
    try {
      await rest(cfg, 'pagefy_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (budgetCache) budgetCache.info = { ...budgetCache.info, spentUsd: budgetCache.info.spentUsd + cost };
    } catch (err) {
      console.error('[ops] 사용 기록 실패', err);
    }
    if (row.status === 'error') await notifyFailure(cfg, row);
  };
  return { send: wrapped, finish };
}

// ───── 실패 알림 ─────

const lastNotified = new Map<string, number>();

async function notifyFailure(cfg: OpsConfig, row: { email: string; action: string; product: string | null; error_kind: string | null; error: string | null; duration_ms: number }) {
  if (!cfg.notifyUrl || !cfg.notifyTo?.length) return;
  const kind = row.error_kind || 'other';
  const last = lastNotified.get(kind) ?? 0;
  if (Date.now() - last < 3600_000) return; // 같은 종류는 1시간에 한 번만 (연달아 실패해도 메일이 쏟아지지 않게)
  lastNotified.set(kind, Date.now());
  const KIND: Record<string, string> = { timeout: '시간 초과', refusal: '모델 거절', api: 'Claude API 오류', other: '기타 오류' };
  try {
    await fetch(cfg.notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script 웹앱은 미리 확인 요청(preflight) 없이 받는 형식만
      body: JSON.stringify({
        action: 'pagefyNotify',
        secret: cfg.notifySecret ?? '',
        to: cfg.notifyTo,
        subject: `[Pagefy] ${row.action === 'review' ? '재검증' : '생성'} 실패 — ${KIND[kind] ?? kind}`,
        body: [
          `누가: ${row.email}`,
          `무엇: ${row.action === 'plan' ? '구조 계획' : row.action === 'review' ? '마크업 재검증' : '섹션 생성'}${row.product ? ` · ${row.product}` : ''}`,
          `걸린 시간: ${Math.round(row.duration_ms / 1000)}초`,
          `오류: ${row.error ?? '(내용 없음)'}`,
          '',
          '같은 종류의 실패는 1시간 동안 다시 알리지 않습니다. 전체 목록: https://its.itket.com/pagefy/#admin',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    console.error('[ops] 실패 알림을 보내지 못함', err);
  }
}

// ───── 결과 평가 ─────

const AREA_IDS = new Set<string>(FEEDBACK_AREAS.map((a) => a.id));

export function checkFeedback(b: FeedbackRequest | null): string | null {
  if (!b || typeof b.jobId !== 'string' || !b.jobId || b.jobId.length > 100) return '작업 정보가 없습니다.';
  if (b.verdict !== 'asis' && b.verdict !== 'edited') return '평가 값이 올바르지 않습니다.';
  if (!Array.isArray(b.areas) || b.areas.some((a) => !AREA_IDS.has(a))) return '고친 곳 값이 올바르지 않습니다.';
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) return '메모는 500자 이내로 적어 주세요.';
  return null;
}

export async function saveFeedback(cfg: OpsConfig, email: string, b: FeedbackRequest) {
  await rest(cfg, 'pagefy_feedback?on_conflict=job_id,email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      job_id: b.jobId,
      email,
      at: new Date().toISOString(),
      product: (b.product || '').slice(0, 200) || null,
      verdict: b.verdict,
      areas: b.verdict === 'edited' ? b.areas : [],
      note: b.note?.trim() || null,
    }),
  });
}

// ───── 관리 화면 ─────

type RunRow = { at: string; email: string; action: string; product: string | null; cost_usd: number | string; status: string; error_kind: string | null; error: string | null; duration_ms: number | null };
type FbRow = { at: string; email: string; product: string | null; verdict: 'asis' | 'edited'; areas: string[]; note: string | null };

export async function adminStats(cfg: OpsConfig, month = monthKST()): Promise<AdminStats> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('달 형식은 YYYY-MM 입니다.');
  const from = monthStartISO(month);
  const to = monthStartISO(nextMonth(month));
  const sixFrom = monthStartISO(nextMonth(month, -5));
  const q = (s: string) => encodeURIComponent(s);
  const [settings, runs, fb, history] = await Promise.all([
    readSettings(cfg),
    rest<RunRow[]>(cfg, `pagefy_runs?select=at,email,action,product,cost_usd,status,error_kind,error,duration_ms&at=gte.${q(from)}&at=lt.${q(to)}&order=at.desc&limit=5000`),
    rest<FbRow[]>(cfg, `pagefy_feedback?select=at,email,product,verdict,areas,note&at=gte.${q(from)}&at=lt.${q(to)}&order=at.desc&limit=2000`),
    rest<{ at: string; action: string; cost_usd: number | string }[]>(cfg, `pagefy_runs?select=at,action,cost_usd&at=gte.${q(sixFrom)}&at=lt.${q(to)}&limit=20000`),
  ]);
  const spent = runs.reduce((n, r) => n + Number(r.cost_usd || 0), 0);
  const users = new Map<string, { email: string; runs: number; costUsd: number; failed: number }>();
  for (const r of runs) {
    const u = users.get(r.email) ?? { email: r.email, runs: 0, costUsd: 0, failed: 0 };
    u.runs += 1;
    u.costUsd += Number(r.cost_usd || 0);
    if (r.status === 'error') u.failed += 1;
    users.set(r.email, u);
  }
  const plans = runs.filter((r) => r.action === 'plan' && r.status === 'ok' && r.duration_ms);
  const areas: Record<string, number> = {};
  for (const f of fb) for (const a of f.areas ?? []) areas[a] = (areas[a] ?? 0) + 1;
  const months = Array.from({ length: 6 }, (_, i) => nextMonth(month, i - 5)).map((m) => {
    const rows = history.filter((h) => monthKST(new Date(h.at)) === m);
    return { month: m, costUsd: Math.round(rows.reduce((n, h) => n + Number(h.cost_usd || 0), 0) * 100) / 100, plans: rows.filter((h) => h.action === 'plan').length };
  });
  return {
    month,
    budget: budgetOf(month, settings.capUsd, spent, settings.unblockedMonth),
    runs: {
      total: runs.length,
      ok: runs.filter((r) => r.status === 'ok').length,
      failed: runs.filter((r) => r.status === 'error').length,
      cancelled: runs.filter((r) => r.status === 'cancelled').length,
      timeouts: runs.filter((r) => r.error_kind === 'timeout').length,
      avgPlanMs: plans.length ? Math.round(plans.reduce((n, r) => n + (r.duration_ms ?? 0), 0) / plans.length) : null,
    },
    users: [...users.values()].map((u) => ({ ...u, costUsd: Math.round(u.costUsd * 100) / 100 })).sort((a, b) => b.costUsd - a.costUsd),
    failures: runs
      .filter((r) => r.status === 'error')
      .slice(0, 20)
      .map((r) => ({ at: r.at, email: r.email, action: r.action, product: r.product, kind: r.error_kind, error: r.error, durationMs: r.duration_ms })),
    feedback: { total: fb.length, asis: fb.filter((f) => f.verdict === 'asis').length, edited: fb.filter((f) => f.verdict === 'edited').length, areas },
    recentFeedback: fb.slice(0, 20),
    months,
  };
}
