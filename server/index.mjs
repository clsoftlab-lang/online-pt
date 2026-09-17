// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — Claude 백엔드 프록시(선택). 실제 AI 를 켤 때만 사용합니다.
//
//   POST /api/ai  { task, payload }  ->  text/plain 스트림(델타)
//
//   ★ 보안 원칙: API 키는 오직 이 서버(process.env.ANTHROPIC_API_KEY)에만 존재합니다.
//     브라우저·리포지토리·프론트 코드에는 키를 절대 두지 않습니다.
//
//   ★ 무인·저비용 원칙:
//     • 기본 모델은 비용 우선 claude-haiku-4-5 (환경변수 AI_MODEL 로 변경).
//       품질이 더 필요하면 AI_MODEL=claude-sonnet-5 또는 claude-opus-5 로 올릴 수 있습니다.
//     • 안정적인 per-task 시스템 프롬프트는 prompt caching(cache_control: ephemeral)으로 보내
//       반복 호출 시 캐시를 읽어 비용을 낮춥니다.
//     • Haiku 4.5 는 adaptive thinking/effort 를 받지 않으므로(400 방지) 전송하지 않습니다.
//     • per-task max_tokens 를 낮게(기본 ~700) 두고, 분당 요청수 제한 + 월간 토큰 예산으로
//       비용 폭주를 막습니다. 예산 초과 시 429 {fallback:true} 로 응답 → 프론트는 mock 폴백.
//
//   실행(로컬):  cd server && npm install && cp .env.example .env  (키 입력 후)  npm start
//   그런 다음 ai/config.js 의 AI_ENDPOINT 를 "http://localhost:8790/api/ai" 로 설정하세요.
//   (CI 에서는 npm install / 실행 / 실제 API 호출을 하지 않습니다.)

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT) || 8790;

// 비용 우선 기본값. AI_MODEL 로 claude-sonnet-5 / claude-opus-5 등으로 상향 가능.
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';

// per-task 출력 상한(비용 방어). 기본 700, 정말 필요한 task 만 소폭 상향.
const MAX_TOKENS = { coach: 700, routine: 800, summary: 500, digest: 700 };
const DEFAULT_MAX_TOKENS = 700;

// 비용 가드레일
const RATE_LIMIT_PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20;
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP) || 2_000_000;
const AI_EFFORT = process.env.AI_EFFORT || 'low';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = '모든 답변은 일반적인 운동 가이드이며 의학적 조언이 아닙니다. 통증·질환·부상이 있으면 전문의 상담을 안내하세요.';

// ---------------------------------------------------------------------------
// task -> system 프롬프트 + 사용자 메시지 구성
//   system 은 "안정적"이어야 캐시 적중률이 높습니다(사용자별 값은 user 메시지로).
// ---------------------------------------------------------------------------
function buildPrompt(task, payload = {}) {
  const common = `당신은 한국어로 답하는 온라인 퍼스널 트레이닝 앱의 AI 코치입니다. ${DISCLAIMER} 간결하고 실행 가능한 조언을 제공하세요.`;
  if (task === 'coach') {
    return {
      system: `${common} 사용자의 목표와 부상 이력을 고려해 조언하고, 제공된 트레이너 목록에서 적합한 트레이너를 최대 3명 추천하세요.`,
      user: `목표: ${payload.goal || '전반적 건강'}\n운동 수준: ${payload.level || '초급'}\n부상/주의: ${payload.injuries || '없음'}\n질문: ${payload.message || '(없음)'}\n\n트레이너 목록(JSON):\n${safeJson(payload.trainers)}`,
    };
  }
  if (task === 'routine') {
    return {
      system: `${common} 목표·수준·시간에 맞춘 운동 루틴을 워밍업/메인/마무리 구조로 생성하세요. 제공된 기준 루틴 데이터를 참고할 수 있습니다.`,
      user: `목표: ${payload.goal || '다이어트'}\n수준: ${payload.level || '초급'}\n가용 시간(분): ${payload.minutes || 30}\n관심 부위: ${(payload.focus || []).join(', ') || '전신'}\n\n참고 루틴(JSON):\n${safeJson(payload.routines)}`,
    };
  }
  if (task === 'summary') {
    return {
      system: `${common} 방금 끝난 세션의 요약과 격려 중심의 코치 피드백, 다음 세션 목표를 생성하세요.`,
      user: `트레이너: ${payload.trainerName || '트레이너'}\n루틴: ${payload.routineName || '자유 세션'}\n운동 시간(분): ${payload.minutes || 0}\n완료 동작: ${payload.done || 0}/${payload.total || 0}\n만족도: ${payload.rating || 0}/5\n사용자 메모: ${payload.feedback || '(없음)'}`,
    };
  }
  if (task === 'digest') {
    // 무인 자동 브리핑: 앱 접속 시 "오늘의 추천 트레이너 + 맞춤 루틴" 자동 생성
    return {
      system: `${common} 사용자가 앱을 열면 보여줄 "오늘의 브리핑"을 만드세요. 오늘의 목표에 어울리는 추천 트레이너 1~2명과, 그 목표에 맞는 짧은 오늘의 루틴을 간결하게 제시하세요. 제공된 트레이너/루틴 데이터를 활용하세요.`,
      user: `오늘의 목표: ${payload.goal || '전반적 건강'}\n운동 수준: ${payload.level || '초급'}\n가용 시간(분): ${payload.minutes || 30}\n\n트레이너 목록(JSON):\n${safeJson(payload.trainers)}\n\n참고 루틴(JSON):\n${safeJson(payload.routines)}`,
    };
  }
  return { system: common, user: `지원하지 않는 task: ${task}` };
}

