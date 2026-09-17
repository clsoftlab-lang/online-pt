// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — 화면 렌더링 + 이벤트 배선(오케스트레이션).
// 도메인 로직은 pt-engine.js, 저장은 store.js, 아트는 svg.js 담당.

import * as engine from './pt-engine.js';
import { loadState, saveState, resetState } from './store.js';
import { trainerAvatar, cameraTile, exerciseArt, stars } from './svg.js';
import { askAI } from './ai/ai.js';

const AI_GOALS = ['다이어트', '근력강화', '자세교정', '재활', '바디프로필', '코어강화', '산전산후', '시니어건강'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const { won } = engine;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let state = loadState();
let DATA = { trainers: [], plans: [], routines: [] };
let sessionTimer = null; // 세션 룸 타이머 핸들

// ---------------------------------------------------------------------------
// 부트스트랩
// ---------------------------------------------------------------------------
async function boot() {
  applyTheme(state.theme);
  try {
    const [trainers, routines] = await Promise.all([
      fetch('./data/trainers.json').then((r) => r.json()),
      fetch('./data/routines.json').then((r) => r.json()),
    ]);
    DATA.trainers = trainers.trainers;
    DATA.plans = routines.plans;
    DATA.routines = routines.routines;
  } catch (err) {
    console.error('데이터 로드 실패:', err);
    $('#trainer-grid').innerHTML = '<p class="empty">데이터를 불러오지 못했습니다. 로컬 서버(http.server)로 열어주세요.</p>';
    return;
  }
  wireHeader();
  wireTabs();
  wireFilters();
  wireSurvey();
  wireAi();
  renderAll();
  renderAiDigest(); // 무인 자동 브리핑(오늘의 추천 트레이너 + 맞춤 루틴) — 비차단
}

function persist() { saveState(state); }

function renderAll() {
  renderCredit();
  renderExplore();
  renderPasses();
  renderBookings();
  renderProgress();
}

// ---------------------------------------------------------------------------
// 헤더 / 테마 / 탭
// ---------------------------------------------------------------------------
function wireHeader() {
  $('#theme-toggle').addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.theme = order[state.theme] || 'light';
    applyTheme(state.theme);
    persist();
    toast(`테마: ${({ auto: '자동', light: '라이트', dark: '다크' })[state.theme]}`);
  });
  $('#reset-btn').addEventListener('click', () => {
    if (confirm('모든 데모 데이터(이용권·예약·기록·리뷰)를 초기화할까요?')) {
      state = resetState();
      applyTheme(state.theme);
      renderAll();
      $('#survey-result').innerHTML = '';
      buildSurveyForm();
      toast('초기화 완료');
    }
  });
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function wireTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
}

function switchView(view) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  if (view === 'progress') renderProgress();
  if (view === 'bookings') renderBookings();
  if (view === 'passes') renderPasses();
  if (view === 'survey') buildSurveyForm();
}

function renderCredit() {
  const n = engine.totalRemaining(state.passes);
  $('#credit-count').textContent = n;
  $('#credit-chip').classList.toggle('has-credit', n > 0);
  $('#bookings-count').textContent = state.bookings.filter((b) => b.status === 'confirmed').length;
}

// ---------------------------------------------------------------------------
// 트레이너 탐색
// ---------------------------------------------------------------------------
function wireFilters() {
  const specSel = $('#filter-specialty');
  const specs = [...new Set(DATA.trainers.flatMap((t) => t.specialties))].sort();
  specSel.innerHTML = '<option value="all">전문분야 전체</option>'
    + specs.map((s) => `<option value="${s}">${s}</option>`).join('');
  ['#search', '#filter-specialty', '#filter-gender', '#filter-price', '#filter-rating', '#filter-sort']
    .forEach((sel) => $(sel).addEventListener('input', renderExplore));
}

function currentFilters() {
  return {
    q: $('#search').value,
    specialty: $('#filter-specialty').value,
    gender: $('#filter-gender').value,
    maxPrice: Number($('#filter-price').value) || 0,
    minRating: Number($('#filter-rating').value) || 0,
    sort: $('#filter-sort').value,
  };
}

