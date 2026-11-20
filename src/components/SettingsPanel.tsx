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
  resume: { missing: number; total: number } | null;
  /** 저장된 계획이 있지만 설정이 바뀌어 처음부터 만들어야 함 */
  resumeChanged: boolean;
  /** fresh = 저장된 계획을 버리고 처음부터 */
  onGenerate: (fresh?: boolean) => void;
  onCancel: () => void;
  health: HealthInfo | null;
  tileCount: number;
}

export default function SettingsPanel({ settings: s, onChange, baseUrl, canGenerate, running, resume, resumeChanged, onGenerate, onCancel, health, tileCount }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug);
  const revOk = /^\d{8}(-\d+)?$/.test(s.rev);
  const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[s.productName.trim()];

  return (
    <section className="panel">
      <h2 className="panel__title">3. 설정</h2>
      <div className="form">
        <label>
          <span>제품명 (폴더명·HTML 파일명)</span>
          <input value={s.productName} onChange={(e) => onChange({ ...s, productName: e.target.value, slug: toSlug(e.target.value) || s.slug })} />
        </label>
        <label>
          <span>채널 폴더 (HTML 작성 방식이 정해짐 · 7절)</span>
          <select value={s.channel} onChange={(e) => set('channel', e.target.value as Channel)}>
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
              <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>제품슬러그 (한 번 정하면 바꾸지 않음 · 6-1)</span>
          <input value={s.slug} className={slugOk ? '' : 'is-bad'} onChange={(e) => set('slug', e.target.value.trim())} placeholder="zgx-nano-ai-station" />
          {slugOk && savedSlug && savedSlug === s.slug && <small>이 제품에 전에 쓴 슬러그입니다 (바꾸면 이미지 주소가 달라짐)</small>}
          {slugOk && savedSlug && savedSlug !== s.slug && <small className="msg--error">전에 쓴 슬러그는 "{savedSlug}" 입니다. 규칙 6-1: 한 번 정하면 바꾸지 않습니다.</small>}
          {!slugOk && <small className="msg--error">영문 소문자·숫자·하이픈만. 한글 제품명이면 영문 모델명으로 직접 입력하세요.</small>}
        </label>
        <label>
          <span>rev (이미지 묶음 날짜)</span>
          <input value={s.rev} className={revOk ? '' : 'is-bad'} onChange={(e) => set('rev', e.target.value.trim())} />
        </label>
        <label className="form__wide">
          <span>이미지 공개 주소 루트</span>
          <input value={s.publicRoot} onChange={(e) => set('publicRoot', e.target.value)} />
          <small>HTML 이미지 주소: {baseUrl}/파일명</small>
        </label>
        <label className="form__wide">
          <span>추가 지시 (선택)</span>
          <textarea rows={3} value={s.extra} onChange={(e) => set('extra', e.target.value)} placeholder="예) 마지막 포트 섹션은 표로 만들어 줘 / 헤드카피는 이미지로 구워 줘" />
        </label>
      </div>
      <div className="actions">
        {running ? (
          <button className="btn btn--ghost" onClick={onCancel}>취소</button>
        ) : resume ? (
          <>
            <button className="btn btn--primary" disabled={!canGenerate} onClick={() => onGenerate()}>이어서 만들기 (남은 섹션 {resume.missing}개)</button>
            <button className="btn" disabled={!canGenerate} onClick={() => onGenerate(true)}>처음부터 다시</button>
          </>
        ) : (
          <button className="btn btn--primary" disabled={!canGenerate} onClick={() => onGenerate(true)}>마크업 생성</button>
        )}
        <span className="hint">
          {resume
            ? `저장된 계획(섹션 ${resume.total - resume.missing}/${resume.total}개 완료)에서 이어갑니다. 남은 섹션만 요청하므로 비용이 적게 듭니다.`
            : resumeChanged
              ? '설정이 저장된 계획을 만들 때와 달라 처음부터 다시 만듭니다.'
              : health?.mock ? 'MOCK 모드라 비용이 들지 않습니다.' : `PSD 렌더 타일 ${tileCount}장 + 레이어 정보를 보냅니다. 1회 대략 $0.5~2 (PSD 크기에 따라 다름).`}
        </span>
      </div>
    </section>
  );
}
