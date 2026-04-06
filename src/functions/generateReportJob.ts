import { app, InvocationContext } from "@azure/functions";
import { GenerateReportMessage } from "../models/queueMessage";
import { logger } from "../utils/logger";

/**
 * Queue Trigger 함수 - LLM 리포트 생성 및 채널 발송을 담당한다
 *
 * 실행 흐름:
 * 1. fetchMarketSnapshot이 크롤링/저장 완료 후 report-generate-queue에 메시지를 적재한다
 * 2. 이 함수가 트리거되어 메시지를 수신한다
 * 3. (다음 단계) LLM을 통한 시장 리포트를 생성한다
 * 4. (다음 단계) 생성된 리포트를 채널(Slack / Teams / Kakao 등)로 발송한다
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

    // TODO: 다음 단계 - LLM을 통한 리포트 생성 구현 위치
    logger.info(`[다음 단계] ${payload.marketDate} 시장 리포트 LLM 생성 예정`);

    // TODO: 다음 단계 - 채널 발송 구현 위치 (Slack / Teams / Kakao 등)
    logger.info(`[다음 단계] ${payload.marketDate} 리포트 채널 발송 예정`);

    context.log("generateReportJob 완료");
  } catch (err) {
    logger.error("generateReportJob 실패", err);
    throw err;
  }
}

// Queue 이름은 환경변수 REPORT_GENERATE_QUEUE_NAME에서 읽는다
app.storageQueue("generateReportJob", {
  queueName: "%REPORT_GENERATE_QUEUE_NAME%",
  connection: "STORAGE_JOB_CONNECTION_STRING",
  handler: generateReportJobHandler,
});
