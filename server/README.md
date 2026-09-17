<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# 🤖 Online PT — Claude 백엔드 프록시 (선택)

프론트엔드의 AI 기능을 **실제 Claude**로 구동할 때만 사용하는 얇은 프록시입니다.
데모 모드(기본값)에서는 이 서버 없이 `ai/`의 결정론적 MockProvider가 동작하므로,
서버는 실제 AI를 켤 때만 실행하면 됩니다.

## 🔐 보안 원칙 (가장 중요)

- **API 키는 오직 이 서버(`process.env.ANTHROPIC_API_KEY`)에만 존재합니다.**
- **브라우저·프론트 코드·리포지토리에는 키를 절대 두지 않습니다.**
- 프론트는 키를 모른 채 `POST /api/ai` 로 `{ task, payload }` 만 보내고, 서버가 대신 Claude를 호출합니다.
- `.env` 는 커밋하지 마세요(`.env.example` 만 커밋).

## 실행

```bash
cd server
npm install
cp .env.example .env      # .env 를 열어 ANTHROPIC_API_KEY 를 채웁니다(키는 서버에만)
npm start                 # http://localhost:8790
```

> CI 에서는 `npm install` / 서버 실행 / 실제 API 호출을 하지 않습니다. 로컬에서만 수행하세요.

그런 다음 프론트의 [`../ai/config.js`](../ai/config.js) 에서:

```js
export const AI_ENDPOINT = "http://localhost:8790/api/ai";
```

로 설정하면 프론트가 mock 대신 실제 Claude 응답을 스트리밍합니다.
빈 문자열(`""`)로 두면 데모(mock) 모드로 되돌아갑니다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/ai` | `{ task, payload }` → `text/plain` 스트림. `task`: `coach`·`routine`·`summary`·`digest` |
| `GET` | `/health` | 상태 확인(`{ ok, model, keyLoaded, monthlyTokens, monthlyTokenCap, rateLimitPerMin }`) |

## 모델 / 파라미터 (무인·저비용)

- 모델: **`claude-haiku-4-5`** (기본, 비용 우선) — `AI_MODEL` 로 변경 가능.
  품질이 더 필요하면 `AI_MODEL=claude-sonnet-5` 또는 `AI_MODEL=claude-opus-5`.
- **Prompt caching**: 안정적인 per-task `system` 프롬프트를 `cache_control:{type:'ephemeral'}`
  블록으로 전송 → 반복 호출 시 캐시를 읽어 입력 비용을 낮춥니다.
- **Thinking/effort**: `claude-haiku-4-5` 는 adaptive thinking/effort 를 받지 않으므로(400 방지)
  전송하지 않습니다. 상위 모델일 때만 `thinking:{type:'adaptive'}` + `output_config:{effort}`(기본 `low`, `AI_EFFORT`).
- **출력 상한**: per-task `max_tokens`(기본 ~700; 필요한 task 만 소폭 상향).
- **비용 가드레일**: IP당 분당 요청 제한(`AI_RATE_LIMIT_PER_MIN`, 기본 20) + 월간 토큰 예산
  (`AI_MONTHLY_TOKEN_CAP`, 기본 2,000,000). 초과 시 **HTTP 429 `{fallback:true}`** → 프론트는 mock 으로 자동 폴백.
  토큰 사용량은 스트림 최종 메시지의 `usage` 로 누적합니다.
- 스트리밍: `client.messages.stream(...)` 의 `text` 이벤트를 응답으로 흘려보냄
- 의존성: [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk)

## ☁️ 무료 무인 배포 — Cloudflare Workers (`worker.js`)

관리할 서버 없이 무료 티어로 상시 가동하려면 [`worker.js`](worker.js) + [`wrangler.toml`](wrangler.toml) 을 씁니다.
Anthropic REST(`POST https://api.anthropic.com/v1/messages`, 헤더 `x-api-key`·`anthropic-version: 2023-06-01`)
를 직접 호출하며, 모델/캐싱/가드레일 규칙은 위와 동일합니다.

```bash
cd server
npm install -g wrangler          # 최초 1회
wrangler secret put ANTHROPIC_API_KEY   # 키는 Secret 으로만 보관(리포지토리 금지)
wrangler deploy                  # https://online-pt-ai.<your-subdomain>.workers.dev
```

그런 다음 프론트 `ai/config.js` 의 `AI_ENDPOINT` 를 배포된 Worker URL(`.../api/ai`)로 설정하면 됩니다.
서버 실패·429·네트워크 오류 시 프론트가 자동으로 mock 으로 폴백하므로 앱은 절대 멈추지 않습니다(무인).

## 안내

모든 AI 산출물은 **일반적인 운동 가이드이며 의학적 조언이 아닙니다.**
통증·질환·부상이 있으면 전문의와 상담하도록 안내합니다.
