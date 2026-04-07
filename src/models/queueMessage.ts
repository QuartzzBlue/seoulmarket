/**
 * report-generate-queue 메시지 타입
 * - scripts/crawl.ts(GitHub Actions)가 크롤링/저장 완료 후 생성하고
 * - generateReportJob이 소비한다
 */
export interface GenerateReportMessage {
  /** 조회 대상 날짜 (YYYY-MM-DD 형식) */
  marketDate: string;

  /** 실행 유형 (상위 단계에서 전달됨) */
  runType: "scheduled" | "manual";

  /** 이 메시지가 생성된 시각 (ISO 8601) */
  requestedAt: string;
}
