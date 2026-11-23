// 로컬 서버용 Claude 설정. API 키는 이 서버(.env)에만 있다 — 브라우저로 보내지 않는다
import Anthropic from '@anthropic-ai/sdk';
import type { Effort, RunConfig } from '../core/run.ts';

export const MODEL = process.env.PAGEFY_MODEL || 'claude-opus-5-5';
export const EFFORT = (process.env.PAGEFY_EFFORT || 'medium') as Effort;
/** 계획 effort. 2026-11-20(옛 방식: 계획이 CSS·지침까지 씀)엔 medium 이 140초를 넘었지만, 2026-11-23 구조 계획만 쓰는 지금 방식은 ZGX(860×17455) medium 95초 — 품질을 위해 medium. 시간 초과가 잦으면 PAGEFY_PLAN_EFFORT=low */
export const PLAN_EFFORT = (process.env.PAGEFY_PLAN_EFFORT || 'medium') as Effort;

/** 로컬은 시간 제한 없음 */
export const RUN: RunConfig = { model: MODEL, effort: EFFORT, maxTokens: 32000, timeLimitMs: 0 };
export const PLAN_RUN: RunConfig = { ...RUN, effort: PLAN_EFFORT, maxTokens: 16000 };

let client: Anthropic | null = null;
export const getClient = () => (client ??= new Anthropic());

export { describeError, usageOf } from '../core/run.ts';
