# Pagefy 운영 설명서 (담당자·부담당자용)

사용자용 안내는 화면 「도움말」(`#help`)에 있다. 이 문서는 운영하는 사람이 보는 것.
처음 만든 날: 2026-11-24 (사내 정식 도입 준비 1단계)

## 1. 한눈에

| 무엇 | 어디 | 누가 고치나 |
|---|---|---|
| 화면 | GitHub `its-mkt/pagefy` → Pages (`main` push 하면 1~2분 뒤 반영) | 담당자 |
| 생성 서버 | Supabase 프로젝트 `ad-insight DB`(tqxljgmygvanysqnhiar) 함수 `pagefy` | 담당자 |
| 마크업 규칙 원본 | `\\192.168.1.254\마케팅팀\A_상세페이지\pagefy.md` | 담당자·부담당자 |
| 로그인·권한 | 광고 인사이트 계정 (역할 admin·manager·member 만 생성 가능, admin 은 「관리」 화면도) | 광고 인사이트 관리자 |
| 운영 기록 | DB 표 `pagefy_runs`(생성 기록) · `pagefy_feedback`(결과 평가 — 2026-11-24 화면에서 평가 막대를 빼서 더 쌓이지 않음) · `pagefy_settings`(월 상한) | 함수가 씀 |
| 이미지 서버 | 고도몰 FTP — 함수 비밀값 `PAGEFY_FTP_*` | 담당자 |

## 2. 매주 할 일 (10분)

1. 화면 「관리」를 연다 (admin 계정).
   - **도입 성과**(맨 위 둘째 카드): 이번 달 완료 건수 · 실패율 · 1건 평균 비용 · 평균 소요 시간. 월말에 이 네 숫자를 회사 보고에 쓴다 (2026-11-24 결정 — 결과 평가 막대를 빼서 "그대로 붙여넣기 비율" 대신). 실패율이 10% 를 넘으면 카드가 노랗게 바뀐다.
2. **최근 실패**를 본다. 같은 실패가 반복되면 4절 표대로 대처.
3. **시간 초과** 횟수를 본다. 한 달에 5회가 넘으면 Supabase 유료 전환(150초 제한 해제)을 검토한다.

## 3. 월 상한

- 팀 전체 월 상한 기본 **$100** (2026-11 실측 1건 평균 $0.72 × 월 40건 × 수정 포함 2회 ≈ $58 의 약 2배).
- 사용액이 80% 를 넘으면 모든 사용자 화면 맨 위에 경고, 100% 가 되면 새 생성이 막힌다 (이미 만든 결과 열기·복사는 됨).
- 막혔을 때: 「관리」 → **이번 달만 상한 풀기** (다음 달 1일에 자동으로 다시 적용). 상한 금액은 「상한 바꾸기」.
- 사용액은 함수가 Claude 응답에서 직접 잰 값의 합이다. 실제 청구액은 Anthropic 콘솔(Usage)에서 월 1회 대조한다.

## 4. 문제가 생기면

| 증상 | 먼저 볼 곳 | 대처 |
|---|---|---|
| 「생성 서버 확인 실패」 | Supabase 대시보드 → Edge Functions → pagefy → Logs | 함수가 내려갔으면 다시 배포 (5절) |
| 「Claude API 키가 올바르지 않습니다」 | 함수 비밀값 `ANTHROPIC_API_KEY` | 키를 새로 만들어 비밀값 교체 |
| 「요청 한도를 넘었습니다」가 잦음 | Anthropic 콘솔 → Limits | 잠시 뒤 다시. 계속되면 한도 상향 요청 |
| 시간 초과(140초)가 잦음 | 「관리」 시간 초과 수, 해당 PSD 길이 | 함수 비밀값 `PAGEFY_PLAN_EFFORT=low` 또는 Supabase 유료 전환 |
| 이미지 업로드 실패 | 화면 오류 문구, 함수 Logs `[upload]` | FTP 계정·비밀번호 만료 확인 → `PAGEFY_FTP_*` 교체 |
| 결과 품질이 갑자기 나빠짐 | 규칙 원본 최근 수정, `rules/` 커밋 | 규칙을 되돌리고 `yarn sync:rules` → 커밋·push |
| 「권한을 확인하지 못했습니다」 | 광고 인사이트 수집기 웹앱(Apps Script) 동작 | 광고 인사이트 쪽 장애 — 그쪽 담당에게 |

