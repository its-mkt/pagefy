// Pagefy API (Supabase Edge Function, Deno) — its.itket.com/pagefy 화면이 부르는 서버
// - 로그인: 광고 인사이트(ad-insight) 계정을 그대로 쓴다. 승인 여부는 광고 인사이트 수집기 웹앱의 whoami 로 확인
// - Claude API 키: Supabase 함수 비밀값 ANTHROPIC_API_KEY (코드·저장소에 없음)
// - 무료 플랜 150초 제한 → 생성은 계획(/plan)과 섹션별(/section)로 나눠 부른다. 한 번에 140초가 넘으면 끊고 알린다
// - 규칙: 저장소의 rules/detail_to_markup.md (공유 폴더 원본을 yarn sync:rules 로 복사해 push) 를 읽어 10분간 기억한다
// - core/·shared/ 는 저장소의 같은 폴더를 yarn build:function 으로 복사한 것 (직접 고치지 않는다)
import Anthropic from '@anthropic-ai/sdk';
import { buildPlanMessages, buildSectionMessages, buildSystem } from './core/prompt.ts';
import { describeError, runClaude, usageOfError, type Effort, type RunConfig } from './core/run.ts';
import { validatePlan, validateSection } from './core/validate.ts';
import type { HealthInfo, PlanRequest, SectionRequest, StreamEvent } from './shared/types.ts';
import type { Dial } from './core/ftp.ts';
import { adminStats, budgetBlock, checkFeedback, getBudget, opsConfigFrom, saveFeedback, saveSettings, trackRun } from './core/ops.ts';
import type { AdminSettingsRequest, FeedbackRequest } from './shared/ops.ts';
import { checkGoodsNo, fetchGoods, godoConfigFrom } from './core/godo.ts';
import { type UploadFile, type UploadTarget, checkFolder, checkTarget, deleteFiles, ftpConfigFrom, putFiles, undoUpload, verifyFiles, type UploadedItem } from './core/upload.ts';

// 이미지 호스팅 업로드 (규칙 6절): 접속 정보는 함수 비밀값 PAGEFY_FTP_HOST·USER·PASS·ROOT·PUBLIC_BASE(·PORT) 에만 둔다.
// 없으면 업로드 기능을 끈다 (화면에 버튼 없음). 같은 이름 파일은 화면이 확인받은 것만 덮어쓴다 — 옛 파일은 숨김 백업 (core/upload.ts)
// 운영 기록·월 상한·실패 알림 (core/ops.ts). SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 는 함수에 자동으로 들어 있다.
// 알림은 함수 비밀값 PAGEFY_NOTIFY_URL·PAGEFY_NOTIFY_SECRET·PAGEFY_NOTIFY_TO(쉼표로 여러 명) 가 있을 때만
const OPS = opsConfigFrom((k) => Deno.env.get(k));
const ftpCfg = () => ftpConfigFrom((k) => Deno.env.get(`PAGEFY_FTP_${k}`));
// 고도몰 등록 확인 (오픈 API 상품 조회, 읽기 전용): 함수 비밀값 PAGEFY_GODO_PARTNER_KEY · PAGEFY_GODO_USER_KEY (아이티켓 고도몰). 없으면 화면에 확인 상자가 없다
const godoCfg = () => godoConfigFrom((k) => Deno.env.get(`PAGEFY_GODO_${k}`));
const denoDial: Dial = async (hostname, port) => {
  const c = await Deno.connect({ hostname, port });
  return {
    write: async (b) => {
      for (let off = 0; off < b.length; ) off += await c.write(b.subarray(off));
    },
    read: async () => {
      const buf = new Uint8Array(64 * 1024);
      const n = await c.read(buf);
      return n === null ? null : buf.subarray(0, n);
    },
    close: async () => {
      try {
        c.close();
      } catch {
        // 이미 닫힘
      }
    },
  };
};
/** 기록용: 토큰 안의 이메일 (권한은 whoami 로 이미 확인함 — 여기서는 누가 올렸는지 로그에만) */
function emailOf(token: string) {
  try {
    return (JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string }).email || '?';
  } catch {
    return '?';
  }
}

