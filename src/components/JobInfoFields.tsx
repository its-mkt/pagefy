// 작업 기록 칸 (담당자 · 메모 · 테스트용) — 만들기 화면 설정과 변환 내역 「작업 정보 편집」 창이 같이 쓴다.
// 값은 작업의 note 에 따로 저장된다 (만들기 설정과 별개 — Claude 에 보내지 않고 마크업 결과·이어서 만들기에도 영향 없음)
import type { JobNote } from '../lib/jobs';
import { CheckField } from './ui';

/** 메모 최대 글자 수 (변환 내역 한 줄에 보이는 정도) */
export const MEMO_MAX = 120;

export default function JobInfoFields({ value: v, onChange, me }: { value: JobNote; onChange: (v: JobNote) => void; me?: string }) {
  return (
    <>
      {/* 세로로 한 칸씩 (2026-11-25 — 둘이 나란히면 메모 칸이 좁다) */}
      <label className="form__wide">
        <span>담당자 (선택)</span>
        <input value={v.assignee ?? ''} onChange={(e) => onChange({ ...v, assignee: e.target.value })} placeholder={me ? `비우면 ${me}` : '예) 디자인팀 홍길동'} />
      </label>
      <label className="form__wide">
        <span>메모 (선택)</span>
        <input value={v.memo ?? ''} maxLength={MEMO_MAX} onChange={(e) => onChange({ ...v, memo: e.target.value })} placeholder="예) 리뉴얼 시안 2차 / 쿠팡 폭 확인용" />
      </label>
      <CheckField className="form__wide" checked={!!v.test} onChange={(t) => onChange({ ...v, test: t })}>
        테스트용 작업 <small>변환 내역에 「테스트」로 표시되고, 거르기에서 뺄 수 있습니다</small>
      </CheckField>
    </>
  );
}
