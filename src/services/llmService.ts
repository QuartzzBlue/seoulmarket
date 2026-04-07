import OpenAI from "openai";
import { InsightSchema, MarketInsight, insightJsonSchema } from "../models/insightSchema";
import { NormalizedSnapshot } from "../models/normalizedData";
import { logger } from "../utils/logger";

/**
 * OpenAI API를 호출하여 시장 인사이트 JSON을 생성한다
 *
 * 방어 레이어:
 * 1. response_format.json_schema — 모델 레벨에서 스키마 강제
 * 2. JSON.parse — 파싱 실패 시 즉시 감지
 * 3. InsightSchema.parse — Zod 런타임 검증
 * 4. repair prompt — 검증 실패 시 1회 재시도
 *
 * 환경변수:
 * - LLM_API_KEY : OpenAI API 키
 * - LLM_MODEL   : 사용할 모델 ID (예: gpt-4.1-mini)
 *
 * @param snapshot 2차 정제된 시장 데이터
 * @returns 검증된 MarketInsight 객체를 JSON 문자열로 반환
 */
export async function generateReport(snapshot: NormalizedSnapshot): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!apiKey) throw new Error("환경변수 LLM_API_KEY가 설정되지 않았습니다.");
  if (!model) throw new Error("환경변수 LLM_MODEL이 설정되지 않았습니다.");

  const client = new OpenAI({ apiKey });
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(snapshot);

  logger.info("LLM 인사이트 생성 요청", { model });

  const insight = await callWithRetry(client, model, systemPrompt, userPrompt);

  logger.info("LLM 인사이트 생성 완료", { marketTone: insight.marketTone, confidence: insight.confidence });
  return JSON.stringify(insight, null, 2);
}

/**
 * Structured Output 호출 + Zod 검증 + 실패 시 repair prompt 재시도
 */
async function callWithRetry(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<MarketInsight> {
  // 1차 호출
  const first = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    temperature: 0.3,
    response_format: { type: "json_schema", json_schema: insightJsonSchema },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const firstContent = first.choices[0]?.message?.content ?? "";

  try {
    return InsightSchema.parse(JSON.parse(firstContent));
  } catch (err) {
    // 2차 호출 — repair prompt
    logger.warn("LLM 응답 검증 실패, repair 재시도", {
      error: err instanceof Error ? err.message : String(err),
    });

    const repair = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: insightJsonSchema },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: firstContent },
        {
          role: "user",
          content: buildRepairPrompt(
            firstContent,
            err instanceof Error ? err.message : "Schema validation failed"
          ),
        },
      ],
    });

    const repairedContent = repair.choices[0]?.message?.content ?? "";
    return InsightSchema.parse(JSON.parse(repairedContent));
  }
}

/**
 * 검증 실패 시 모델에게 전달하는 repair 지시 프롬프트
 */
function buildRepairPrompt(rawOutput: string, errorMessage: string): string {
  return `
아래 응답은 JSON 스키마 검증에 실패했다.

오류:
${errorMessage}

원본 응답:
${rawOutput}

해야 할 일:
- 유효한 JSON 객체만 다시 출력한다.
- 설명, 마크다운, 코드블록 없이 JSON만 출력한다.
- 누락된 필수 필드를 모두 채운다.
- marketTone은 bullish / neutral / bearish 중 하나만 사용한다.
- 배열 길이는 정확히 맞춘다 (koreaInsights: 3, globalInsights: 3, actionNotes: 2, riskFactors: 2, headlineDrivers: 2~4).
  `.trim();
}

// =============================================================================
// 프롬프트 영역
// =============================================================================

/**
 * 시스템 프롬프트 — LLM의 역할과 응답 형식을 정의한다
 */