const ALLOWED_ORIGINS = ['https://its.itket.com', 'http://localhost:1100', 'http://localhost:1101'];
/** 광고 인사이트 수집기 웹앱 (권한 판정: admins·members 명단) */
const ROLE_URL = 'https://script.google.com/macros/s/AKfycbzQS9yMlp9L_eRaH77QWLsY6GOY7L5hyRk1fkuaAHg8GvJmHHwhPRgr2zWldgbX5-cNcg/exec';
const ALLOWED_ROLES = new Set(['admin', 'manager', 'member']);
const RULES_URL = 'https://raw.githubusercontent.com/its-mkt/pagefy/main/rules/detail_to_markup.md';

let rulesCache: { text: string; at: number; updatedAt: string | null } | null = null;
async function loadRules() {
  if (rulesCache && Date.now() - rulesCache.at < 10 * 60_000) return rulesCache;
  try {
    const r = await fetch(RULES_URL, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const text = await r.text();
    // 마지막 커밋 시각 (규칙을 언제 반영했는지 화면에 표시)
    let updatedAt: string | null = null;
    try {
      const c = await fetch('https://api.github.com/repos/its-mkt/pagefy/commits?path=rules/detail_to_markup.md&per_page=1', { headers: { 'User-Agent': 'pagefy' }, signal: AbortSignal.timeout(5_000) });
      updatedAt = ((await c.json()) as { commit?: { committer?: { date?: string } } }[])[0]?.commit?.committer?.date ?? null;
    } catch {
      // 시각을 못 읽어도 규칙은 쓴다
    }
    rulesCache = { text, at: Date.now(), updatedAt };
  } catch (err) {
    if (!rulesCache) throw new Error(`규칙 파일을 읽지 못했습니다 (${RULES_URL}): ${(err as Error).message}`);
    // 예전 규칙으로 계속 쓰되, 매 요청마다 다시 읽느라 느려지지 않게 1분 뒤에 다시 시도
    rulesCache.at = Date.now() - 9 * 60_000;
  }
  return rulesCache!;
}

const MODEL = Deno.env.get('PAGEFY_MODEL') || 'claude-opus-5-5';
const EFFORT = (Deno.env.get('PAGEFY_EFFORT') || 'medium') as Effort;
const RUN: RunConfig = { model: MODEL, effort: EFFORT, maxTokens: 32000, timeLimitMs: 140_000 };
/** 계획 effort. 2026-11-20(옛 방식: 계획이 CSS·지침까지 씀)엔 medium 이 140초를 넘었지만, 2026-11-23 구조 계획만 쓰는 지금 방식은 ZGX(860×17455) medium 95초 — 품질을 위해 medium. 시간 초과가 잦으면 PAGEFY_PLAN_EFFORT=low */
const PLAN_RUN: RunConfig = { ...RUN, effort: (Deno.env.get('PAGEFY_PLAN_EFFORT') || 'medium') as Effort, maxTokens: 16000 };
const hasKey = () => !!Deno.env.get('ANTHROPIC_API_KEY');

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }));

