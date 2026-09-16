// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// svg.js — 인라인 SVG 플레이스홀더 아트(사진/영상 대체).
// 실제 인물 사진·촬영본 없음. 모두 절차적 도형. (DEMO)

/** 트레이너 아바타(원형 그라디언트 + 실루엣). hue 로 색상 구분. */
export function trainerAvatar(trainer, size = 120) {
  const hue = trainer.hue ?? 210;
  const initial = (trainer.name || '?').slice(-2);
  const gid = `g-${trainer.id}`;
  return `
<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${trainer.name} 프로필 이미지(가상)" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 60%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 40) % 360} 70% 45%)"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="url(#${gid})"/>
  <circle cx="${size / 2}" cy="${size * 0.4}" r="${size * 0.16}" fill="rgba(255,255,255,0.9)"/>
  <path d="M ${size * 0.22} ${size * 0.92} a ${size * 0.28} ${size * 0.24} 0 0 1 ${size * 0.56} 0 Z" fill="rgba(255,255,255,0.9)"/>
  <text x="${size / 2}" y="${size * 0.55}" text-anchor="middle" font-size="${size * 0.16}" font-weight="700" fill="hsl(${hue} 70% 30%)" opacity="0.0">${initial}</text>
</svg>`;
}

/** 화상 세션 카메라 타일(장식용 실루엣 + LIVE 점). */
export function cameraTile(label, hue, live = false) {
  return `
<svg viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label} 카메라 화면(가상)" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cam-${hue}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 40% 22%)"/>
      <stop offset="1" stop-color="hsl(${hue} 45% 12%)"/>
    </linearGradient>
  </defs>
  <rect width="320" height="220" fill="url(#cam-${hue})"/>
  <circle cx="160" cy="80" r="34" fill="hsl(${hue} 45% 40%)"/>
  <path d="M 96 210 a 64 52 0 0 1 128 0 Z" fill="hsl(${hue} 45% 38%)"/>
  ${live ? '<circle cx="26" cy="24" r="7" fill="#ff4d4f"><animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite"/></circle><text x="42" y="29" fill="#fff" font-size="13" font-weight="700">LIVE</text>' : ''}
  <text x="160" y="205" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-size="13">${label}</text>
</svg>`;
}

/** 운동 동작 픽토그램(추상 도형). idx 로 변형. */
export function exerciseArt(idx = 0) {
  const hue = (idx * 47) % 360;
  return `
<svg viewBox="0 0 80 80" role="img" aria-label="운동 아이콘" xmlns="http://www.w3.org/2000/svg">
  <rect width="80" height="80" rx="14" fill="hsl(${hue} 60% 92%)"/>
  <circle cx="40" cy="26" r="9" fill="hsl(${hue} 60% 45%)"/>
  <rect x="35" y="35" width="10" height="24" rx="5" fill="hsl(${hue} 60% 45%)"/>
  <rect x="18" y="40" width="18" height="7" rx="3.5" fill="hsl(${hue} 60% 55%)" transform="rotate(-20 27 43)"/>
  <rect x="44" y="40" width="18" height="7" rx="3.5" fill="hsl(${hue} 60% 55%)" transform="rotate(20 53 43)"/>
  <rect x="30" y="58" width="8" height="18" rx="4" fill="hsl(${hue} 60% 50%)"/>
  <rect x="42" y="58" width="8" height="18" rx="4" fill="hsl(${hue} 60% 50%)"/>
</svg>`;
}

/** 별점(0~5, 0.1 단위) SVG. */
export function stars(rating) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return `
<span class="stars" aria-label="평점 ${rating.toFixed(1)}점">
  <svg viewBox="0 0 100 20" width="90" height="18" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="clip-${pct.toFixed(0)}"><rect x="0" y="0" width="${pct}" height="20"/></clipPath></defs>
    <g fill="var(--star-empty)">${starPath(0)}${starPath(20)}${starPath(40)}${starPath(60)}${starPath(80)}</g>
    <g fill="var(--star-fill)" clip-path="url(#clip-${pct.toFixed(0)})">${starPath(0)}${starPath(20)}${starPath(40)}${starPath(60)}${starPath(80)}</g>
  </svg>
</span>`;
}
function starPath(x) {
  return `<path transform="translate(${x} 0) scale(0.2)" d="M50 5 L61 39 L97 39 L68 61 L79 95 L50 73 L21 95 L32 61 L3 39 L39 39 Z"/>`;
}
