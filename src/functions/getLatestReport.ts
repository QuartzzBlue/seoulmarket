import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { MarketInsight } from "../models/insightSchema";
import { NormalizedSnapshot } from "../models/normalizedData";
import { createNormalizedDataBlobService, createReportsBlobService } from "../services/blobService";
import { logger } from "../utils/logger";

/**
 * HTTP Trigger 함수 - PWA용 최신 리포트 JSON을 반환한다
 *
 * GET /api/getLatestReport
 * GET /api/getLatestReport?date=2026-04-09
 *
 * 응답: { insight: MarketInsight, snapshot: NormalizedSnapshot }
 *
 * authLevel: anonymous — PWA(정적 페이지)에서 키 없이 호출할 수 있어야 한다.
 * 데이터가 시장 공개 정보이므로 익명 접근을 허용한다.
 */
async function getLatestReportHandler(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // CORS preflight 요청 처리
  if (req.method === "OPTIONS") {
    return { status: 204, headers: corsHeaders() };
  }

  context.log("getLatestReport 실행 시작");

  try {
    const dateParam = req.query.get("date");
    let marketDate: string;

    if (dateParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return {
          status: 400,
          headers: corsHeaders(),
          jsonBody: { error: "date 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력하세요." },
        };
      }
      marketDate = dateParam;
    } else {
      // KST 기준 오늘 날짜를 구한다 (UTC+9)
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
      marketDate = now.toISOString().split("T")[0];
    }

    const reportsBlobService = createReportsBlobService();
    const blobNames = await reportsBlobService.listBlobNames(`${marketDate}/`);

    if (blobNames.length === 0) {
      return {
        status: 404,
        headers: corsHeaders(),
        jsonBody: { error: `${marketDate} 날짜의 리포트가 없습니다.` },
      };
    }

    // ISO 8601 파일명은 사전순 정렬 = 시간순 정렬이므로 마지막이 최신이다
    const latestBlobName = blobNames.sort().at(-1)!;

    logger.info("최신 리포트 조회", { marketDate, latestBlobName });

    const normalizedBlobService = createNormalizedDataBlobService();
    const [reportJson, normalizedJson] = await Promise.all([
      reportsBlobService.load(latestBlobName),
      normalizedBlobService.load(latestBlobName),
    ]);

    const insight = JSON.parse(reportJson) as MarketInsight;
    const snapshot = JSON.parse(normalizedJson) as NormalizedSnapshot;

    return {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Cache-Control": "no-cache",
      },
      jsonBody: { insight, snapshot },
    };
  } catch (err) {
    logger.error("getLatestReport 실패", err);
    return {
      status: 500,
      headers: corsHeaders(),
      jsonBody: { error: "리포트 조회 중 오류가 발생했습니다." },
    };
  }
}

/** CORS 허용 헤더 — GitHub Pages 도메인에서 호출 가능하도록 한다 */
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

app.http("getLatestReport", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: getLatestReportHandler,
});
