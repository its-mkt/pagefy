-- Pagefy 운영 기록 (2026-11-24, 사내 정식 도입 준비) — 아직 적용하지 않음
-- 적용: Supabase 프로젝트 ad-insight DB(tqxljgmygvanysqnhiar) 에 이 파일 그대로 실행 (MCP apply_migration 이름 pagefy_ops)
--
-- 세 표 모두 화면(anon·authenticated)에서 직접 못 읽는다 — RLS 켬 + 정책 없음.
-- 읽기·쓰기는 Supabase 함수 pagefy 가 service_role 로만 한다 (권한 판정은 함수가 광고 인사이트 whoami 로 이미 함).

-- 1) Claude 호출 기록: 생성 요청마다 한 줄 (누가·언제·무엇을·얼마·성공 여부·걸린 시간)
--    월 상한은 이 표의 cost_usd 합으로 판단한다 (화면이 보내는 값이 아니라 함수가 직접 잰 값)
create table if not exists public.pagefy_runs (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  email        text not null,
  action       text not null check (action in ('plan', 'section')),
  product      text,                         -- 제품명 (요청 meta.productName)
  channel      text,
  model        text,
  cost_usd     numeric(10, 4) not null default 0,
  status       text not null check (status in ('ok', 'error', 'cancelled')),
  error_kind   text,                         -- timeout · refusal · api · other
  error        text,
  duration_ms  integer
);
create index if not exists pagefy_runs_at on public.pagefy_runs (at desc);

-- 2) 결과 평가: 「수정 없이 그대로 썼어요 / 고쳐서 썼어요」 (주 지표 = 그대로 붙여넣기 가능 비율)
--    같은 작업을 다시 평가하면 마지막 것으로 바꾼다 (job_id + email 하나)
create table if not exists public.pagefy_feedback (
  job_id   text not null,
  email    text not null,
  at       timestamptz not null default now(),
  product  text,
  verdict  text not null check (verdict in ('asis', 'edited')),
  areas    text[] not null default '{}',     -- position · linebreak · image · text · other
  note     text check (char_length(note) <= 500),
  primary key (job_id, email)
);
create index if not exists pagefy_feedback_at on public.pagefy_feedback (at desc);

-- 3) 운영 설정: 월 상한(USD) · 상한 해제한 달
create table if not exists public.pagefy_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.pagefy_settings (key, value) values ('monthly_cap_usd', '100'::jsonb) on conflict (key) do nothing;
insert into public.pagefy_settings (key, value) values ('unblocked_month', 'null'::jsonb) on conflict (key) do nothing;

alter table public.pagefy_runs enable row level security;
alter table public.pagefy_feedback enable row level security;
alter table public.pagefy_settings enable row level security;
revoke all on public.pagefy_runs, public.pagefy_feedback, public.pagefy_settings from anon, authenticated;