function renderExplore() {
  const list = engine.filterTrainers(DATA.trainers, currentFilters());
  $('#explore-count').textContent = `${list.length}명의 트레이너`;
  const grid = $('#trainer-grid');
  if (!list.length) { grid.innerHTML = '<p class="empty">조건에 맞는 트레이너가 없습니다.</p>'; return; }
  grid.innerHTML = list.map(trainerCard).join('');
  $$('.trainer-card', grid).forEach((card) => {
    card.addEventListener('click', () => openTrainerDetail(card.dataset.id));
  });
}

function trainerCard(t) {
  return `
  <article class="trainer-card" data-id="${t.id}" tabindex="0" role="button" aria-label="${t.name} 상세 보기">
    <div class="tc-avatar">${trainerAvatar(t, 96)}</div>
    <div class="tc-body">
      <div class="tc-top">
        <h3>${t.name}</h3>
        <span class="gender-tag ${t.gender}">${t.gender === 'female' ? '여성' : '남성'}</span>
      </div>
      <div class="tc-rating">${stars(t.rating)} <b>${t.rating.toFixed(1)}</b> <span class="muted">(${t.reviewCount})</span></div>
      <div class="tc-tags">${t.specialties.map((s) => `<span class="tag">${s}</span>`).join('')}</div>
      <p class="tc-intro">${t.intro}</p>
      <div class="tc-foot">
        <span class="price">${won(t.pricePerSession)}<span class="muted">/회</span></span>
        <span class="muted">경력 ${t.experienceYears}년</span>
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// 트레이너 상세
// ---------------------------------------------------------------------------
function openTrainerDetail(id) {
  const t = DATA.trainers.find((x) => x.id === id);
  if (!t) return;
  const reviews = state.reviews.filter((r) => r.trainerId === id);
  const slots = engine.generateSlots(t, state.bookings).slice(0, 3);
  $('#trainer-detail').innerHTML = `
    <button class="dialog-close" aria-label="닫기">✕</button>
    <div class="detail-head">
      <div class="detail-avatar">${trainerAvatar(t, 140)}</div>
      <div>
        <h2>${t.name} <span class="gender-tag ${t.gender}">${t.gender === 'female' ? '여성' : '남성'}</span></h2>
        <div class="tc-rating">${stars(t.rating)} <b>${t.rating.toFixed(1)}</b> <span class="muted">· 리뷰 ${t.reviewCount + reviews.length}개 · 경력 ${t.experienceYears}년</span></div>
        <div class="tc-tags">${t.specialties.map((s) => `<span class="tag">${s}</span>`).join('')}</div>
        <p class="price big">${won(t.pricePerSession)}<span class="muted">/회</span></p>
      </div>
    </div>
    <p class="detail-intro">${t.intro}</p>
    <h3>자격 · 이력</h3>
    <ul class="certs">${t.certifications.map((c) => `<li>✔ ${c}</li>`).join('')}</ul>
    <h3>예약 가능 시간대</h3>
    <div class="slot-preview">
      ${slots.length ? slots.map((s) => `<div class="slot-day"><b>${fmtDate(s.date)}</b> ${s.times.filter((x) => !x.taken).map((x) => `<span class="slot-mini">${x.time}</span>`).join('') || '<span class="muted">마감</span>'}</div>`).join('') : '<p class="muted">가능 시간이 없습니다.</p>'}
    </div>
    <h3>리뷰</h3>
    <div class="reviews">
      ${reviews.length ? reviews.map(reviewRow).join('') : '<p class="muted">아직 리뷰가 없습니다. 세션 후 첫 리뷰를 남겨보세요!</p>'}
    </div>
    <div class="dialog-actions">
      <button class="btn secondary" data-act="review">리뷰 작성</button>
      <button class="btn primary" data-act="book">이 트레이너로 예약</button>
    </div>`;
  showBackdrop('#detail-backdrop');
  const dlg = $('#trainer-detail');
  $('.dialog-close', dlg).addEventListener('click', () => hideBackdrop('#detail-backdrop'));
  $('[data-act="book"]', dlg).addEventListener('click', () => { hideBackdrop('#detail-backdrop'); openBooking(t.id); });
  $('[data-act="review"]', dlg).addEventListener('click', () => openReviewForm(t.id));
}

function reviewRow(r) {
  return `<div class="review"><div class="review-head">${stars(r.rating)} <span class="muted">${r.author} · ${fmtDate(r.createdAt)}</span></div><p>${escapeHtml(r.text)}</p></div>`;
}

function openReviewForm(trainerId) {
  const dlg = $('#trainer-detail');
  const box = document.createElement('div');
  box.className = 'inline-form';
  box.innerHTML = `
    <h4>리뷰 작성</h4>
    <label class="field"><span>평점</span>
      <select id="rv-rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select>
    </label>
    <label class="field"><span>내용</span><textarea id="rv-text" rows="3" placeholder="세션은 어떠셨나요?"></textarea></label>
    <button class="btn primary" id="rv-submit">등록</button>`;
  dlg.querySelector('.reviews').prepend(box);
  $('#rv-submit', box).addEventListener('click', () => {
    const text = $('#rv-text', box).value.trim();
    if (!text) { toast('내용을 입력하세요.'); return; }
    state.reviews.push({
      id: engine.uid('rv'), trainerId, rating: Number($('#rv-rating', box).value),
      text, author: '나', createdAt: Date.now(),
    });
    persist();
    toast('리뷰가 등록되었습니다.');
    openTrainerDetail(trainerId);
  });
}

// ---------------------------------------------------------------------------
// 예약
// ---------------------------------------------------------------------------
function openBooking(trainerId) {
  const t = DATA.trainers.find((x) => x.id === trainerId);
  if (!t) return;
  const remaining = engine.totalRemaining(state.passes);
  const slots = engine.generateSlots(t, state.bookings);
  $('#booking-dialog').innerHTML = `
    <button class="dialog-close" aria-label="닫기">✕</button>
    <h2>${t.name} 예약</h2>
    <p class="section-note">남은 횟수 <b>${remaining}회</b> · 날짜와 시간을 선택하세요.</p>
    ${remaining <= 0 ? '<div class="warn">남은 PT 횟수가 없습니다. <b>이용권</b> 탭에서 먼저 구매하세요.</div>' : ''}
    <div class="calendar">
      ${slots.length ? slots.map((s) => `
        <div class="cal-day">
          <div class="cal-date">${fmtDate(s.date)} <span class="muted">(${WEEKDAYS[s.weekday]})</span></div>
          <div class="cal-times">
            ${s.times.map((x) => `<button class="slot ${x.taken ? 'taken' : ''}" ${x.taken || remaining <= 0 ? 'disabled' : ''} data-date="${s.date}" data-time="${x.time}">${x.time}</button>`).join('')}
          </div>
        </div>`).join('') : '<p class="muted">가능한 시간이 없습니다.</p>'}
    </div>`;
  showBackdrop('#booking-backdrop');
  const dlg = $('#booking-dialog');
  $('.dialog-close', dlg).addEventListener('click', () => hideBackdrop('#booking-backdrop'));
  $$('.slot:not(.taken):not([disabled])', dlg).forEach((btn) => {
    btn.addEventListener('click', () => confirmBooking(t, btn.dataset.date, btn.dataset.time));
  });
}

function confirmBooking(t, date, time) {
  try {
    const res = engine.createBooking(state, { trainerId: t.id, trainerName: t.name, date, time });
    state.bookings = res.bookings;
    state.passes = res.passes;
    persist();
    renderCredit();
    hideBackdrop('#booking-backdrop');
    toast(`예약 확정! ${fmtDate(date)} ${time} · ${t.name}`);
    switchView('bookings');
    renderBookings();
  } catch (err) {
    toast(err.message);
  }
}

function renderBookings() {
  const view = $('#bookings-view');
  const sorted = [...state.bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = sorted.filter((b) => b.status === 'confirmed');
  const past = sorted.filter((b) => b.status !== 'confirmed').reverse();
  if (!sorted.length) {
    view.innerHTML = '<p class="empty">아직 예약이 없습니다. <b>트레이너 탐색</b>에서 예약해 보세요.</p>';
    return;
  }
  view.innerHTML = `
    <h3>다가오는 세션 (${upcoming.length})</h3>
    <div class="booking-list">
      ${upcoming.length ? upcoming.map(bookingRow).join('') : '<p class="muted">예정된 세션이 없습니다.</p>'}
    </div>
    <h3>지난 세션</h3>
    <div class="booking-list">
      ${past.length ? past.map(bookingRow).join('') : '<p class="muted">기록이 없습니다.</p>'}
    </div>`;
  $$('[data-act="enter"]', view).forEach((b) => b.addEventListener('click', () => openSessionRoom(b.dataset.id)));
  $$('[data-act="cancel"]', view).forEach((b) => b.addEventListener('click', () => doCancel(b.dataset.id)));
}

function bookingRow(b) {
  const statusLabel = { confirmed: '확정', completed: '완료', cancelled: '취소됨' }[b.status];
  return `
  <div class="booking-card ${b.status}">
    <div class="bk-info">
      <b>${fmtDate(b.date)} ${b.time}</b>
      <span class="muted">${b.trainerName}</span>
      <span class="status-tag ${b.status}">${statusLabel}</span>
    </div>
    <div class="bk-actions">
      ${b.status === 'confirmed' ? `<button class="btn primary sm" data-act="enter" data-id="${b.id}">세션 입장</button>
        <button class="btn ghost sm" data-act="cancel" data-id="${b.id}">취소</button>` : ''}
    </div>
  </div>`;
}

function doCancel(id) {
  if (!confirm('예약을 취소할까요? 차감된 횟수는 환불됩니다.')) return;
  try {
    const res = engine.cancelBooking(state, id);
    state.bookings = res.bookings;
    state.passes = res.passes;
    persist();
    renderCredit();
    renderBookings();
    toast('예약이 취소되고 횟수가 환불되었습니다.');
  } catch (err) { toast(err.message); }
}

// ---------------------------------------------------------------------------
// 이용권
// ---------------------------------------------------------------------------
function renderPasses() {
  $('#plan-grid').innerHTML = DATA.plans.map((p) => `
    <article class="plan-card">
      ${p.badge ? `<span class="plan-badge">${p.badge}</span>` : ''}
      <h3>${p.name}</h3>
      <p class="plan-price">${won(p.price)}</p>
      <p class="plan-per muted">회당 ${won(Math.round(p.price / p.sessions))} · 총 ${p.sessions}회</p>
      <p class="plan-desc">${p.desc}</p>
      <button class="btn primary" data-plan="${p.id}">모의 결제로 구매</button>
    </article>`).join('');
  $$('[data-plan]', $('#plan-grid')).forEach((btn) => {
    btn.addEventListener('click', () => buyPass(btn.dataset.plan));
  });
  renderMyPasses();
}

function buyPass(planId) {
  try {
    const pass = engine.purchasePass(DATA.plans, planId);
    state.passes.push(pass);
    persist();
    renderCredit();
    renderMyPasses();
    toast(`${pass.planName} 구매 완료! (+${pass.sessions}회, 모의 결제)`);
  } catch (err) { toast(err.message); }
}

function renderMyPasses() {
  const box = $('#my-passes');
  if (!state.passes.length) { box.innerHTML = '<p class="empty">보유한 이용권이 없습니다.</p>'; return; }
  box.innerHTML = state.passes.map((p) => `
    <div class="pass-row ${p.remaining === 0 ? 'used' : ''}">
      <div><b>${p.planName}</b> <span class="muted">${fmtDate(p.purchasedAt)} 구매</span></div>
      <div class="pass-remain"><b>${p.remaining}</b> / ${p.sessions}회 남음
        <div class="bar"><span style="width:${(p.remaining / p.sessions) * 100}%"></span></div>
      </div>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// 화상 PT 세션 룸(시뮬레이션)
// ---------------------------------------------------------------------------
function openSessionRoom(bookingId) {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  const t = DATA.trainers.find((x) => x.id === b.trainerId);
  const routine = pickRoutine(t);
  const room = $('#session-room');
  room.dataset.bookingId = bookingId;
  room.dataset.routineId = routine.id;
  room.innerHTML = `
    <div class="sr-bar">
      <div class="sr-title">🔴 화상 PT · ${b.trainerName} <span class="demo-chip">시뮬레이션</span></div>
      <div class="sr-timer" id="sr-timer">00:00</div>
      <button class="btn ghost sm" id="sr-exit">나가기</button>
    </div>
    <div class="sr-stage">
      <div class="cam trainer-cam">${cameraTile('트레이너 · ' + b.trainerName, t.hue, true)}</div>
      <div class="cam my-cam">${cameraTile('내 화면 (모의)', 200, false)}
        <div class="cam-note">실제 웹캠은 사용하지 않는 데모입니다</div>
      </div>
    </div>
    <div class="sr-panel">
      <div class="sr-routine">
        <h3>오늘의 루틴 · ${routine.name} <span class="muted">${routine.durationMin}분 · ${routine.level}</span></h3>
        <ul class="routine-list" id="routine-list">
          ${routine.exercises.map((e, i) => `
            <li>
              <label class="rt-check">
                <input type="checkbox" data-idx="${i}" />
                <span class="rt-art">${exerciseArt(i)}</span>
                <span class="rt-info"><b>${e.name}</b><span class="muted">${e.sets}세트 · ${e.reps} · 휴식 ${e.rest}초</span><span class="rt-cue">💡 ${e.cue}</span></span>
              </label>
            </li>`).join('')}
        </ul>
        <div class="routine-progress">완료 <b id="rt-done">0</b> / ${routine.exercises.length}
          <div class="bar"><span id="rt-bar" style="width:0%"></span></div>
        </div>
      </div>
      <div class="sr-feedback">
        <h3>자세 피드백 메모</h3>
        <textarea id="sr-feedback" rows="4" placeholder="예) 스쿼트 시 무릎 안쪽 모임 → 발끝 방향 유지 코칭"></textarea>
        <label class="field"><span>세션 만족도</span>
          <select id="sr-rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select>
        </label>
        <button class="btn primary" id="sr-end">세션 종료 & 기록 저장</button>
      </div>
    </div>`;
  room.hidden = false;
  document.body.classList.add('session-open');

  // 타이머 시작
  const startedAt = Date.now();
  const timerEl = $('#sr-timer', room);
  sessionTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = fmtClock(sec);
  }, 1000);

  // 루틴 체크
  const doneEl = $('#rt-done', room);
  const barEl = $('#rt-bar', room);
  const total = routine.exercises.length;
  $$('#routine-list input', room).forEach((cb) => {
    cb.addEventListener('change', () => {
      const done = $$('#routine-list input:checked', room).length;
      doneEl.textContent = done;
      barEl.style.width = `${(done / total) * 100}%`;
    });
  });

  $('#sr-exit', room).addEventListener('click', () => closeSessionRoom());
  $('#sr-end', room).addEventListener('click', () => endSession(startedAt));
}

