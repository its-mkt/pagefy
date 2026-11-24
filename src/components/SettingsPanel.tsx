import { useEffect, useState } from 'react';
import { RadioGroup } from 'radix-ui';
import type { Channel, HealthInfo } from '../../shared/types';
import { readLocal, toSlug } from '../lib/util';
import { MARKETS, normMarket, type Market } from '../../shared/markets';

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
}

/** 고도몰 쇼핑몰 (같은 규칙 — <style> 사용, PC 최대 860px) */
const GODO = ['itket', 'oncore'] as const satisfies readonly Channel[];
const GODO_LABEL: Record<(typeof GODO)[number], string> = { itket: '아이티켓', oncore: '온코어' };
/** 접힌 줄에 보일 판매처 — 고도몰 · 아이티켓 / 오픈마켓 · 쿠팡 */
const placeOf = (c: Channel, m: Market) => (c === 'openmarket' ? `오픈마켓 · ${MARKETS[m].label}` : `고도몰 · ${GODO_LABEL[c]}`);

export default function SettingsPanel({ settings: s, onChange, baseUrl, canGenerate, running, resume, resumeChanged, onGenerate, onCancel, health, collapsed, blockers }: Props) {
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

  if (collapsed && !expanded) {
    return (
      <section className="panel panel--tight">
        <div className="setrow">
          <p className="setrow__text">
            <b>{s.productName.trim() || '제품명 없음'}</b>
            <span>{placeOf(s.channel, mk)}</span>
            <span>서버 폴더 {s.slug}</span>
          </p>
          <div className="setrow__acts">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setExpanded(true)}>설정 바꾸기</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="setup__head">
        <h2 className="panel__title">만들기 설정</h2>
        {collapsed && <button type="button" className="btn btn--sm btn--ghost" onClick={() => setExpanded(false)}>접기</button>}
      </div>

      <fieldset className="setup__fields" disabled={running}>
        <div className="form">
          <label>
            <span>제품명 (폴더명·HTML 파일명)</span>
            <input value={s.productName} onChange={(e) => onChange({ ...s, productName: e.target.value, slug: toSlug(e.target.value) || s.slug })} placeholder="예) ZGX Nano AI Station" />
          </label>
          {/* 서버 폴더 이름은 이미지 주소에 들어가고 한 번 정하면 바꾸지 않는다(규칙 6-1) → 제품명 옆에 늘 보이게 */}
          <label>
            <span>서버 폴더 이름 (영문 · 이미지 주소에 들어감)</span>
            <input value={s.slug} className={slugOk ? '' : 'is-bad'} aria-invalid={!slugOk} onChange={(e) => set('slug', e.target.value.trim().toLowerCase())} placeholder="예) zgx-nano-ai-station" spellCheck={false} />
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
                <RadioGroup.Item key={c} value={c} className="chopt">
                  <span className="chopt__dot" aria-hidden="true"><RadioGroup.Indicator className="chopt__on" /></span>
                  <b>{GODO_LABEL[c]}</b>
                </RadioGroup.Item>
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
          </label>
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
                    <small>
                      <button type="button" className="link-btn" onClick={() => setRootEdit(false)}>
                        다 고쳤으면 잠그기
                      </button>
                    </small>
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
          <button type="button" className="btn btn--ghost" onClick={onCancel}>취소</button>
        ) : resume ? (
          <>
            <button type="button" className="btn btn--primary btn--go" disabled={!canGenerate} onClick={() => onGenerate()}>{resume.code ? (resume.changed ? "지금 설정으로 다시 계산 (비용 없음)" : "저장된 계획으로 마무리 (비용 없음)") : `이어서 만들기 (남은 섹션 ${resume.missing}개)`}</button>
            <button type="button" className="btn" disabled={!canGenerate} onClick={() => onGenerate(true)}>처음부터 다시</button>
          </>
        ) : (
          <button type="button" className="btn btn--primary btn--go" disabled={!canGenerate} onClick={() => onGenerate(true)}>마크업 만들기</button>
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
