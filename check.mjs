// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — CI 검증 스크립트
//   1) 모든 JSON 파싱
//   2) 모든 JS 를 `node --check` 로 구문 검사
//   3) index.html 필수 컨테이너 존재 확인
//   4) pt-engine 단위 테스트 (이용권 차감 / 예약 / 취소 환불 / 진행상황 / 추천)
// 실패 시 프로세스 종료코드 1.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  purchasePass, consumeCredit, refundCredit, totalRemaining,
  createBooking, cancelBooking, completeBooking, hasConflict,
  computeProgress, computeStreak, recommendTrainers, filterTrainers,
  generateSlots, buildSessionSummary,
} from './pt-engine.js';
import { AI_ENDPOINT } from './ai/config.js';
import { askAI } from './ai/ai.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(name, threw, '예외가 발생해야 함');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', '.github'].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const files = walk(ROOT);

// ---------------------------------------------------------------------------
console.log('\n[1] JSON 파싱');
let trainers = []; let plans = []; let routines = [];
for (const f of files.filter((x) => x.endsWith('.json'))) {
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    ok(`parse ${rel(f)}`, true);
    if (f.endsWith('trainers.json')) trainers = data.trainers;
    if (f.endsWith('routines.json')) { plans = data.plans; routines = data.routines; }
  } catch (err) { ok(`parse ${rel(f)}`, false, err.message); }
}
ok('트레이너 12명 이상', trainers.length >= 12, `실제 ${trainers.length}`);
ok('루틴 데이터 존재', routines.length >= 4, `실제 ${routines.length}`);
ok('이용권 플랜 존재', plans.length >= 3, `실제 ${plans.length}`);
ok('트레이너 필수 필드', trainers.every((t) => t.id && t.name && t.specialties && t.pricePerSession && t.rating != null && t.availableDays && t.availableTimes));

// ---------------------------------------------------------------------------
console.log('\n[2] JS 구문 검사 (node --check)');
for (const f of files.filter((x) => x.endsWith('.js') || x.endsWith('.mjs'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); ok(`node --check ${rel(f)}`, true); }
  catch (err) { ok(`node --check ${rel(f)}`, false, String(err.stderr || err).slice(0, 120)); }
}

// ---------------------------------------------------------------------------
console.log('\n[3] index.html 필수 컨테이너');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const id of ['app', 'trainer-grid', 'plan-grid', 'my-passes', 'bookings-view',
  'progress-view', 'session-room', 'survey-form', 'credit-count', 'toast',
  'view-ai', 'ai-chat-output', 'ai-routine-output']) {
  ok(`#${id} 존재`, html.includes(`id="${id}"`));
}
ok('module 스크립트 로드', html.includes('type="module"') && html.includes('app.js'));
ok('DEMO 경계 문구', html.includes('시뮬레이션') && html.includes('localStorage'));
ok('SPDX 헤더', html.includes('SPDX-License-Identifier: Apache-2.0'));

// ---------------------------------------------------------------------------
console.log('\n[4] pt-engine 단위 테스트');

// (a) 구매 → 남은 횟수
const p4 = purchasePass(plans, 'plan-4');
eq('4회권 구매 시 remaining=4', p4.remaining, 4);
eq('구매 후 총 잔여 4', totalRemaining([p4]), 4);
throws('없는 상품 구매 → 예외', () => purchasePass(plans, 'nope'));

// (b) 차감 로직 (핵심)
let passes = [purchasePass(plans, 'plan-1'), purchasePass(plans, 'plan-4')];
passes[0].purchasedAt = 1000; passes[1].purchasedAt = 2000; // 오래된 것 우선 소진 확인
const c1 = consumeCredit(passes);
eq('차감 후 총 잔여 4 (5→4)', totalRemaining(c1.passes), 4);
eq('가장 오래된 1회권이 소진됨', c1.passes.find((p) => p.id === passes[0].id).remaining, 0);
eq('소진된 passId 반환', c1.passId, passes[0].id);
// 잔여 0에서 차감 → 예외
throws('잔여 0에서 차감 → 예외', () => consumeCredit([{ id: 'x', remaining: 0, sessions: 1, purchasedAt: 1 }]));