function pickRoutine(trainer) {
  // 트레이너 전문분야에 맞는 루틴 우선 선택
  const map = { 다이어트: 'r-fatburn', 근력강화: 'r-strength', 자세교정: 'r-posture', 코어: 'r-core', 시니어: 'r-senior', 바디프로필: 'r-profile' };
  for (const s of trainer.specialties) {
    if (map[s]) { const r = DATA.routines.find((x) => x.id === map[s]); if (r) return r; }
  }
  return DATA.routines[0];
}

function endSession(startedAt) {
  const room = $('#session-room');
  const bookingId = room.dataset.bookingId;
  const routineId = room.dataset.routineId;
  const routine = DATA.routines.find((r) => r.id === routineId);
  const durationSec = Math.floor((Date.now() - startedAt) / 1000);
  const completed = $$('#routine-list input:checked', room).map((cb) => Number(cb.dataset.idx));
  const booking = state.bookings.find((b) => b.id === bookingId);
  const log = {
    id: engine.uid('log'),
    bookingId,
    trainerId: booking ? booking.trainerId : null,
    date: booking ? booking.date : new Date().toISOString().slice(0, 10),
    durationSec,
    routineId,
    completedExercises: completed,
    feedback: $('#sr-feedback', room).value.trim(),
    rating: Number($('#sr-rating', room).value),
    createdAt: Date.now(),
  };
  state.logs.push(log);
  state.bookings = engine.completeBooking(state.bookings, bookingId);
  persist();
  closeSessionRoom();
  renderCredit();
  renderBookings();
  showSummary(log, routine, booking);
}

