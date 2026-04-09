import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { KOSPI_TOP10_UNIVERSE } from "../models/universe";
import { MarketInsight } from "../models/insightSchema";
import { createReportsBlobService } from "../services/blobService";
import { getStockSnapshot } from "../services/stockDataService";
import { generateStockOpinion } from "../services/llmService";
import { logger } from "../utils/logger";

/**
 * HTTP Trigger 함수 — 코스피 대형주 종목 코드를 받아 매수/홀딩/매도 의견을 반환한다
 *
 * 사용 방법:
 *   POST /api/getStockOpinion
 *   Content-Type: application/json
 *   Body: { "code": "005930" }
 *
 * 실행 흐름:
 *   1. 요청 바디에서 종목 코드를 읽는다.
 *   2. KOSPI_TOP10_UNIVERSE에 포함된 종목인지 검증한다.
 *   3. reports Blob에서 오늘(KST 기준) 최신 MarketInsight를 로드한다.
 *      - 오늘 데이터 없으면 전날 fallback
 *      - 둘 다 없으면 macroContext = null
 *   4. 종목 기술적 스냅샷을 가져온다 (Phase 1: 더미).
 *   5. LLM으로 종목 의견을 생성한다.
 *   6. 결과를 JSON으로 반환한다.
 */
async function getStockOpinionHandler(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("getStockOpinion 실행 시작");

  try {
    // ── 1. 요청 파싱 ──────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const code = (body?.code ?? req.query.get("code")) as string | undefined;

    if (!code) {
      return {
        status: 400,
        jsonBody: { error: "code 필드는 필수입니다. 예: { \"code\": \"005930\" }" },
      };
    }

    // ── 2. 유니버스 검증 ──────────────────────────────────────────────────────
    const stock = KOSPI_TOP10_UNIVERSE.find((s) => s.code === code);
    if (!stock) {
      return {
        status: 400,
        jsonBody: {
          error: "지원하지 않는 종목입니다. 코스피 TOP10 종목만 분석 가능합니다.",
          supportedCodes: KOSPI_TOP10_UNIVERSE.map((s) => ({
            code: s.code,
            name: s.name,
          })),
        },
      };
    }

    logger.info("종목 의견 생성 시작", { code: stock.code, name: stock.name });

    // ── 3. 최신 MarketInsight 로드 ────────────────────────────────────────────
    // KST(UTC+9) 기준 오늘 날짜로 Blob prefix를 구성한다.
    // new Date().toISOString()은 UTC 기준이라 한국 시간 새벽 0~9시에 날짜가 어긋날 수 있다.
    const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const kstYesterday = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86_400_000)
      .toISOString()
      .split("T")[0];

    const reportsBlobService = createReportsBlobService();
    let macroContext: MarketInsight | null = null;

    // 오늘 → 전날 순서로 fallback
    for (const datePrefix of [kstDate, kstYesterday]) {
      const blobNames = await reportsBlobService.listBlobNames(`${datePrefix}/`);
      if (blobNames.length > 0) {
        // ISO 8601 파일명이므로 사전순 정렬 = 시간순 정렬
        const latestBlobName = blobNames.sort().at(-1)!;
        const reportJson = await reportsBlobService.load(latestBlobName);
        macroContext = JSON.parse(reportJson) as MarketInsight;
        logger.info("거시 컨텍스트 로드 완료", { latestBlobName });
        break;
      }
    }

    if (!macroContext) {
      logger.warn("거시 컨텍스트 없음. 종목 데이터만으로 분석 진행", { kstDate });
    }

    // ── 4. 기술적 스냅샷 생성 ─────────────────────────────────────────────────
    const snapshot = await getStockSnapshot(stock.code);

    // ── 5. LLM 종목 의견 생성 ─────────────────────────────────────────────────
    const opinion = await generateStockOpinion({ stock, snapshot, macroContext });

    logger.info("종목 의견 생성 완료", {
      code: stock.code,
      name: stock.name,
      opinion: opinion.opinion,
      confidence: opinion.confidence,
    });

    // ── 6. 응답 반환 ──────────────────────────────────────────────────────────
    return {
      status: 200,
      jsonBody: {
        code:          stock.code,
        name:          stock.name,
        sector:        stock.sector,
        generatedAt:   new Date().toISOString(),
        macroAvailable: macroContext !== null,
        ...opinion,
        snapshot,
      },
    };
  } catch (err) {
    logger.error("getStockOpinion 실패", err);
    return {
      status: 500,
      jsonBody: { error: "종목 의견 생성 중 오류가 발생했습니다." },
    };
  }
}

app.http("getStockOpinion", {
  methods: ["POST"],
  authLevel: "function", // function key 인증 필요 (무단 호출 방지)
  handler: getStockOpinionHandler,
});
