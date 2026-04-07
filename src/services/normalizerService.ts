import * as cheerio from "cheerio";
import { AnyNode } from "domhandler";
import {
  FlowEntry,
  MarketCard,
  MarketKind,
  NewsCard,
  NormalizedMarketData,
  NormalizedSnapshot,
  ParsedBriefing,
  ParsedCardBase,
  ParsedFlow,
} from "../models/normalizedData";
import { logger } from "../utils/logger";

// ─── 1차 정제 유틸 ────────────────────────────────────────────────────────────

/** 공백 정규화 */
function clean(text?: string | null): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/** div.rounded-xl 노드에서 MarketCard를 생성한다 (텍스트 8자 미만이면 null) */
function toMarketCard($: cheerio.CheerioAPI, el: AnyNode): MarketCard | null {
  const node = $(el);
  const text = clean(node.text());
  if (!text || text.length < 8) return null;

  const monoValues = node
    .find(".font-mono")
    .map((_, e) => clean($(e).text()))
    .get()
    .filter(Boolean);

  return { text, monoValues };
}

// ─── 1차 정제 ────────────────────────────────────────────────────────────────

/**
 * Playwright로 렌더된 HTML을 1차 정제하여 섹션별 JSON으로 변환한다
 *
 * 출력 형식:
 * { meta, briefing, summaryCards, marketCards, news }
 *
 * 정제 전략:
 * 1. script, style, noscript, svg 노드 제거
 * 2. meta/title/canonical 추출
 * 3. initialBriefing 정규식으로 AI 브리핑 추출
 * 4. 브리핑 섹션 grid-cols-4 직속 카드를 summaryCards로 추출
 * 5. 나머지 div.rounded-xl 블록을 marketCards로 추출
 * 6. a[href*="news.google.com"] 기준 뉴스 카드 추출
 */
export function normalize(html: string, collectedAt: string): NormalizedMarketData {
  logger.info("HTML 1차 정제 시작");

  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  // 1) 페이지 메타
  const meta = {
    title: clean($("title").first().text()),
    description: clean($('meta[name="description"]').attr("content")),
    canonical: clean($('link[rel="canonical"]').attr("href")),
  };

  // 2) AI 시황 브리핑 — JS 인라인 데이터에서 정규식으로 추출
  const briefingMatch = html.match(/"initialBriefing"\s*:\s*"([^"]+)"/);
  const briefing = briefingMatch ? clean(briefingMatch[1]) : "";

  // 3) 상단 요약 카드 (summaryCards) — grid-cols-4 영역의 직속 카드
  const summaryCards: MarketCard[] = [];
  $("div.grid")
    .filter((_, el) => $(el).hasClass("sm\\:grid-cols-4"))
    .first()
    .children("span, div")
    .each((_, el) => {
      const candidates = $(el).is("span")
        ? $(el).children("div.rounded-xl")
        : $(el).filter("div.rounded-xl");
      candidates.each((_, card) => {
        const result = toMarketCard($, card);
        if (result) summaryCards.push(result);
      });
    });

  // 4) 나머지 시장 카드 (marketCards) — summaryCards 섹션 제외
  const summarySection = $("div.grid")
    .filter((_, el) => $(el).hasClass("sm\\:grid-cols-4"))
    .first();
  const marketCards: MarketCard[] = [];
  $("div.rounded-xl").each((_, el) => {
    if (summarySection.find(el).length > 0) return;
    const result = toMarketCard($, el);
    if (result) marketCards.push(result);
  });

  // 5) 뉴스 카드 — news.google.com 링크 기준
  const news: NewsCard[] = [];
  $('a[href*="news.google.com"]').each((_, el) => {
    const a = $(el);
    const title =
      clean(a.find("h3, h2, strong").first().text()) || clean(a.attr("title"));
    const summary = clean(a.find("p").first().text());
    const href = a.attr("href") || "";

    const outerHtml = $.html(el);
    const tone: NewsCard["tone"] = outerHtml.includes("text-red-400")
      ? "negative"
      : outerHtml.includes("text-emerald-400")
      ? "positive"
      : "neutral";

    if (title || href) {
      news.push({ title, summary, href, tone });
    }
  });

  logger.info("HTML 1차 정제 완료", {
    summaryCardCount: summaryCards.length,
    marketCardCount: marketCards.length,
    newsCount: news.length,
    hasBriefing: !!briefing,
  });

  return { collectedAt, meta, briefing, summaryCards, marketCards, news };
}

// ─── 2차 정제 유틸 ────────────────────────────────────────────────────────────