function closeSessionRoom() {
  if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
  const room = $('#session-room');
  room.hidden = true;
  room.innerHTML = '';
  document.body.classList.remove('session-open');
}

function showSummary(log, routine, booking) {
  const s = engine.buildSessionSummary(log, routine);
  $('#session-summary').innerHTML = `
    <button class="dialog-close" aria-label="닫기">✕</button>
    <h2>🎉 세션 완료!</h2>
    <p class="section-note">${booking ? booking.trainerName : ''} · ${s.routineName}</p>
    <div class="summary-grid">
      <div class="sum-stat"><b>${s.minutes}</b><span>분 운동</span></div>
      <div class="sum-stat"><b>${s.done}/${s.total}</b><span>동작 완료</span></div>
      <div class="sum-stat"><b>${s.completionRate}%</b><span>달성률</span></div>
      <div class="sum-stat"><b>${'★'.repeat(s.rating)}</b><span>만족도</span></div>
    </div>
    ${s.feedback ? `<div class="sum-feedback"><h4>코치 메모</h4><p>${escapeHtml(s.feedback)}</p></div>` : ''}
    <div class="ai-card">
      <h4>🤖 AI 세션 요약/피드백</h4>
      <p class="section-note">일반적인 운동 가이드이며 의학적 조언이 아닙니다.</p>
      <button class="btn secondary" data-act="ai-summary">AI 피드백 생성</button>
      <pre class="ai-output" id="ai-summary-output" aria-live="polite"></pre>
    </div>
    <div class="dialog-actions">
      ${booking ? `<button class="btn secondary" data-act="review2">리뷰 남기기</button>` : ''}
      <button class="btn primary" data-act="close2">확인</button>
    </div>`;
  showBackdrop('#summary-backdrop');
  const dlg = $('#session-summary');
  const close = () => hideBackdrop('#summary-backdrop');
  $('.dialog-close', dlg).addEventListener('click', close);
  const aiBtn = $('[data-act="ai-summary"]', dlg);
  if (aiBtn) aiBtn.addEventListener('click', () => streamInto($('#ai-summary-output', dlg), aiBtn, 'summary', {
    trainerName: booking ? booking.trainerName : '',
    routineName: s.routineName,
    minutes: s.minutes,
    done: s.done,
    total: s.total,
    completionRate: s.completionRate,
    rating: s.rating,
    feedback: s.feedback,
  }));
  $('[data-act="close2"]', dlg).addEventListener('click', () => { close(); switchView('progress'); });
  const rv = $('[data-act="review2"]', dlg);
  if (rv) rv.addEventListener('click', () => { close(); openTrainerDetail(booking.trainerId); setTimeout(() => openReviewForm(booking.trainerId), 100); });
}

