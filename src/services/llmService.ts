import OpenAI from "openai";
import { InsightSchema, MarketInsight, insightJsonSchema } from "../models/insightSchema";
import { NormalizedSnapshot } from "../models/normalizedData";
import { TrackedStock } from "../models/universe";
import { StockTechnicalSnapshot } from "../models/stockData";
import {
  StockOpinion,
  StockOpinionSchema,
  stockOpinionJsonSchema,
} from "../models/stockOpinionSchema";
import { logger } from "../utils/logger";

// =============================================================================
// generateReport — 시장 인사이트 생성
// =============================================================================

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
// 시장 인사이트 프롬프트 영역
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
10. 약어(코스피, VIX, WTI, ETF 등)를 처음 등장할 때 반드시 한 번 괄호로 풀어 쓴다.
    예) "VIX(공포지수)", "WTI(미국산 원유 가격)", "코스피200 선물(대형주 200개 기준 미래 가격 계약)"
11. 주식에 익숙하지 않은 일반 독자도 문맥을 파악할 수 있도록 쉬운 표현을 병행한다.
    예) "외국인 순매도(해외 투자자들이 국내 주식을 팔아 자금 이탈)"
12. 단, 풀어 쓰기는 처음 한 번만 한다. 같은 용어를 반복 풀어 쓰지 않는다.

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
  "koreaInsights": ["", "", ""],
  "globalInsights": ["", "", ""],
  "actionNotes": ["", ""],
  "riskFactors": ["", ""],
  "headlineDrivers": [""]
}

필드 규칙:
- marketTone: 전체 시장 톤. bullish(상승 분위기) / neutral(중립) / bearish(하락 분위기) 중 하나
- confidence: 0~100 사이 정수. 해석 신뢰도이며, 데이터 일관성이 높을수록 높인다
- summaryTitle: 메시지 제목으로 바로 쓸 수 있는 한 줄 제목, 30자 내외. 전문 용어 없이 쉽게 쓴다.
- oneLineSummary: 전체 상황을 한 줄로 요약, 80자 내외. 주식을 잘 모르는 사람도 이해할 수 있게 쓴다.
- koreaInsights: 한국시장 관련 핵심 포인트 3개. 약어는 첫 등장 시 괄호로 풀어 쓴다.
- globalInsights: 글로벌 지표 관련 핵심 포인트 3개. 약어는 첫 등장 시 괄호로 풀어 쓴다.
- actionNotes: 실무적으로 참고 가능한 관찰 포인트 2개. 투자 초보자도 이해할 수 있는 톤으로 작성한다.
- riskFactors: 오늘 장에서 경계할 변수 2개. 왜 경계해야 하는지 짧게 이유를 덧붙인다.
- headlineDrivers: 오늘 시장 방향성에 영향을 준 핵심 재료 2~4개. 뉴스 제목이 아닌 "시장에 미친 의미" 중심으로 서술한다.

작성 스타일:
- "상승", "하락", "부담", "지지", "혼조", "보합", "경계", "완화", "압력" 같은 표현을 우선 사용한다.
- 수치가 필요할 때만 간단히 포함한다.
- 뉴스는 전체를 다 쓰지 말고, 실제 시장 해석에 필요한 것만 반영한다.
- 입력 데이터가 상충하면, 그 자체를 "혼조 신호"로 해석한다.
- 뉴스 중복이 있으면 하나로 간주한다.
- 처음 등장하는 약어는 반드시 괄호 안에 쉬운 설명을 추가한다.
  예) "VIX(시장 공포지수, 높을수록 불안심리 강함)", "ETF(여러 종목을 한 번에 담은 펀드)"
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

용어 풀이 참고표 (출력에 포함할 때 첫 등장 시 1회 괄호 병기):
- 코스피(KOSPI): 한국거래소 유가증권시장 전체 종목의 주가지수
- 코스닥(KOSDAQ): 한국 중소·벤처 기업 중심의 주식시장 지수
- 코스피200 선물: 국내 대형주 200개를 기반으로 한 파생상품. 장 시작 전 시장 방향 예측에 활용
- VIX: 미국 증시의 공포지수. 수치가 높을수록 투자자들의 불안심리가 강하다는 의미
- WTI: 미국산 원유 가격의 기준이 되는 지표. 에너지 비용과 인플레이션에 영향
- ETF(Exchange Traded Fund): 여러 종목을 묶어 주식처럼 거래할 수 있는 펀드 상품
- EWY / KORU: 한국 주식시장에 투자하는 해외 ETF. 외국인 시각에서의 한국 투자심리 반영
- 달러인덱스(DXY): 미국 달러의 강약을 나타내는 지표. 높으면 달러 강세, 신흥국 자금 이탈 우려
- 나스닥100 선물: 미국 기술주 100개 기반 지수의 선물. 기술주 투자심리 선행 지표
- S&P500 선물: 미국 대형주 500개 기반 지수의 선물. 전반적 글로벌 투자심리 반영
- 미국 금리(국채 수익률): 미국 10년물 국채 금리. 높으면 위험자산(주식) 매력 감소 가능
- 개인/외국인/기관 수급: 해당 투자 주체가 주식을 샀는지(순매수) 팔았는지(순매도) 여부

