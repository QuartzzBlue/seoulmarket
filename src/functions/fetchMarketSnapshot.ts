import { app, InvocationContext } from "@azure/functions";
import { MarketInsight } from "../models/insightSchema";
import { GenerateReportMessage, MarketSnapshotMessage } from "../models/queueMessage";
import { NormalizedSnapshot } from "../models/normalizedData";
import { createNormalizedDataBlobService, createRawDataBlobService, createReportsBlobService } from "../services/blobService";
import { fetchRaw } from "../services/crawlerService";
import { normalize, normalizeIndexBoardSnapshot } from "../services/normalizerService";
import { createReportGenerateQueueService } from "../services/queueService";
import { sendReport } from "../services/teamsService";
import { logger } from "../utils/logger";

/** 최근 리포트 재사용 기준 시간 (밀리초) */
const REPORT_REUSE_WINDOW_MS = 60 * 60 * 1000; // 1시간

/**
 * Queue Trigger 함수 - 시장 데이터 크롤링 및 Blob 저장을 담당한다
 *
 * 실행 흐름 (최근 리포트 없는 경우):
 * 1. scheduleMorningMarketJob이 market-snapshot-queue에 메시지를 적재한다
 * 2. 이 함수가 트리거되어 메시지를 수신한다
 * 3. 최근 1시간 이내 리포트 존재 여부를 확인한다
 * 4. CRAWL_TARGET_URL에서 raw 데이터를 가져온다
 * 5. raw → 1차 정제 → 2차 정제 → Blob 저장
 * 6. 완료 후 report-generate-queue에 메시지를 적재한다
 *
 * 실행 흐름 (최근 리포트 있는 경우):
 * 3. 최근 리포트와 normalized-data를 Blob에서 로드한다
 * 4. Teams 채널로 기존 리포트를 전송하고 종료한다
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

    // ── 최근 1시간 이내 리포트 존재 확인 ────────────────────────────────────
    const recentReport = await findRecentReport(payload.marketDate);

    if (recentReport) {
      logger.info("최근 1시간 이내 리포트 존재 - 크롤링 건너뜀", { blobName: recentReport });

      // 기존 리포트(LLM 인사이트)와 normalized-data(한국 지수)를 함께 로드한다
      const reportsBlobService = createReportsBlobService();
      const normalizedBlobService = createNormalizedDataBlobService();

      const reportJson = await reportsBlobService.load(recentReport);
      const insight = JSON.parse(reportJson) as MarketInsight;

      // normalized-data blobName: "2026-04-07/2026-04-07T01:58:56.103Z.json"
      // reports blobName도 동일한 타임스탬프 구조를 사용한다
      const normalizedBlobName = recentReport; // 컨테이너만 다르고 경로는 동일
      const normalizedJson = await normalizedBlobService.load(normalizedBlobName);
      const snapshot = JSON.parse(normalizedJson) as NormalizedSnapshot;

      await sendReport(insight, snapshot);
      context.log("fetchMarketSnapshot 완료 - 기존 리포트 Teams 전송");
      return;
    }

    // ── 정상 크롤링 흐름 ─────────────────────────────────────────────────────
    const crawlUrl = process.env.CRAWL_TARGET_URL;
    if (!crawlUrl) {
      throw new Error("환경변수 CRAWL_TARGET_URL이 설정되지 않았습니다.");
    }

    // raw 데이터 크롤링
    const rawData = await fetchRaw(crawlUrl);

    // Blob 경로: {marketDate}/{requestedAt}.txt
    const rawBlobService = createRawDataBlobService();
    await rawBlobService.save(`${payload.marketDate}/${payload.requestedAt}.txt`, rawData);

    // 1차 정제: HTML → 섹션별 중간 JSON
    const intermediate = normalize(rawData, payload.requestedAt);
    // 2차 정제: 섹션별 JSON → 종목별 구조화 JSON (koreaSummary / globalSummary / flows / briefing)
    const snapshot = normalizeIndexBoardSnapshot(intermediate);
    const normalizedBlobService = createNormalizedDataBlobService();
    // Blob 경로: {marketDate}/{requestedAt}.json
    await normalizedBlobService.save(
      `${payload.marketDate}/${payload.requestedAt}.json`,
      JSON.stringify(snapshot, null, 2)
    );

    // 크롤링/저장 완료 후 리포트 생성 큐에 메시지를 적재한다
    const reportMessage: GenerateReportMessage = {
      marketDate: payload.marketDate,
      runType: payload.runType,
      requestedAt: payload.requestedAt, // Blob 경로와 동일한 타임스탬프를 사용해야 한다
    };

    const reportQueueService = createReportGenerateQueueService();
    await reportQueueService.sendMessage(reportMessage);

    context.log("fetchMarketSnapshot 완료 - 리포트 생성 큐에 메시지 적재됨");
  } catch (err) {
    logger.error("fetchMarketSnapshot 실패", err);
    throw err;
  }
}

/**
 * reports 컨테이너에서 최근 1시간 이내에 생성된 리포트 Blob 이름을 반환한다
 * 해당하는 리포트가 없으면 null을 반환한다
 *
 * Blob 이름 형식: "{marketDate}/{requestedAt}.json"
 * requestedAt은 ISO 8601 문자열이므로 파일명에서 직접 파싱한다
 *
 * @param marketDate 조회 대상 날짜 (예: "2026-04-07")
 */
async function findRecentReport(marketDate: string): Promise<string | null> {
  const reportsBlobService = createReportsBlobService();
  const blobNames = await reportsBlobService.listBlobNames(`${marketDate}/`);

  const threshold = new Date(Date.now() - REPORT_REUSE_WINDOW_MS);

  for (const name of blobNames) {
    // 파일명에서 타임스탬프를 추출한다: "2026-04-07/2026-04-07T01:58:56.103Z.json" → "2026-04-07T01:58:56.103Z"
    const tsStr = name.replace(`${marketDate}/`, "").replace(".json", "");
    const ts = new Date(tsStr);
    if (!isNaN(ts.getTime()) && ts > threshold) {
      return name;
    }
  }

  return null;
}

// Queue 이름은 환경변수 MARKET_SNAPSHOT_QUEUE_NAME에서 읽는다
app.storageQueue("fetchMarketSnapshot", {
  queueName: "%MARKET_SNAPSHOT_QUEUE_NAME%",
  connection: "STORAGE_CONNECTION_STRING",
  handler: fetchMarketSnapshotHandler,
});
