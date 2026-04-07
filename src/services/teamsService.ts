import { MarketInsight } from "../models/insightSchema";
import { NormalizedSnapshot, ParsedCardBase } from "../models/normalizedData";
import { logger } from "../utils/logger";

/**
 * Microsoft Teams Incoming Webhook으로 시장 인사이트 리포트를 전송한다
 *
 * 환경변수:
 * - TEAMS_WEBHOOK_URL : Teams 채널 Incoming Webhook URL
 *
 * @param insight   LLM이 생성한 시장 인사이트
 * @param snapshot  2차 정제 데이터 (한국 시장 지수 포함)
 */
export async function sendReport(
  insight: MarketInsight,
  snapshot: NormalizedSnapshot
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("환경변수 TEAMS_WEBHOOK_URL이 설정되지 않았습니다.");

  const toneLabel: Record<MarketInsight["marketTone"], string> = {
    bullish: "🟢 강세",
    neutral: "🟡 중립",
    bearish: "🔴 약세",
  };

  // 리포팅 시각 — KST로 변환하여 표시한다
  const reportedAt = new Date(snapshot.collectedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // 한국 시장 핵심 지수 추출
  const find = (kind: string, labelIncludes: string) =>
    snapshot.koreaSummary.find(
      (c) => c.kind === kind && c.label.includes(labelIncludes)
    );

  const kospi    = find("koreaIndex",   "코스피 종합");
  const kosdaq   = find("koreaIndex",   "코스닥 종합");
  const future   = snapshot.koreaSummary.find((c) => c.kind === "koreaFuture" && c.extra === "주간");
  const fx       = snapshot.koreaSummary.find((c) => c.kind === "fx" && c.label.includes("원/달러"));
  const flow     = snapshot.flows[0];

  /** "▲ +37.53 / +0.69%" 형태로 포맷 */
  const fmtChange = (c?: ParsedCardBase) => {
    if (!c) return "-";
    const arrow = c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "-";
    const abs = c.changeAbs ?? "";
    const pct = c.changePct ? ` / ${c.changePct}` : "";
    return `${c.value}  ${arrow} ${abs}${pct}`;
  };

  // Teams Incoming Webhook MessageCard 형식
  const payload = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor:
      insight.marketTone === "bullish"
        ? "00C851"
        : insight.marketTone === "bearish"
        ? "FF4444"
        : "FFBB33",
    summary: insight.summaryTitle,
    sections: [
      // 1) 헤더 — 종합 판단
      {
        activityTitle: `[${toneLabel[insight.marketTone]}]  ${insight.summaryTitle}  (${reportedAt})`,
        activitySubtitle: insight.oneLineSummary,
        facts: [
          { name: "신뢰도", value: `${insight.confidence}/100` },
        ],
      },
      // 2) 한국 시장 지수 (normalized-data 기반)
      {
        title: "📊 한국 시장 지수",
        facts: [
          { name: "코스피 종합",     value: fmtChange(kospi) },
          { name: "코스닥 종합",     value: fmtChange(kosdaq) },
          { name: "코스피200 선물",  value: fmtChange(future) },
          { name: "원/달러 환율",    value: fmtChange(fx) },
          ...(flow
            ? [
                {
                  name: `수급 (${flow.date})`,
                  value: [
                    `개인 ${flow.individual.amount}(${flow.individual.direction === "buy" ? "매수" : "매도"})`,
                    `외국인 ${flow.foreign.amount}(${flow.foreign.direction === "buy" ? "매수" : "매도"})`,
                    `기관 ${flow.institution.amount}(${flow.institution.direction === "buy" ? "매수" : "매도"})`,
                  ].join("  "),
                },
              ]
            : []),
        ],
      },
      // 3) LLM 인사이트 — 한국 시장
      {
        title: "🇰🇷 한국 시장 인사이트",
        text: insight.koreaInsights.map((s) => `• ${s}`).join("\n\n"),
      },
      // 4) LLM 인사이트 — 글로벌
      {
        title: "🌐 글로벌 지표",
        text: insight.globalInsights.map((s) => `• ${s}`).join("\n\n"),
      },
      // 5) 리스크 & 참고 포인트
      {
        title: "⚠️ 리스크 요인",
        text: insight.riskFactors.map((s) => `• ${s}`).join("\n\n"),
      },
      {
        title: "📌 참고 포인트",
        text: insight.actionNotes.map((s) => `• ${s}`).join("\n\n"),
      },
      // 6) 핵심 재료
      {
        title: "📰 핵심 재료",
        text: insight.headlineDrivers.map((s) => `• ${s}`).join("\n\n"),
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Teams webhook 전송 실패: ${response.status} ${response.statusText}`);
  }

  logger.info("Teams 리포트 전송 완료", { summaryTitle: insight.summaryTitle });
}
