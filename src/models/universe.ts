/**
 * 코스피 대형주 유니버스 정의
 *
 * Phase 1에서는 시가총액 상위 10개 종목만 추적한다.
 * 나중에 종목 수를 늘리거나 외부 설정 파일로 분리할 수 있도록
 * 인터페이스와 배열을 명확하게 분리해 둔다.
 */

/** 추적 대상 종목 정보 */
export type TrackedStock = {
  /** 종목 코드 (6자리 숫자 문자열, 예: "005930") */
  code: string;
  /** 종목명 (예: "삼성전자") */
  name: string;
  /** 섹터 분류 (예: "반도체") */
  sector: string;
};

/**
 * 코스피 시가총액 상위 10개 종목 유니버스
 * 출처: KRX / 한국거래소 기준 (2026년 4월 기준)
 */
export const KOSPI_TOP10_UNIVERSE: TrackedStock[] = [
  { code: "005930", name: "삼성전자",       sector: "반도체" },
  { code: "000660", name: "SK하이닉스",     sector: "반도체" },
  { code: "005380", name: "현대차",         sector: "자동차" },
  { code: "035420", name: "NAVER",          sector: "IT서비스" },
  { code: "051910", name: "LG화학",         sector: "화학" },
  { code: "006400", name: "삼성SDI",        sector: "배터리" },
  { code: "035720", name: "카카오",         sector: "IT서비스" },
  { code: "068270", name: "셀트리온",       sector: "바이오" },
  { code: "207940", name: "삼성바이오로직스", sector: "바이오" },
  { code: "000270", name: "기아",           sector: "자동차" },
];