// ---------------------------------------------------------------------------
// 진행상황
// ---------------------------------------------------------------------------
function renderProgress() {
  const p = engine.computeProgress(state.bookings, state.logs);
  const remaining = engine.totalRemaining(state.passes);
  const maxCount = Math.max(1, ...p.weekly.map((w) => w.count));
  $('#progress-view').innerHTML = `
    <div class="stat-row">
      <div class="stat-card"><b>${p.attended}</b><span>완료한 세션</span></div>
      <div class="stat-card"><b>${p.upcoming}</b><span>예정 세션</span></div>
      <div class="stat-card"><b>${remaining}</b><span>남은 횟수</span></div>
      <div class="stat-card"><b>${p.totalMinutes}</b><span>총 운동(분)</span></div>
      <div class="stat-card"><b>${p.streak}</b><span>연속 주 스트릭</span></div>
    </div>
    <h3>주간 출석 그래프</h3>
    <div class="chart" role="img" aria-label="주간 완료 세션 막대그래프">
      ${p.weekly.map((w) => `
        <div class="chart-col">
          <div class="chart-bar" style="height:${(w.count / maxCount) * 100}%" title="${w.count}회"></div>
          <span class="chart-val">${w.count || ''}</span>
          <span class="chart-label">${w.label}</span>
        </div>`).join('')}
    </div>
    <h3>운동 기록</h3>
    <div class="log-list">
      ${state.logs.length ? [...state.logs].reverse().map(logRow).join('') : '<p class="muted">아직 기록이 없습니다. 세션을 완료하면 여기에 쌓입니다.</p>'}
    </div>`;
}