// 같은 토큰으로 섹션 요청이 여러 번 오므로 권한 확인 결과를 잠깐 기억한다
const roleCache = new Map<string, { role: string; at: number }>();
async function roleOf(token: string): Promise<string> {
  if (!token) return 'guest';
  const hit = roleCache.get(token);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.role;
  try {
    const r = await fetch(`${ROLE_URL}?whoami=1&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return 'unknown'; // 웹앱 오류는 기억하지 않는다 (5분간 "로그인 만료"로 굳지 않게)
    const j = (await r.json()) as { role?: string };
    const role = j.role || 'invalid';
    if (roleCache.size > 500) roleCache.clear();
    roleCache.set(token, { role, at: Date.now() });
    return role;
  } catch {
    return 'unknown';
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    Vary: 'Origin',
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' } });

function sse(req: Request, work: (send: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>) {
  const ac = new AbortController();
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // 화면이 연결을 끊음
        }
      };
      try {
        await work(send, ac.signal);
      } catch (err) {
        if (!ac.signal.aborted) send({ type: 'error', message: describeError(err), ...usageOfError(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // 이미 닫힘
        }
      }
    },
    cancel() {
      ac.abort(); // 화면에서 취소하면 Claude 요청도 끊는다
    },
  });
  return new Response(body, { headers: { ...corsHeaders(req), 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } });
}

/** Claude 호출 한 번을 운영 기록에 남긴다 (비용·성공 여부·걸린 시간, 실패면 알림). 기록 실패는 생성에 영향 없음 */
async function tracked(info: Parameters<typeof trackRun>[1], send: (e: StreamEvent) => void, signal: AbortSignal, work: (send: (e: StreamEvent) => void) => Promise<void>) {
  const run = trackRun(OPS, info, send);
  try {
    await work(run.send);
    await run.finish(signal.aborted);
  } catch (err) {
    const u = usageOfError(err);
    await run.finish(signal.aborted, { message: describeError(err), costUsd: u.usage?.costUsd, model: u.model });
    throw err;
  }
}

/** 요청이 들어온 뒤 흐른 시간을 빼고 남은 시간만 Claude 에 준다 (권한 확인·규칙 읽기도 150초 안에 들어감) */
const within = (cfg: RunConfig, t0: number): RunConfig => ({ ...cfg, timeLimitMs: Math.max(20_000, cfg.timeLimitMs - (Date.now() - t0)) });

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  const path = new URL(req.url).pathname;
  const action = path.endsWith('/health')
    ? 'health'
    : path.endsWith('/plan')
      ? 'plan'
      : path.endsWith('/section')
        ? 'section'
        : path.endsWith('/upload/check')
          ? 'upload-check'
          : path.endsWith('/upload/files')
            ? 'upload-files'
            : path.endsWith('/upload/verify')
              ? 'upload-verify'
              : path.endsWith('/upload/remove')
                ? 'upload-remove'
                : path.endsWith('/upload/delete')
                ? 'upload-delete'
                : path.endsWith('/godo/goods')
                ? 'godo-goods'
                : path.endsWith('/feedback')
                  ? 'feedback'
                  : path.endsWith('/admin/stats')
                    ? 'admin-stats'
                    : path.endsWith('/admin/settings')
                      ? 'admin-settings'
                      : '';
  if (!action) return json(req, 404, { error: '없는 주소입니다.' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const role = await roleOf(token);
  if (!ALLOWED_ROLES.has(role)) {
    const why: Record<string, string> = {
      guest: '회사 계정으로 로그인해야 쓸 수 있습니다.',
      invalid: '로그인이 만료됐습니다. 새로고침한 뒤 다시 로그인하세요.',
      pending: '계정 승인을 기다리는 중입니다. 관리자가 승인하면 쓸 수 있습니다.',
      none: '아직 사용 승인을 요청하지 않은 계정입니다. 계정 관리 화면(광고 인사이트)에서 승인을 요청하세요.',
      rejected: '승인 요청이 거절된 계정입니다. 마케팅팀 관리자에게 문의하세요.',
      revoked: '사용 권한이 해제된 계정입니다. 마케팅팀 관리자에게 문의하세요.',
      unknown: '권한을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.',
    };
    return json(req, role === 'guest' || role === 'invalid' ? 401 : 403, { error: why[role] || '승인된 회사 계정만 쓸 수 있습니다.', role });
  }

  if (action === 'health') {
    const body: HealthInfo & { role: string } = {
      ok: true,
      mock: false,
      hasKey: hasKey(),
      model: MODEL,
      effort: EFFORT,
      planEffort: PLAN_RUN.effort,
      rules: await loadRules().then((r) => ({ source: 'GitHub its-mkt/pagefy rules/detail_to_markup.md', updatedAt: r.updatedAt, fallback: false })).catch(() => ({ source: '(규칙 읽기 실패)', updatedAt: null, fallback: true })),
      role,
      upload: !!ftpCfg(),
      godo: !!godoCfg(),
      // 이번 달 사용액·상한 (80% 넘으면 화면에 경고, 다 쓰면 막힘). 운영 기록 DB 를 못 읽으면 빼고 보낸다
      budget: OPS ? await getBudget(OPS).catch(() => undefined) : undefined,
    };
    return json(req, 200, body);
  }
  // 관리 화면 (광고 인사이트 역할 admin 만): 이번 달 비용·사용 기록·평가, 월 상한 바꾸기·풀기
  if (action === 'admin-stats' || action === 'admin-settings') {
    if (role !== 'admin') return json(req, 403, { error: '관리자만 볼 수 있습니다.' });
    if (!OPS) return json(req, 503, { error: '운영 기록 DB 설정이 없습니다.' });
    try {
      if (action === 'admin-stats') return json(req, 200, await adminStats(OPS, new URL(req.url).searchParams.get('month') || undefined));
      if (req.method !== 'POST') return json(req, 405, { error: 'POST 로 요청하세요.' });
      const budget = await saveSettings(OPS, (await req.json()) as AdminSettingsRequest, emailOf(token));
      console.log(`[admin] ${emailOf(token)} 설정 변경 — 상한 $${budget.capUsd}${budget.unblocked ? ' (이번 달 해제)' : ''}`);
      return json(req, 200, { budget });
    } catch (err) {
      return json(req, 400, { error: describeError(err) });
    }
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 로 요청하세요.' });

  // 결과 평가 (그대로 썼어요 / 고쳐서 썼어요) — 생성 권한이 있는 사람이면 누구나
  if (action === 'feedback') {
    if (!OPS) return json(req, 503, { error: '운영 기록 DB 설정이 없습니다.' });
    let fb: FeedbackRequest | null = null;
    try {
      fb = (await req.json()) as FeedbackRequest;
    } catch {
      // 아래에서 거절
    }
    const bad = checkFeedback(fb);
    if (bad) return json(req, 400, { error: bad });
    try {
      await saveFeedback(OPS, emailOf(token), fb!);
      return json(req, 200, { ok: true });
    } catch (err) {
      return json(req, 502, { error: describeError(err) });
    }
  }

  // 고도몰 등록 확인 — 상품 상세설명·수정일을 읽어 화면이 Pagefy 결과와 비교한다 (읽기 전용)
  if (action === 'godo-goods') {
    const cfg = godoCfg();
    if (!cfg) return json(req, 503, { error: '고도몰 API 키(함수 비밀값 PAGEFY_GODO_*)가 없습니다. 관리자에게 등록을 요청하세요.' });
    let no: unknown;
    try {
      no = ((await req.json()) as { goodsNo?: unknown }).goodsNo;
    } catch {
      return json(req, 400, { error: '요청 본문을 읽지 못했습니다.' });
    }
    const bad = checkGoodsNo(no);
    if (bad) return json(req, 400, { error: bad });
    try {
      const goods = await fetchGoods(cfg, no as string);
      return goods ? json(req, 200, goods) : json(req, 404, { error: `고도몰에 상품번호 ${no} 상품이 없습니다.` });
    } catch (err) {
      return json(req, 502, { error: describeError(err) });
    }
  }

  if (action.startsWith('upload-')) {
    const cfg = ftpCfg();
    if (!cfg) return json(req, 503, { error: '이미지 서버 접속 정보(함수 비밀값 PAGEFY_FTP_*)가 없습니다. 관리자에게 등록을 요청하세요.' });
    let ub: { target?: UploadTarget; files?: unknown; overwrite?: unknown; items?: unknown };
    try {
      ub = await req.json();
    } catch {
      return json(req, 400, { error: '요청 본문을 읽지 못했습니다.' });
    }
    const t = ub.target as UploadTarget;
    const problem = checkTarget(cfg, t);
    if (problem) return json(req, 400, { error: problem });
    try {
      if (action === 'upload-check') return json(req, 200, await checkFolder(cfg, denoDial, t));
      if (action === 'upload-files') {
        const out = await putFiles(cfg, denoDial, t, ub.files as UploadFile[], (ub.overwrite as string[]) ?? [], t0 + 130_000);
        const over = out.done.filter((d) => d.backup).length;
        console.log(`[upload] ${emailOf(token)} ${t.channel}/${t.slug} 올림 ${out.done.length}개${over ? ` (덮어씀 ${over}개)` : ''}${out.refused.length ? ` · 거절 ${out.refused.length}개` : ''}`);
        return json(req, 200, out);
      }
      // 잘못 올린 것 되돌리기 — 이번에 올린 파일만: 덮어쓴 것은 백업으로 되돌리고 새로 올린 것은 지운다 (core/upload.ts undoUpload)
      if (action === 'upload-remove') {
        const out = await undoUpload(cfg, denoDial, t, ub.items as UploadedItem[], t0 + 130_000);
        console.log(`[upload] ${emailOf(token)} ${t.channel}/${t.slug} 되돌림 — 복원 ${out.restored.length}개 · 지움 ${out.removed.length}개${out.failed.length ? ` · 실패 ${out.failed.length}개` : ''}`);
        return json(req, 200, out);
      }
      // 변환 내역 「이미지 서버에서 지우기」 — 화면이 고른 파일과 그 숨김 백업을 지운다 (core/upload.ts deleteFiles)
      if (action === 'upload-delete') {
        const out = await deleteFiles(cfg, denoDial, t, ub.files as string[], t0 + 130_000);
        console.log(`[upload] ${emailOf(token)} ${t.channel}/${t.slug} 지움 ${out.removed.length}개 (백업 ${out.backups}개${out.missing.length ? ` · 이미 없음 ${out.missing.length}개` : ''}${out.failed.length ? ` · 실패 ${out.failed.length}개` : ''})`);
        return json(req, 200, out);
      }
      return json(req, 200, { results: await verifyFiles(cfg, t, (ub.files as { file: string; size: number; sha256?: string }[]) || [], t0 + 130_000) });
    } catch (err) {
      return json(req, 502, { error: describeError(err) });
    }
  }
  // 월 상한: 이번 달 사용액이 상한에 닿았으면 새 생성을 막는다 (관리자가 관리 화면에서 그 달만 풀 수 있음)
  const blocked = await budgetBlock(OPS);
  if (blocked) return json(req, 429, { error: blocked, budgetBlocked: true });
  if (!hasKey()) return json(req, 500, { error: 'Supabase 함수 비밀값 ANTHROPIC_API_KEY 가 없습니다. 관리자에게 등록을 요청하세요.' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: '요청 본문을 읽지 못했습니다.' });
  }

  if (action === 'plan') {
    const b = body as PlanRequest;
    const problem = validatePlan(b);
    if (problem) return json(req, 400, { error: problem });
    return sse(req, async (send, signal) => {
      send({ type: 'status', message: `계획 요청 중… (타일 ${b.tiles.length}장, 텍스트 ${b.summary.texts.length}개)` });
      const system = buildSystem((await loadRules()).text);
      await tracked({ email: emailOf(token), action: 'plan', product: b.meta?.productName, channel: b.meta?.channel }, send, signal, (s) => runClaude(getClient(), within(PLAN_RUN, t0), system, buildPlanMessages(b), s, signal));
    });
  }

  const b = body as SectionRequest;
  const problem = validateSection(b);
  if (problem) return json(req, 400, { error: problem });
  return sse(req, async (send, signal) => {
    const system = buildSystem((await loadRules()).text);
    await tracked({ email: emailOf(token), action: 'section', product: b.meta?.productName, channel: b.meta?.channel }, send, signal, (s) => runClaude(getClient(), within(RUN, t0), system, buildSectionMessages(b), s, signal));
  });
});
