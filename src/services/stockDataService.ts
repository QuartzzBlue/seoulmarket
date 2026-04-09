import { StockTechnicalSnapshot } from "../models/stockData";

/**
 * 종목 기술적 스냅샷을 반환한다
 *
 * Phase 1 (현재): 더미 데이터를 반환한다.
 *   - isDummy: true로 표시되며, LLM 프롬프트에서 이를 감지해
 *     기술적 지표 대신 거시 환경 중심으로 판단하도록 유도한다.
 *
 * Phase 2 (예정): 실제 시세 API (예: 한국투자증권, KIS Developers 등)
 *   와 연동하여 실시간 데이터를 반환하도록 교체한다.
 *
 * @param code 종목 코드 (예: "005930")
 * @returns 기술적 스냅샷 객체
 */
export async function getStockSnapshot(
  code: string
): Promise<StockTechnicalSnapshot> {
  // Phase 2에서 실제 API 호출로 교체한다
  return {
    code,
    r1w:         0,
    r1m:         0,
    trend:       "sideway",
    priceVsMA20: "near",
    volumeScore:  0,
    isDummy:     true,
  };
}
