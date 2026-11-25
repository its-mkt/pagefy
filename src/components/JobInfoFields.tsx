// 작업 기록 칸 (담당자 · 메모 · 테스트용) — 만들기 화면 설정과 변환 내역 「작업 정보 편집」 창이 같이 쓴다.
// 값은 작업의 note 에 따로 저장된다 (만들기 설정과 별개 — Claude 에 보내지 않고 마크업 결과·이어서 만들기에도 영향 없음)
import type { JobNote } from '../lib/jobs';
import { CheckField } from './ui';

/** 메모 최대 글자 수 (변환 내역 한 줄에 보이는 정도) */
export const MEMO_MAX = 120;

/** 담당자가 채워졌는지 (필수 칸 — 만들기·작업 정보 저장 전에 본다) */
export const hasAssignee = (n: JobNote) => !!n.assignee?.trim();

/**
 * 담당자는 필수 (2026-11-25 사용자 지시). 비어 있으면 data-attn — 만들기 설정이 펼쳐질 때 커서를 둔다 (모양은 다른 칸과 같음).
 * showError: 비운 채 「마크업 만들기」·「저장」을 누른 뒤 — 빨간 테두리 + 안내 (입력하면 바로 풀림)
 */
export default function JobInfoFields({ value: v, onChange, showError }: { value: JobNote; onChange: (v: JobNote) => void; showError?: boolean }) {
  const whoEmpty = !hasAssignee(v);
  const bad = !!showError && whoEmpty;
  return (
    <>
      {/* 세로로 한 칸씩 (2026-11-25 — 둘이 나란히면 메모 칸이 좁다) */}
      <label className="form__wide">
        <span>담당자 (필수)</span>
        <input
          value={v.assignee ?? ''}
          data-field="assignee"
          data-attn={whoEmpty || undefined}
          className={bad ? 'is-bad' : ''}
          aria-invalid={bad || undefined}
          aria-required="true"
          onChange={(e) => onChange({ ...v, assignee: e.target.value })}
          placeholder="예) 홍길동"
        />
        {bad && (
          <small className="msg--error" role="alert">
            담당자를 입력해 주세요.
          </small>
        )}
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
