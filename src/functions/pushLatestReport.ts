import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { MarketInsight } from "../models/insightSchema";
import { NormalizedSnapshot } from "../models/normalizedData";
import { createNormalizedDataBlobService, createReportsBlobService } from "../services/blobService";
import { sendReport } from "../services/teamsService";
import { logger } from "../utils/logger";

/**
 * HTTP Trigger 함수 - 가장 최근 리포트를 채널로 수동 푸시한다
 *
 * 사용 방법:
 *   POST /api/pushLatestReport
 *   Body (선택): { "date": "2026-04-07" }  ← 생략 시 오늘 날짜로 조회
 *
 * 실행 흐름:
 * 1. 요청 바디에서 날짜를 읽는다 (없으면 오늘)
 * 2. reports 컨테이너에서 해당 날짜의 가장 최근 Blob을 찾는다
 * 3. 리포트(MarketInsight)와 normalized-data(NormalizedSnapshot)를 로드한다
 * 4. 채널(Teams)로 리포트를 전송한다
 */
async function pushLatestReportHandler(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("pushLatestReport 실행 시작");

  try {
    // 날짜 파라미터 파싱 (body JSON 또는 query string)
    let marketDate: string;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const dateParam = (body?.date ?? req.query.get("date")) as string | undefined;

    if (dateParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return { status: 400, jsonBody: { error: "date 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력하세요." } };
      }
      marketDate = dateParam;
    } else {
      // crawl.ts와 동일하게 KST 기준 날짜를 사용한다 (UTC+9)
      marketDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
    }

    logger.info("최신 리포트 조회 시작", { marketDate });

    // reports 컨테이너에서 해당 날짜의 Blob 목록을 조회한다
    const reportsBlobService = createReportsBlobService();
    const blobNames = await reportsBlobService.listBlobNames(`${marketDate}/`);

    if (blobNames.length === 0) {
      return { status: 404, jsonBody: { error: `${marketDate} 날짜의 리포트가 없습니다.` } };
    }

    // Blob 이름의 타임스탬프를 기준으로 가장 최근 것을 선택한다
    // 파일명 형식: {marketDate}/{requestedAt}.json → requestedAt(ISO 8601) 기준 정렬
    const latestBlobName = blobNames.sort().at(-1)!;

    logger.info("최신 리포트 Blob 선택", { latestBlobName });

    // 리포트와 normalized-data를 병렬로 로드한다
    const normalizedBlobService = createNormalizedDataBlobService();
    const [reportJson, normalizedJson] = await Promise.all([
      reportsBlobService.load(latestBlobName),
      normalizedBlobService.load(latestBlobName), // 동일한 경로 구조를 공유한다
    ]);

    const insight = JSON.parse(reportJson) as MarketInsight;
    const snapshot = JSON.parse(normalizedJson) as NormalizedSnapshot;

    await sendReport(insight, snapshot);

    context.log("pushLatestReport 완료 - 채널 전송 성공");
    return { status: 200, jsonBody: { ok: true, pushedReport: latestBlobName } };
  } catch (err) {
    logger.error("pushLatestReport 실패", err);
    return { status: 500, jsonBody: { error: "리포트 전송 중 오류가 발생했습니다." } };
  }
}

app.http("pushLatestReport", {
  methods: ["POST"],
  authLevel: "function", // function key 인증 필요 (무단 호출 방지)
  handler: pushLatestReportHandler,
});
