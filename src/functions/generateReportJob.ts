import { app, InvocationContext } from "@azure/functions";
import { MarketInsight } from "../models/insightSchema";
import { NormalizedSnapshot } from "../models/normalizedData";
import { GenerateReportMessage } from "../models/queueMessage";
import { createNormalizedDataBlobService, createReportsBlobService } from "../services/blobService";
import { generateReport } from "../services/llmService";
import { sendReport } from "../services/teamsService";
import { logger } from "../utils/logger";

/**
 * Queue Trigger 함수 - LLM 리포트 생성, Blob 저장, Teams 전송을 담당한다
 *
 * 실행 흐름:
 * 1. GitHub Actions crawl.ts가 크롤링/저장 완료 후 report-generate-queue에 메시지를 적재한다
 * 2. 이 함수가 트리거되어 메시지를 수신한다
 * 3. normalized-data Blob에서 정제 데이터를 읽는다
 * 4. LLM에 리포트 생성을 요청한다
 * 5. 생성된 리포트를 reports Blob에 저장한다
 * 6. Teams 채널로 리포트를 전송한다
 */
async function generateReportJobHandler(
  queueItem: unknown,
  context: InvocationContext
): Promise<void> {
  context.log("generateReportJob 실행 시작");

  try {
    if (typeof queueItem !== "object" || queueItem === null) {
      throw new Error(`지원하지 않는 메시지 타입: ${typeof queueItem}`);
    }

    const payload = queueItem as GenerateReportMessage;

    logger.info("Queue 메시지 수신", {
      marketDate: payload.marketDate,
      runType: payload.runType,
      requestedAt: payload.requestedAt,
    });

    // normalized-data Blob에서 정제 데이터를 읽는다
    // 경로: {marketDate}/{requestedAt}.json  (crawl.ts가 저장한 경로와 동일)
    const blobName = `${payload.marketDate}/${payload.requestedAt}.json`;
    const normalizedBlobService = createNormalizedDataBlobService();
    const rawJson = await normalizedBlobService.load(blobName);
    const snapshot = JSON.parse(rawJson) as NormalizedSnapshot;

    // LLM에 리포트 생성 요청 — 검증된 MarketInsight JSON 문자열을 반환한다
    const reportJson = await generateReport(snapshot);

    // 생성된 리포트(JSON)를 reports Blob에 저장한다
    // 경로: {marketDate}/{requestedAt}.json
    const reportsBlobService = createReportsBlobService();
    await reportsBlobService.save(
      `${payload.marketDate}/${payload.requestedAt}.json`,
      reportJson,
      "application/json; charset=utf-8"
    );

    // Teams 채널로 리포트를 전송한다
    const insight = JSON.parse(reportJson) as MarketInsight;
    await sendReport(insight, snapshot);

    context.log("generateReportJob 완료 - 리포트 저장 및 Teams 전송 완료");
  } catch (err) {
    logger.error("generateReportJob 실패", err);
    throw err;
  }
}

// Queue 이름은 환경변수 REPORT_GENERATE_QUEUE_NAME에서 읽는다
app.storageQueue("generateReportJob", {
  queueName: "%REPORT_GENERATE_QUEUE_NAME%",
  connection: "STORAGE_CONNECTION_STRING",
  handler: generateReportJobHandler,
});
