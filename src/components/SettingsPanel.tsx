import { Fragment, useEffect, useRef, useState } from 'react';
import { RadioGroup, Tooltip } from 'radix-ui';
import { Button } from './Button';
import type { Channel, HealthInfo } from '../../shared/types';
import { readLocal, toSlug } from '../lib/util';
import { MARKETS, normMarket, type Market } from '../../shared/markets';
import JobInfoFields, { hasAssignee } from './JobInfoFields';
import { groupLabel, platformLabel, type JobNote } from '../lib/jobs';
import { ChevronDown } from 'lucide-react';
import { Tip } from './ui';

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
  /** 만든 사람 (로그인 계정 이름) — 담당자 칸을 비우면 이 사람 */
  me?: string;
  /** 작업 기록 (담당자·메모·테스트) — 만들기 설정과 따로 작업의 note 에 저장된다 */
  note: JobNote;
  onNoteChange: (n: JobNote) => void;
}

/**
 * 고도몰 쇼핑몰 (같은 규칙 — <style> 사용, PC 최대 860px). 순서: 아이티켓 · zbyhp · cadkorea | 온코어 (2026-11-25 사용자 지시 — 온코어 앞에 구분선)
 * GODO_SPLIT = 이 쇼핑몰 앞에 구분선
 */
