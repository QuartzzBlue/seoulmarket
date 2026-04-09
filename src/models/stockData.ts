/**
 * 개별 종목의 기술적 스냅샷 타입 정의
 *
 * Phase 1에서는 더미 데이터를 사용하며 isDummy: true로 표시한다.
 * Phase 2에서 실제 시세 API 연동 시 isDummy: false로 전환한다.
 */

/** 종목 기술적 스냅샷 */
export type StockTechnicalSnapshot = {
  /** 종목 코드 */
  code: string;

  /** 1주 수익률 (%) */
  r1w: number;

  /** 1개월 수익률 (%) */
  r1m: number;

  /**
   * 추세 판정
   * - up: 상승 추세
   * - sideway: 박스권 (횡보)
   * - down: 하락 추세
   */
  trend: "up" | "sideway" | "down";

  /**
   * 현재가 vs MA20 (20일 이동평균선)
   * - above: 이동평균 위 (강세 신호)
   * - near: 이동평균 근접 (중립)
   * - below: 이동평균 아래 (약세 신호)
   */
  priceVsMA20: "above" | "near" | "below";

  /**
   * 거래량 강도
   * - 1: 평균 이상 (거래 활발)
   * - 0: 보통
   * - -1: 평균 미만 (거래 부진)
   */
  volumeScore: -1 | 0 | 1;

  /**
   * 더미 데이터 여부
   * - true: 실제 시세 API 미연동 상태 (Phase 1)
   * - false: 실제 API 데이터 사용 (Phase 2 이후)
   */
  isDummy: boolean;
};
