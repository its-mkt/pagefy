import { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'radix-ui';
import { Button } from './Button';
import type { Channel, HealthInfo } from '../../shared/types';
import { SLUG_BLOCK, readLocal, toSlug } from '../lib/util';
import Select from './Select';
import { MARKETS, normMarket, type Market } from '../../shared/markets';
import JobInfoFields, { hasAssignee } from './JobInfoFields';
import { groupLabel, platformLabel, type JobNote } from '../lib/jobs';
import { ChevronDown } from 'lucide-react';
import { Seg, Tip } from './ui';

export interface Settings {
  productName: string;
  channel: Channel;
  /** 오픈마켓일 때 플랫폼 (폭 등 기준이 마켓마다 다름) */
  market: Market;
  slug: string;
  rev: string;
  publicRoot: string;
  extra: string;
}

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  baseUrl: string;
  canGenerate: boolean;
  running: boolean;
  /** 저장된 계획으로 이어서 만들 수 있음 (남은 섹션 수) */
  resume: { missing: number; total: number; code?: boolean; changed?: boolean } | null;
  /** 저장된 계획이 있지만 설정이 바뀌어 처음부터 만들어야 함 */
  resumeChanged: boolean;
  /** fresh = 저장된 계획을 버리고 처음부터 */
  onGenerate: (fresh?: boolean) => void;
  onCancel: () => void;
  health: HealthInfo | null;
  tileCount: number;
  /** 생성 중이거나 결과가 있으면 한 줄로 접는다 */
  collapsed: boolean;
  /** 만들기 전에 해결할 것 (버튼 아래에 보여 줌) */
  blockers: string[];
  waiting: string[];
  /** 만든 사람 (로그인 계정 이름) — 담당자 칸을 비우면 이 사람 */
  me?: string;
  /** 작업 기록 (담당자·메모·테스트) — 만들기 설정과 따로 작업의 note 에 저장된다 */
  note: JobNote;
  onNoteChange: (n: JobNote) => void;
}

/**
 * 고도몰 쇼핑몰 (같은 규칙 — <style> 사용, PC 최대 860px). 순서: 아이티켓 · zbyhp · cadkorea · 온코어
 */
