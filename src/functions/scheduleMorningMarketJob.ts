import { app, InvocationContext, Timer } from "@azure/functions";
import { MarketSnapshotMessage } from "../models/queueMessage";
import { createMarketSnapshotQueueService } from "../services/queueService";
import { logger } from "../utils/logger";

/**
 * Timer Trigger 함수 - 정해진 스케줄에 맞춰 Queue에 작업 메시지를 적재한다
 *
 * 실행 흐름:
 * 1. 타이머가 발동된다 (스케줄: MORNING_JOB_SCHEDULE 환경변수)
 * 2. 오늘 날짜와 실행 유형을 담은 메시지를 생성한다
 * 3. Queue에 메시지를 적재한다 -> fetchMarketSnapshot이 이를 소비한다
 */
async function scheduleMorningMarketJobHandler(
  _timer: Timer,
  context: InvocationContext
): Promise<void> {
  context.log("scheduleMorningMarketJob 실행 시작");

  try {
    // 오늘 날짜를 YYYY-MM-DD 형식으로 구한다 (한국 로컬 날짜 기준)
    const today = new Date();
    const marketDate = today.toISOString().split("T")[0];

    const message: MarketSnapshotMessage = {
      marketDate,
      runType: "scheduled",
      requestedAt: today.toISOString(),
    };

    logger.info("Queue 메시지 생성", message);

    const queueService = createMarketSnapshotQueueService();
    await queueService.sendMessage(message);

    context.log("scheduleMorningMarketJob 완료 - 메시지 적재 성공");
  } catch (err) {
    logger.error("scheduleMorningMarketJob 실패", err);
    throw err;
  }
}

// Azure Functions v4 방식으로 함수 등록
// 스케줄은 환경변수 MORNING_JOB_SCHEDULE에서 읽는다
// 예: "0 0 9 * * 1-5" -> 평일 오전 9시 실행
app.timer("scheduleMorningMarketJob", {
  schedule: "%MORNING_JOB_SCHEDULE%",
  handler: scheduleMorningMarketJobHandler,
});
