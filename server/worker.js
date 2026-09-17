// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/worker.js — Cloudflare Workers 변형(무인·무료 호스팅).
//
//   POST /api/ai  { task, payload }  ->  text/plain (assistant 텍스트)
//
//   ★ 왜 Worker?  무료 티어로 상시 가동되고, 관리할 서버가 없습니다(무인).
//   ★ 보안: API 키는 Worker Secret(ANTHROPIC_API_KEY)에만 존재합니다.
//            브라우저·리포지토리에는 절대 두지 않습니다.
//            설정:  wrangler secret put ANTHROPIC_API_KEY
//
//   비용 규칙은 server/index.mjs 와 동일:
//     • 기본 모델 claude-haiku-4-5 (env.AI_MODEL 로 상향 가능: claude-sonnet-5 / claude-opus-5)
//     • prompt caching(cache_control: ephemeral) 으로 안정 system 프롬프트 캐시
//     • Haiku 4.5 는 thinking/effort 미전송(400 방지), 상위 모델만 전송
//     • per-task max_tokens 를 낮게(기본 700) 유지
//     • 분당 요청수 제한(인메모리, isolate 단위) + 월간 토큰 예산 → 초과 시 429 {fallback:true}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = { coach: 700, routine: 800, summary: 500, digest: 700 };
const DEFAULT_MAX_TOKENS = 700;
const DEFAULT_RATE_LIMIT_PER_MIN = 20;
const DEFAULT_MONTHLY_TOKEN_CAP = 2_000_000;

const DISCLAIMER = '모든 답변은 일반적인 운동 가이드이며 의학적 조언이 아닙니다. 통증·질환·부상이 있으면 전문의 상담을 안내하세요.';

// 인메모리 가드레일(Worker isolate 단위 — 완벽한 전역은 아니나 저비용 방어로 충분)
const rateHits = new Map();
let monthKey = currentMonthKey();
let monthlyTokens = 0;

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function safeJson(v) {
  try { return JSON.stringify(v ?? [], null, 0).slice(0, 6000); } catch { return '[]'; }
}

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
    return {
      system: `${common} 사용자가 앱을 열면 보여줄 "오늘의 브리핑"을 만드세요. 오늘의 목표에 어울리는 추천 트레이너 1~2명과, 그 목표에 맞는 짧은 오늘의 루틴을 간결하게 제시하세요. 제공된 트레이너/루틴 데이터를 활용하세요.`,
      user: `오늘의 목표: ${payload.goal || '전반적 건강'}\n운동 수준: ${payload.level || '초급'}\n가용 시간(분): ${payload.minutes || 30}\n\n트레이너 목록(JSON):\n${safeJson(payload.trainers)}\n\n참고 루틴(JSON):\n${safeJson(payload.routines)}`,
    };
  }
  return { system: common, user: `지원하지 않는 task: ${task}` };
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
}

function rateLimited(ip, limit) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateHits.get(ip) || []).filter((t) => t > windowStart);
  hits.push(now);
  rateHits.set(ip, hits);
  return hits.length > limit;
}

function budgetExceeded(cap) {
  const nowKey = currentMonthKey();
  if (nowKey !== monthKey) { monthKey = nowKey; monthlyTokens = 0; }
  return monthlyTokens >= cap;
}

function accumulateUsage(usage) {
  if (!usage) return;
  monthlyTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const model = env.AI_MODEL || DEFAULT_MODEL;

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, model, keyLoaded: Boolean(env.ANTHROPIC_API_KEY), monthlyTokens });
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/ai')) {
      return json({ error: 'Not found. Use POST /api/ai' }, 404);
    }

    const rateLimit = Number(env.AI_RATE_LIMIT_PER_MIN) || DEFAULT_RATE_LIMIT_PER_MIN;
    const cap = Number(env.AI_MONTHLY_TOKEN_CAP) || DEFAULT_MONTHLY_TOKEN_CAP;

    // 비용 가드레일 → 초과 시 429 {fallback:true} (프론트는 mock 폴백)
    if (rateLimited(clientIp(request), rateLimit)) return json({ fallback: true, error: 'rate limit exceeded' }, 429);
    if (budgetExceeded(cap)) return json({ fallback: true, error: 'monthly token budget exceeded' }, 429);

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'ANTHROPIC_API_KEY 미설정. wrangler secret put ANTHROPIC_API_KEY 로 설정하세요.' }, 500);
    }

    let task; let payload;
    try {
      ({ task, payload } = await request.json());
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }

    const { system, user } = buildPrompt(task, payload);
    const maxTokens = MAX_TOKENS[task] || DEFAULT_MAX_TOKENS;

    const reqBody = {
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    };
    if (!model.startsWith('claude-haiku')) {
      reqBody.thinking = { type: 'adaptive' };
      reqBody.output_config = { effort: env.AI_EFFORT || 'low' };
    }

    let apiRes;
    try {
      apiRes = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(reqBody),
      });
    } catch (err) {
      return json({ fallback: true, error: String(err?.message || err) }, 502);
    }

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => '');
      // 상류 오류 → 프론트가 mock 으로 폴백하도록 힌트
      return json({ fallback: true, error: `anthropic ${apiRes.status}: ${detail.slice(0, 200)}` }, 502);
    }

    const data = await apiRes.json();
    accumulateUsage(data.usage);
    const text = Array.isArray(data.content)
      ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      : '';

    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS },
    });
  },
};