function buildSystemPrompt(): string {
  return `
역할:
- 입력으로 제공되는 정제된 시장 데이터(JSON)를 읽고,
  한국 주식시장 개장 전/직후에 참고할 수 있는 핵심 인사이트를 도출한다.
- 숫자를 단순 나열하지 말고, 지표 간 연결 관계와 의미를 설명한다.
- 다만, 입력 데이터에 없는 사실을 지어내지 않는다.
- 뉴스 제목/요약은 참고 자료이며, 과도한 확정 해석은 피한다.

중요 원칙:
1. 반드시 입력 JSON에 포함된 정보만 근거로 해석한다.
2. 과장 표현, 단정 표현, 투자 권유 표현을 피한다.
3. "반드시", "확실", "폭등", "폭락 예정" 같은 표현은 사용하지 않는다.
4. 표현은 간결하고 실무적으로 쓴다.
5. 같은 내용을 반복하지 않는다.
6. 한국어로만 작성한다.
7. 문장은 너무 길지 않게 쓴다.
8. 링크(URL)는 출력에 포함하지 않는다.
9. 금융 자문처럼 보이지 않게, "참고용 인사이트" 톤을 유지한다.

해석 기준:
- koreaSummary: 코스피/코스닥, 코스피200 선물, 환율, 삼성전자, 한국 ETF 등 한국 증시에 직접 연관된 지표
- globalSummary: 나스닥100 선물, S&P500 선물, WTI, 금, 비트코인, VIX, 달러인덱스, 미국 금리 등 글로벌 위험선호/회피 판단용 지표
- flows: 개인/외국인/기관 수급 흐름
- briefing: 이미 생성된 장전 요약 문단
- news: 오늘 시장에 영향을 줄 수 있는 뉴스 후보

출력 규칙:
- 반드시 아래 JSON 형태 "하나만" 출력한다.
- 마크다운, 코드블록, 설명문, 인사말 없이 JSON만 출력한다.
- 문자열 안 줄바꿈은 \\n 으로 처리하지 말고 자연 문장으로 작성한다.

출력 스키마:
{
  "marketTone": "bullish | neutral | bearish",
  "confidence": 0,
  "summaryTitle": "",
  "oneLineSummary": "",
  "koreaInsights": [
    "",
    "",
    ""
  ],
  "globalInsights": [
    "",
    "",
    ""
  ],
  "actionNotes": [
    "",
    ""
  ],
  "riskFactors": [
    "",
    ""
  ],
  "headlineDrivers": [
    ""
  ]
}

필드 규칙:
- marketTone: 전체 시장 톤. bullish / neutral / bearish 중 하나
- confidence: 0~100 사이 정수. 해석 신뢰도이며, 데이터 일관성이 높을수록 높인다
- summaryTitle: 슬랙/카카오 메시지 제목으로 바로 쓸 수 있는 한 줄 제목, 30자 내외
- oneLineSummary: 전체 상황을 한 줄로 요약, 80자 내외
- koreaInsights: 한국시장 관련 핵심 포인트 3개
- globalInsights: 글로벌 지표 관련 핵심 포인트 3개
- actionNotes: 실무적으로 참고 가능한 관찰 포인트 2개
- riskFactors: 오늘 장에서 경계할 변수 2개
- headlineDrivers: 오늘 시장 방향성에 영향을 준 핵심 재료 2~4개

작성 스타일:
- "상승", "하락", "부담", "지지", "혼조", "보합", "경계", "완화", "압력" 같은 표현을 우선 사용한다.
- 수치가 필요할 때만 간단히 포함한다.
- 뉴스는 전체를 다 쓰지 말고, 실제 시장 해석에 필요한 것만 반영한다.
- 입력 데이터가 상충하면, 그 자체를 "혼조 신호"로 해석한다.
- 뉴스 중복이 있으면 하나로 간주한다.
- oneLineSummary와 summaryTitle은 주식 뉴스를 처음 접하는 사람도 이해할 수 있게 쓴다.
- riskFactors는 단순 나열이 아니라 "왜 리스크인지" 한 구절을 덧붙인다.
  예) "달러 강세 — 원/달러 환율 상승으로 외국인 투자자 이탈 압력"
  `.trim();
}

/**
 * 유저 프롬프트 — 시장 데이터를 포함한 실제 요청 메시지를 생성한다
 *
 * @param snapshot 2차 정제 결과 (briefing, koreaSummary, globalSummary, flows, news 포함)
 */
function buildUserPrompt(snapshot: NormalizedSnapshot): string {
  const dedupedNews = Array.from(
    new Map(
      snapshot.news.map((item) => [
        `${item.title}__${item.summary}`,
        {
          title: item.title,
          summary: item.summary,
          tone: item.tone,
        },
      ])
    ).values()
  );

  const compactPayload = {
    collectedAt: snapshot.collectedAt,
    meta: snapshot.meta,
    briefing: snapshot.briefing,
    flows: snapshot.flows,
    koreaSummary: snapshot.koreaSummary.map((item) => ({
      kind: item.kind,
      label: item.label,
      value: item.value,
      changeAbs: item.changeAbs ?? null,
      changePct: item.changePct ?? null,
      direction: item.direction ?? null,
      extra: item.extra ?? null,
    })),
    globalSummary: snapshot.globalSummary.map((item) => ({
      kind: item.kind,
      label: item.label,
      value: item.value,
      changeAbs: item.changeAbs ?? null,
      changePct: item.changePct ?? null,
      direction: item.direction ?? null,
      extra: item.extra ?? null,
    })),
    news: dedupedNews,
  };

  return `
아래는 오늘 아침 기준으로 정제된 시장 데이터다.

작업:
1. 한국 증시 관점에서 핵심 포인트를 정리한다.
2. 글로벌 지표가 한국 시장에 주는 함의를 연결해서 설명한다.
3. 수급, 선물, 환율, 변동성(VIX), 원자재, 금리, 뉴스 흐름을 함께 고려한다.
4. 입력값이 서로 엇갈리면 "혼조" 또는 "방향성 제한"으로 해석한다.
5. 뉴스는 중복 제거된 항목만 참고하고, headlineDrivers에는 중요한 재료만 추린다.
6. 반드시 JSON만 출력한다.

추가 해석 가이드:
- 코스피/코스닥과 코스피200 선물이 같이 강하면 국내 투자심리 개선 신호로 본다.
- 나스닥100/S&P500 선물이 약하고 VIX가 높으면 위험자산 선호가 약한 것으로 본다.
- 달러 강세, 유가 상승, 미국 금리 상승은 한국 증시에 부담 요인이 될 수 있다.
- 반도체지수 강세와 삼성전자 강세는 한국 대형주에 우호적 신호가 될 수 있다.
- 한국 ETF(EWY, KORU) 강세는 해외 시각에서 한국 관련 위험선호가 살아있는 신호로 해석 가능하다.
- 뉴스는 시장 방향을 설명하는 보조 근거로만 사용하고, 숫자 지표보다 우선하지 않는다.

입력 JSON:
${JSON.stringify(compactPayload, null, 2)}
`;
}
// =============================================================================
