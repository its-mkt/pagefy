// 작업 기록 칸 (담당자 · 메모 · 테스트용) — 만들기 화면 설정과 변환 내역 「작업 정보 편집」 창이 같이 쓴다.
// 값은 작업의 note 에 따로 저장된다 (만들기 설정과 별개 — Claude 에 보내지 않고 마크업 결과·이어서 만들기에도 영향 없음)
import { okLink, type JobNote } from '../lib/jobs';
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
      {/* 담당자·메모는 가로로 나란히 (PC), 좁은 화면에서는 한 칸씩 — 체크박스는 아래 한 줄 */}
      <div className="jobinfo__pair">
      <label>
        <span>담당자 <em className="req" title="필수 입력">*</em></span>
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
      <label>
        <span>메모 (선택)</span>
        <input value={v.memo ?? ''} maxLength={MEMO_MAX} onChange={(e) => onChange({ ...v, memo: e.target.value })} placeholder="예) 리뉴얼 시안 2차 / 쿠팡 폭 확인용" />
      </label>
      </div>
      {/* 쇼핑몰에 등록한 상품 페이지 — 넣으면 변환 내역에 「등록됨」 링크. 주소 모양이 아니면 빨간 테두리 (저장은 막지 않고 알림만) */}
      <label className="form__wide">
        <span>등록한 페이지 링크 (선택)</span>
        <input
          type="url"
          value={v.link ?? ''}
          className={okLink(v.link) ? '' : 'is-bad'}
          aria-invalid={!okLink(v.link) || undefined}
          onChange={(e) => onChange({ ...v, link: e.target.value })}
          placeholder="예) https://www.itket.co.kr/goods/goods_view.php?goodsNo=1000001234"
          spellCheck={false}
        />
        {!okLink(v.link) && <small className="msg--error">http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.</small>}
      </label>
      <CheckField className="form__wide" checked={!!v.test} onChange={(t) => onChange({ ...v, test: t })}>
        테스트용 작업 <small>변환 이력에 「테스트」로 표시되고, 거르기에서 뺄 수 있습니다</small>
      </CheckField>
    </>
  );
}
