// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/config.js — AI 레이어 설정.
//
//   AI_ENDPOINT 가 빈 문자열("")이면 => 데모 모드: 결정론적 한국어 MockProvider 사용.
//   값이 있으면(예: "http://localhost:8790/api/ai") => 백엔드 프록시로 POST + 스트리밍.
//
//   ⚠️ 보안: 브라우저/리포지토리에는 절대로 API 키를 두지 않습니다.
//      실제 Claude 호출은 server/ 백엔드 프록시가 ANTHROPIC_API_KEY 로만 수행합니다.
//      이 값은 백엔드 URL 일 뿐, 키가 아닙니다.
export const AI_ENDPOINT = "";
