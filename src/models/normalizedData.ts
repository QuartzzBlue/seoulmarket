/**
 * 크롤링된 HTML 정제 데이터 모델
 *
 * 정제 단계:
 * - 1차: HTML → 섹션별 JSON (NormalizedMarketData) — normalizerService.normalize()
 * - 2차: 섹션별 JSON → 종목별 구조화 JSON (NormalizedSnapshot) — normalizerService.normalizeIndexBoardSnapshot()
 */

// ─── 1차 정제 타입 ────────────────────────────────────────────────────────────

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
}

export interface NewsCard {
  title: string;
  summary: string;
  href: string;
  /** 뉴스 감성: positive(상승), negative(하락), neutral(중립) */
  tone: "positive" | "negative" | "neutral";
}

/** div.rounded-xl 카드 항목 */
export interface MarketCard {
  text: string;
  monoValues: string[];
}

/** 1차 정제 결과 — HTML에서 섹션 단위로 추출한 중간 표현 */
export interface NormalizedMarketData {
  collectedAt: string;
  meta: PageMeta;
  briefing: string;
  summaryCards: MarketCard[];
  marketCards: MarketCard[];
  news: NewsCard[];
}

// ─── 2차 정제 타입 ────────────────────────────────────────────────────────────

export type MarketKind =
  | "koreaSentiment"   // 코스피 예측 점수
  | "koreaIndex"       // 코스피/코스닥 종합
  | "koreaFuture"      // 코스피200 선물
  | "koreaStockEtf"    // 삼성전자, 한국 ETF
  | "fx"               // 원달러 환율
  | "globalIndex"      // 해외 지수 (VIX, 달러인덱스, 반도체지수 등)
  | "globalFuture"     // 나스닥/S&P500/닛케이 선물
  | "commodity"        // WTI, 금, 은, 구리, 천연가스
  | "crypto"           // 비트코인
  | "rate"             // 국채 금리
  | "spread"           // 장단기 금리차
  | "flow"             // 수급 (개인/외국인/기관)
  | "briefing"         // AI 시황
  | "other";

export interface ParsedCardBase {
  kind: MarketKind;
  rawText: string;
  label: string;
  value: string;
  changeAbs?: string;
  changePct?: string;
  direction?: "up" | "down" | "flat";
  /** 마감/주간 등 부가 태그 */
  extra?: string;
}

export interface ParsedBriefing {
  time?: string;
  text: string;
}

export interface FlowEntry {
  amount: string;
  /** 매수(buy) / 매도(sell) — 날짜 기준 우측이면 매수, 좌측이면 매도 */
  direction: "buy" | "sell";
}

export interface ParsedFlow {
  date: string;
  individual: FlowEntry;
  foreign: FlowEntry;
  institution: FlowEntry;
}

/** 2차 정제 결과 — Blob에 저장되는 최종 구조화 JSON */
export interface NormalizedSnapshot {
  collectedAt: string;
  meta: PageMeta;
  briefing: ParsedBriefing | null;
  flows: ParsedFlow[];
  koreaSummary: ParsedCardBase[];
  globalSummary: ParsedCardBase[];
  news: NewsCard[];
}
