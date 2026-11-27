// 변환 뒤 「마크업 재검증」 상자 (2026-11-27 사용자 지시) — 만든 마크업만 다시 읽어 검토한다 (src/lib/review.ts).
//  1~3단계 코드 검토(규칙·플랫폼 / SEO·GEO·AEO·alt·마크업 / PSD 레이어 대응) — 태그·속성·포함 여부처럼 셀 수 있는 것, 브라우저에서 몇 초, 비용 없음
//  4단계 Claude 정밀 검토 — 판단이 필요한 것(제목 의미·이미지로 남긴 글자가 맞는지·alt 문구·핵심 사실·읽기 순서), 서버 /review 1회.
//   이번에 새로 만든 결과는 자동으로, 저장된 작업을 다시 연 것은 단추로 (모르는 새 비용이 나가지 않게). 같은 마크업 결과는 이 PC 에 기억해 다시 부르지 않는다
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX, Info, RotateCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import type { Loaded, Result } from '../App';
import { keepMap } from '../lib/codegen';
import { COPY_START, copySection } from '../lib/output';
import { editorIdOf, editorOf, simulate } from '../lib/editorSim';
import { collect } from '../lib/api';
import {
  REVIEW_STEPS,
  buildReviewRequest,
  parseReviewOutput,
  passCounts,
  reviewKey,
  reviewStep,
  type ClaudeFinding,
  type ClaudeReview,
  type ReviewInput,
  type ReviewLevel,
  type ReviewPass,
} from '../lib/review';
import type { UsageInfo } from '../../shared/types';
import { Button } from './Button';
import { Fold } from './ui';
import Elapsed from './Elapsed';

/** 단계마다 안내 문구를 읽을 수 있게 잠깐 머문다 (ms) — 코드 검토는 순식간이라 멈춤 없이는 안내가 깜빡이고 만다 */
const STEP_MS = 450;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ICON: Record<ReviewLevel, typeof CircleCheck> = { error: CircleX, warn: TriangleAlert, info: Info, ok: CircleCheck };
const LABEL: Record<ReviewLevel, string> = { error: '오류', warn: '확인', info: '참고', ok: '통과' };

/** Claude 검토 결과를 이 PC 에 기억 (같은 마크업이면 다시 부르지 않음) — 최근 것만 */
const CACHE = 'pagefy.review.';
const CACHE_MAX = 40;
type Cached = { at: number; review: ClaudeReview; usage?: UsageInfo; model?: string };
function readCache(key: string): Cached | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE + key) || 'null') as Cached | null;
  } catch {
    return null;
  }
}
function writeCache(key: string, v: Cached) {
  try {
    localStorage.setItem(CACHE + key, JSON.stringify(v));
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE));
    if (keys.length > CACHE_MAX) keys.map((k) => [k, readCache(k.slice(CACHE.length))?.at ?? 0] as const).sort((a, b) => a[1] - b[1]).slice(0, keys.length - CACHE_MAX).forEach(([k]) => localStorage.removeItem(k));
  } catch {
    // 저장 공간이 없으면 기억만 못 한다
  }
}

export function reviewInput(result: Result, loaded: Loaded, html: string): ReviewInput {
  const plan = result.bundle.plan;
  const openmarket = result.meta.channel === 'openmarket';
  const kept = plan.engine === 'code' ? keepMap(loaded.summary, plan, openmarket) : new Map((plan.bakedTexts ?? []).map((b) => [b.layerId, b.reason]));
  return { html, summary: loaded.summary, plan, meta: result.meta, baseUrl: result.baseUrl, kept, layout: result.layout };
}

type AiState =
  | { s: 'wait' }
  | { s: 'run'; chars: number; startedAt: number }
  | { s: 'done'; review: ClaudeReview; usage?: UsageInfo; model?: string; cached: boolean }
  | { s: 'error'; message: string };

interface Props {
  result: Result;
  loaded: Loaded;
  /** 검토할 HTML — 「수정」에서 저장한 복사 구간이 있으면 그것 */
  html: string;
  /** 검토가 끝날 때마다 (진단 정보 복사에 붙인다) */
  onDone?: (passes: ReviewPass[], claude?: ClaudeReview) => void;
  /** 검토가 아직 진행 중인지 (코드 3단계 또는 Claude 정밀 검토) — 복사 버튼을 보조로 낮추는 데 쓴다 */
  onBusy?: (busy: boolean) => void;
}

