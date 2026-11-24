# 작업 기록을 로그인 계정에 저장 — 초안 (미적용)

상태: **DB 표 적용 완료 (2026-11-23, 마이그레이션 pagefy_jobs) · 화면 코드 커밋·배포됨.** 이후 휴지통용 `deleted_at timestamptz` 열이 추가됐다 (아래 SQL 초안에는 없음 — 실제 표가 기준).
운영 기록(생성 기록·평가·월 상한)은 별도 표 — `supabase/migrations/20261124_pagefy_ops.sql`, `docs/operations.md`. 권한 확인: 본인 행만 보임, 남의 행 수정·삭제 0건, 남의 이름으로 추가·비로그인 접근 거절(42501). 보안 점검(advisors)에 이 표 관련 경고 없음.
표가 없는 동안 화면은 자동으로 "이 브라우저에만 저장"으로 동작한다 (표 없음 오류 → 계정 저장 끔).

정한 것 (2026-11-23 사용자 "권장대로"):
- 승인 대기 계정도 자기 기록 저장은 허용 (생성은 함수가 막음) — 아래 SQL 그대로
- 관리자 사람별 비용 보기 정책은 넣지 않음 (필요해지면 2절 2번 추가)
- 계정 저장은 개수 제한 없음, 화면은 최근 20개 + "더 보기"

## 1. 무엇을 어디에 두나

| 무엇 | 어디 | 이유 |
|---|---|---|
| 작업 기록: 설정·구조 계획·결과(섹션 HTML/CSS)·실패 사유·비용·상태 | **Supabase DB `public.pagefy_jobs`** (계정별) | 작업당 수십~수백 KB. 다른 PC·브라우저에서 이어 보기 |
| PSD 원본 | 지금처럼 **브라우저 IndexedDB** | 장당 수십~수백 MB (ZGX 182MB) — 무료 플랜 파일 50MB·전체 1GB 를 넘음 |
| 잘라 둔 이미지 | 저장 안 함 | PSD 로 다시 만든다 |

다른 PC 에서 열면: 기록(결과 HTML·비용·보고)은 바로 보이고, 이미지 자르기·수정 요청·이어서 만들기는 "PSD 를 다시 골라 주세요" → 고른 파일의 `fileKey`(이름·크기·수정 시각 → 해시)가 같을 때만 이어 붙인다.

## 2. 표 (public 스키마, 이름 앞에 `pagefy_`)

- 별도 스키마(`pagefy`)는 Data API 노출 설정을 바꿔야 해서 피한다. 광고 인사이트도 `public.usage_*` 처럼 앞붙임을 쓴다.
- 지금 public 의 광고 인사이트 표 5개는 RLS 켜짐·정책 없음(화면에서 직접 못 읽음). 이 표만 "본인 행만" 정책을 연다.

```sql
-- 20261123_pagefy_jobs (초안 — 아직 실행하지 않음)
create table public.pagefy_jobs (
  id          uuid primary key,                       -- 화면이 만든 작업 id (지금 IndexedDB 의 Job.id 그대로)
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  file_name   text not null,
  file_size   bigint not null,
  file_key    text not null,                          -- 같은 PSD 인지 확인용 (원본은 저장 안 함)
  state       text not null check (state in ('ready', 'running', 'stopped', 'error', 'done')),
  -- 생성 중 표시: 다른 PC·브라우저가 같은 작업을 동시에 만들지 않게 (2분 넘게 갱신 없으면 끊긴 것으로 본다)
  running_until timestamptz,
  cost_usd    numeric(10, 3) not null default 0,
  model       text,
  data        jsonb not null,                         -- settings·meta·baseUrl·extra·plan·sections·failed·usage·revisionCount
  constraint pagefy_jobs_data_size check (pg_column_size(data) < 4000000)  -- 4MB 넘는 기록은 거절 (실수·남용 방지)
);

create index pagefy_jobs_user_updated on public.pagefy_jobs (user_id, updated_at desc);

alter table public.pagefy_jobs enable row level security;

-- 로그인한 사람은 자기 작업만 읽고 쓴다
create policy "pagefy_jobs: 본인 읽기"   on public.pagefy_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy "pagefy_jobs: 본인 추가"   on public.pagefy_jobs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "pagefy_jobs: 본인 수정"   on public.pagefy_jobs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "pagefy_jobs: 본인 삭제"   on public.pagefy_jobs for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.pagefy_jobs from anon;
grant select, insert, update, delete on public.pagefy_jobs to authenticated;
```

