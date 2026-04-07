/**
 * GitHub Actions에서 실행하는 독립 크롤링 스크립트
 *
 * 역할:
 * 1. CRAWL_TARGET_URL을 Playwright로 크롤링한다
 * 2. raw HTML을 Blob(raw-data)에 저장한다
 * 3. HTML을 정제하여 normalized JSON을 Blob(normalized-data)에 저장한다
 * 4. report-generate-queue에 메시지를 적재한다
 *    → Azure Functions의 generateReportJob이 이를 소비하여 LLM 리포트를 생성한다
 *
 * 필요한 환경변수:
 *   CRAWL_TARGET_URL
 *   STORAGE_CONNECTION_STRING
 *   REPORT_GENERATE_QUEUE_NAME
 *   BLOB_CONTAINER_RAW_DATA
 *   BLOB_CONTAINER_NORMALIZED_DATA
 */

import {
  createNormalizedDataBlobService,
  createRawDataBlobService,
} from "../src/services/blobService";
import { fetchRaw } from "../src/services/crawlerService";
import { normalize, normalizeIndexBoardSnapshot } from "../src/services/normalizerService";
import { createReportGenerateQueueService } from "../src/services/queueService";
import { GenerateReportMessage } from "../src/models/queueMessage";
import { logger } from "../src/utils/logger";

async function main(): Promise<void> {
  const crawlUrl = process.env.CRAWL_TARGET_URL;
  if (!crawlUrl) {
    throw new Error("환경변수 CRAWL_TARGET_URL이 설정되지 않았습니다.");
  }

  // 타임스탬프는 전체 흐름에서 Blob 경로와 Queue 메시지를 연결하는 키로 사용된다
  const now = new Date();
  const marketDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const requestedAt = now.toISOString();              // ISO 8601

  logger.info("크롤링 시작", { marketDate, requestedAt, crawlUrl });

  // ── 1단계: 크롤링 ──────────────────────────────────────────────────────────
  const rawHtml = await fetchRaw(crawlUrl);

  // ── 2단계: raw HTML → Blob 저장 ────────────────────────────────────────────
  const rawBlobService = createRawDataBlobService();
  await rawBlobService.save(`${marketDate}/${requestedAt}.txt`, rawHtml);

  // ── 3단계: HTML 정제 → normalized JSON → Blob 저장 ─────────────────────────
  const intermediate = normalize(rawHtml, requestedAt);
  const snapshot = normalizeIndexBoardSnapshot(intermediate);

  const normalizedBlobService = createNormalizedDataBlobService();
  await normalizedBlobService.save(
    `${marketDate}/${requestedAt}.json`,
    JSON.stringify(snapshot, null, 2),
    "application/json; charset=utf-8"
  );

  // ── 4단계: report-generate-queue에 메시지 적재 ──────────────────────────────
  // generateReportJob(Azure Function)이 이 메시지를 소비하여 LLM 리포트를 생성한다
  const message: GenerateReportMessage = {
    marketDate,
    requestedAt,
    runType: "scheduled",
  };

  const queueService = createReportGenerateQueueService();
  await queueService.sendMessage(message);

  logger.info("크롤링 완료 - report-generate-queue에 메시지 적재됨", { marketDate, requestedAt });
}

main().catch((err) => {
  logger.error("크롤링 스크립트 실패", err);
  process.exit(1);
});