사용자가 보낸 「진단 정보 복사」 내용에는 PSD 정보·점검 결과·오류가 들어 있다. 코드 쪽 문제면 저장소 이슈로 남긴다.

## 5. 배포·반영

```bash
yarn typecheck && yarn build           # 화면 확인
yarn build:function                    # core/·shared/ 를 함수 폴더로 복사
# → supabase/functions/pagefy 를 Supabase 프로젝트 ad-insight DB 에 함수 pagefy 로 배포 (verify_jwt 끔)
yarn sync:rules                        # 규칙 원본을 고쳤으면 → rules/ 커밋·push (함수가 10분 안에 다시 읽음)
```

화면은 `main` 에 머지하면 GitHub Actions 가 Pages 로 올린다.

## 6. 1단계 반영 순서 (2026-11-24 작업분 — 아직 반영 안 됨)

1. **DB 표 만들기**: `supabase/migrations/20261124_pagefy_ops.sql` 을 ad-insight DB 에 실행 (표 3개, RLS 켬·정책 없음 → 화면에서 직접 못 읽음).
2. **실패 알림 웹앱** (선택, 없으면 알림만 꺼짐): 광고 인사이트 Apps Script 의 `doPost` 에 아래를 더하고 새 버전으로 배포.
   ```js
   // Pagefy 실패 알림 — 함수 비밀값 PAGEFY_NOTIFY_SECRET 과 같은 값을 스크립트 속성 PAGEFY_NOTIFY_SECRET 에 둔다
   function pagefyNotify_(body) {
     const secret = PropertiesService.getScriptProperties().getProperty('PAGEFY_NOTIFY_SECRET');
     if (!secret || body.secret !== secret) return { ok: false, error: 'forbidden' };
     const to = (body.to || []).filter((e) => /@/.test(e)).slice(0, 5);
     if (!to.length) return { ok: false, error: 'no recipient' };
     MailApp.sendEmail({ to: to.join(','), subject: String(body.subject).slice(0, 200), body: String(body.body).slice(0, 5000) });
     return { ok: true };
   }
   // doPost(e) 안: const body = JSON.parse(e.postData.contents); if (body.action === 'pagefyNotify') return json(pagefyNotify_(body));
   ```
3. **함수 비밀값** (Supabase → Edge Functions → Secrets):
   - `PAGEFY_NOTIFY_URL` = 위 웹앱 주소 (`.../exec`)
   - `PAGEFY_NOTIFY_SECRET` = 임의의 긴 문자열 (웹앱 스크립트 속성과 같게)
   - `PAGEFY_NOTIFY_TO` = 담당자,부담당자 이메일 (쉼표)
   - `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY` 는 함수에 자동으로 들어 있다
4. **함수 배포**: `yarn build:function` → 함수 `pagefy` 배포.
5. **화면 배포**: dev → main 머지 (Pages).
6. **확인**: admin 계정으로 「관리」 열림 · 한 건 만들고 `pagefy_runs` 에 줄이 생기는지 · 상한을 $1 로 낮춰 막히는지 → 다시 $100.

## 7. 2단계 이후 (정해진 것, 아직 안 함)

| 할 일 | 메모 |
|---|---|
| 저장소 비공개 전환 | 조직 GitHub 요금제 확인 필요 (무료면 Pages 를 다른 곳으로). 함수의 규칙 읽기를 인증 방식으로 바꿔야 함 |
| Pagefy 전용 FTP 계정 | 고도몰 관리자에서 이미지 폴더(`/data/detail`)만 쓰기 권한 → `PAGEFY_FTP_*` 교체. 이미지 서버는 FTPS·SFTP 를 지원하지 않음(2026-11-23 확인) → 전용 계정으로 피해 범위를 줄이는 것이 대책 |
| 자동 테스트 | 단위 테스트(`yarn test`, vitest)는 1단계에 기본만 넣음. ZGX 위치 대조 104/104 를 `yarn test:layout` 으로 (브라우저 렌더 필요 — Playwright) |
| Sonnet 비교 | 최근 3건(ZGX·MWS 재고정리·카드뉴스)을 Opus/Sonnet 각 1회, 약 $5. 점검 통과 수·못 찾은 글자·위치 대조로 비교 |
| 팀원 작업 목록 공유 | `pagefy_jobs` 에 같은 팀 읽기 정책 + 최근 작업에 「팀 작업」 보기 |
