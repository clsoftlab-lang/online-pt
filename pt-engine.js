// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// pt-engine.js — 순수(DOM 비의존) 도메인 로직.
//   이용권 구매/차감, 예약 충돌·생성·취소, 진행상황 집계,
//   설문 기반 트레이너 추천, 필터/정렬, 세션 요약.
// app.js 와 check.mjs 가 함께 import 하므로 브라우저 API 를 쓰지 않는다.

/** 안전한 uid (crypto 있으면 사용, 없으면 시간+난수). */
export function uid(prefix = 'id') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

/** 남은 총 횟수. */
export function totalRemaining(passes = []) {
  return passes.reduce((sum, p) => sum + Math.max(0, p.remaining | 0), 0);
}

/** 이용권 구매 → 새 pass 객체 반환(모의 결제). 상태를 변형하지 않음. */
export function purchasePass(plans, planId, now = Date.now()) {
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new Error(`알 수 없는 상품: ${planId}`);
  return {
    id: uid('pass'),
    planId: plan.id,
    planName: plan.name,
    sessions: plan.sessions,
    remaining: plan.sessions,
    price: plan.price,
    purchasedAt: now,
  };
}

/**
 * 사용 가능한(remaining>0) 가장 오래된 이용권에서 1회 차감.
 * @returns {{passes: Array, passId: string}} 새 passes 배열 + 사용된 pass id
 * @throws 남은 횟수가 없으면 에러.
 */
export function consumeCredit(passes = []) {
  const candidates = passes
    .filter((p) => (p.remaining | 0) > 0)
    .sort((a, b) => a.purchasedAt - b.purchasedAt);
  if (candidates.length === 0) throw new Error('남은 PT 횟수가 없습니다. 이용권을 먼저 구매하세요.');
  const target = candidates[0];
  const next = passes.map((p) => (p.id === target.id ? { ...p, remaining: p.remaining - 1 } : p));
  return { passes: next, passId: target.id };
}

/** 특정 pass 로 1회 환불(취소 시). remaining 이 sessions 를 넘지 않도록 clamp. */
export function refundCredit(passes = [], passId) {
  return passes.map((p) => (p.id === passId
    ? { ...p, remaining: Math.min(p.sessions, p.remaining + 1) }
    : p));
}

/** 같은 날짜+시간에 confirmed 예약이 이미 있는지. */
export function hasConflict(bookings = [], date, time, ignoreId = null) {
  return bookings.some((b) => b.id !== ignoreId
    && b.status === 'confirmed'
    && b.date === date
    && b.time === time);
}

/**
 * 예약 생성: 횟수 차감 + 충돌 검사.
 * @returns {{bookings, passes, booking}}
 * @throws 충돌 또는 잔여 횟수 부족 시.
 */
export function createBooking(state, { trainerId, trainerName, date, time }, now = Date.now()) {
  if (!date || !time) throw new Error('날짜와 시간을 선택하세요.');
  if (hasConflict(state.bookings, date, time)) {
    throw new Error('이미 같은 시간에 예약이 있습니다.');
  }
  const { passes, passId } = consumeCredit(state.passes);
  const booking = {
    id: uid('bk'),
    trainerId,
    trainerName,
    date,
    time,
    status: 'confirmed',
    passId,
    createdAt: now,
  };
  return { bookings: [...state.bookings, booking], passes, booking };
}

/** 예약 취소: 상태를 cancelled 로 바꾸고 해당 pass 에 1회 환불. */
export function cancelBooking(state, bookingId) {
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error('예약을 찾을 수 없습니다.');
  if (booking.status !== 'confirmed') throw new Error('확정 상태의 예약만 취소할 수 있습니다.');
  const bookings = state.bookings.map((b) => (b.id === bookingId ? { ...b, status: 'cancelled' } : b));
  const passes = refundCredit(state.passes, booking.passId);
  return { bookings, passes };
}

/** 예약 완료 처리(세션 종료 후). */
export function completeBooking(bookings = [], bookingId) {
  return bookings.map((b) => (b.id === bookingId && b.status === 'confirmed'
    ? { ...b, status: 'completed' }
    : b));
}

/** ISO 날짜 문자열(YYYY-MM-DD)간 일수 차이. */
function daysBetween(a, b) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

/**
 * 진행상황 집계.
 * @returns {{attended, upcoming, cancelled, totalMinutes, streak, weekly}}
 */
export function computeProgress(bookings = [], logs = []) {
  const attended = bookings.filter((b) => b.status === 'completed').length;
  const upcoming = bookings.filter((b) => b.status === 'confirmed').length;
  const cancelled = bookings.filter((b) => b.status === 'cancelled').length;
  const totalMinutes = logs.reduce((s, l) => s + Math.round((l.durationSec || 0) / 60), 0);

  // 주간 완료 건수(최근 8주) — 그래프용
  const now = new Date();
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const weekAgo = 7 - i; // 0 = 이번 주
    return { label: `${weekAgo === 0 ? '이번주' : weekAgo + '주전'}`, count: 0 };
  });
  const completed = bookings.filter((b) => b.status === 'completed');
  for (const b of completed) {
    const diff = daysBetween(now.toISOString().slice(0, 10), b.date);
    const weekIdx = 7 - Math.floor(Math.max(0, diff) / 7);
    if (weekIdx >= 0 && weekIdx < 8) weekly[weekIdx].count += 1;
  }

  // 연속 출석(streak): 완료 예약을 날짜별로 묶어, 최근 완료일 기준 연속 활동 주 수
  const streak = computeStreak(completed);
  return { attended, upcoming, cancelled, totalMinutes, streak, weekly };
}

