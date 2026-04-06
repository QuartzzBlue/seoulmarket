import { app, InvocationContext } from "@azure/functions";
import { GenerateReportMessage, MarketSnapshotMessage } from "../models/queueMessage";
import { createReportGenerateQueueService } from "../services/queueService";
import { logger } from "../utils/logger";

/**
 * Queue Trigger 함수 - 시장 데이터 크롤링 및 저장을 담당한다
 *
 * 실행 흐름:
 * 1. scheduleMorningMarketJob이 market-snapshot-queue에 메시지를 적재한다
 * 2. 이 함수가 트리거되어 메시지를 수신한다
 * 3. (다음 단계) 실제 크롤링 및 Blob 저장을 수행한다
 * 4. 완료 후 report-generate-queue에 메시지를 적재한다 -> generateReportJob이 소비한다
 */
async function fetchMarketSnapshotHandler(
  queueItem: unknown,
  context: InvocationContext
): Promise<void> {
  context.log("fetchMarketSnapshot 실행 시작");

  try {
    if (typeof queueItem !== "object" || queueItem === null) {
      throw new Error(`지원하지 않는 메시지 타입: ${typeof queueItem}`);
    }

    const payload = queueItem as MarketSnapshotMessage;

    logger.info("Queue 메시지 수신", {
      marketDate: payload.marketDate,
      runType: payload.runType,
      requestedAt: payload.requestedAt,
    });

    // TODO: 다음 단계 - 실제 크롤링 구현 위치
    logger.info(`[다음 단계] ${payload.marketDate} 시장 데이터 크롤링 예정`);

    // TODO: 다음 단계 - Blob 저장 구현 위치
    logger.info(`[다음 단계] ${payload.marketDate} 크롤링 결과 Blob 저장 예정`);

    // 크롤링/저장 완료 후 리포트 생성 큐에 메시지를 적재한다
    const reportMessage: GenerateReportMessage = {
      marketDate: payload.marketDate,
      runType: payload.runType,
      requestedAt: new Date().toISOString(),
    };

    const reportQueueService = createReportGenerateQueueService();
    await reportQueueService.sendMessage(reportMessage);

    context.log("fetchMarketSnapshot 완료 - 리포트 생성 큐에 메시지 적재됨");
  } catch (err) {
    logger.error("fetchMarketSnapshot 실패", err);
    throw err;
  }
}

// Queue 이름은 환경변수 MARKET_SNAPSHOT_QUEUE_NAME에서 읽는다
app.storageQueue("fetchMarketSnapshot", {
  queueName: "%MARKET_SNAPSHOT_QUEUE_NAME%",
  connection: "STORAGE_JOB_CONNECTION_STRING",
  handler: fetchMarketSnapshotHandler,
});
