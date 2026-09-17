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
//   실행(로컬):  cd server && npm install && cp .env.example .env  (키 입력 후)  npm start
//   그런 다음 ai/config.js 의 AI_ENDPOINT 를 "http://localhost:8790/api/ai" 로 설정하세요.
//   (CI 에서는 npm install / 실행 / 실제 API 호출을 하지 않습니다.)

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT) || 8790;
const MODEL = 'claude-opus-5';
const MAX_TOKENS = 2048;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = '모든 답변은 일반적인 운동 가이드이며 의학적 조언이 아닙니다. 통증·질환·부상이 있으면 전문의 상담을 안내하세요.';

// ---------------------------------------------------------------------------
// task -> system 프롬프트 + 사용자 메시지 구성
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
  return { system: common, user: `지원하지 않는 task: ${task}` };
}

function safeJson(v) {
  try { return JSON.stringify(v ?? [], null, 0).slice(0, 6000); } catch { return '[]'; }
}

// ---------------------------------------------------------------------------
// HTTP 서버
// ---------------------------------------------------------------------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: MODEL, keyLoaded: Boolean(process.env.ANTHROPIC_API_KEY) }));
    return;
  }
  if (req.method !== 'POST' || !req.url.startsWith('/api/ai')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /api/ai' }));
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

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
    });

    stream.on('text', (text) => res.write(text));
    stream.on('error', (err) => {
      if (!res.writableEnded) res.end(`\n[AI 오류] ${err?.message || err}`);
    });
    await stream.finalMessage();
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
  console.log(`[online-pt AI proxy] http://localhost:${PORT}  (model=${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY 가 없습니다. server/.env 에 키를 설정하세요(키는 서버에만 보관).');
  }
});
