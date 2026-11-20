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

export function usageOf(model: string, u: Anthropic.Beta.BetaUsage | undefined): UsageInfo {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  const p = PRICE[model] || PRICE['claude-opus-5-5'];
  const costUsd = (input * p[0] + output * p[1] + cacheRead * p[2] + cacheWrite * p[0] * 1.25) / 1e6;
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
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort);
  let timedOut = false;
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
      send({ type: 'error', message: `모델이 요청을 거절했습니다 (${final.stop_details?.category ?? '사유 미상'}).` });
      return;
    }
    send({ type: 'done', stopReason: final.stop_reason, usage: usageOf(final.model, final.usage), model: final.model });
  } catch (err) {
    if (timedOut) throw new Error(`서버 실행 시간 제한(${Math.round(cfg.timeLimitMs / 1000)}초)에 걸려 중단했습니다. 섹션을 더 작게 나누도록 수정 요청하거나 다시 시도하세요.`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
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