### 정하지 않은 것 (적용 전에 고를 것)

1. **승인 안 된 계정**: DB 는 광고 인사이트 승인 명단(Apps Script)을 모른다. 위 정책이면 승인 대기 계정도 자기 행은 쓸 수 있다 (생성은 함수가 막으므로 실제로 쓸 내용은 거의 없음). 막으려면 함수를 거쳐 저장하거나 명단을 DB 로 옮겨야 한다 — 지금은 두지 않는 것을 권장.
2. **관리자 비용 보기**: 사람별 비용을 관리자가 보려면 `usage_admins`(email) 와 묶는 읽기 정책을 하나 더 둔다. 원하면 추가:
   ```sql
   create policy "pagefy_jobs: 관리자 읽기" on public.pagefy_jobs for select to authenticated
     using (exists (select 1 from public.usage_admins a where a.email = (select auth.jwt() ->> 'email')));
   ```
   (`usage_admins` 는 RLS 켜짐·정책 없음이라 이 정책 안의 하위 질의가 못 읽을 수 있다 → 적용 시 security definer 함수로 감싸야 하는지 확인)
3. **보관 개수**: 지금 브라우저는 최근 8개. 계정 저장은 개수 제한 없이 두고 화면만 최근 20개 + "더 보기"를 권장.

## 3. 화면 코드 변경 (완료 — `src/lib/jobs.ts`, `JobsPanel.tsx`, `App.tsx`)

MOCK(로컬, 브라우저 저장)에서 확인: 생성·목록·지우기 그대로, 브라우저 PSD 를 지운 뒤 「PSD 골라 열기」→ 같은 PSD 고르면 결과 복원·PSD 다시 저장.
계정 저장 경로는 표를 만든 뒤 배포 화면에서 확인해야 한다 (미검증).

아래는 처음 계획 (구현과 같음):

- `src/lib/jobs.ts`
  - `listJobs/putJob/deleteJob` → 배포 모드(로그인)면 `pagefy_jobs` 를 쓰고, 로컬(`yarn dev`, 로그인 없음)은 지금처럼 IndexedDB.
  - PSD(`files` 저장소)는 계속 IndexedDB. `getFile(fileKey)` 가 없으면 "PSD 다시 고르기" 안내.
  - `putJob` 은 섹션이 끝날 때마다 불리므로 1초 단위로 모아서(debounce) 저장, 실패하면 IndexedDB 에 남겨 두고 다음에 다시 올림.
- 처음 한 번: 브라우저에 있던 작업을 계정으로 옮기기 (같은 id 가 없을 때만 insert).
- 생성 중 표시: 생성 시작 때 `running_until = now()+2분`, 진행 중 1분마다 연장, 끝나면 null. 다른 곳에서 열 때 `running_until > now()` 이면 "다른 곳에서 만드는 중" (지금의 `busyJobIds` 를 서버 쪽까지 확장).
- `JobsPanel` 문구: "이 브라우저에만 저장" → "내 계정에 저장 (PSD 원본은 이 PC 에만)".

## 4. 크기·비용 예상

- 작업 1개 `data`: 구조 계획 원문(약 30KB) + 섹션 결과 + 보고 → 수십~수백 KB. 무료 DB 500MB 기준 수천 건.
- 추가 비용 없음 (DB 읽기·쓰기만, Claude 호출 수는 그대로).
