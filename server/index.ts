// 로컬 API 서버: 개발 중 화면(Vite)에서 /api 로 들어온 요청을 받아 Claude API 를 부른다
// 배포(its.itket.com/pagefy)에서는 같은 일을 Supabase 함수(supabase/functions/pagefy)가 한다 — 둘 다 core/ 를 쓴다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { HealthInfo, PlanRequest, SectionRequest, StreamEvent } from '../shared/types.ts';
import { buildPlanMessages, buildSectionMessages, buildSystem } from '../core/prompt.ts';
import { runClaude } from '../core/run.ts';
import { validatePlan, validateSection } from '../core/validate.ts';
import { EFFORT, MODEL, RUN, describeError, getClient } from './claude.ts';
import { mockPlanOutput, mockSectionOutput, mockStream } from './mock.ts';
import { loadRules } from './rules.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT || 1101);
const MOCK = process.env.MOCK === '1';
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const app = express();
/** 배포 주소 경로. 화면은 /pagefy/, API 는 /pagefy/api/… (개발 중 Vite 프록시용 /api/… 도 같이 받는다) */
const BASE_PATH = '/pagefy';
const api = express.Router();

api.get('/health', (_req, res) => {
  let rules: HealthInfo['rules'] = { source: '(없음)', updatedAt: null, fallback: true };
  try {
    const r = loadRules();
    rules = { source: r.source, updatedAt: r.updatedAt, fallback: r.fallback };
  } catch {
    // 규칙 파일이 없으면 화면에 표시
  }
  const body: HealthInfo = { ok: true, mock: MOCK, hasKey: hasKey(), model: MODEL, effort: EFFORT, rules };
  res.json(body);
});

api.get('/rules', (_req, res) => {
  try {
    res.json(loadRules());
  } catch (err) {
    res.status(500).json({ error: describeError(err) });
  }
});

/** SSE 응답을 열고 작업을 돌린다 */
async function streamTo(res: express.Response, work: (send: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const send = (e: StreamEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // 화면에서 취소하거나 창을 닫으면 Claude 요청도 끊는다
  try {
    await work(send, ac.signal);
  } catch (err) {
    if (!ac.signal.aborted) send({ type: 'error', message: describeError(err) });
  } finally {
    res.end();
  }
}

function precheck(res: express.Response, problem: string | null) {
  if (problem) {
    res.status(400).json({ error: problem });
    return false;
  }
  if (!MOCK && !hasKey()) {
    res.status(400).json({ error: 'API 키가 없습니다. .env 에 ANTHROPIC_API_KEY 를 넣고 서버를 다시 켜세요 (또는 MOCK=1 로 화면 점검).' });
    return false;
  }
  return true;
}

api.post('/plan', express.json({ limit: '80mb' }), async (req, res) => {
  const body = req.body as PlanRequest;
  if (!precheck(res, validatePlan(body))) return;
  await streamTo(res, async (send, signal) => {
    if (MOCK) return mockStream(mockPlanOutput(body), send, signal);
    const rules = loadRules();
    send({ type: 'status', message: `규칙: ${rules.source}${rules.fallback ? ' (공유 폴더 접근 불가 → 사본 사용)' : ''}` });
    send({ type: 'status', message: `계획 요청 중… (타일 ${body.tiles.length}장, 텍스트 ${body.summary.texts.length}개)` });
    await runClaude(getClient(), RUN, buildSystem(rules.text), buildPlanMessages(body), send, signal);
  });
});

api.post('/section', express.json({ limit: '40mb' }), async (req, res) => {
  const body = req.body as SectionRequest;
  if (!precheck(res, validateSection(body))) return;
  await streamTo(res, async (send, signal) => {
    if (MOCK) return mockStream(mockSectionOutput(body), send, signal);
    await runClaude(getClient(), RUN, buildSystem(loadRules().text), buildSectionMessages(body), send, signal);
  });
});

app.use('/api', api);
app.use(`${BASE_PATH}/api`, api);

// 빌드한 화면(dist)이 있으면 /pagefy/ 에서 같이 서비스 (yarn build → yarn start 로 한 포트에서 사용)
const dist = path.join(HERE, '..', 'dist');
if (fs.existsSync(dist)) {
  app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`));
  app.use(BASE_PATH, express.static(dist));
  app.get(new RegExp(`^${BASE_PATH}(/(?!api/).*)?$`), (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[pagefy api] http://localhost:${PORT}  model=${MODEL} effort=${EFFORT}${MOCK ? '  (MOCK 모드)' : ''}${hasKey() ? '' : '  ⚠ API 키 없음'}`);
});
