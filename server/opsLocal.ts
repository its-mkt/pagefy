// 로컬 서버의 운영 기록 자리 — 배포는 Supabase 함수가 DB(pagefy_runs·feedback·settings)에 남긴다 (core/ops.ts).
// 로컬(yarn dev)은 DB 가 없으므로 이 PC 메모리에만 둔다: 평가는 받아 두고, 관리 화면은 MOCK=1 일 때 예시 숫자로 보여 준다
// (화면 흐름 점검용. 로컬은 각자 API 키를 쓰므로 월 상한으로 막지 않는다)
import express from 'express';
import { type AdminSettingsRequest, type AdminStats, type BudgetInfo, type FeedbackRequest, budgetOf, monthKST, nextMonth } from '../shared/ops.ts';
import { checkFeedback } from '../core/ops.ts';

const MOCK = process.env.MOCK === '1';
const feedback: (FeedbackRequest & { at: string })[] = [];
let capUsd = 100;
let unblockedMonth: string | null = null;
/** MOCK 예시 사용액 — 상한 경고(80%)가 화면에 어떻게 보이는지 보려면 PAGEFY_MOCK_SPENT=85 */
const mockSpent = () => Number(process.env.PAGEFY_MOCK_SPENT || 23.4);

export function localBudget(): BudgetInfo | undefined {
  return MOCK ? budgetOf(monthKST(), capUsd, mockSpent(), unblockedMonth) : undefined;
}

function mockStats(month: string): AdminStats {
  const fbAsis = feedback.filter((f) => f.verdict === 'asis').length;
  const areas: Record<string, number> = { position: 3, linebreak: 2, image: 1 };
  for (const f of feedback) for (const a of f.areas) areas[a] = (areas[a] ?? 0) + 1;
  const now = Date.now();
  const ago = (m: number) => new Date(now - m * 60_000).toISOString();
  return {
    month,
    budget: budgetOf(month, capUsd, mockSpent(), unblockedMonth),
    runs: { total: 41, ok: 37, failed: 3, cancelled: 1, timeouts: 2, avgPlanMs: 94_000 },
    users: [
      { email: 'designer1@example.com', runs: 22, costUsd: 13.1, failed: 2 },
      { email: 'designer2@example.com', runs: 15, costUsd: 8.2, failed: 1 },
      { email: 'manager@example.com', runs: 4, costUsd: 2.1, failed: 0 },
    ],
    failures: [
      { at: ago(35), email: 'designer1@example.com', action: 'plan', product: 'HP ZGX Nano G1n AI Station', kind: 'timeout', error: '서버 실행 시간 제한(140초)에 걸려 중단했습니다.', durationMs: 140_200 },
      { at: ago(60 * 26), email: 'designer2@example.com', action: 'plan', product: '카드뉴스 서플', kind: 'api', error: '요청 한도를 넘었습니다. 잠시 뒤 다시 시도하세요.', durationMs: 3_100 },
      { at: ago(60 * 50), email: 'designer1@example.com', action: 'plan', product: '2607 MWS 재고정리', kind: 'timeout', error: '서버 실행 시간 제한(140초)에 걸려 중단했습니다.', durationMs: 140_050 },
    ],
    feedback: { total: 12 + feedback.length, asis: 7 + fbAsis, edited: 5 + feedback.length - fbAsis, areas },
    recentFeedback: [
      ...feedback
        .slice()
        .reverse()
        .map((f) => ({ at: f.at, email: '(이 PC)', product: f.product, verdict: f.verdict, areas: f.areas, note: f.note ?? null })),
      { at: ago(90), email: 'designer2@example.com', product: '카드뉴스 서플', verdict: 'edited' as const, areas: ['linebreak'], note: '둘째 문단 줄바꿈 한 곳' },
      { at: ago(60 * 5), email: 'designer1@example.com', product: 'HP ZGX Nano G1n AI Station', verdict: 'asis' as const, areas: [], note: null },
    ].slice(0, 20),
    months: Array.from({ length: 6 }, (_, i) => nextMonth(month, i - 5)).map((m, i) => ({ month: m, costUsd: i === 5 ? mockSpent() : i >= 3 ? [0, 0, 0, 4.2, 31.5][i] : 0, plans: i === 5 ? 18 : i === 4 ? 21 : i === 3 ? 3 : 0 })),
  };
}

export const opsRouter = express.Router();

opsRouter.post('/feedback', express.json(), (req, res) => {
  const b = req.body as FeedbackRequest;
  const bad = checkFeedback(b);
  if (bad) return void res.status(400).json({ error: bad });
  const i = feedback.findIndex((f) => f.jobId === b.jobId);
  if (i >= 0) feedback.splice(i, 1);
  feedback.push({ ...b, at: new Date().toISOString() });
  console.log(`[feedback] ${b.product} — ${b.verdict === 'asis' ? '그대로 씀' : `고쳐서 씀 (${b.areas.join(', ')})`}${b.note ? ` · ${b.note}` : ''}`);
  res.json({ ok: true });
});

opsRouter.get('/admin/stats', (req, res) => {
  if (!MOCK) return void res.status(503).json({ error: '관리 화면은 배포 화면에서만 실제 숫자가 나옵니다 (로컬은 MOCK=1 일 때 예시 숫자).' });
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : monthKST();
  res.json(mockStats(month));
});

opsRouter.post('/admin/settings', express.json(), (req, res) => {
  if (!MOCK) return void res.status(503).json({ error: '로컬에서는 바꿀 설정이 없습니다.' });
  const b = req.body as AdminSettingsRequest;
  if (b.capUsd !== undefined) {
    if (!Number.isFinite(b.capUsd) || b.capUsd < 1 || b.capUsd > 10000) return void res.status(400).json({ error: '월 상한은 1~10000 달러로 정하세요.' });
    capUsd = b.capUsd;
  }
  if (b.unblock !== undefined) unblockedMonth = b.unblock ? monthKST() : null;
  res.json({ budget: localBudget() });
});
