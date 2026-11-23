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
import { type UploadFile, type UploadTarget, checkFolder, checkTarget, ftpConfigFrom, putFiles, removeUpload, verifyFiles } from './core/upload.ts';

// 이미지 호스팅 업로드 (규칙 6절): 접속 정보는 함수 비밀값 PAGEFY_FTP_HOST·USER·PASS·ROOT·PUBLIC_BASE(·PORT) 에만 둔다.
// 없으면 업로드 기능을 끈다 (화면에 버튼 없음). 같은 이름 파일은 덮어쓰지 않는다 (core/upload.ts)
const ftpCfg = () => ftpConfigFrom((k) => Deno.env.get(`PAGEFY_FTP_${k}`));
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
      rules: await loadRules().then((r) => ({ source: 'GitHub its-mkt/pagefy rules/detail_to_markup.md', updatedAt: r.updatedAt, fallback: false })).catch(() => ({ source: '(규칙 읽기 실패)', updatedAt: null, fallback: true })),
      role,
      upload: !!ftpCfg(),
    };
    return json(req, 200, body);
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 로 요청하세요.' });

  if (action.startsWith('upload-')) {
    const cfg = ftpCfg();
    if (!cfg) return json(req, 503, { error: '이미지 서버 접속 정보(함수 비밀값 PAGEFY_FTP_*)가 없습니다. 관리자에게 등록을 요청하세요.' });
    let ub: { target?: UploadTarget; files?: unknown };
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
        const out = await putFiles(cfg, denoDial, t, ub.files as UploadFile[], t0 + 130_000);
        console.log(`[upload] ${emailOf(token)} ${t.channel}/${t.slug}/${t.rev} 올림 ${out.done.length}개${out.refused.length ? ` · 거절 ${out.refused.length}개` : ''}`);
        return json(req, 200, out);
      }
      // 잘못 올린 것 되돌리기 — 이 작업이 올린 폴더만, 폴더 안 파일이 모두 이 결과의 이미지일 때만 (core/upload.ts removeUpload)
      if (action === 'upload-remove') {
        const out = await removeUpload(cfg, denoDial, t, ub.files as string[], t0 + 130_000);
        console.log(`[upload] ${emailOf(token)} ${t.channel}/${t.slug}/${t.rev} 되돌림 ${out.removed.length}개${out.folderRemoved ? ' · 폴더 삭제' : ''}`);
        return json(req, 200, out);
      }
      return json(req, 200, { results: await verifyFiles(cfg, t, (ub.files as { file: string; size: number; sha256?: string }[]) || [], t0 + 130_000) });
    } catch (err) {
      return json(req, 502, { error: describeError(err) });
    }
  }
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
      await runClaude(getClient(), within(PLAN_RUN, t0), system, buildPlanMessages(b), send, signal);
    });
  }

  const b = body as SectionRequest;
  const problem = validateSection(b);
  if (problem) return json(req, 400, { error: problem });
  return sse(req, async (send, signal) => {
    const system = buildSystem((await loadRules()).text);
    await runClaude(getClient(), within(RUN, t0), system, buildSectionMessages(b), send, signal);
  });
});
