// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai.js — 앱의 유일한 AI 진입점.
//
//   askAI(task, payload, { onToken }) :
//     • AI_ENDPOINT 가 "" 이면  => 결정론적 한국어 MockProvider (앱의 트레이너/루틴 데이터 재사용).
//     • AI_ENDPOINT 가 있으면    => 백엔드 프록시로 POST { task, payload } 후 텍스트 스트림 수신.
//
//   지원 task: 'coach'(운동 코치 챗봇) · 'routine'(목표→맞춤 루틴) · 'summary'(세션 요약/피드백).
//
//   ⚠️ 모든 산출물은 "일반적인 운동 가이드이며 의학적 조언이 아님". 통증·질환 시 전문의 상담.
//   ⚠️ 이 파일은 API 키를 절대 다루지 않습니다. 실제 Claude 호출은 server/ 프록시 전용.

import { AI_ENDPOINT } from './config.js';

const DISCLAIMER = '※ 일반적인 운동 가이드이며 의학적 조언이 아닙니다. 통증·질환·부상이 있으면 전문의와 상담하세요.';

/**
 * AI 호출. onToken 이 주어지면 토큰을 순차적으로 흘려보냅니다(스트리밍 UX).
 * @param {'coach'|'routine'|'summary'} task
 * @param {object} payload  화면에서 수집한 입력 + 재사용할 트레이너/루틴 데이터
 * @param {{onToken?: (chunk: string) => void}} [opts]
 * @returns {Promise<{text: string, provider: 'mock'|'server', task: string}>}
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  if (AI_ENDPOINT) {
    try {
      return await serverProvider(task, payload, onToken);
    } catch (err) {
      // 이미 서버 토큰을 일부 흘려보낸 경우: 중복 방지를 위해 부분 결과 반환
      if (err && err.streamed) {
        return { text: err.partial || '', provider: 'server', task, error: String(err.message || err) };
      }
      // 무인(never-breaks) 원칙: 서버 실패 / 429 {fallback:true} / 네트워크 오류
      //   → mock 으로 자동 폴백해 앱이 절대 멈추지 않게 함
      const text = mockProvider(task, payload);
      if (onToken) await streamChunks(text, onToken);
      return { text, provider: 'mock', task, fallback: true };
    }
  }
  const text = mockProvider(task, payload);
  if (onToken) await streamChunks(text, onToken);
  return { text, provider: 'mock', task };
}

// ---------------------------------------------------------------------------
// 실제 백엔드 프록시(스트리밍) — 키는 서버에만 존재
//   실패/429{fallback:true} 는 예외로 던져 askAI 가 mock 으로 폴백하게 함.
// ---------------------------------------------------------------------------
async function serverProvider(task, payload, onToken) {
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task, payload }),
  });
  if (!res.ok) {
    // 429 {fallback:true}(비용 예산/레이트리밋) 또는 기타 오류 → 폴백 트리거
    let fallback = res.status === 429;
    try {
      const j = await res.clone().json();
      if (j && j.fallback) fallback = true;
    } catch { /* JSON 아님 — 무시 */ }
    const msg = await res.text().catch(() => '');
    const e = new Error(`AI 서버 오류 ${res.status}: ${String(msg).slice(0, 200)}`);
    e.fallback = fallback; // askAI 는 streamed 가 아니면 항상 mock 폴백
    throw e;
  }
  // 서버는 text/plain 청크로 델타를 흘려보냄
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        text += chunk;
        if (onToken && chunk) onToken(chunk);
      }
    } catch (err) {
      // 스트리밍 도중 끊김: 이미 출력한 부분은 유지(중복 폴백 금지)
      const e = new Error(String(err?.message || err));
      e.streamed = true; e.partial = text;
      throw e;
    }
    return { text, provider: 'server', task };
  }
  const text = await res.text();
  if (onToken && text) onToken(text);
  return { text, provider: 'server', task };
}

// ---------------------------------------------------------------------------
// MockProvider — 결정론적 한국어. 앱 데이터(payload)를 그대로 재사용.
// ---------------------------------------------------------------------------
function mockProvider(task, payload) {
  switch (task) {
    case 'coach': return mockCoach(payload);
    case 'routine': return mockRoutine(payload);
    case 'summary': return mockSummary(payload);
    case 'digest': return mockDigest(payload);
    default: return `지원하지 않는 요청(task=${task})입니다.\n\n${DISCLAIMER}`;
  }
}

