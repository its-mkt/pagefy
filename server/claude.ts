// 로컬 서버용 Claude 설정. API 키는 이 서버(.env)에만 있다 — 브라우저로 보내지 않는다
import Anthropic from '@anthropic-ai/sdk';
import type { Effort, RunConfig } from '../core/run.ts';

export const MODEL = process.env.PAGEFY_MODEL || 'claude-opus-5-5';
export const EFFORT = (process.env.PAGEFY_EFFORT || 'medium') as Effort;

/** 계획·섹션 공통 설정 (로컬은 시간 제한 없음) */
export const RUN: RunConfig = { model: MODEL, effort: EFFORT, maxTokens: 32000, timeLimitMs: 0 };

let client: Anthropic | null = null;
export const getClient = () => (client ??= new Anthropic());

export { describeError, usageOf } from '../core/run.ts';
