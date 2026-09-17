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
| `POST` | `/api/ai` | `{ task, payload }` → `text/plain` 스트림. `task`: `coach`·`routine`·`summary` |
| `GET` | `/health` | 상태 확인(`{ ok, model, keyLoaded }`) |

## 모델 / 파라미터

- 모델: **`claude-opus-5`**
- `max_tokens: 2048`, `thinking: { type: "adaptive" }`
- 스트리밍: `client.messages.stream(...)` 의 `text` 이벤트를 응답으로 흘려보냄
- 의존성: [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk)

## 안내

모든 AI 산출물은 **일반적인 운동 가이드이며 의학적 조언이 아닙니다.**
통증·질환·부상이 있으면 전문의와 상담하도록 안내합니다.
