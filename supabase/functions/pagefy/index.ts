// Pagefy API (Supabase Edge Function, Deno) — its.itket.com/pagefy 화면이 부르는 서버
// - 로그인: 광고 인사이트(ad-insight) 계정을 그대로 쓴다. 승인 여부는 광고 인사이트 수집기 웹앱의 whoami 로 확인
// - Claude API 키: Supabase 함수 비밀값 ANTHROPIC_API_KEY (코드·저장소에 없음)
// - 무료 플랜 150초 제한 → 생성은 계획(/plan)과 섹션별(/section)로 나눠 부른다. 한 번에 140초가 넘으면 끊고 알린다
// - 규칙: 저장소의 rules/detail_to_markup.md (공유 폴더 원본을 yarn sync:rules 로 복사해 push) 를 읽어 10분간 기억한다
// - core/·shared/ 는 저장소의 같은 폴더를 yarn build:function 으로 복사한 것 (직접 고치지 않는다)
import Anthropic from '@anthropic-ai/sdk';
import { buildPlanMessages, buildSectionMessages, buildSystem } from './core/prompt.ts';
import { describeError, runClaude, type Effort, type RunConfig } from './core/run.ts';
import { validatePlan, validateSection } from './core/validate.ts';
import type { HealthInfo, PlanRequest, SectionRequest, StreamEvent } from './shared/types.ts';

const ALLOWED_ORIGINS = ['https://its.itket.com', 'http://localhost:1100', 'http://localhost:1101'];
/** 광고 인사이트 수집기 웹앱 (권한 판정: admins·members 명단) */
const ROLE_URL = 'https://script.google.com/macros/s/AKfycbzQS9yMlp9L_eRaH77QWLsY6GOY7L5hyRk1fkuaAHg8GvJmHHwhPRgr2zWldgbX5-cNcg/exec';
const ALLOWED_ROLES = new Set(['admin', 'manager', 'member']);
const RULES_URL = 'https://raw.githubusercontent.com/its-mkt/pagefy/main/rules/detail_to_markup.md';

let rulesCache: { text: string; at: number; updatedAt: string | null } | null = null;
async function loadRules() {
  if (rulesCache && Date.now() - rulesCache.at < 10 * 60_000) return rulesCache;
  try {
    const r = await fetch(RULES_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status}`);
    const text = await r.text();
    // 마지막 커밋 시각 (규칙을 언제 반영했는지 화면에 표시)
    let updatedAt: string | null = null;
    try {
      const c = await fetch('https://api.github.com/repos/its-mkt/pagefy/commits?path=rules/detail_to_markup.md&per_page=1', { headers: { 'User-Agent': 'pagefy' } });
      updatedAt = ((await c.json()) as { commit?: { committer?: { date?: string } } }[])[0]?.commit?.committer?.date ?? null;
    } catch {
      // 시각을 못 읽어도 규칙은 쓴다
    }
    rulesCache = { text, at: Date.now(), updatedAt };
  } catch (err) {
    if (!rulesCache) throw new Error(`규칙 파일을 읽지 못했습니다 (${RULES_URL}): ${(err as Error).message}`);
  }
  return rulesCache!;
}

const MODEL = Deno.env.get('PAGEFY_MODEL') || 'claude-opus-5-5';
const EFFORT = (Deno.env.get('PAGEFY_EFFORT') || 'medium') as Effort;
const RUN: RunConfig = { model: MODEL, effort: EFFORT, maxTokens: 32000, timeLimitMs: 140_000 };
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
    const r = await fetch(`${ROLE_URL}?whoami=1&access_token=${encodeURIComponent(token)}`);
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
        if (!ac.signal.aborted) send({ type: 'error', message: describeError(err) });
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  const path = new URL(req.url).pathname;
  const action = path.endsWith('/health') ? 'health' : path.endsWith('/plan') ? 'plan' : path.endsWith('/section') ? 'section' : '';
  if (!action) return json(req, 404, { error: '없는 주소입니다.' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const role = await roleOf(token);
  if (!ALLOWED_ROLES.has(role)) {
    const why: Record<string, string> = {
      guest: '로그인이 필요합니다.',
      invalid: '로그인이 만료됐습니다. 다시 로그인하세요.',
      pending: '광고 인사이트 계정 승인을 기다리는 중입니다.',
      none: '광고 인사이트에서 가입·승인 요청을 먼저 하세요.',
      unknown: '권한을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.',
    };
    return json(req, role === 'guest' || role === 'invalid' ? 401 : 403, { error: why[role] || '승인된 계정만 쓸 수 있습니다.', role });
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
    };
    return json(req, 200, body);
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 로 요청하세요.' });
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
      await runClaude(getClient(), RUN, buildSystem((await loadRules()).text), buildPlanMessages(b), send, signal);
    });
  }

  const b = body as SectionRequest;
  const problem = validateSection(b);
  if (problem) return json(req, 400, { error: problem });
  return sse(req, async (send, signal) => runClaude(getClient(), RUN, buildSystem((await loadRules()).text), buildSectionMessages(b), send, signal));
});