function safeJson(v) {
  try { return JSON.stringify(v ?? [], null, 0).slice(0, 6000); } catch { return '[]'; }
}

// ---------------------------------------------------------------------------
// 비용 가드레일 상태(인메모리)
// ---------------------------------------------------------------------------
const rateHits = new Map();               // ip -> number[] (최근 1분 타임스탬프)
let monthKey = currentMonthKey();
let monthlyTokens = 0;                     // 이번 달 누적 토큰(usage 기준)

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateHits.get(ip) || []).filter((t) => t > windowStart);
  hits.push(now);
  rateHits.set(ip, hits);
  return hits.length > RATE_LIMIT_PER_MIN;
}

function budgetExceeded() {
  const nowKey = currentMonthKey();
  if (nowKey !== monthKey) { monthKey = nowKey; monthlyTokens = 0; } // 월 경계 리셋
  return monthlyTokens >= MONTHLY_TOKEN_CAP;
}

function accumulateUsage(usage) {
  if (!usage) return;
  const used = (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  monthlyTokens += used;
}

// ---------------------------------------------------------------------------
// HTTP 서버
// ---------------------------------------------------------------------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, model: MODEL, keyLoaded: Boolean(process.env.ANTHROPIC_API_KEY),
      monthlyTokens, monthlyTokenCap: MONTHLY_TOKEN_CAP, rateLimitPerMin: RATE_LIMIT_PER_MIN,
    }));
    return;
  }
  if (req.method !== 'POST' || !req.url.startsWith('/api/ai')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /api/ai' }));
    return;
  }

  // 비용 가드레일: 분당 요청수 제한
  if (rateLimited(clientIp(req))) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fallback: true, error: 'rate limit exceeded' }));
    return;
  }
  // 비용 가드레일: 월간 토큰 예산 초과 → 429 {fallback:true} (프론트는 mock 폴백)
  if (budgetExceeded()) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fallback: true, error: 'monthly token budget exceeded' }));
    return;
  }

  try {
    const body = await readBody(req);
    const { task, payload } = JSON.parse(body || '{}');
    if (!process.env.ANTHROPIC_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY 미설정. server/.env 를 확인하세요.' }));
      return;
    }
    const { system, user } = buildPrompt(task, payload);
    const maxTokens = MAX_TOKENS[task] || DEFAULT_MAX_TOKENS;

    // 요청 파라미터: prompt caching + (Haiku 면 thinking/effort 생략)
    const params = {
      model: MODEL,
      max_tokens: maxTokens,
      // 안정적 system 프롬프트를 캐시 대상으로 표시 → 반복 호출 시 비용 절감
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    };
    if (!MODEL.startsWith('claude-haiku')) {
      // Haiku 4.5 는 adaptive thinking/effort 미지원(400) → 상위 모델에서만 전송
      params.thinking = { type: 'adaptive' };
      params.output_config = { effort: AI_EFFORT };
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

    const stream = client.messages.stream(params);
    stream.on('text', (text) => res.write(text));
    stream.on('error', (err) => {
      if (!res.writableEnded) res.end(`\n[AI 오류] ${err?.message || err}`);
    });
    const final = await stream.finalMessage();
    accumulateUsage(final?.usage);   // 스트림 최종 메시지의 usage 로 월간 토큰 누적
    if (!res.writableEnded) res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    } else if (!res.writableEnded) {
      res.end(`\n[서버 오류] ${err?.message || err}`);
    }
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('요청 본문이 너무 큽니다.')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`[online-pt AI proxy] http://localhost:${PORT}  (model=${MODEL}, cap=${MONTHLY_TOKEN_CAP} tok/월, ${RATE_LIMIT_PER_MIN}/분)`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY 가 없습니다. server/.env 에 키를 설정하세요(키는 서버에만 보관).');
  }
});
