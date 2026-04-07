import { MarketInsight } from "../models/insightSchema";
import { NormalizedSnapshot, ParsedCardBase } from "../models/normalizedData";
import { logger } from "../utils/logger";


/**
 * Microsoft Teams Incoming Webhook으로 시장 인사이트 리포트를 전송한다
 *
 * MessageCard(레거시) 대신 Adaptive Card v1.5를 사용한다.
 * - ColumnSet으로 지수/수급 2열 레이아웃
 * - 시장 톤에 따른 헤더 배경 강조
 * - 용어 해설은 기본 접힘 상태로, 버튼 클릭 시 토글
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

  const payload = buildAdaptiveCardPayload(insight, snapshot);

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


// =============================================================================
// Adaptive Card 페이로드 빌더
// =============================================================================

/**
 * Adaptive Card v1.5 형식의 Teams Webhook 페이로드를 생성한다
 *
 * 카드 구조:
 *   ① 헤더 배너    — 제목, 한 줄 요약, 시장 톤, 신뢰도, 수집 시각
 *   ② 한국 시장 지수 — 코스피/코스닥/선물/환율 2열, 수급 1행
 *   ③ 한국 시장 인사이트 (LLM)
 *   ④ 글로벌 지표 (LLM)
 *   ⑤ 리스크 요인 | 참고 포인트 (2열 나란히)
 *   ⑥ 핵심 재료
 *   ⑦ 용어 해설 (기본 접힘, 토글 버튼으로 열기)
 */
