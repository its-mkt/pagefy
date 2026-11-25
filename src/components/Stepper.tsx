/** 지금 어느 단계인지 — PSD 올리기 → 확인·설정 → 만들기 → 복사해 붙여넣기 */
const STEPS = ['PSD 올리기', '확인·설정', '마크업 만들기', '복사해 붙여넣기'] as const;

/**
 * step = 실제 진행 단계, shown = 화면에 보이는 단계 (지난 단계를 눌러 보는 중이면 다름).
 * 완료한 ②·③ 과 지금 단계는 눌러서 그 단계 화면으로 갈 수 있다 (2026-11-25 — 화면은 단계마다 그 단계 칸만 보이므로 설정을 다시 보려면 ② 로).
 * ① 은 누르지 않는다 — 다른 PSD 는 머리의 「새 PSD」로 (지금 작업이 닫히므로)
 */
export default function Stepper({ step, shown = step, onPick }: { step: number; shown?: number; onPick?: (n: number) => void }) {
  return (
    <ol className="stepper" aria-label="진행 단계">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'cur' : 'todo';
        const canPick = !!onPick && n >= 2 && n <= step && n !== shown;
        const body = (
          <>
            <span className="stepper__num">{state === 'done' ? '✓' : n}</span>
            <span className="stepper__label">{label}</span>
          </>
        );
        return (
          <li key={label} className={`stepper__item is-${state}${n === shown ? ' is-shown' : ''}`} aria-current={n === shown ? 'step' : undefined}>
            {canPick ? (
              <button type="button" className="stepper__btn" onClick={() => onPick!(n)} title={n === step ? '지금 단계로 돌아가기' : `${label} 화면 보기`}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
