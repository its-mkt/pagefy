/** 지금 어느 단계인지 — PSD 올리기 → 확인·설정 → 만들기 → 복사해 붙여넣기 */
const STEPS = ['PSD 올리기', '확인·설정', '마크업 만들기', '복사해 붙여넣기'] as const;

export default function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" aria-label="진행 단계">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'cur' : 'todo';
        return (
          <li key={label} className={`stepper__item is-${state}`} aria-current={state === 'cur' ? 'step' : undefined}>
            <span className="stepper__num">{state === 'done' ? '✓' : n}</span>
            <span className="stepper__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