// (c) 환불
const refunded = refundCredit(c1.passes, c1.passId);
eq('환불 후 총 잔여 5', totalRemaining(refunded), 5);
const overRefund = refundCredit([{ id: 'z', remaining: 2, sessions: 2, purchasedAt: 1 }], 'z');
eq('환불은 sessions 초과 불가', overRefund[0].remaining, 2);

// (d) 예약 생성 + 충돌
let st = { passes: [purchasePass(plans, 'plan-4')], bookings: [], logs: [], reviews: [] };
const b1 = createBooking(st, { trainerId: 't-mina', trainerName: '김미나', date: '2026-10-01', time: '07:00' });
st.passes = b1.passes; st.bookings = b1.bookings;
eq('예약 생성 시 1회 차감 (4→3)', totalRemaining(st.passes), 3);
eq('예약 1건 생성', st.bookings.length, 1);
eq('예약 상태 confirmed', st.bookings[0].status, 'confirmed');
ok('같은 시간 충돌 감지', hasConflict(st.bookings, '2026-10-01', '07:00'));
ok('다른 시간 충돌 아님', !hasConflict(st.bookings, '2026-10-01', '08:00'));
throws('동일 시간 재예약 → 예외', () => createBooking(st, { trainerId: 't-mina', trainerName: '김미나', date: '2026-10-01', time: '07:00' }));

// 잔여 없을 때 예약 → 예외
const empty = { passes: [], bookings: [], logs: [] };
throws('잔여 0에서 예약 → 예외', () => createBooking(empty, { trainerId: 't', trainerName: 'x', date: '2026-10-02', time: '09:00' }));

// (e) 취소 → 환불
const cancel = cancelBooking(st, st.bookings[0].id);
st.bookings = cancel.bookings; st.passes = cancel.passes;
eq('취소 시 상태 cancelled', st.bookings[0].status, 'cancelled');
eq('취소 시 횟수 환불 (3→4)', totalRemaining(st.passes), 4);
throws('취소된 예약 재취소 → 예외', () => cancelBooking(st, st.bookings[0].id));

// (f) 완료 처리 + 진행상황
let st2 = { passes: [purchasePass(plans, 'plan-12')], bookings: [], logs: [] };
const bb = createBooking(st2, { trainerId: 't-mina', trainerName: '김미나', date: '2026-09-10', time: '07:00' });
st2.passes = bb.passes; st2.bookings = bb.bookings;
st2.bookings = completeBooking(st2.bookings, bb.booking.id);
eq('완료 처리', st2.bookings[0].status, 'completed');
st2.logs = [{ id: 'l1', bookingId: bb.booking.id, trainerId: 't-mina', date: '2026-09-10', durationSec: 1800, routineId: 'r-fatburn', completedExercises: [0, 1, 2], rating: 5 }];
const prog = computeProgress(st2.bookings, st2.logs);
eq('완료 세션 1건 집계', prog.attended, 1);
eq('총 운동 30분 집계', prog.totalMinutes, 30);

// (g) 스트릭
eq('빈 완료 → 스트릭 0', computeStreak([]), 0);
const streakBookings = [
  { status: 'completed', date: '2026-09-07' },
  { status: 'completed', date: '2026-09-14' },
  { status: 'completed', date: '2026-09-21' },
];
eq('3주 연속 → 스트릭 3', computeStreak(streakBookings), 3);

// (h) 추천 엔진
const rec = recommendTrainers({ goal: '다이어트', gender: 'female', focus: ['홈트기초'], budget: 40000 }, trainers);
ok('추천 결과 존재', rec.length === trainers.length);
ok('다이어트 목표 → 상위 트레이너가 다이어트 전문', rec[0].specialties.some((s) => ['다이어트', '홈트기초'].includes(s)));
ok('추천 점수 내림차순', rec.every((t, i) => i === 0 || rec[i - 1].matchScore >= t.matchScore));
ok('매칭 사유 포함', Array.isArray(rec[0].matchReasons));