입력 JSON:
${JSON.stringify(compactPayload, null, 2)}
`;
}

// =============================================================================
// generateStockOpinion — 종목 의견 생성
// =============================================================================

/** generateStockOpinion 파라미터 */
type GenerateStockOpinionParams = {
  stock: TrackedStock;
  snapshot: StockTechnicalSnapshot;
  /** 오늘자 MarketInsight. null인 경우 거시 컨텍스트 없이 분석한다. */
  macroContext: MarketInsight | null;
};

/**
 * 코스피 대형주에 대한 매수/홀딩/매도 의견을 LLM으로 생성한다
 *
 * 방어 레이어 (generateReport와 동일한 패턴):
 * 1. response_format.json_schema — 모델 레벨에서 스키마 강제
 * 2. JSON.parse — 파싱 실패 시 즉시 감지
 * 3. StockOpinionSchema.parse — Zod 런타임 검증
 * 4. repair prompt — 검증 실패 시 1회 재시도
 *
 * @param params stock, snapshot, macroContext
 * @returns 검증된 StockOpinion 객체
 */
export async function generateStockOpinion(
  params: GenerateStockOpinionParams
): Promise<StockOpinion> {
  const apiKey = process.env.LLM_API_KEY;
  const model  = process.env.LLM_MODEL;

  if (!apiKey) throw new Error("환경변수 LLM_API_KEY가 설정되지 않았습니다.");
  if (!model)  throw new Error("환경변수 LLM_MODEL이 설정되지 않았습니다.");

  const client       = new OpenAI({ apiKey });
  const systemPrompt = buildStockOpinionSystemPrompt();
  const userPrompt   = buildStockOpinionUserPrompt(params);

  logger.info("종목 LLM 의견 요청", {
    model,
    code:    params.stock.code,
    name:    params.stock.name,
    isDummy: params.snapshot.isDummy,
  });

  // 1차 호출
  const first = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    temperature: 0.3,
    response_format: { type: "json_schema", json_schema: stockOpinionJsonSchema },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
  });

  const firstContent = first.choices[0]?.message?.content ?? "";

  try {
    return StockOpinionSchema.parse(JSON.parse(firstContent));
  } catch (err) {
    logger.warn("종목 LLM 응답 검증 실패, repair 재시도", {
      code:  params.stock.code,
      error: err instanceof Error ? err.message : String(err),
    });

    const repair = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: stockOpinionJsonSchema },
      messages: [
        { role: "system",    content: systemPrompt },
        { role: "user",      content: userPrompt },
        { role: "assistant", content: firstContent },
        {
          role: "user",
          content: buildStockOpinionRepairPrompt(
            firstContent,
            err instanceof Error ? err.message : "Schema validation failed"
          ),
        },
      ],
    });

    const repairedContent = repair.choices[0]?.message?.content ?? "";
    return StockOpinionSchema.parse(JSON.parse(repairedContent));
  }
}

// =============================================================================
// 종목 의견 프롬프트 영역
// =============================================================================

/**
 * 종목 의견용 시스템 프롬프트
 */
function buildStockOpinionSystemPrompt(): string {
  return `
# 역할
너는 한국 주식시장 전문가 어시스턴트다.
코스피(한국거래소 유가증권시장 대형주 지수) 대형주에 대해 매수 / 매도 / 홀딩 의견을 제시한다.

# 핵심 원칙
1. 실제 투자 권유가 아닌 "참고용 분석 의견" 톤을 유지한다.
2. 항상 "의견 → 신뢰도 → 근거 → 전략" 순서로 구성한다.
3. 입력 데이터에 없는 사실을 지어내지 않는다.
4. 과장 표현("확실히", "반드시", "폭등 예정")을 사용하지 않는다.
5. 숫자 지표를 최대한 활용하되, 없는 값은 언급하지 않는다.
6. 거시 환경(macroContext)을 종목 판단의 배경으로 반드시 연결한다.
7. 약어는 처음 등장할 때 괄호로 풀어 쓴다.
   예) MA20(20일 이동평균선), RSI(과매수·과매도 지표), VIX(시장 공포지수)
8. 주식에 익숙하지 않은 독자도 이해할 수 있도록 쉬운 표현을 병행한다.
9. 한국어로만 작성한다.
10. 문장은 간결하게 쓴다.