const GODO = ['itket', 'zbyhp', 'cadkorea', 'oncore'] as const satisfies readonly Channel[];
const GODO_LABEL: Record<(typeof GODO)[number], string> = { itket: '아이티켓', zbyhp: 'zbyhp', cadkorea: 'cadkorea', oncore: '온코어' };
const GODO_SPLIT: (typeof GODO)[number] = 'oncore';
export default function SettingsPanel({ settings: s, onChange, baseUrl, canGenerate, running, resume, resumeChanged, onGenerate, onCancel, health, collapsed, blockers, me, note, onNoteChange }: Props) {
  // 예전에 저장된 작업은 market 이 없다 → 기본 플랫폼으로
  const mk: Market = normMarket(s.market);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug);
  const rootOk = /^https:\/\//.test(s.publicRoot.trim());
  const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[s.productName.trim()];

  // 서버 폴더 이름·이미지 주소는 늘 보이게 둔다 (만들기 전에 눈으로 확인). 주소 루트는 팀 공용 값이라 「바꾸기」를 눌러야 고칠 수 있다
  const [rootEdit, setRootEdit] = useState(false);

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
      if (document.querySelector('.tour__card') || (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]'))) return;
      const el = panel.current?.querySelector<HTMLElement>('[data-attn]');
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 600); // 처음 안내가 뜰지 정해진 뒤 (Tour 는 400ms 뒤에 고른다)
    return () => window.clearTimeout(t);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="form" data-tour="names">
          <label>
            <span>제품명 (폴더명·HTML 파일명)</span>
            <input value={s.productName} data-attn={!s.productName.trim() || undefined} onChange={(e) => onChange({ ...s, productName: e.target.value, slug: toSlug(e.target.value) || s.slug })} placeholder="예) ZGX Nano AI Station" />
          </label>
          {/* 서버 폴더 이름은 이미지 주소에 들어가고 한 번 정하면 바꾸지 않는다(규칙 6-1) → 제품명 옆에 늘 보이게 */}
          <label>
            <span>서버 폴더 이름 (영문 · 이미지 주소에 들어감)</span>
            <input value={s.slug} className={slugOk ? '' : 'is-bad'} aria-invalid={!slugOk} data-attn={!slugOk || undefined} onChange={(e) => set('slug', e.target.value.trim().toLowerCase())} placeholder="예) zgx-nano-ai-station" spellCheck={false} />
            {slugOk && savedSlug && savedSlug === s.slug && <small>이 제품에 전에 쓴 이름입니다. 바꾸면 이미지 주소가 달라집니다.</small>}
            {slugOk && savedSlug && savedSlug !== s.slug && (
              <small className="msg--error">
                전에 쓴 이름은 "{savedSlug}" 입니다. 한 번 정하면 바꾸지 않습니다.{' '}
                <button type="button" className="link-btn" onClick={() => set('slug', savedSlug)}>
                  되돌리기
                </button>
              </small>
            )}
            {slugOk && !savedSlug && <small>한 번 정하면 바꾸지 않습니다 (같은 제품은 늘 같은 이름).</small>}
            {!slugOk && <small className="msg--error">영문 소문자·숫자·하이픈(-)만 씁니다. 한글 제품명이면 영문 모델명으로 넣으세요.</small>}
          </label>
        </div>

        {/* 판매처: 고도몰(아이티켓·온코어) / 오픈마켓(플랫폼별)을 한 묶음으로 고른다 — 오픈마켓은 플랫폼을 바로 누른다 */}
        <RadioGroup.Root
          className="chgroups"
          data-tour="channel"
          aria-label="판매처"
          value={s.channel === 'openmarket' ? `openmarket:${mk}` : s.channel}
          onValueChange={(v) => {
            const [ch, m] = v.split(':');
            if (ch === 'openmarket') onChange({ ...s, channel: 'openmarket', market: m as Market });
            else set('channel', ch as Channel);
          }}
        >
          <div className="chgroup">
            <p className="chgroup__head">
              <b>고도몰</b>
              <small>&lt;style&gt; 사용 · PC 최대 860px</small>
            </p>
            <div className="chgroup__opts">
              {GODO.map((c) => (
                <Fragment key={c}>
                  {c === GODO_SPLIT && <span className="chopt__sep" aria-hidden="true" />}
                  <RadioGroup.Item value={c} className="chopt">
                    <span className="chopt__dot" aria-hidden="true"><RadioGroup.Indicator className="chopt__on" /></span>
                    <b>{GODO_LABEL[c]}</b>
                  </RadioGroup.Item>
                </Fragment>
              ))}
            </div>
          </div>
          <div className="chgroup">
            <p className="chgroup__head">
              <b>오픈마켓</b>
              <small>인라인 스타일만 · 플랫폼마다 폭·규칙이 다름</small>
            </p>
            <div className="chgroup__opts">
              {(Object.keys(MARKETS) as Market[]).map((m) => {
                return (
                  <RadioGroup.Item key={m} value={`openmarket:${m}`} className="chopt">
                    <span className="chopt__dot" aria-hidden="true"><RadioGroup.Indicator className="chopt__on" /></span>
                    <b>{MARKETS[m].label}</b>
                    {MARKETS[m].width && <small>{MARKETS[m].width}px</small>}
                  </RadioGroup.Item>
                );
              })}
            </div>
          </div>
        </RadioGroup.Root>
        {/* 판매처를 고르면 이미지가 올라갈 서버 폴더를 바로 아래에 보여 준다 (FTP 경로 = 공개 주소의 경로 부분) */}
        <p className="chpath">
          <span className="chpath__label">이미지 서버 폴더</span>
          <code>{baseUrl}</code>
        </p>
        {s.channel === 'openmarket' && (
          <p className="market">
            <b>{MARKETS[mk].label}</b>
            <small className="market__note">
              {MARKETS[mk].note}
              {!MARKETS[mk].verified && ' (기준 확인 전 — 붙여넣은 뒤 마켓 미리보기로 확인)'}
            </small>
          </p>
        )}

        <div className="form setup__extra">
          <label className="form__wide">
            <span>추가 지시 (선택)</span>
            <textarea rows={2} value={s.extra} onChange={(e) => set('extra', e.target.value)} placeholder="예) 마지막 포트 섹션은 표로 만들어 줘 / 헤드카피는 이미지로 구워 줘" />
            <small>Claude 에게 보내는 지시입니다. 기록용 설명은 아래 「메모」에 적으세요.</small>
          </label>
        </div>

        {/* 작업 기록 — 변환 내역에서 누가·왜 만든 작업인지 알아보게. Claude 에 보내지 않고 결과·이어서 만들기에도 영향 없음 (sameMeta 에 들지 않음) */}
        <div className="form setup__memo" data-tour="note">
          <p className="setup__memo-head form__wide">
            <b>작업 기록</b>
            <small>변환 내역에만 보입니다</small>
          </p>
          <JobInfoFields value={note} onChange={onNoteChange} showError={whoTried} />
        </div>

        {/* 이미지 주소는 늘 보이게 두고(확인용), 루트는 잠가 둔다 — 실수로 바뀌면 HTML 의 모든 이미지 주소가 틀어진다 */}
        <div className="adv">
          <div className="adv__head">
            <span className="adv__title">HTML 이미지 주소</span>
            {!rootOk && <span className="badge badge--error">고칠 것 있음</span>}
            {rootOk && !rootEdit && (
              <button type="button" className="link-btn adv__edit" onClick={() => setRootEdit(true)}>
                주소 루트 바꾸기
              </button>
            )}
          </div>
          <div className="adv__body">
            {rootOk && !slugOk && <p className="adv__url"><small>서버 폴더 이름을 고치면 이미지 주소가 여기에 나옵니다.</small></p>}
            {rootOk && slugOk && (
              <p className="adv__url">
                <code>{baseUrl}/파일명</code>
                <small>이미지 서버에 다시 올리면 같은 이름 파일은 확인을 받은 뒤 덮어씁니다.</small>
              </p>
            )}
            {(rootEdit || !rootOk) && (
              <div className="form">
                <label className="form__wide">
                  <span>이미지 공개 주소 루트 (팀 공용 값 — 보통 바꾸지 않음)</span>
                  <input value={s.publicRoot} className={rootOk ? '' : 'is-bad'} aria-invalid={!rootOk} onChange={(e) => set('publicRoot', e.target.value)} spellCheck={false} />
                  {rootOk ? (
                    <Button type="button" size="sm" variant="primary" onClick={() => setRootEdit(false)}>
                      편집 완료
                    </Button>
                  ) : (
                    <small className="msg--error">https:// 로 시작하는 주소를 넣으세요.</small>
                  )}
                </label>
              </div>
            )}
          </div>
        </div>
      </fieldset>

      <div className="actions setup__actions">
        {running ? (
          <Button type="button"  onClick={onCancel}>취소</Button>
        ) : resume ? (
          <>
            <Button type="button" variant="primary" className="btn--go" data-tour="go" disabled={!canGenerate} onClick={() => go()}>{resume.code ? (resume.changed ? "지금 설정으로 다시 계산 (비용 없음)" : "저장된 계획으로 마무리 (비용 없음)") : `이어서 만들기 (남은 섹션 ${resume.missing}개)`}</Button>
            <Button type="button"  disabled={!canGenerate} onClick={() => go(true)}>처음부터 다시</Button>
          </>
        ) : (
          <Button type="button" variant="primary" className="btn--go" data-tour="go" disabled={!canGenerate} onClick={() => go(true)}>마크업 만들기</Button>
        )}
      </div>
      {!running && blockers.length > 0 && (
        <div className="blockers">
          <p className="blockers__title">만들기 전에:</p>
          <ul>
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}
      <p className="hint setup__cost">
        {resume
          ? resume.code ? (resume.changed ? "같은 묶음(고도몰끼리·오픈마켓끼리) 안에서 바꿔 받아 둔 구조 계획을 그대로 씁니다. 폭·플랫폼 규칙·이미지 주소만 지금 설정으로 다시 계산해 비용이 들지 않습니다 (이미지는 바뀐 폴더에 다시 올려야 함)." : "구조 계획은 이미 받아 두었습니다. 마크업은 프로그램이 다시 계산하므로 API 비용이 들지 않습니다.") : `저장된 계획(섹션 ${resume.total - resume.missing}/${resume.total}개 완료)에서 이어갑니다. 남은 섹션만 요청하므로 비용이 적게 듭니다.`
          : resumeChanged
            ? '고도몰과 오픈마켓을 바꾸면(또는 추가 지시를 바꾸면) HTML 방식이 달라져 구조 계획부터 다시 만듭니다 (Claude 1회, 약 $0.5~2).'
            : health?.mock ? 'MOCK 모드라 비용이 들지 않습니다.' : 'Claude 가 섹션 구조를 한 번 정하고, 글자 위치·크기·줄바꿈은 프로그램이 PSD 값으로 계산합니다 (1회 약 $0.5~2).'}
      </p>
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
