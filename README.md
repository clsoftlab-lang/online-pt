<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# 💪 Online PT · 온라인 퍼스널 트레이닝

A browser-only **online personal-training** SPA: find a trainer, buy a session pass, book a
time slot, and run a **1:1 video home-workout** in a simulated session room — with a live timer,
today's routine checklist, and posture-feedback notes — then track your progress. No build step,
no backend, no accounts.

**🔗 LIVE DEMO: https://clsoftlab-lang.github.io/online-pt/**

> 한국어 설명은 **[README.ko.md](README.ko.md)** 를 보세요.

---

## What it is

Booking a real personal trainer for home workouts over video is the seed idea. This demo turns it
into a fully clickable product: browse 14 fictional trainers, filter and sort them, read profiles
and reviews, purchase a pass with **simulated payment** (which decrements a session count), pick a
calendar slot, enter a **mock video-call room**, complete a routine, and watch your attendance and
minutes accumulate on a progress chart.

## Features

- **Trainer discovery** — search + filter by specialty, gender, price, rating; sort by rating / reviews / price / experience.
- **Trainer detail** — intro, certifications, upcoming availability preview, reviews, price.
- **PT passes** — 4 plans (1 / 4 / 12 / 24 sessions). **Simulated checkout** adds credits instantly.
- **Booking** — a 14-day calendar of the trainer's real availability; picking a slot **decrements one credit** and prevents double-booking.
- **Mock video session room** — SVG camera tiles (trainer + "you"), a **working session timer**, today's routine as a **checklist** with sets/reps/rest and coaching cues, and a **posture-feedback memo**.
- **Routines / programs** — 6 goal-based routines (fat-burn, strength, posture, core, senior, body-profile) with set/rep/rest and exercise art placeholders.
- **Progress** — completed vs. upcoming sessions, remaining credits, total minutes, weekly-attendance bar chart, streak, session log.
- **Reviews** — write a rating + text review per trainer.
- **Extras** — body/goal **survey → recommended trainers** (scored with reasons); **post-session summary** (minutes, completion %, rating, coach note).
- **Booking cancel** refunds the credit. **Light + dark** theme, **mobile-first** responsive Korean UI.

## How the core logic works

All domain logic lives in DOM-free [`pt-engine.js`](pt-engine.js) and is unit-tested in [`check.mjs`](check.mjs):

- **Pass purchase** → `purchasePass(plans, planId)` returns a pass object with `remaining = sessions`.
- **Credit decrement** → `consumeCredit(passes)` spends **one** credit from the *oldest* pass that still has any, and throws if none remain.
- **Booking** → `createBooking(state, slot)` checks `hasConflict()` (same date+time), consumes a credit, and appends a `confirmed` booking. Cancel → `cancelBooking()` refunds via `refundCredit()` (clamped to the plan's total).
- **Session end** → a log is saved and the booking is marked `completed`; `computeProgress()` aggregates attendance / minutes / weekly counts / streak.
- **Recommendation** → `recommendTrainers(survey, trainers)` scores specialty match, gender preference, focus areas, budget, plus a rating/experience quality term, and sorts descending.

## Run locally

No dependencies, no build. Serve the folder over HTTP (ES modules need `http://`, not `file://`):

```bash
python -m http.server 8983
# then open http://localhost:8983
```

Run the checks (JSON parse + `node --check` all JS + required containers + engine unit tests):

```bash
node check.mjs
```

## DEMO-MODE boundaries

- **The "video call" is a simulated UI only** — SVG camera tiles and a timer. There is **no real webcam, no WebRTC, no live video**, and your camera is never accessed.
- **All trainers, reviews, prices, and routines are fictional seed data** in `data/*.json`.
- **Persistence is `localStorage` in your own browser, not a real database** — it never leaves your device and can be wiped with the ↺ reset button.
- **No real payments** — checkout is simulated and charges nothing.
- **No real accounts, no login, no personal data (PII) collected.**
- **A production build would add:** a backend + database, real **WebRTC** video sessions, a real payment gateway, authentication, trainer onboarding/scheduling, and notifications.

## Tech

Plain **HTML + CSS + ES-module JavaScript**, no framework, no bundler. Inline **SVG** for all art.
`fetch` loads `data/*.json`; state persists to `localStorage` (with try/catch + in-memory fallback).
CI runs `node check.mjs` on Node 20 via GitHub Actions.

## Project structure

```
index.html         SPA shell + required containers
styles.css         mobile-first, light/dark theme
app.js             views + event wiring (orchestration)
pt-engine.js       pure domain logic (passes, booking, progress, recommend) — unit tested
store.js           localStorage persistence + reset (try/catch, fallback)
svg.js             inline SVG placeholders (avatars, camera tiles, exercise art, stars)
data/trainers.json 14 fictional trainers
data/routines.json 4 pass plans + 6 workout routines
check.mjs          CI: JSON parse, node --check, container check, engine unit tests
.github/workflows/ci.yml
```

## Contributors

- **Dr. Lee Il-guk (이일국)** — creator, product direction
- **LWJ**, **LMJ** — collaborators
- **Claude** (Anthropic) — implementation assistance

## License

- Code: **Apache-2.0** (see [LICENSE](LICENSE)).
- Documentation: **CC BY 4.0**.
- SPDX headers: `Apache-2.0` · `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`.

> **Not an official Anthropic product.** Built as an independent open-source demo.
