-- 마크업 재검증(Claude 정밀 검토, 2026-11-27) 사용 기록 — pagefy_runs.action 에 'review' 를 더한다.
-- 함수(supabase/functions/pagefy) 를 다시 배포하기 전에 먼저 적용한다. 안 하면 재검증 비용이 기록되지 않아 월 상한 계산에서 빠진다
alter table public.pagefy_runs drop constraint if exists pagefy_runs_action_check;
alter table public.pagefy_runs add constraint pagefy_runs_action_check check (action in ('plan', 'section', 'review'));