/** ▲/▼ 기호와 | 구분자로 등락값·등락률·방향을 분리한다 */
function parseChange(raw?: string): {
  direction?: "up" | "down" | "flat";
  changeAbs?: string;
  changePct?: string;
} {
  if (!raw) return {};
  const direction: "up" | "down" | "flat" = raw.includes("▲")
    ? "up"
    : raw.includes("▼")
    ? "down"
    : "flat";
  const cleaned = raw.replace(/[▲▼\s]/g, "");
  const [absPart, pctPart] = cleaned.split("|");
  return {
    direction,
    changeAbs: absPart || undefined,
    changePct: pctPart || undefined,
  };
}

/**
 * 카드 텍스트에서 종목 라벨과 부가 태그를 추출한다
 *
 * 라벨 추출 규칙:
 * - 첫 번째 숫자 또는 ▲▼ 직전까지를 라벨로 본다
 * - 라벨 내 "마감" / "주간" 문자열은 extra로 분리하고 라벨에서 제거한다
 *
 * 예시:
 *   "반도체지수마감7,916.1▲ ..." → { label: "반도체지수", extra: "마감" }
 *   "원달러 환율1,510.08▲ ..."  → { label: "원달러 환율", extra: "" }
 *   "코스피200 선물주간817.35▲" → { label: "코스피200 선물", extra: "주간" }
 */
function extractLabel(text: string): { label: string; extra: string } {
  // 부가 태그 추출
  const extraMatch = text.match(/(마감|주간)/);
  const extra = extraMatch ? extraMatch[1] : "";

  // 첫 번째 숫자 또는 방향 기호 앞까지를 라벨 후보로 사용한다
  const labelMatch = text.match(/^([^\d▲▼]+)/);
  let label = labelMatch ? labelMatch[1] : "";

  // 라벨 후보에 부가 태그가 포함되어 있으면 제거한다
  label = label.replace(/마감|주간/g, "").trim();

  return { label, extra };
}

/** 카드 텍스트를 분석하여 MarketKind를 반환한다 */
function classifyKind(text: string): MarketKind {
  if (text.includes("AI 시황") && text.includes("브리핑")) return "briefing";
  if (text.includes("◀ 매도") && text.includes("개인")) return "flow";
  if (text.includes("코스피 예측")) return "koreaSentiment";
  if (text.includes("코스피 종합") || text.includes("코스닥 종합")) return "koreaIndex";
  if (text.includes("코스피200 선물")) return "koreaFuture";
  if (
    text.includes("삼성전자") ||
    text.includes("한국ETF") ||
    text.includes("3X 한국")
  ) return "koreaStockEtf";
  if (text.includes("원달러 환율") || text.includes("원/달러 환율")) return "fx";
  if (
    text.includes("나스닥100 선물") ||
    text.includes("S&P500 선물") ||
    text.includes("니케이225 선물")
  ) return "globalFuture";
  if (
    text.includes("달러인덱스") ||
    text.includes("반도체지수") ||
    text.includes("상해종합") ||
    text.includes("MSCI 신흥국") ||
    text.includes("VIX")
  ) return "globalIndex";
  if (
    text.startsWith("WTI") ||
    text.startsWith("금") ||
    text.startsWith("은") ||
    text.startsWith("구리") ||
    text.startsWith("천연가스")
  ) return "commodity";
  if (text.startsWith("비트코인")) return "crypto";
  if (text.includes("년물")) return "rate";
  if (text.includes("금리차")) return "spread";
  return "other";
}

/**
 * 카드 하나를 파싱하여 ParsedCardBase | ParsedBriefing | ParsedFlow 중 하나로 반환한다
 * 파싱 불가 시 null을 반환한다
 */