const GODO = ['itket', 'zbyhp', 'cadkorea', 'oncore'] as const satisfies readonly Channel[];
const GODO_LABEL: Record<(typeof GODO)[number], string> = { itket: '아이티켓', zbyhp: 'zbyhp', cadkorea: 'cadkorea', oncore: '온코어' };
export default function SettingsPanel({ settings: s, onChange, baseUrl, canGenerate, running, resume, resumeChanged, onGenerate, onCancel, health, collapsed, blockers, waiting, me, note, onNoteChange }: Props) {
  // 서버 폴더 이름 문제는 칸 아래 안내가 이미 말하므로 목록에서는 뺀다
  const listed = blockers.filter((b) => b !== SLUG_BLOCK);
  // 예전에 저장된 작업은 market 이 없다 → 기본 플랫폼으로
  const mk: Market = normMarket(s.market);
  const chGroup: 'godo' | 'openmarket' = s.channel === 'openmarket' ? 'openmarket' : 'godo';
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug);
  const rootOk = /^https:\/\//.test(s.publicRoot.trim());
  const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[s.productName.trim()];

  // 서버 폴더 이름·이미지 주소는 늘 보이게 둔다 (만들기 전에 눈으로 확인). 주소 루트는 팀 공용 값이라 화면에서 바꿀 수 없다 — 업로드 서버 설정과 맞아야 해서 잘못 바뀌면 만들기가 막히거나 이미지 주소가 틀어진다. 주소가 https:// 가 아닐 때만 고칠 칸이 뜬다

  // 접힘: collapsed 가 켜질 때마다 다시 접는다
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (collapsed) setExpanded(false);
  }, [collapsed, running]); // 다시 만들기를 시작할 때도 접는다

  // 채워야 할 칸 (data-attn) — 매번 설정이 펼쳐질 때 첫 칸에 커서를 둔다 (처음이 아니어도, 2026-11-25 의견).
  // 순서: 제품명·서버 폴더 → 담당자. 모양은 다른 칸과 같고(노란 표시 없앰, 2026-11-25), 커서만 옮긴다
  // 처음 안내가 떠 있거나 다른 입력칸에 이미 쓰는 중이면 커서를 빼앗지 않는다
  const full = !(collapsed && !expanded);
  const panel = useRef<HTMLElement>(null);

  // 담당자는 필수 (2026-11-25 사용자 지시) — 비운 채 만들기를 누르면 만들지 않고 빨간 테두리·안내를 띄우고 그 칸으로 커서를 옮긴다.
  // 다른 「만들기를 막는 것」(blockers)은 단추를 끄지만, 담당자는 누른 뒤에 알려 준다 (처음부터 빨갛게 보이지 않게)
  const [whoTried, setWhoTried] = useState(false);
  const go = (fresh?: boolean) => {
    if (!hasAssignee(note)) {
      setWhoTried(true);
      const el = panel.current?.querySelector<HTMLElement>('[data-field="assignee"]');
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setWhoTried(false);
    onGenerate(fresh);
  };
  useEffect(() => {
    if (!full || running) return;
    const t = window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]')) return;
      const el = panel.current?.querySelector<HTMLElement>('[data-attn]');
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 600);
    return () => window.clearTimeout(t);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  // 아래 한 줄 — 비용이 드는지, 어떻게 이어지는지만 짧게
  const costLine = resume
    ? resume.code
      ? (resume.changed ? "구조 계획 재사용 · 주소만 다시 계산 (비용 없음)" : "저장된 계획으로 마무리 (비용 없음)")
      : `남은 섹션 ${resume.missing}개만 요청 (비용 적음)`
    : resumeChanged ? "구조 계획부터 다시 만듭니다 (약 $0.5~2)"
    : health?.mock ? "MOCK 모드 — 비용 없음"
    : "구조 계획 Claude 1회 · 약 $0.5~2";

  if (collapsed && !expanded) {
    return (
      <section className="panel panel--tight">
        <div className="setrow">
          <p className="setrow__text">
            <b>{s.productName.trim() || '제품명 없음'}</b>
            {/* 판매처·서버 폴더 등은 아래 간략 정보에 (위 줄은 제품명만 — 같은 정보를 두 번 쓰지 않게) */}
            {note.test && <span className="badge badge--test">테스트</span>}
          </p>
          {/* 「설정 바꾸기」 글자 대신 펼치기 꺾쇠 (2026-11-25 사용자) — 뜻은 화면 읽기 이름·툴팁으로 */}
          <div className="setrow__acts">
            <Tip content="만들기 설정 펼치기">
              <Button type="button" size="sm" icon className="setrow__fold" aria-label="만들기 설정 펼치기" aria-expanded={false} onClick={() => setExpanded(true)}>
                <ChevronDown className="btn__ico" />
              </Button>
            </Tip>
          </div>
        </div>
        {/* 간략 정보 — 접힌 채로도 무엇으로 만드는지 한눈에 */}
        {/* 담당·메모는 비어 있어도 늘 보인다 (누구 작업인지·무엇을 적어 뒀는지가 가장 먼저 필요, 2026-11-25 사용자). 고치기는 꺾쇠로 펼쳐서 */}
        <dl className="setrow__info">
          <div>
            <dt>담당</dt>
            <dd className={note.assignee?.trim() || me ? '' : 'is-empty'}>{note.assignee?.trim() || (me ? `${me} (만든 사람)` : '미지정')}</dd>
          </div>
          <div>
            <dt>판매처</dt>
            <dd>
              {groupLabel(s.channel)} · {platformLabel({ channel: s.channel, market: mk })}
            </dd>
          </div>
          <div>
            <dt>서버 폴더</dt>
            <dd>{s.slug || '—'}</dd>
          </div>
          <div className="setrow__grow">
            <dt>메모</dt>
            <ClipText className={`setrow__memo${note.memo?.trim() ? '' : ' is-empty'}`} text={note.memo?.trim() || '없음'} />
          </div>
          <div className="setrow__grow">
            <dt>이미지 주소</dt>
            <ClipText text={`${baseUrl}/`}>
              <code>{baseUrl}/</code>
            </ClipText>
          </div>
          {s.extra.trim() && (
            <div className="setrow__grow">
              <dt>추가 지시</dt>
              <ClipText className="setrow__extra" text={s.extra.trim()} />
            </div>
          )}
        </dl>
      </section>
    );
  }

  return (
    <section className="panel" ref={panel}>
      <div className="setup__head">
        <h2 className="panel__title">만들기 설정</h2>
        {collapsed && (
          <Tip content="만들기 설정 접기">
            <Button type="button" size="sm" icon className="setrow__fold is-open" aria-label="만들기 설정 접기" aria-expanded onClick={() => setExpanded(false)}>
              <ChevronDown className="btn__ico" />
            </Button>
          </Tip>
        )}
      </div>

      <fieldset className="setup__fields" disabled={running}>
        {/* 판매처: 고도몰·오픈마켓을 드롭다운 하나에서 그룹으로 고른다 — 고른 값이 하나뿐이라 어디가 선택됐는지 헷갈리지 않는다 */}
        <div className="form">
          <label className="setup__channel">
            <span>판매처</span>
            <div className="setup__channel-row">
              <Seg<'godo' | 'openmarket'>
                aria-label="판매처 종류"
                value={chGroup}
                onChange={(g) => {
                  if (g === 'godo') set('channel', GODO.includes(s.channel as (typeof GODO)[number]) ? s.channel : GODO[0]);
                  else onChange({ ...s, channel: 'openmarket', market: mk });
                }}
                items={[{ value: 'godo', label: '고도몰' }, { value: 'openmarket', label: '오픈마켓' }]}
              />
              {chGroup === 'godo' ? (
                <Select<string>
                  aria-label="고도몰 쇼핑몰"
                  value={s.channel}
                  onChange={(v) => set('channel', v as Channel)}
                  options={GODO.map((c) => ({ value: c, label: GODO_LABEL[c] }))}
                />
              ) : (
                <Select<string>
                  aria-label="오픈마켓 플랫폼"
                  value={mk}
                  onChange={(m) => onChange({ ...s, channel: 'openmarket', market: m as Market })}
                  options={(Object.keys(MARKETS) as Market[]).map((m) => ({ value: m, label: MARKETS[m].label }))}
                />
              )}
            </div>
          </label>
        </div>
        {/* 판매처를 고르면 이미지가 올라갈 서버 폴더를 바로 아래에 보여 준다 (FTP 경로 = 공개 주소의 경로 부분) */}
        {s.channel === 'openmarket' && (
          <p className="market">
            <b>{MARKETS[mk].label}</b>
            <small className="market__note">
              {MARKETS[mk].note}
              {!MARKETS[mk].verified && ' (기준 확인 전 — 붙여넣은 뒤 마켓 미리보기로 확인)'}
            </small>
          </p>
        )}

        <div className="form">
          <label>
            <span>제품명 (폴더명·HTML 파일명) <em className="req" title="필수 입력">*</em></span>
            <input value={s.productName} aria-required="true" data-attn={!s.productName.trim() || undefined} onChange={(e) => onChange({ ...s, productName: e.target.value, slug: toSlug(e.target.value) || s.slug })} placeholder="예) ZGX Nano AI Station" />
          </label>
          {/* 서버 폴더 이름은 이미지 주소에 들어가고 한 번 정하면 바꾸지 않는다(규칙 6-1) → 제품명 옆에 늘 보이게 */}
          <label>
            <span>서버 폴더 이름 (영문 · 이미지 주소에 들어감) <em className="req" title="필수 입력">*</em></span>
            <input value={s.slug} aria-required="true" className={slugOk ? '' : 'is-bad'} aria-invalid={!slugOk} data-attn={!slugOk || undefined} onChange={(e) => set('slug', e.target.value.trim().toLowerCase())} placeholder="예) zgx-nano-ai-station" spellCheck={false} />
            {slugOk && savedSlug && savedSlug === s.slug && <small>이 제품에 전에 쓴 이름입니다. 바꾸면 이미지 주소가 달라집니다.</small>}
            {slugOk && savedSlug && savedSlug !== s.slug && (
              <small className="msg--error">
                전에 쓴 이름은 "{savedSlug}" 입니다. 한 번 정하면 바꾸지 않습니다.{' '}
                <button type="button" className="link-btn" onClick={() => set('slug', savedSlug)}>
                  되돌리기
                </button>
              </small>
            )}
            {slugOk && !savedSlug && /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(s.productName) && s.slug === toSlug(s.productName.trim()) && (
              <small>제품명의 한글은 빼고 자동으로 넣었습니다 ({s.slug}). 다르면 직접 고치세요.</small>
            )}
            {slugOk && !savedSlug && !/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(s.productName) && <small>한 번 정하면 바꾸지 않습니다 (같은 제품은 늘 같은 이름).</small>}
            {!slugOk && <small className="msg--error">영문 소문자·숫자·하이픈(-)만 씁니다. 한글 제품명이면 영문 모델명으로 넣으세요.</small>}
          </label>
        </div>

        {/* 이미지 주소는 늘 보이게 두고(확인용), 루트는 잠가 둔다 — 실수로 바뀌면 HTML 의 모든 이미지 주소가 틀어진다 */}
        <div className="adv">
          <div className="adv__head">
            <span className="adv__title">HTML 이미지 주소</span>
            {!rootOk && <span className="badge badge--error">고칠 것 있음</span>}
          </div>
          <div className="adv__body">
            {rootOk && !slugOk && <p className="adv__url"><small>서버 폴더 이름을 고치면 이미지 주소가 여기에 나옵니다.</small></p>}
            {rootOk && slugOk && (
              <p className="adv__url">
                <code>{baseUrl}/파일명</code>
                <small>이미지 서버에 다시 올리면 같은 이름 파일은 확인을 받은 뒤 덮어씁니다.</small>
              </p>
            )}
            {!rootOk && (
              <div className="form">
                <label className="form__wide">
                  <span>이미지 공개 주소 루트 (팀 공용 값 — 보통 바꾸지 않음) <em className="req" title="필수 입력">*</em></span>
                  <input value={s.publicRoot} aria-required="true" className="is-bad" aria-invalid={true} onChange={(e) => set('publicRoot', e.target.value)} spellCheck={false} />
                  <small className="msg--error">https:// 로 시작하는 주소를 넣으세요.</small>
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="form setup__extra">
          <label className="form__wide">
            <span>추가 지시 (선택)</span>
            <textarea rows={2} value={s.extra} onChange={(e) => set('extra', e.target.value)} placeholder="예) 마지막 포트 섹션은 표로 만들어 줘 / 헤드카피는 이미지로 구워 줘" />
            <small>Claude 에게 보내는 지시입니다. 기록용 설명은 아래 「메모」에 적으세요.</small>
          </label>
        </div>

        {/* 작업 기록 — 변환 내역에서 누가·왜 만든 작업인지 알아보게. Claude 에 보내지 않고 결과·이어서 만들기에도 영향 없음 (sameMeta 에 들지 않음) */}
        <div className="form setup__memo">
          <p className="setup__memo-head form__wide">
            <b>작업 기록</b>
            <small>변환 내역에만 보입니다</small>
          </p>
          <JobInfoFields value={note} onChange={onNoteChange} showError={whoTried} />
        </div>

      </fieldset>

      {!running && (listed.length > 0 || waiting.length > 0) && (
        <div className="blockers">
          {listed.length > 0 && (
            <>
              <p className="blockers__title">만들기 전에:</p>
              <ul>
                {listed.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </>
          )}
          {waiting.length > 0 && <p className="hint">{waiting[0]}</p>}
        </div>
      )}
      <div className="actions setup__actions">
        {running ? (
          <Button type="button" onClick={onCancel}>취소</Button>
        ) : resume ? (
          <>
            <Button type="button" variant="primary" className="btn--go" disabled={!canGenerate} onClick={() => go()}>{resume.code ? (resume.changed ? "다시 계산" : "마무리") : `이어서 (${resume.missing}개 남음)`}</Button>
            <Button type="button" disabled={!canGenerate} onClick={() => go(true)}>처음부터 다시</Button>
          </>
        ) : (
          <Button type="button" variant="primary" className="btn--go" disabled={!canGenerate} onClick={() => go(true)}>마크업 만들기</Button>
        )}
      </div>
      <p className="hint setup__cost">{costLine}</p>
    </section>
  );
}

/**
 * 간략 정보의 값 칸 — 칸이 좁아 말줄임(…)으로 잘렸을 때만 마우스를 올리거나 초점을 주면 전체 내용을 툴팁으로 (2026-11-25 사용자).
 * 툴팁 감싸개는 늘 두고(감싸개를 붙였다 뗐다 하면 칸이 새로 그려져 잰 값이 옛 칸 것이 된다) 열리는 것만 잘렸을 때로 막는다.
 * 칸 폭이 바뀔 때마다(창 크기·다른 값 길이) 다시 잰다. 다 보이는 값은 초점도 받지 않는다
 */
function ClipText({ text, className, children }: { text: string; className?: string; children?: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    const check = () => setClipped(e.scrollWidth > e.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(e);
    return () => ro.disconnect();
  }, [text]);
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <Tooltip.Root open={open && clipped} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <dd ref={ref} className={className} tabIndex={clipped ? 0 : undefined}>
            {children ?? text}
          </dd>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" side="bottom" sideOffset={6} collisionPadding={8}>
            {text}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
