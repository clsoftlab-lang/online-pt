// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// store.js — localStorage 영속화(try/catch, 인메모리 폴백, 초기화).
// 저장 대상: 이용권(passes)·예약(bookings)·세션기록(logs)·리뷰(reviews)·설문(survey)·테마.

const KEY = 'online-pt:v1';

const DEFAULT_STATE = {
  passes: [],
  bookings: [],
  logs: [],
  reviews: [],
  survey: null,
  theme: 'auto',
};

let memoryFallback = null; // localStorage 불가 환경(프라이빗 모드 등) 대비

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 저장된 상태 로드. 실패 시 기본값. */
export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...clone(DEFAULT_STATE), ...parsed };
  } catch (err) {
    console.warn('[store] load 실패, 인메모리 폴백 사용:', err);
    return memoryFallback ? clone(memoryFallback) : clone(DEFAULT_STATE);
  }
}

/** 상태 저장. localStorage 실패 시 메모리에 보관. */
export function saveState(state) {
  memoryFallback = clone(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('[store] save 실패(용량/프라이빗 모드?), 메모리에만 유지:', err);
    return false;
  }
}

/** 전체 초기화. */
export function resetState() {
  memoryFallback = clone(DEFAULT_STATE);
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.warn('[store] reset 실패:', err);
  }
  return clone(DEFAULT_STATE);
}

export { DEFAULT_STATE };