function parseMarketCard(
  raw: MarketCard
): ParsedCardBase | ParsedBriefing | ParsedFlow | null {
  const text = clean(raw.text);
  const kind = classifyKind(text);

  // 브리핑 카드
  if (kind === "briefing") {
    const time = raw.monoValues[0];
    const body = clean(
      text.replace("AI 시황", "").replace("장전 브리핑", "").replace(time || "", "")
    );
    return { time, text: body } satisfies ParsedBriefing;
  }

  // 수급 카드
  if (kind === "flow") {
    const dateMatch = text.match(/\d+\/\d+\(.+?\)/);
    const date = dateMatch?.[0] || "";

    // 날짜 문자열을 기준으로 텍스트를 좌(매도) / 우(매수)로 분리한다
    // 예: "◀ 매도2,098억개인4/7(화)매수 ▶163억외국인기관1,246억"
    //       leftPart = "◀ 매도2,098억개인"   rightPart = "매수 ▶163억외국인기관1,246억"
    const dateIdx = date ? text.indexOf(date) : -1;
    const leftPart  = dateIdx >= 0 ? text.slice(0, dateIdx) : text;
    const rightPart = dateIdx >= 0 ? text.slice(dateIdx + date.length) : "";

    // [\\d,]* 로 숫자·쉼표를 매칭하고 [억만]으로 끝맺는다
    // 이전 패턴 [\\d,억만]* 은 억·만을 중간 문자로 허용해 "4,069억4,141억"처럼
    // 두 금액이 이어붙은 경우 전체를 하나의 금액으로 잘못 캡처했다
    const amountPat = "([\\d][\\d,]*[억만])";

    /** 키워드 앞뒤에서 금액을 추출하고, 어느 쪽에서 찾았는지로 방향을 판별한다 */
    const extractEntry = (keyword: string): FlowEntry => {
      // 오른쪽(매수): 키워드 뒤에 금액  ex) "외국인495억"
      const buyMatch = rightPart.match(new RegExp(keyword + amountPat));
      if (buyMatch) return { amount: buyMatch[1], direction: "buy" };

      // 왼쪽(매도): 키워드 앞에 금액  ex) "2,098억개인"
      const sellMatchLeft = leftPart.match(new RegExp(amountPat + keyword));
      if (sellMatchLeft) return { amount: sellMatchLeft[1], direction: "sell" };

      // 오른쪽에 키워드 앞 금액이 있는 경우 (매도 측)
      const sellMatchRight = rightPart.match(new RegExp(amountPat + keyword));
      if (sellMatchRight) return { amount: sellMatchRight[1], direction: "sell" };

      return { amount: "", direction: "buy" };
    };

    return {
      date,
      individual: extractEntry("개인"),
      foreign:    extractEntry("외국인"),
      institution: extractEntry("기관"),
    } satisfies ParsedFlow;
  }

  // koreaSentiment 카드 — "45/100중립코스피 예측" 형태로 숫자가 앞에 오므로 별도 처리
  if (kind === "koreaSentiment") {
    const value = raw.monoValues[0] || "";
    return {
      kind,
      rawText: text,
      label: "코스피 예측",
      value: clean(value),
      direction: "flat",
    } satisfies ParsedCardBase;
  }

  // 일반 지표 카드
  const value = raw.monoValues[0] || "";
  const changeRaw = raw.monoValues[1];
  const { direction, changeAbs, changePct } = parseChange(changeRaw);
  const { label, extra } = extractLabel(text);

  return {
    kind,
    rawText: text,
    label: clean(label),
    value: clean(value),
    changeAbs,
    changePct,
    direction,
    extra: extra ? clean(extra) : undefined,
  } satisfies ParsedCardBase;
}

// ─── 2차 정제 ────────────────────────────────────────────────────────────────

/**
 * 1차 정제 결과(NormalizedMarketData)를 받아 종목별 구조화 JSON(NormalizedSnapshot)으로 변환한다
 *
 * 분류 규칙:
 * - koreaSentiment / koreaIndex / koreaFuture / koreaStockEtf / fx → koreaSummary
 * - globalFuture / globalIndex / commodity / crypto / rate / spread → globalSummary
 * - briefing → briefing 필드
 * - flow → flows 배열
 */
export function normalizeIndexBoardSnapshot(
  snapshot: NormalizedMarketData
): NormalizedSnapshot {
  logger.info("HTML 2차 정제 시작");

  const koreaSummary: ParsedCardBase[] = [];
  const globalSummary: ParsedCardBase[] = [];
  const flows: ParsedFlow[] = [];

  // briefing 문자열이 이미 있으면 기본값으로 사용, 카드에서 파싱되면 덮어쓴다
  let briefing: ParsedBriefing | null = snapshot.briefing
    ? { time: undefined, text: clean(snapshot.briefing) }
    : null;

  for (const raw of snapshot.marketCards) {
    const parsed = parseMarketCard(raw);
    if (!parsed) continue;

    // ParsedBriefing 판별 — time/text 키 존재 여부로 구분
    if ("text" in parsed && !("kind" in parsed) && !("date" in parsed)) {
      briefing = parsed as ParsedBriefing;
      continue;
    }

    // ParsedFlow 판별
    if ("date" in parsed && "individual" in parsed) {
      flows.push(parsed as ParsedFlow);
      continue;
    }

    const card = parsed as ParsedCardBase;
    switch (card.kind) {
      case "koreaSentiment":
      case "koreaIndex":
      case "koreaFuture":
      case "koreaStockEtf":
      case "fx":
        koreaSummary.push(card);
        break;
      case "globalIndex":
      case "globalFuture":
      case "commodity":
      case "crypto":
      case "rate":
      case "spread":
        globalSummary.push(card);
        break;
      default:
        globalSummary.push(card);
        break;
    }
  }

  logger.info("HTML 2차 정제 완료", {
    koreaSummaryCount: koreaSummary.length,
    globalSummaryCount: globalSummary.length,
    flowsCount: flows.length,
    hasBriefing: !!briefing,
  });

  return {
    collectedAt: snapshot.collectedAt,
    meta: snapshot.meta,
    briefing,
    flows,
    koreaSummary,
    globalSummary,
    news: snapshot.news,
  };
}