function logRow(l) {
  const r = DATA.routines.find((x) => x.id === l.routineId);
  const t = DATA.trainers.find((x) => x.id === l.trainerId);
  return `<div class="log-card">
    <div><b>${fmtDate(l.date)}</b> <span class="muted">${t ? t.name : ''} · ${r ? r.name : '자유 세션'}</span></div>
    <div class="muted">${Math.round(l.durationSec / 60)}분 · 동작 ${l.completedExercises.length}개 · 만족도 ${'★'.repeat(l.rating)}</div>
    ${l.feedback ? `<div class="log-fb">💬 ${escapeHtml(l.feedback)}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 맞춤추천 설문
// ---------------------------------------------------------------------------
function wireSurvey() { buildSurveyForm(); }

function buildSurveyForm() {
  const s = state.survey || {};
  const goals = ['다이어트', '근력강화', '자세교정', '재활', '바디프로필', '코어강화', '산전산후', '시니어건강'];
  const focuses = [...new Set(DATA.trainers.flatMap((t) => t.specialties))].sort();
  const form = $('#survey-form');
  if (!form) return;
  form.innerHTML = `
    <div class="field-row">
      <label class="field"><span>키 (cm)</span><input type="number" id="sv-height" min="120" max="210" value="${s.height || 170}" /></label>
      <label class="field"><span>몸무게 (kg)</span><input type="number" id="sv-weight" min="30" max="180" value="${s.weight || 68}" /></label>
    </div>
    <label class="field"><span>주요 목표</span>
      <select id="sv-goal">${goals.map((g) => `<option value="${g}" ${s.goal === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
    </label>
    <div class="field-row">
      <label class="field"><span>운동 경험</span>
        <select id="sv-level">${['초급', '중급', '고급'].map((l) => `<option ${s.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <label class="field"><span>선호 트레이너 성별</span>
        <select id="sv-gender">
          <option value="any" ${s.gender === 'any' ? 'selected' : ''}>상관없음</option>
          <option value="female" ${s.gender === 'female' ? 'selected' : ''}>여성</option>
          <option value="male" ${s.gender === 'male' ? 'selected' : ''}>남성</option>
        </select>
      </label>
    </div>
    <label class="field"><span>회당 예산(원)</span>
      <select id="sv-budget">
        <option value="0">상관없음</option>
        <option value="35000">3.5만원 이하</option>
        <option value="45000">4.5만원 이하</option>
        <option value="60000">6만원 이하</option>
      </select>
    </label>
    <fieldset class="chips"><legend>관심 부위/종류 (복수 선택)</legend>
      ${focuses.map((f) => `<label class="chip-check"><input type="checkbox" value="${f}" ${(s.focus || []).includes(f) ? 'checked' : ''}/> ${f}</label>`).join('')}
    </fieldset>
    <button type="submit" class="btn primary">맞춤 트레이너 추천받기</button>`;
  form.onsubmit = (e) => {
    e.preventDefault();
    runSurvey();
  };
}

function runSurvey() {
  const survey = {
    height: Number($('#sv-height').value),
    weight: Number($('#sv-weight').value),
    goal: $('#sv-goal').value,
    level: $('#sv-level').value,
    gender: $('#sv-gender').value,
    budget: Number($('#sv-budget').value) || 0,
    focus: $$('#survey-form .chip-check input:checked').map((c) => c.value),
  };
  state.survey = survey;
  persist();
  const ranked = engine.recommendTrainers(survey, DATA.trainers).slice(0, 3);
  $('#survey-result').innerHTML = `
    <h3>추천 트레이너 TOP 3</h3>
    <div class="rec-list">
      ${ranked.map((t, i) => `
        <article class="rec-card" data-id="${t.id}">
          <span class="rec-rank">#${i + 1}</span>
          <div class="rec-avatar">${trainerAvatar(t, 72)}</div>
          <div class="rec-body">
            <b>${t.name}</b> <span class="muted">${won(t.pricePerSession)}/회 · ★${t.rating.toFixed(1)}</span>
            <div class="match-score">매칭 ${t.matchScore}점</div>
            <ul class="match-reasons">${t.matchReasons.map((r) => `<li>✔ ${r}</li>`).join('') || '<li class="muted">품질 지표 기반 추천</li>'}</ul>
          </div>
        </article>`).join('')}
    </div>`;
  $$('.rec-card', $('#survey-result')).forEach((c) => c.addEventListener('click', () => openTrainerDetail(c.dataset.id)));
}

// ---------------------------------------------------------------------------
// AI 코치 (챗봇 · 맞춤 루틴 생성 · 세션 피드백) — ai/ai.js 의 askAI() 사용
// ---------------------------------------------------------------------------
function wireAi() {
  const goalOpts = AI_GOALS.map((g) => `<option value="${g}">${g}</option>`).join('');
  const chatGoal = $('#ai-chat-goal');
  const routineGoal = $('#ai-routine-goal');
  if (chatGoal) chatGoal.innerHTML = goalOpts;
  if (routineGoal) routineGoal.innerHTML = goalOpts;

  const chatBtn = $('#ai-chat-send');
  if (chatBtn) chatBtn.addEventListener('click', runAiChat);
  const routineBtn = $('#ai-routine-gen');
  if (routineBtn) routineBtn.addEventListener('click', runAiRoutine);
  const digestBtn = $('#ai-digest-refresh');
  if (digestBtn) digestBtn.addEventListener('click', renderAiDigest);
}

// (0) 무인 자동 브리핑 — 접속 시 "오늘의 추천 트레이너 + 맞춤 루틴"을 askAI 로 자동 생성.
//     날짜 기반으로 오늘의 목표를 결정론적으로 선택 → 사용자 조작 없이 self-running.
//     mock(오프라인)에서도 동작하며 실패 시 자동 폴백(무인). 렌더를 막지 않도록 await 하지 않음.
function renderAiDigest() {
  const out = $('#ai-digest-output');
  if (!out || !DATA.trainers.length) return;
  const goal = AI_GOALS[new Date().getDate() % AI_GOALS.length]; // 오늘의 목표(요일 대신 날짜로 순환)
  streamInto(out, $('#ai-digest-refresh'), 'digest', {
    goal,
    level: '초급',
    minutes: 30,
    trainers: DATA.trainers,
    routines: DATA.routines,
  });
}

/** 스트리밍 출력을 pre 요소에 흘려보내며 버튼 상태를 관리. */
async function streamInto(outputEl, btnEl, task, payload) {
  if (!outputEl) return;
  const original = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '생성 중…'; }
  outputEl.textContent = '';
  outputEl.classList.add('streaming');
  try {
    await askAI(task, payload, { onToken: (chunk) => { outputEl.textContent += chunk; } });
  } catch (err) {
    outputEl.textContent = `AI 오류: ${err.message}\n(서버 연동 시 server/ 프록시가 실행 중인지 확인하세요.)`;
  } finally {
    outputEl.classList.remove('streaming');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = original; }
  }
}

// (1) 운동 코치 챗봇 — 목표/부상 → 조언 + 트레이너 추천
function runAiChat() {
  streamInto($('#ai-chat-output'), $('#ai-chat-send'), 'coach', {
    goal: $('#ai-chat-goal').value,
    level: $('#ai-chat-level').value,
    injuries: $('#ai-chat-injuries').value.trim(),
    message: $('#ai-chat-message').value.trim(),
    trainers: DATA.trainers,
  });
}

// (2) 목표 → 맞춤 루틴 생성
function runAiRoutine() {
  streamInto($('#ai-routine-output'), $('#ai-routine-gen'), 'routine', {
    goal: $('#ai-routine-goal').value,
    level: $('#ai-routine-level').value,
    minutes: Number($('#ai-routine-min').value) || 30,
    routines: DATA.routines,
  });
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------
function showBackdrop(sel) { $(sel).hidden = false; document.body.classList.add('modal-open'); }
function hideBackdrop(sel) { $(sel).hidden = true; document.body.classList.remove('modal-open'); }

function fmtDate(v) {
  const d = typeof v === 'number' ? new Date(v) : new Date(v + (String(v).length === 10 ? 'T00:00:00' : ''));
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtClock(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); el.hidden = true; }, 2600);
}

// 백드롭 클릭 시 닫기
$$('.backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => { if (e.target === bd) { bd.hidden = true; document.body.classList.remove('modal-open'); } });
});

boot();