export default function ReviewPanel({ result, loaded, html, onDone, onBusy }: Props) {
  /** 지금 검토 중인 코드 단계 (0~2), null = 끝 */
  const [step, setStep] = useState<number | null>(0);
  const [passes, setPasses] = useState<ReviewPass[]>([]);
  const [round, setRound] = useState(0);
  const [ai, setAi] = useState<AiState>({ s: 'wait' });
  const acRef = useRef<AbortController | null>(null);
  /** 지금 검토하는 요청 (Claude 단추가 쓴다) */
  const reqRef = useRef<{ req: ReturnType<typeof buildReviewRequest>; key: string } | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  /** Claude 정밀 검토를 새로 부른다 (기억한 결과 확인은 부르는 쪽에서) */
  async function runClaude() {
    const r = reqRef.current;
    if (!r) return;
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setAi({ s: 'run', chars: 0, startedAt: Date.now() });
    try {
      const out = await collect('review', r.req, { text: (all) => setAi((a) => (a.s === 'run' ? { ...a, chars: all.length } : a)) }, ac.signal);
      if (ac.signal.aborted) return;
      const review = parseReviewOutput(out.text);
      writeCache(r.key, { at: Date.now(), review, usage: out.usage, model: out.model });
      setAi({ s: 'done', review, usage: out.usage, model: out.model, cached: false });
      doneRef.current?.(passesRef.current, review);
    } catch (e) {
      if (!ac.signal.aborted) setAi({ s: 'error', message: (e as Error).message });
    }
  }
  const passesRef = useRef<ReviewPass[]>([]);

  useEffect(() => {
    let off = false;
    (async () => {
      acRef.current?.abort();
      setPasses([]);
      setAi({ s: 'wait' });
      const input = reviewInput(result, loaded, html);
      const done: ReviewPass[] = [];
      for (let i = 0; i < REVIEW_STEPS.length; i++) {
        if (off) return;
        setStep(i);
        await sleep(STEP_MS);
        if (off) return;
        try {
          // 1단계에만 그 플랫폼 에디터 저장 흉내를 붙인다 (쇼핑몰 미리보기와 같은 표) — 붙여넣는 복사 구간만 (문서 머리 <title>·<meta> 는 붙여넣지 않음)
          if (i === 0) input.sim = simulate(html.includes(COPY_START) ? copySection(html) : html, editorOf(editorIdOf(result.meta)), { strict: false, designMode: false });
          done.push(reviewStep(REVIEW_STEPS[i].key, input));
        } catch (e) {
          done.push({ ...REVIEW_STEPS[i], stats: '검토 실패', findings: [{ level: 'warn', message: `이 단계를 검토하지 못했습니다: ${(e as Error).message}` }] });
        }
        setPasses([...done]);
      }
      if (off) return;
      setStep(null);
      passesRef.current = done;
      doneRef.current?.(done);
      // 4단계 Claude 정밀 검토 — 선택이 아니라 늘 자동 (사용자 지시 2026-11-27). 같은 마크업은 이 PC 에 기억한 결과를 써서 비용이 두 번 나가지 않는다
      const req = buildReviewRequest(input, done);
      const key = reviewKey(req);
      reqRef.current = { req, key };
      const c = readCache(key);
      if (c) {
        setAi({ s: 'done', review: c.review, usage: c.usage, model: c.model, cached: true });
        doneRef.current?.(done, c.review);
      } else runClaude();
    })();
    return () => {
      off = true;
      acRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, loaded, html, round]);

  const codeBusy = step !== null;
  const busyRef = useRef(onBusy);
  busyRef.current = onBusy;
  const pending = codeBusy || ai.s === 'wait' || ai.s === 'run';
  useEffect(() => busyRef.current?.(pending), [pending]);
  const aiBusy = ai.s === 'run';
  const busy = codeBusy || aiBusy;
  const claude = ai.s === 'done' ? ai.review : null;
  const counts = (key: string) => {
    const p = passes.find((x) => x.key === key);
    const c = p ? passCounts(p) : { err: 0, warn: 0 };
    const cf = claude?.passes[key as keyof ClaudeReview['passes']] ?? [];
    return { err: c.err + cf.filter((f) => f.level === 'error').length, warn: c.warn + cf.filter((f) => f.level === 'warn').length };
  };
  const total = REVIEW_STEPS.reduce((n, s) => {
    const c = counts(s.key);
    return { err: n.err + c.err, warn: n.warn + c.warn };
  }, { err: 0, warn: 0 });
  const tone = busy ? 'is-busy' : total.err ? 'is-error' : total.warn ? 'is-warn' : 'is-ok';

  return (
    <section className={`review ${tone}`} aria-labelledby="review-title" aria-busy={busy}>
      <div className="review__head">
        <ShieldCheck className="review__ico" aria-hidden="true" />
        <h3 id="review-title" className="review__title">마크업 재검증</h3>
        <span className="review__sum">
          {codeBusy ? `${step! + 1}/4 단계 검토 중` : aiBusy ? '4/4 Claude 정밀 검토 중' : total.err || total.warn ? `오류 ${total.err} · 확인 ${total.warn}` : claude ? '4단계 모두 통과' : '코드 검토 3단계 통과'}
        </span>
        {!busy && (
          <Button size="sm" className="review__again" onClick={() => setRound((r) => r + 1)}>
            <RotateCw className="btn__ico" />
            다시 검토
          </Button>
        )}
      </div>
      {/* 안내 문구 — 화면 읽기 프로그램도 단계가 바뀔 때마다 읽는다 */}
      <p className="review__busy" role="status" aria-live="polite">
        {codeBusy ? (
          <>
            <span className="spinner" aria-hidden="true" />
            변환된 마크업을 재검증하고 있습니다 — {step! + 1}/4 {REVIEW_STEPS[step!].title}
          </>
        ) : aiBusy ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Claude 가 마크업을 정밀 재검증하고 있습니다 — 4/4 판단 검토 (보통 30초~1분{ai.chars ? ` · 받는 중 ${ai.chars.toLocaleString()}자` : ''})
          </>
        ) : (
          <span className="review__done">
            코드로 규칙·플랫폼 / 검색 최적화·alt·마크업 / PSD 레이어 대응을 세 번 나눠 보고{claude ? ', Claude 가 판단이 필요한 것을 한 번 더 봤습니다' : ''}
          </span>
        )}
      </p>
      <ol className="review__passes">
        {REVIEW_STEPS.map((s, i) => {
          const p = passes[i];
          const c = counts(s.key);
          const st = !p ? (step === i ? 'is-run' : 'is-wait') : c.err ? 'is-error' : c.warn ? 'is-warn' : 'is-ok';
          const shown = p?.findings.filter((x) => x.level !== 'ok') ?? [];
          const cf = claude?.passes[s.key] ?? [];
          return (
            <li key={s.key} className={`review__pass ${st}`}>
              <div className="review__row">
                <span className="review__num" aria-hidden="true">{i + 1}</span>
                <b className="review__name">{s.title}</b>
                <span className="review__state">{!p ? (step === i ? '검토 중…' : '기다리는 중') : c.err || c.warn ? `오류 ${c.err} · 확인 ${c.warn}` : '통과'}</span>
              </div>
              <p className="review__scope">{p ? p.stats : s.scope}</p>
              {p && shown.length + cf.length > 0 && (
                <Fold className="fold review__fold" defaultOpen={c.err > 0} summary={<>검토 내용 {shown.length + cf.length}건{cf.length ? ` (Claude ${cf.length})` : ''}</>}>
                  <ul className="review__list">
                    {shown.map((x, k) => (
                      <Item key={`c${k}`} f={x} />
                    ))}
                    {cf.map((x, k) => (
                      <Item key={`a${k}`} f={x} ai />
                    ))}
                  </ul>
                </Fold>
              )}
            </li>
          );
        })}
        {/* 4단계 — Claude 정밀 검토 */}
        <li className={`review__pass review__ai ${ai.s === 'run' ? 'is-run' : ai.s === 'error' ? 'is-warn' : ai.s === 'done' ? 'is-ok' : 'is-wait'}`}>
          <div className="review__row">
            <span className="review__num" aria-hidden="true">4</span>
            <b className="review__name">
              <Sparkles className="review__spark" aria-hidden="true" />
              Claude 정밀 검토
            </b>
            <span className="review__state">
              {ai.s === 'wait' ? '코드 검토 뒤에' : ai.s === 'run' ? <Elapsed since={ai.startedAt} suffix=' 지남' /> : ai.s === 'error' ? '실패' : `끝${ai.cached ? ' (기억한 결과)' : ''}${ai.usage ? ` · $${ai.usage.costUsd.toFixed(2)}` : ''}`}
            </span>
          </div>
          <p className="review__scope">제목이 주제를 나타내는지, 이미지로 남긴 글자가 맞는지, alt 문구, 핵심 사실, 읽기 순서처럼 판단이 필요한 것 — 결과는 위 1~3단계에 「Claude」로 붙습니다. 사진은 보지 않습니다</p>
          {ai.s === 'error' && (
            <div className="review__ask">
              <span className="review__err" role="alert">{ai.message}</span>
              <Button size="sm" onClick={() => runClaude()}>
                <RotateCw className="btn__ico" />
                다시 시도
              </Button>
            </div>
          )}
          {claude && (
            <div className="review__claude">
              {claude.summary && <p className="review__summary">{claude.summary}</p>}
              {claude.falsePositives.length > 0 && (
                <Fold className="fold review__fold" summary={<>Claude 가 오탐으로 본 코드 점검 {claude.falsePositives.length}건</>}>
                  <ul className="review__list">
                    {claude.falsePositives.map((x, k) => (
                      <li key={k} className="review__item is-info">
                        <Info className="review__lv" aria-label="참고" />
                        <div>
                          <span>{x.finding}</span>
                          {x.why && <span className="review__samples">{x.why}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Fold>
              )}
              {ai.s === 'done' && (
                <Button size="sm" className="review__redo" onClick={() => runClaude()}>
                  <RotateCw className="btn__ico" />
                  Claude 로 다시 검토
                </Button>
              )}
            </div>
          )}
        </li>
      </ol>
    </section>
  );
}

function Item({ f, ai }: { f: ClaudeFinding; ai?: boolean }) {
  const Ico = ICON[f.level];
  return (
    <li className={`review__item is-${f.level}`}>
      <Ico className="review__lv" aria-label={LABEL[f.level]} />
      <div>
        {ai && <span className="review__by">Claude</span>}
        <span>{f.message}</span>
        {f.samples && f.samples.length > 0 && <span className="review__samples">{f.samples.join(' · ')}</span>}
        {f.where && <span className="review__samples">위치: {f.where}</span>}
        {f.fix && <span className="review__fix">고치는 법: {f.fix}</span>}
      </div>
    </li>
  );
}