// (i) 필터
const filtered = filterTrainers(trainers, { gender: 'female', sort: 'priceAsc' });
ok('여성 필터', filtered.every((t) => t.gender === 'female'));
ok('가격 오름차순 정렬', filtered.every((t, i) => i === 0 || filtered[i - 1].pricePerSession <= t.pricePerSession));
const priceFilter = filterTrainers(trainers, { maxPrice: 35000 });
ok('가격 상한 필터', priceFilter.every((t) => t.pricePerSession <= 35000));

// (j) 슬롯 생성
const t0 = trainers[0];
const slots = generateSlots(t0, [], new Date('2026-09-14'), 14);
ok('슬롯 생성됨', slots.length > 0);
ok('슬롯 요일이 가용요일 내', slots.every((s) => t0.availableDays.includes(s.weekday)));

// (k) 세션 요약
const summary = buildSessionSummary(
  { durationSec: 1500, completedExercises: [0, 1, 2], rating: 4, feedback: '좋았어요' },
  routines.find((r) => r.id === 'r-fatburn'),
);
eq('요약 분 계산', summary.minutes, 25);
eq('요약 완료수', summary.done, 3);
ok('요약 달성률 계산', summary.completionRate > 0 && summary.completionRate <= 100);

// ---------------------------------------------------------------------------
console.log('\n[5] AI 레이어 검증 (ai/ + server/)');

// (a) ai/ + server/ 파일 node --check (Cloudflare Worker 포함)
for (const f of ['ai/config.js', 'ai/ai.js', 'server/index.mjs', 'server/worker.js']) {
  const abs = join(ROOT, f);
  try { execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' }); ok(`node --check ${f}`, true); }
  catch (err) { ok(`node --check ${f}`, false, String(err.stderr || err).slice(0, 120)); }
}

// (b) 데모 기본값: AI_ENDPOINT 는 반드시 빈 문자열(브라우저에 실 엔드포인트/키 미노출)
eq('AI_ENDPOINT 빈 문자열(데모=mock)', AI_ENDPOINT, '');

// (c) 실제 API 키 형식이 어디에도 포함되지 않아야 함 (문자열 결합으로 자기 자신 매칭 회피)
const KEY_RE = new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}');
let leak = null;
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  if (KEY_RE.test(content)) { leak = rel(f); break; }
}
ok('실제 API 키 형식 미포함', !leak, leak ? `발견: ${leak}` : '');

// (d) MockProvider 결정론적 한국어 응답(세 가지 task)
const aiCoach = await askAI('coach', { goal: '다이어트', level: '초급', injuries: '무릎', trainers });
ok('coach mock 응답(mock provider)', aiCoach.provider === 'mock' && aiCoach.text.includes('추천 트레이너'));
ok('coach mock 의학 조언 아님 고지', aiCoach.text.includes('의학적 조언이 아닙니다'));
const aiRoutine = await askAI('routine', { goal: '근력강화', level: '중급', minutes: 45, routines });
ok('routine mock 응답', aiRoutine.provider === 'mock' && aiRoutine.text.includes('맞춤 루틴'));
const aiSummary = await askAI('summary', { trainerName: '김미나', routineName: '홈 지방연소 서킷', minutes: 25, done: 3, total: 6, rating: 4 });
ok('summary mock 응답', aiSummary.provider === 'mock' && aiSummary.text.includes('세션 요약'));

// (e) 무인 자동 브리핑(digest) — 오늘의 추천 트레이너 + 맞춤 루틴 (mock/오프라인 동작)
const aiDigest = await askAI('digest', { goal: '다이어트', level: '초급', minutes: 30, trainers, routines });
ok('digest mock 응답(오늘의 브리핑)', aiDigest.provider === 'mock' && aiDigest.text.includes('오늘의 추천 트레이너') && aiDigest.text.includes('오늘의 맞춤 루틴'));
ok('digest 의학 조언 아님 고지', aiDigest.text.includes('의학적 조언이 아닙니다'));

// ---------------------------------------------------------------------------
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail) { console.error('\n실패 항목:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('모든 검증 통과 ✓');