/** (4) 무인 자동 브리핑 — 앱 접속 시 "오늘의 추천 트레이너 + 맞춤 루틴"(오프라인 mock). */
function mockDigest(p = {}) {
  const goal = (p.goal || '전반적 건강').trim();
  const level = (p.level || '초급').trim();
  const minutes = Number(p.minutes) || 30;
  const trainers = Array.isArray(p.trainers) ? p.trainers : [];

  const lines = [];
  lines.push(`☀️ 오늘의 브리핑 — 목표: ${goal} · ${level} · ${minutes}분`);

  // 오늘의 추천 트레이너(coach 랭킹 재사용, 상위 2명)
  const coach = mockCoach({ goal, level, trainers });
  const recBlock = coach.split('■ 추천 트레이너')[1];
  lines.push('');
  lines.push('■ 오늘의 추천 트레이너');
  if (recBlock) {
    recBlock.split('\n').map((s) => s.trim()).filter((s) => /^\d\./.test(s)).slice(0, 2)
      .forEach((s) => lines.push(`• ${s}`));
  } else {
    lines.push('• “트레이너 탐색” 탭에서 목표에 맞는 트레이너를 확인하세요.');
  }

  // 오늘의 맞춤 루틴(routine 재사용, 메인 동작 상위 3개만 요약)
  const routine = mockRoutine({ goal, level, minutes, routines: p.routines });
  const mains = routine.split('\n').filter((s) => /^\s{3}\d+\./.test(s)).slice(0, 3);
  lines.push('');
  lines.push('■ 오늘의 맞춤 루틴');
  if (mains.length) mains.forEach((s) => lines.push(`•${s.replace(/^\s+\d+\./, '')}`));
  else lines.push('• 워밍업 5분 · 스쿼트/푸시업/플랭크 각 3세트 · 마무리 스트레칭 5분');

  lines.push('');
  lines.push('“🤖 AI 코치” 탭에서 목표를 바꿔 더 자세한 코칭과 루틴을 받아보세요.');
  lines.push('');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

/** (1) AI 운동 코치 챗봇 — 목표/부상 → 조언 + 트레이너 추천. */
function mockCoach(p = {}) {
  const goal = (p.goal || '전반적 건강').trim();
  const injuries = (p.injuries || '').trim();
  const level = (p.level || '초급').trim();
  const message = (p.message || '').trim();
  const trainers = Array.isArray(p.trainers) ? p.trainers : [];

  const goalMap = {
    다이어트: ['다이어트', '홈트기초', '코어'],
    근력강화: ['근력강화', '바디프로필'],
    자세교정: ['자세교정', '체형교정', '필라테스'],
    재활: ['재활', '자세교정'],
    바디프로필: ['바디프로필', '근력강화'],
    코어강화: ['코어', '필라테스'],
    산전산후: ['산전산후', '코어'],
    시니어건강: ['시니어', '재활'],
  };
  const wanted = goalMap[goal] || ['홈트기초'];

  // 목표 매칭 + 평점/경력 품질 가중으로 상위 트레이너 산출(결정론적)
  const ranked = trainers
    .map((t) => {
      const hit = (t.specialties || []).filter((s) => wanted.includes(s));
      const score = hit.length * 30 + (t.rating || 0) * 4 + Math.min(t.experienceYears || 0, 10);
      return { t, score, hit };
    })
    .sort((a, b) => b.score - a.score || (b.t.rating || 0) - (a.t.rating || 0))
    .slice(0, 3);

  const lines = [];
  lines.push(`🎯 목표: ${goal} · 운동 수준: ${level}`);
  if (message) lines.push(`💬 질문: ${message}`);
  lines.push('');
  lines.push('■ 코치 조언');
  for (const tip of coachTips(goal, level)) lines.push(`• ${tip}`);

  if (injuries) {
    lines.push('');
    lines.push(`■ 부상/주의(${injuries}) 관련`);
    for (const c of injuryCautions(injuries)) lines.push(`• ${c}`);
  }

  if (ranked.length) {
    lines.push('');
    lines.push('■ 추천 트레이너');
    ranked.forEach((r, i) => {
      const why = r.hit.length ? `${r.hit.join('·')} 전문` : '평점·경력 우수';
      lines.push(`${i + 1}. ${r.t.name} (★${(r.t.rating || 0).toFixed(1)}, 경력 ${r.t.experienceYears || 0}년) — ${why}`);
    });
    lines.push('“트레이너 탐색” 탭에서 프로필을 확인하고 예약할 수 있습니다.');
  }

  lines.push('');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

function coachTips(goal, level) {
  const base = {
    다이어트: ['주 3~4회, 전신 서킷 + 가벼운 유산소를 20~30분부터 시작하세요.', '식사는 단백질을 매 끼 손바닥 크기로 챙기고 급격한 단식은 피하세요.', '주당 체중 0.5~0.7kg 감량을 넘지 않는 완만한 목표가 지속에 유리합니다.'],
    근력강화: ['대근육 복합운동(스쿼트·힌지·프레스·로우) 위주로 주 3회 구성하세요.', '점진적 과부하: 무게 또는 반복을 매주 조금씩 늘리세요.', '세트 사이 60~90초 휴식으로 자세 유지에 집중하세요.'],
    자세교정: ['장시간 앉은 뒤에는 흉추 폄·견갑 후인 동작으로 자주 풀어주세요.', '월엔젤·페이스풀·YTW 로 약해진 등 근육을 활성화하세요.', '통증이 아닌 뻐근함 범위 내에서만 스트레칭하세요.'],
    바디프로필: ['근력 자극 + 유산소 균형과 함께 수면·수분을 우선 관리하세요.', '촬영 4주 전부터 컨디셔닝, 마지막 주 급격한 수분 제한은 피하세요.', '무리한 초저칼로리보다 소폭 적자 + 단백질 유지가 안전합니다.'],
  };
  const tips = base[goal] || ['본인 수준에 맞는 강도로 주 3회부터 꾸준함을 우선하세요.', '워밍업 5분 · 마무리 스트레칭 5분을 반드시 포함하세요.', '통증이 있으면 즉시 중단하고 무리하지 마세요.'];
  if (level === '초급') tips.push('처음 2주는 동작 습득과 습관 형성에 집중하고 강도는 낮게 유지하세요.');
  if (level === '고급') tips.push('주기화(강·약 주)를 도입해 정체기를 넘기고 회복 주를 배치하세요.');
  return tips;
}

function injuryCautions(injuries) {
  const s = injuries.toLowerCase();
  const out = [];
  if (/무릎|knee/.test(s)) out.push('무릎: 깊은 스쿼트·점프 착지를 피하고, 벽 스쿼트·글루트 브릿지로 대체하세요.');
  if (/허리|요추|back|lumbar/.test(s)) out.push('허리: 굿모닝·무거운 데드리프트를 피하고 코어 안정화(데드버그·버드독)부터 하세요.');
  if (/어깨|shoulder/.test(s)) out.push('어깨: 통증 유발 각도(과도한 오버헤드)를 피하고 회전근개 강화부터 진행하세요.');
  if (/손목|wrist/.test(s)) out.push('손목: 푸시업은 주먹/패러렛으로, 플랭크는 전완 플랭크로 대체하세요.');
  if (/발목|ankle/.test(s)) out.push('발목: 점프·런지를 줄이고 밴드 발목 강화·균형 운동으로 보강하세요.');
  if (!out.length) out.push(`"${injuries}" 부위는 통증 없는 가동범위에서만, 낮은 강도로 진행하고 악화 시 중단하세요.`);
  out.push('부상이 지속되면 전문의·물리치료사 진단을 먼저 받으세요.');
  return out;
}

/** (2) 목표 → 맞춤 루틴 생성. */
function mockRoutine(p = {}) {
  const goal = (p.goal || '다이어트').trim();
  const level = (p.level || '초급').trim();
  const minutes = Number(p.minutes) || 30;
  const routines = Array.isArray(p.routines) ? p.routines : [];

  const goalToRoutine = {
    다이어트: 'r-fatburn', 근력강화: 'r-strength', 자세교정: 'r-posture',
    코어강화: 'r-core', 코어: 'r-core', 시니어건강: 'r-senior', 시니어: 'r-senior', 바디프로필: 'r-profile',
  };
  const base = routines.find((r) => r.id === goalToRoutine[goal])
    || routines.find((r) => r.goal === goal)
    || routines[0];

  const lines = [];
  lines.push(`■ ${goal} 맞춤 루틴 (${level} · 약 ${minutes}분)`);
  lines.push('');
  lines.push('1) 워밍업 (5분): 관절 가동 + 심박 올리기');

  const scale = { 초급: 0.85, 중급: 1, 고급: 1.2 }[level] || 1;
  if (base && Array.isArray(base.exercises)) {
    lines.push(`2) 메인 (${Math.max(15, minutes - 10)}분) — 기준 루틴: ${base.name}`);
    base.exercises
      .filter((e) => !/워밍업|스트레칭|호흡/.test(e.name))
      .forEach((e, i) => {
        const sets = Math.max(1, Math.round((e.sets || 3) * scale));
        lines.push(`   ${i + 1}. ${e.name} — ${sets}세트 × ${e.reps} (휴식 ${e.rest || 40}초)  💡 ${e.cue || ''}`.trimEnd());
      });
  } else {
    lines.push('2) 메인: 스쿼트 · 푸시업 · 로우 · 플랭크 (각 3세트)');
  }
  lines.push('3) 마무리 (5분): 정적 스트레칭 + 호흡 정리');
  lines.push('');
  lines.push(`권장 빈도: 주 ${level === '고급' ? 4 : 3}회 · 세트 간 휴식은 호흡이 회복될 때까지.`);
  lines.push('');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

/** (3) 세션 요약/피드백 생성. */
function mockSummary(p = {}) {
  const trainerName = p.trainerName || '트레이너';
  const routineName = p.routineName || '자유 세션';
  const minutes = Number(p.minutes) || 0;
  const done = Number(p.done) || 0;
  const total = Number(p.total) || 0;
  const rate = total ? Math.round((done / total) * 100) : (Number(p.completionRate) || 0);
  const rating = Number(p.rating) || 0;
  const note = (p.feedback || '').trim();

  let verdict;
  if (rate >= 90) verdict = '거의 완벽하게 마쳤습니다. 훌륭한 집중력이었어요!';
  else if (rate >= 60) verdict = '핵심 동작을 충실히 소화했습니다. 다음엔 남은 동작까지 노려봐요.';
  else if (rate > 0) verdict = '시작이 반입니다. 완료 동작을 조금씩 늘려가면 됩니다.';
  else verdict = '오늘은 워밍업만으로도 의미가 있었습니다. 다음 세션에서 이어가요.';

  const lines = [];
  lines.push(`■ ${routineName} 세션 요약 (${trainerName})`);
  lines.push(`• 운동 시간: ${minutes}분`);
  lines.push(`• 완료 동작: ${done}${total ? ` / ${total}` : ''}개 (달성률 ${rate}%)`);
  if (rating) lines.push(`• 만족도: ${'★'.repeat(Math.max(0, Math.min(5, rating)))}`);
  lines.push('');
  lines.push('■ 코치 피드백');
  lines.push(`• ${verdict}`);
  if (note) lines.push(`• 메모 반영: "${note}" — 다음 세션에서 이 부분을 우선 점검하겠습니다.`);
  lines.push(`• 다음 목표: 달성률 ${Math.min(100, rate + 10)}% 또는 세트당 1~2회 추가에 도전해 보세요.`);
  lines.push('• 세션 후 10분 스트레칭과 충분한 수분·단백질 섭취로 회복을 도우세요.');
  lines.push('');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 스트리밍 유틸 — mock 응답을 토큰 단위로 흘려보내 실제 스트림 UX 재현
// ---------------------------------------------------------------------------
async function streamChunks(text, onToken) {
  // 공백/개행 경계를 유지하며 조각내기(한국어에서도 자연스럽게)
  const tokens = text.match(/\S+\s*|\s+/g) || [text];
  for (const tk of tokens) {
    onToken(tk);
    await sleep(8);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
