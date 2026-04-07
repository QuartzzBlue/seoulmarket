import { app, InvocationContext, Timer } from "@azure/functions";
import { MarketSnapshotMessage } from "../models/queueMessage";
import { createMarketSnapshotQueueService } from "../services/queueService";
import { logger } from "../utils/logger";

/**
 * Timer Trigger 함수 - 정해진 스케줄에 맞춰 Queue에 작업 메시지를 적재한다
 *
 * 실행 흐름:
 * 1. 타이머가 발동된다 (스케줄: MARKET_JOB_SCHEDULE 환경변수)
 * 2. 오늘 날짜와 실행 유형을 담은 메시지를 생성한다
 * 3. Queue에 메시지를 적재한다 -> fetchMarketSnapshot이 이를 소비한다
 *
 * 타임존:
 * - Azure Functions 타이머는 기본적으로 UTC 기준으로 동작한다
 * - WEBSITE_TIME_ZONE = "Korea Standard Time" 으로 설정하면 KST 기준으로 동작한다
 * - 로컬 개발 시에도 local.settings.json에 WEBSITE_TIME_ZONE을 설정해야 한다
 *
 * 스케줄 예:
 * - "0 0 8,15,19 * * *" -> 매일 08:00 / 15:00 / 19:00 (KST) 실행
 */
async function scheduleMorningMarketJobHandler(
  _timer: Timer,
  context: InvocationContext
): Promise<void> {
  context.log("scheduleMorningMarketJob 실행 시작");

  try {
    // 오늘 날짜를 YYYY-MM-DD 형식으로 구한다
    const now = new Date();
    const marketDate = now.toISOString().split("T")[0];

    const message: MarketSnapshotMessage = {
      marketDate,
      runType: "scheduled",
      requestedAt: now.toISOString(),
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

// 스케줄은 환경변수 MARKET_JOB_SCHEDULE에서 읽는다
// WEBSITE_TIME_ZONE = "Korea Standard Time" 설정 시 KST 기준으로 동작한다
app.timer("scheduleMorningMarketJob", {
  schedule: "%MARKET_JOB_SCHEDULE%",
  handler: scheduleMorningMarketJobHandler,
});