# 판단 기준 (내부 가이드, 출력에 포함하지 말 것)
- macroContext.marketTone이 bullish이고 섹터가 강하면 → 매수/홀딩 방향
- macroContext.marketTone이 bearish이고 수급이 부정적이면 → 매도/관망 방향
- 지표가 엇갈리면 → 홀딩 또는 "혼조"로 표현
- snapshot.isDummy가 true이면:
  기술적 지표보다 거시 컨텍스트 중심으로 판단하고,
  rationale[0]에 "기술적 데이터 미연동 상태로 거시 환경 중심으로 분석함"을 명시한다.
- confidence 기준:
    70 이상: 판단 근거 명확
    50~70:  신호가 엇갈림
    50 미만: 데이터 불충분 또는 불확실

# 출력 형식
반드시 아래 JSON 형식만 출력한다. 설명문, 마크다운, 코드블록 없이 JSON만 출력한다.

{
  "opinion": "매수 | 홀딩 | 매도",
  "confidence": 0,
  "rationale": ["", "", ""],
  "strategy": {
    "newPosition": "",
    "holders": "",
    "risk": ""
  }
}

# 필드 규칙
- opinion: 매수 / 홀딩 / 매도 중 하나
- confidence: 0~100 정수. 판단 신뢰도
- rationale: 근거 정확히 3개
  - [0]: 종목 자체의 기술적 상태 또는 데이터 현황
  - [1]: 거시/섹터 환경과의 연결
  - [2]: 수급, 뉴스 또는 리스크 기반 보완 근거
- strategy.newPosition: 신규 진입 전략 (1~2문장)
- strategy.holders: 기존 보유자 전략 (1~2문장)
- strategy.risk: 오늘 가장 경계할 리스크 (1~2문장)
  `.trim();
}

/**
 * 종목 의견용 유저 프롬프트 — 종목/스냅샷/거시 컨텍스트를 주입한다
 */
function buildStockOpinionUserPrompt(params: GenerateStockOpinionParams): string {
  const { stock, snapshot, macroContext } = params;

  const macroSection = macroContext
    ? `
[3] 오늘 시장 거시 환경 (최신 리포트 기반)
- 시장 톤: ${macroContext.marketTone}  (bullish=상승 분위기 / neutral=중립 / bearish=하락 분위기)
- 신뢰도: ${macroContext.confidence}/100
- 전체 요약: ${macroContext.oneLineSummary}
- 한국 핵심 포인트:
${macroContext.koreaInsights.map((v, i) => `  ${i + 1}. ${v}`).join("\n")}
- 글로벌 핵심 포인트:
${macroContext.globalInsights.map((v, i) => `  ${i + 1}. ${v}`).join("\n")}
- 위험 요소:
${macroContext.riskFactors.map((v, i) => `  ${i + 1}. ${v}`).join("\n")}
    `.trim()
    : `
[3] 오늘 시장 거시 환경
- 오늘자 시장 리포트가 아직 생성되지 않아 거시 컨텍스트를 사용할 수 없다.
- 종목 자체의 기술적 스냅샷 범위에서만 판단한다.
    `.trim();

  return `
아래 데이터를 바탕으로 ${stock.name}(${stock.code})에 대한 매수/매도/홀딩 의견을 생성해라.

[1] 종목 정보
- 종목명: ${stock.name}
- 종목코드: ${stock.code}
- 섹터: ${stock.sector}

[2] 기술적 스냅샷
- 1주 수익률: ${snapshot.r1w}%
- 1개월 수익률: ${snapshot.r1m}%
- 추세 판정: ${snapshot.trend}  (up=상승 / sideway=박스권 / down=하락)
- 현재가 vs MA20(20일 이동평균선): ${snapshot.priceVsMA20}  (above=위 / near=근접 / below=아래)
- 거래량 강도: ${snapshot.volumeScore}  (+1=평균 이상 / 0=보통 / -1=부진)
- 데이터 상태: ${snapshot.isDummy ? "더미 데이터 (실제 시세 API 미연동 상태)" : "실제 API 데이터"}

${macroSection}

[4] 작업
1. 위 데이터를 바탕으로 ${stock.name}에 대한 의견을 생성해라.
2. macroContext가 있으면 반드시 종목 판단과 연결해서 설명해라.
3. snapshot.isDummy가 true이면 rationale[0]에 데이터 상태를 명시해라.
4. 반드시 JSON만 출력해라.
  `.trim();
}

/**
 * 종목 의견 repair 프롬프트 — 1차 응답 Zod 검증 실패 시 수정 지시
 */
function buildStockOpinionRepairPrompt(rawOutput: string, errorMessage: string): string {
  return `
아래 응답은 JSON 스키마 검증에 실패했다.

오류:
${errorMessage}

원본 응답:
${rawOutput}

해야 할 일:
- 유효한 JSON 객체만 다시 출력한다.
- 설명, 마크다운, 코드블록 없이 JSON만 출력한다.
- opinion은 "매수" / "홀딩" / "매도" 중 하나만 사용한다.
- rationale은 정확히 3개 항목이어야 한다.
- strategy는 newPosition / holders / risk 세 필드가 모두 존재해야 한다.
  `.trim();
}
