// 로컬 서버용 Claude 설정. API 키는 이 서버(.env)에만 있다 — 브라우저로 보내지 않는다
import Anthropic from '@anthropic-ai/sdk';
import type { Effort, RunConfig } from '../core/run.ts';

export const MODEL = process.env.PAGEFY_MODEL || 'claude-opus-5-5';
export const EFFORT = (process.env.PAGEFY_EFFORT || 'medium') as Effort;
/** 계획은 섹션 경계·이미지 목록만 정하므로 가볍게 (무료 Supabase 함수 150초 제한 — 2026-11-20 작은 PSD 도 medium 은 140초 초과) */
export const PLAN_EFFORT = (process.env.PAGEFY_PLAN_EFFORT || 'low') as Effort;

/** 로컬은 시간 제한 없음 */
export const RUN: RunConfig = { model: MODEL, effort: EFFORT, maxTokens: 32000, timeLimitMs: 0 };
export const PLAN_RUN: RunConfig = { ...RUN, effort: PLAN_EFFORT, maxTokens: 16000 };

let client: Anthropic | null = null;
export const getClient = () => (client ??= new Anthropic());

export { describeError, usageOf } from '../core/run.ts';
