// Claude 호출 공용 (로컬 서버·Supabase 함수 공용): 스트리밍 → SSE 이벤트, 비용 계산, 오류 문구
import Anthropic from '@anthropic-ai/sdk';
import type { StreamEvent, UsageInfo } from '../shared/types.ts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RunConfig {
  model: string;
  effort: Effort;
  maxTokens: number;
  /** 이 시간이 지나면 끊고 알린다 (Supabase 무료 함수 150초 제한 대비). 0 이면 제한 없음 */
  timeLimitMs: number;
}

// USD / 1M 토큰 (입력, 출력, 캐시 읽기). 캐시 쓰기 = 입력 × 1.25
const PRICE: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-fable-5-2': [8, 40, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
};

/** 표에 없는 모델(날짜 붙은 이름·대체 모델)은 계열 이름으로 찾는다 */
function priceOf(model: string | null | undefined): [number, number, number] {
  const m = model || '';
  if (PRICE[m]) return PRICE[m];
  const family = ['fable', 'opus', 'sonnet', 'haiku'].find((f) => m.includes(f));
  const key = family && Object.keys(PRICE).find((k) => k.includes(family));
  return key ? PRICE[key] : PRICE['claude-opus-5-5'];
}

type Tok = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
const costOf = (p: [number, number, number], t: Tok) =>
  ((t.input_tokens ?? 0) * p[0] + (t.output_tokens ?? 0) * p[1] + (t.cache_read_input_tokens ?? 0) * p[2] + (t.cache_creation_input_tokens ?? 0) * p[0] * 1.25) / 1e6;

export function usageOf(model: string, u: Anthropic.Beta.BetaUsage | undefined): UsageInfo {
  let input = u?.input_tokens ?? 0;
  let output = u?.output_tokens ?? 0;
  let cacheRead = u?.cache_read_input_tokens ?? 0;
  let cacheWrite = u?.cache_creation_input_tokens ?? 0;
  let costUsd = costOf(priceOf(model), u ?? {});
  // 대체 모델로 넘어간 요청은 시도(거절된 모델 + 대체 모델)마다 따로 센다 — 맨 위 합계만 보면 적게 잡힘
  const its = (u?.iterations ?? []).filter((it) => it.type === 'message' || it.type === 'fallback_message') as (Tok & { model?: string | null })[];
  if (its.length > 1) {
    const sum = (k: keyof Tok) => its.reduce((n, it) => n + (it[k] ?? 0), 0);
    input = Math.max(input, sum('input_tokens'));
    output = Math.max(output, sum('output_tokens'));
    cacheRead = Math.max(cacheRead, sum('cache_read_input_tokens'));
    cacheWrite = Math.max(cacheWrite, sum('cache_creation_input_tokens'));
    costUsd = Math.max(costUsd, its.reduce((n, it) => n + costOf(priceOf(it.model ?? model), it), 0));
  }
  return { input, output, cacheRead, cacheWrite, costUsd: Math.round(costUsd * 1000) / 1000 };
}

/** 메시지 하나를 스트리밍으로 받아 send 로 흘려보낸다 */
export async function runClaude(
  client: Anthropic,
  cfg: RunConfig,
  system: Anthropic.Beta.BetaTextBlockParam[],
  messages: Anthropic.Beta.BetaMessageParam[],
  send: (e: StreamEvent) => void,
  signal: AbortSignal,
) {
  // 규칙 읽기 등 앞 단계에서 이미 취소됐으면 Claude 를 부르지 않는다 (이미 끝난 신호에 붙인 리스너는 불리지 않아, 아무도 안 받는 응답이 끝까지 돌며 비용이 나간다)
  if (signal.aborted) throw new Error('취소되었습니다.');
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort);
  let timedOut = false;
  const partial: { model?: string; usage?: Anthropic.Beta.BetaUsage } = {};
  const timer = cfg.timeLimitMs
    ? setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, cfg.timeLimitMs)
    : undefined;
  try {
    const stream = client.beta.messages.stream(
      {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: cfg.effort },
        // 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도 (거절 범주별 기본 경로)
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages,
      },
      { signal: ac.signal },
    );
    let thinkingShown = false;
    let textStarted = false;
    for await (const event of stream) {
      // 도중에 끊겨도(시간 초과·취소) 쓴 비용을 알리도록 지금까지의 사용량을 모은다
      if (event.type === 'message_start') {
        partial.model = event.message.model;
        partial.usage = { ...event.message.usage };
      } else if (event.type === 'message_delta' && partial.usage) partial.usage = { ...partial.usage, output_tokens: event.usage.output_tokens ?? partial.usage.output_tokens };
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'thinking' && !thinkingShown) {
          thinkingShown = true;
          send({ type: 'status', message: '설계 중 (생각하는 단계)…' });
        } else if (event.content_block.type === 'text' && !textStarted) {
          textStarted = true;
          send({ type: 'status', message: '작성 중…' });
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') send({ type: 'text', text: event.delta.text });
        else if (event.delta.type === 'thinking_delta' && event.delta.thinking) send({ type: 'thinking', text: event.delta.thinking });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({ type: 'error', message: `모델이 요청을 거절했습니다 (${final.stop_details?.category ?? '사유 미상'}).`, usage: usageOf(final.model, final.usage), model: final.model });
      return;
    }
    send({ type: 'done', stopReason: final.stop_reason, usage: usageOf(final.model, final.usage), model: final.model });
  } catch (err) {
    const usage = partial.usage ? usageOf(partial.model ?? cfg.model, partial.usage) : undefined;
    if (timedOut) throw withUsage(new Error(`서버 실행 시간 제한(${Math.round(cfg.timeLimitMs / 1000)}초)에 걸려 중단했습니다. 잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요 (아주 긴 PSD 는 시간이 더 걸립니다).`), usage, partial.model);
    throw withUsage(err, usage, partial.model);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** 오류에 이미 쓴 비용을 붙인다 (서버가 error 이벤트로 화면에 넘김) */
function withUsage(err: unknown, usage: UsageInfo | undefined, model: string | undefined) {
  if (usage && err && typeof err === 'object') Object.assign(err, { usage, model });
  return err;
}

/** 오류에 붙은 비용 (없으면 undefined) */
export function usageOfError(err: unknown): { usage?: UsageInfo; model?: string } {
  const e = err as { usage?: UsageInfo; model?: string } | null;
  return e && typeof e === 'object' && e.usage ? { usage: e.usage, model: e.model } : {};
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API 키가 올바르지 않습니다 (ANTHROPIC_API_KEY 확인).';
  if (err instanceof Anthropic.PermissionDeniedError) return `이 API 키로 쓸 수 없는 기능·모델입니다: ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return '요청 한도를 넘었습니다. 잠시 뒤 다시 시도하세요.';
  if (err instanceof Anthropic.BadRequestError) return `요청 형식 오류: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Claude API 에 연결하지 못했습니다 (네트워크 확인).';
  if (err instanceof Anthropic.APIError) return `Claude API 오류 ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
