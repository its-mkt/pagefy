import { useEffect, useState } from 'react';
import type { Channel, HealthInfo } from '../../shared/types';
import { CHANNEL_LABEL } from '../../shared/types';
import { readLocal, toSlug } from '../lib/util';

export interface Settings {
  productName: string;
  channel: Channel;
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
  resume: { missing: number; total: number; code?: boolean } | null;
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

const CHANNEL_DESC: Record<Channel, string> = {
  itket: '고도몰 · <style> 사용 · PC 최대 860px',
  oncore: '고도몰 · <style> 사용 · PC 최대 860px',
  openmarket: '인라인 스타일만 (스마트스토어·쿠팡 등)',
};

export default function SettingsPanel({ settings: s, onChange, baseUrl, canGenerate, running, resume, resumeChanged, onGenerate, onCancel, health, tileCount, collapsed, blockers }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug);
  const revOk = /^\d{8}(-\d+)?$/.test(s.rev);
  const rootOk = /^https:\/\//.test(s.publicRoot.trim());
  const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[s.productName.trim()];

  // 고급 설정: 값이 잘못되면 자동으로 펼친다 (고친 뒤에도 펼친 채 둠)
  const advBad = !slugOk || !revOk || !rootOk;
  const [advOpen, setAdvOpen] = useState(advBad);
  useEffect(() => {
    if (advBad) setAdvOpen(true);
  }, [advBad]);

  // 접힘: collapsed 가 켜질 때마다 다시 접는다
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (collapsed) setExpanded(false);
  }, [collapsed, running]); // 다시 만들기를 시작할 때도 접는다

  const advSummary = `슬러그 ${s.slug || '없음'} · rev ${s.rev || '없음'} · ${s.extra.trim() ? '추가 지시 있음' : '추가 지시 없음'}`;

  if (collapsed && !expanded) {
    return (
      <section className="panel panel--tight">
        <div className="setrow">
          <p className="setrow__text">
            <b>{s.productName.trim() || '제품명 없음'}</b>
            <span>{CHANNEL_LABEL[s.channel]}</span>
            <span>{s.slug}/{s.rev}</span>
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
          <label className="form__wide">
            <span>제품명 (폴더명·HTML 파일명)</span>
            <input value={s.productName} onChange={(e) => onChange({ ...s, productName: e.target.value, slug: toSlug(e.target.value) || s.slug })} placeholder="예) ZGX Nano AI Station" />
          </label>
        </div>

        <div className="channels" role="radiogroup" aria-label="채널">
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
            <label key={c} className={`channel ${s.channel === c ? 'is-on' : ''}`}>
              <input type="radio" name="pagefy-channel" value={c} checked={s.channel === c} onChange={() => set('channel', c)} />
              <span className="channel__body">
                <b>{CHANNEL_LABEL[c]}</b>
                <small>{CHANNEL_DESC[c]}</small>
              </span>
            </label>
          ))}
        </div>

        <details className="adv" open={advOpen}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              if (!advBad) setAdvOpen((o) => !o);
            }}
          >
            <span className="adv__title">고급 설정</span>
            <span className="adv__now">{advSummary}</span>
            {advBad && <span className="badge badge--error">고칠 것 있음</span>}
          </summary>
          <div className="form adv__body">
            <label>
              <span>제품슬러그 (한 번 정하면 바꾸지 않음 · 6-1)</span>
              <input value={s.slug} className={slugOk ? '' : 'is-bad'} onChange={(e) => set('slug', e.target.value.trim())} placeholder="zgx-nano-ai-station" />
              {slugOk && savedSlug && savedSlug === s.slug && <small>이 제품에 전에 쓴 슬러그입니다 (바꾸면 이미지 주소가 달라짐)</small>}
              {slugOk && savedSlug && savedSlug !== s.slug && <small className="msg--error">전에 쓴 슬러그는 "{savedSlug}" 입니다. 규칙 6-1: 한 번 정하면 바꾸지 않습니다.</small>}
              {!slugOk && <small className="msg--error">영문 소문자·숫자·하이픈만. 한글 제품명이면 영문 모델명으로 직접 입력하세요.</small>}
            </label>
            <label>
              <span>rev (이미지 묶음 날짜)</span>
              <input value={s.rev} className={revOk ? '' : 'is-bad'} onChange={(e) => set('rev', e.target.value.trim())} placeholder="20261123" />
              {!revOk && <small className="msg--error">날짜 8자리(예: 20261123), 같은 날 다시 만들면 20261123-2</small>}
            </label>
            <label className="form__wide">
              <span>이미지 공개 주소 루트</span>
              <input value={s.publicRoot} className={rootOk ? '' : 'is-bad'} onChange={(e) => set('publicRoot', e.target.value)} />
              {rootOk ? <small>HTML 이미지 주소: {baseUrl}/파일명</small> : <small className="msg--error">https:// 로 시작하는 주소를 넣으세요.</small>}
            </label>
            <label className="form__wide">
              <span>추가 지시 (선택)</span>
              <textarea rows={3} value={s.extra} onChange={(e) => set('extra', e.target.value)} placeholder="예) 마지막 포트 섹션은 표로 만들어 줘 / 헤드카피는 이미지로 구워 줘" />
            </label>
          </div>
        </details>
      </fieldset>

      <div className="actions setup__actions">
        {running ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>취소</button>
        ) : resume ? (
          <>
            <button type="button" className="btn btn--primary btn--go" disabled={!canGenerate} onClick={() => onGenerate()}>{resume.code ? "저장된 계획으로 마무리 (비용 없음)" : `이어서 만들기 (남은 섹션 ${resume.missing}개)`}</button>
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
          ? resume.code ? "구조 계획은 이미 받아 두었습니다. 마크업은 프로그램이 다시 계산하므로 API 비용이 들지 않습니다." : `저장된 계획(섹션 ${resume.total - resume.missing}/${resume.total}개 완료)에서 이어갑니다. 남은 섹션만 요청하므로 비용이 적게 듭니다.`
          : resumeChanged
            ? '설정이 저장된 계획을 만들 때와 달라 처음부터 다시 만듭니다.'
            : health?.mock ? 'MOCK 모드라 비용이 들지 않습니다.' : `PSD 렌더 타일 ${tileCount}장 + 레이어 정보를 보냅니다. 1회 대략 $0.5~2 (PSD 크기에 따라 다름).`}
      </p>
    </section>
  );
}
