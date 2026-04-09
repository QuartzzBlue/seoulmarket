import { z } from "zod";

/**
 * LLM이 반환해야 하는 종목 의견 구조를 정의한다
 *
 * insightSchema.ts와 동일한 패턴을 따른다:
 * 1. TypeScript 타입 추론 (StockOpinion)
 * 2. 런타임 응답 검증 (StockOpinionSchema.parse)
 * 3. OpenAI Structured Outputs용 JSON Schema (stockOpinionJsonSchema)
 */
export const StockOpinionSchema = z.object({
  /** 종합 의견: 매수 / 홀딩 / 매도 */
  opinion: z.enum(["매수", "홀딩", "매도"]),

  /** 판단 신뢰도 (0~100). 데이터 일관성이 높을수록 높다. */
  confidence: z.number().int().min(0).max(100),

  /**
   * 의견 근거 3개
   * - [0]: 종목 자체의 기술적 상태
   * - [1]: 거시/섹터 환경과의 연결
   * - [2]: 수급·뉴스·리스크 기반 보완 근거
   */
  rationale: z.array(z.string().min(1)).length(3),

  /** 포지션별 전략 */
  strategy: z.object({
    /** 신규 진입자를 위한 전략 */
    newPosition: z.string().min(1),
    /** 기존 보유자를 위한 전략 */
    holders: z.string().min(1),
    /** 오늘 가장 경계할 리스크 */
    risk: z.string().min(1),
  }),
});

export type StockOpinion = z.infer<typeof StockOpinionSchema>;

/**
 * OpenAI Structured Outputs용 JSON Schema
 * response_format.type = "json_schema"와 함께 전달한다
 * strict: true로 additionalProperties를 차단하고 스키마를 강제한다
 */
export const stockOpinionJsonSchema = {
  name: "stock_opinion",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      opinion: {
        type: "string",
        enum: ["매수", "홀딩", "매도"],
      },
      confidence: {
        type: "integer",
        minimum: 0,
        maximum: 100,
      },
      rationale: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
      strategy: {
        type: "object",
        additionalProperties: false,
        properties: {
          newPosition: { type: "string" },
          holders:     { type: "string" },
          risk:        { type: "string" },
        },
        required: ["newPosition", "holders", "risk"],
      },
    },
    required: ["opinion", "confidence", "rationale", "strategy"],
  },
};
