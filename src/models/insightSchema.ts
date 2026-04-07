import { z } from "zod";

/**
 * LLM이 반환해야 하는 시장 인사이트 구조를 정의한다
 *
 * Zod 스키마는 두 가지 역할을 한다:
 * 1. TypeScript 타입 추론 (MarketInsight)
 * 2. 런타임 응답 검증 (InsightSchema.parse)
 */
export const InsightSchema = z.object({
  marketTone: z.enum(["bullish", "neutral", "bearish"]),
  confidence: z.number().int().min(0).max(100),
  summaryTitle: z.string().min(1).max(60),
  oneLineSummary: z.string().min(1).max(200),
  koreaInsights: z.array(z.string().min(1)).length(3),
  globalInsights: z.array(z.string().min(1)).length(3),
  actionNotes: z.array(z.string().min(1)).length(2),
  riskFactors: z.array(z.string().min(1)).length(2),
  headlineDrivers: z.array(z.string().min(1)).min(2).max(4),
});

export type MarketInsight = z.infer<typeof InsightSchema>;

/**
 * OpenAI Structured Outputs용 JSON Schema
 * response_format.type = "json_schema"와 함께 전달한다
 * strict: true로 additionalProperties를 차단하고 스키마를 강제한다
 */
export const insightJsonSchema = {
  name: "market_insight",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      marketTone: {
        type: "string",
        enum: ["bullish", "neutral", "bearish"],
      },
      confidence: {
        type: "integer",
        minimum: 0,
        maximum: 100,
      },
      summaryTitle: { type: "string" },
      oneLineSummary: { type: "string" },
      koreaInsights: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
      globalInsights: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
      actionNotes: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
      },
      riskFactors: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
      },
      headlineDrivers: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 4,
      },
    },
    required: [
      "marketTone",
      "confidence",
      "summaryTitle",
      "oneLineSummary",
      "koreaInsights",
      "globalInsights",
      "actionNotes",
      "riskFactors",
      "headlineDrivers",
    ],
  },
};