/** 완료 예약 기준 연속 주 스트릭. */
export function computeStreak(completed = []) {
  if (completed.length === 0) return 0;
  const weeks = new Set(completed.map((b) => isoWeek(b.date)));
  const sorted = [...weeks].sort();
  let best = 1; let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (weekDistance(sorted[i - 1], sorted[i]) === 1) { cur += 1; best = Math.max(best, cur); }
    else cur = 1;
  }
  return best;
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10); // 그 주 월요일
}
function weekDistance(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (7 * 86400000));
}

/**
 * 설문(survey) 기반 트레이너 추천 점수.
 * survey: { goal, level, gender('any'|...), focus:[], budget }
 * @returns 점수 내림차순 정렬된 [{...trainer, matchScore, matchReasons}]
 */
export function recommendTrainers(survey = {}, trainers = []) {
  const goalToSpecialty = {
    다이어트: ['다이어트', '홈트기초'],
    근력강화: ['근력강화', '바디프로필'],
    자세교정: ['자세교정', '체형교정', '필라테스'],
    재활: ['재활', '자세교정'],
    바디프로필: ['바디프로필', '근력강화'],
    코어강화: ['코어', '필라테스'],
    산전산후: ['산전산후', '코어'],
    시니어건강: ['시니어', '재활'],
  };
  const wanted = goalToSpecialty[survey.goal] || [];
  return trainers
    .map((t) => {
      let score = 0;
      const reasons = [];
      const hit = t.specialties.filter((s) => wanted.includes(s));
      if (hit.length) { score += hit.length * 30; reasons.push(`${survey.goal} 전문 (${hit.join(', ')})`); }
      if (survey.gender && survey.gender !== 'any' && t.gender === survey.gender) {
        score += 10; reasons.push('선호 성별 일치');
      }
      if (Array.isArray(survey.focus)) {
        const f = t.specialties.filter((s) => survey.focus.includes(s));
        if (f.length) { score += f.length * 8; reasons.push(`관심 부위 (${f.join(', ')})`); }
      }
      if (survey.budget && t.pricePerSession <= survey.budget) {
        score += 12; reasons.push('예산 이내');
      }
      // 평점·경력 가중(품질 보정)
      score += t.rating * 4 + Math.min(t.experienceYears, 10);
      return { ...t, matchScore: Math.round(score), matchReasons: reasons };
    })
    .sort((a, b) => b.matchScore - a.matchScore || b.rating - a.rating);
}

/**
 * 트레이너 목록 필터 + 정렬.
 * filters: { q, specialty, gender, maxPrice, minRating, sort }
 */
export function filterTrainers(trainers = [], filters = {}) {
  const q = (filters.q || '').trim().toLowerCase();
  let out = trainers.filter((t) => {
    if (filters.specialty && filters.specialty !== 'all' && !t.specialties.includes(filters.specialty)) return false;
    if (filters.gender && filters.gender !== 'all' && t.gender !== filters.gender) return false;
    if (filters.maxPrice && t.pricePerSession > filters.maxPrice) return false;
    if (filters.minRating && t.rating < filters.minRating) return false;
    if (q) {
      const hay = `${t.name} ${t.specialties.join(' ')} ${t.intro}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sort = filters.sort || 'rating';
  const cmp = {
    rating: (a, b) => b.rating - a.rating,
    priceAsc: (a, b) => a.pricePerSession - b.pricePerSession,
    priceDesc: (a, b) => b.pricePerSession - a.pricePerSession,
    reviews: (a, b) => b.reviewCount - a.reviewCount,
    experience: (a, b) => b.experienceYears - a.experienceYears,
  }[sort] || ((a, b) => b.rating - a.rating);
  return out.sort(cmp);
}

/**
 * 다음 N일 간 예약 가능한 슬롯 생성(트레이너 요일/시간 + 기존 예약 제외).
 * @returns [{date, weekday, times:[{time, taken}]}]
 */
export function generateSlots(trainer, bookings = [], fromDate = new Date(), days = 14) {
  const out = [];
  const taken = new Set(bookings
    .filter((b) => b.status === 'confirmed' && b.trainerId === trainer.id)
    .map((b) => `${b.date} ${b.time}`));
  for (let i = 0; i < days; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    const weekday = d.getDay();
    if (!trainer.availableDays.includes(weekday)) continue;
    const date = d.toISOString().slice(0, 10);
    const times = trainer.availableTimes
      .slice()
      .sort()
      .map((time) => ({ time, taken: taken.has(`${date} ${time}`) }));
    out.push({ date, weekday, times });
  }
  return out;
}

/** 세션 요약 생성(세션 종료 후). */
export function buildSessionSummary(log, routine) {
  const total = routine ? routine.exercises.length : 0;
  const done = (log.completedExercises || []).length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  const minutes = Math.round((log.durationSec || 0) / 60);
  return {
    minutes,
    done,
    total,
    completionRate: rate,
    rating: log.rating || 0,
    feedback: log.feedback || '',
    routineName: routine ? routine.name : '자유 세션',
  };
}

/** 통화 포맷(원). */
export function won(n) {
  return `${(n | 0).toLocaleString('ko-KR')}원`;
}