function buildAdaptiveCardPayload(
  insight: MarketInsight,
  snapshot: NormalizedSnapshot
): object {
  // ── 시장 톤 표현 매핑 ────────────────────────────────────────
  const toneEmoji: Record<MarketInsight["marketTone"], string> = {
    bullish: "🟢",
    neutral: "🟡",
    bearish: "🔴",
  };
  const toneLabel: Record<MarketInsight["marketTone"], string> = {
    bullish: "강세",
    neutral: "중립",
    bearish: "약세",
  };
  /** Adaptive Card 텍스트 색상 토큰 */
  const toneColor: Record<MarketInsight["marketTone"], string> = {
    bullish: "Good",      // 초록
    neutral: "Warning",   // 노랑
    bearish: "Attention", // 빨강
  };

  // ── 수집 시각 — KST 변환 후 표시 ───────────────────────────
  const reportedAt = new Date(snapshot.collectedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // ── 한국 시장 핵심 지수 추출 ─────────────────────────────────
  const find = (kind: string, labelIncludes: string) =>
    snapshot.koreaSummary.find(
      (c) => c.kind === kind && c.label.includes(labelIncludes)
    );

  const kospi  = find("koreaIndex", "코스피 종합");
  const kosdaq = find("koreaIndex", "코스닥 종합");
  const future = snapshot.koreaSummary.find((c) => c.kind === "koreaFuture" && c.extra === "주간");
  // "원달러 환율" / "원/달러 환율" 두 형식 모두 대응하기 위해 kind만으로 찾는다
  const fx   = snapshot.koreaSummary.find((c) => c.kind === "fx");
  const flow = snapshot.flows[0];

  // ── 포맷 헬퍼 ────────────────────────────────────────────────

  /** "2,650.10  ▲ +0.69%" 형태로 포맷 */
  const fmtIndex = (c?: ParsedCardBase): string => {
    if (!c) return "-";
    const arrow = c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "–";
    const pct   = c.changePct ? ` ${c.changePct}` : "";
    return `${c.value}  ${arrow}${pct}`;
  };

  /** 수급 한 줄 요약 — "개인 +1,234억(매수)  ·  외국인 -567억(매도)  ·  기관 ..." */
  const flowText = flow
    ? [
        `개인 ${flow.individual.amount}(${flow.individual.direction === "buy" ? "매수" : "매도"})`,
        `외국인 ${flow.foreign.amount}(${flow.foreign.direction === "buy" ? "매수" : "매도"})`,
        `기관 ${flow.institution.amount}(${flow.institution.direction === "buy" ? "매수" : "매도"})`,
      ].join("  ·  ")
    : "-";

  // ── 카드 요소 생성 헬퍼 ──────────────────────────────────────

  /**
   * 섹션 구분 제목 블록
   * separator: true → 위쪽에 구분선 자동 추가
   */
  const sectionTitle = (text: string): object => ({
    type: "TextBlock",
    text,
    weight: "Bolder",
    size: "Medium",
    spacing: "Large",
    separator: true,
  });

  /**
   * 불릿 텍스트 블록 배열
   * wrap: true → 긴 문장 자동 줄바꿈
   */
  const bullets = (items: string[]): object[] =>
    items.map((s) => ({
      type: "TextBlock",
      text: `• ${s}`,
      wrap: true,
      spacing: "Small",
    }));

  /**
   * 키-값 목록 블록 (Adaptive Card FactSet)
   * name은 굵은 라벨, value는 일반 텍스트로 렌더링된다
   */
  const factSet = (facts: { name: string; value: string }[]): object => ({
    type: "FactSet",
    facts,
    spacing: "Small",
  });


  // ==========================================================================
  // Adaptive Card body 구성
  // ==========================================================================

  const body: object[] = [

    // ── ① 헤더 배너 ──────────────────────────────────────────────
    // emphasis 스타일로 배경을 강조한다.
    // bleed: true → 카드 좌우 여백을 벗어나 전체 폭으로 확장
    {
      type: "Container",
      style: "emphasis",
      bleed: true,
      items: [
        // 제목 / 시장 톤 — 2열 레이아웃
        {
          type: "ColumnSet",
          columns: [
            {
              type: "Column",
              width: "stretch",
              items: [
                {
                  type: "TextBlock",
                  text: `${toneEmoji[insight.marketTone]} ${insight.summaryTitle}`,
                  weight: "Bolder",
                  size: "Large",
                  wrap: true,
                },
                {
                  type: "TextBlock",
                  text: insight.oneLineSummary,
                  isSubtle: true,
                  wrap: true,
                  spacing: "Small",
                },
              ],
            },
            // 오른쪽: 시장 톤 이모지 + 라벨
            {
              type: "Column",
              width: "auto",
              verticalContentAlignment: "Center",
              items: [
                {
                  type: "TextBlock",
                  text: toneEmoji[insight.marketTone],
                  size: "ExtraLarge",
                  horizontalAlignment: "Center",
                },
                {
                  type: "TextBlock",
                  text: toneLabel[insight.marketTone],
                  weight: "Bolder",
                  color: toneColor[insight.marketTone],
                  horizontalAlignment: "Center",
                  spacing: "None",
                },
              ],
            },
          ],
        },
        // 수집 시각 / 신뢰도 — 2열 레이아웃
        {
          type: "ColumnSet",
          spacing: "Small",
          columns: [
            {
              type: "Column",
              width: "stretch",
              items: [
                {
                  type: "TextBlock",
                  text: `📅 ${reportedAt} KST`,
                  isSubtle: true,
                  size: "Small",
                },
              ],
            },
            {
              type: "Column",
              width: "auto",
              items: [
                {
                  type: "TextBlock",
                  text: `신뢰도 **${insight.confidence}/100**`,
                  size: "Small",
                  horizontalAlignment: "Right",
                },
              ],
            },
          ],
        },
      ],
    },

    // ── ② 한국 시장 지수 ─────────────────────────────────────────
    // 코스피·코스피200선물 / 코스닥·환율 을 2열로 나란히 표시한다
    sectionTitle("📊 한국 시장 지수"),
    {
      type: "ColumnSet",
      columns: [
        {
          type: "Column",
          width: "stretch",
          items: [
            factSet([
              { name: "코스피 종합",    value: fmtIndex(kospi) },
              { name: "코스피200 선물", value: fmtIndex(future) },
            ]),
          ],
        },
        {
          type: "Column",
          width: "stretch",
          items: [
            factSet([
              { name: "코스닥 종합",  value: fmtIndex(kosdaq) },
              { name: "원/달러 환율", value: fmtIndex(fx) },
            ]),
          ],
        },
      ],
    },
    // 수급은 전체 폭 1행으로 표시한다
    factSet([
      { name: `수급 (${flow?.date ?? "-"})`, value: flowText },
    ]),

    // ── ③ 한국 시장 인사이트 ─────────────────────────────────────
    sectionTitle("🇰🇷 한국 시장 인사이트"),
    ...bullets(insight.koreaInsights),

    // ── ④ 글로벌 지표 ────────────────────────────────────────────
    sectionTitle("🌐 글로벌 지표"),
    ...bullets(insight.globalInsights),

    // ── ⑤ 리스크 요인 | 참고 포인트 (2열 나란히) ────────────────
    sectionTitle("⚠️ 리스크 요인  |  📌 참고 포인트"),
    {
      type: "ColumnSet",
      columns: [
        {
          type: "Column",
          width: "stretch",
          items: bullets(insight.riskFactors),
        },
        {
          type: "Column",
          width: "stretch",
          items: bullets(insight.actionNotes),
        },
      ],
    },

    // ── ⑥ 핵심 재료 ─────────────────────────────────────────────
    sectionTitle("📰 핵심 재료"),
    ...bullets(insight.headlineDrivers),

    // ── ⑦ 용어 해설 (기본 접힘) ──────────────────────────────────
    // id: "glossaryBody" 를 Action.ToggleVisibility 로 제어한다
    {
      type: "TextBlock",
      text: "📖 용어 해설",
      weight: "Bolder",
      size: "Medium",
      spacing: "Large",
      separator: true,
    },
    {
      type: "Container",
      id: "glossaryBody",
      isVisible: false,
      items: [
        factSet([
          { name: "코스피(KOSPI)",     value: "한국거래소 유가증권시장 전체 종목의 주가지수" },
          { name: "코스닥(KOSDAQ)",    value: "한국 중소·벤처 기업 중심의 주식시장 지수" },
          { name: "코스피200 선물",    value: "국내 대형주 200개 기반 파생상품. 장 시작 전 시장 방향 예측에 활용" },
          { name: "VIX",             value: "미국 증시 공포지수. 높을수록 투자자 불안심리가 강하다는 의미" },
          { name: "WTI",             value: "미국산 원유 가격 기준 지표. 에너지 비용·인플레이션에 영향" },
          { name: "ETF",             value: "여러 종목을 묶어 주식처럼 거래할 수 있는 펀드 상품" },
          { name: "EWY / KORU",      value: "해외 상장 한국 주식 ETF. 외국인 시각에서의 한국 투자심리 반영" },
          { name: "달러인덱스(DXY)", value: "미국 달러 강약 지표. 높으면 달러 강세, 신흥국 자금 이탈 우려" },
          { name: "나스닥100 선물",   value: "미국 기술주 100개 지수 선물. 기술주 투자심리 선행 지표" },
          { name: "S&P500 선물",      value: "미국 대형주 500개 지수 선물. 전반적 글로벌 투자심리 반영" },
          { name: "미국 금리(10년물)", value: "높으면 위험자산(주식) 매력 감소 가능" },
          { name: "순매수 / 순매도",  value: "매수 > 매도면 순매수(자금 유입), 반대면 순매도(자금 이탈)" },
        ]),
      ],
    },
  ];

  // ── 용어 해설 토글 액션 ──────────────────────────────────────
  // Action.ToggleVisibility: 지정한 id 요소의 isVisible 상태를 반전시킨다
  const actions: object[] = [
    {
      type: "Action.ToggleVisibility",
      title: "📖 용어 해설 보기 / 닫기",
      targetElements: ["glossaryBody"],
    },
  ];

  // ── 최종 페이로드 ────────────────────────────────────────────
  // Teams Incoming Webhook은 Adaptive Card를 attachments 배열로 감싸야 한다
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.5",
          body,
          actions,
        },
      },
    ],
  };
}