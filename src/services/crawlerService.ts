import { chromium } from "playwright";
import { logger } from "../utils/logger";

/**
 * Playwright(Chromium)로 페이지를 렌더링하여 동적 데이터가 포함된 HTML을 반환한다
 *
 * 동작 방식:
 * 1. Chromium 브라우저를 헤드리스 모드로 실행한다
 * 2. 지정된 URL로 이동한다
 * 3. 페이지의 동적 데이터가 로드될 때까지 대기한다
 *    - skeleton 로딩 클래스(animate-pulse)가 사라지는 시점을 로드 완료로 판단한다
 * 4. 렌더링 완료된 HTML 전체를 반환한다
 * 5. 브라우저를 종료한다 (Functions 서버리스 환경에서 매 호출마다 실행/종료)
 *
 * @param url 크롤링 대상 URL
 */
export async function fetchRaw(url: string): Promise<string> {
  logger.info(`크롤링 시작 (Playwright): ${url}`);

  // PLAYWRIGHT_BROWSERS_PATH 환경변수로 브라우저 위치를 Playwright에 알려준다
  // Azure Linux Consumption: PLAYWRIGHT_BROWSERS_PATH=/home/site/wwwroot/.playwright
  // 경로 탐색은 Playwright 내부에 위임하고, executablePath는 명시하지 않는다
  const browser = await chromium.launch({
    headless: true,
    // Consumption 플랜의 샌드박스 제한으로 --no-sandbox가 필요하다
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();

    // 불필요한 리소스(이미지, 폰트, 미디어)는 차단하여 속도를 높인다
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "font", "media"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle" });

    // animate-pulse(skeleton) 클래스가 없어질 때까지 대기한다
    // 데이터가 로드되면 skeleton이 실제 값으로 교체된다
    await page
      .waitForFunction(() => document.querySelector(".animate-pulse") === null, {
        timeout: 15000,
      })
      .catch(() => {
        // 타임아웃이 발생해도 현재 상태의 HTML을 그대로 사용한다
        logger.warn("skeleton 제거 대기 타임아웃 - 현재 상태의 HTML을 사용합니다");
      });

    const html = await page.content();

    logger.info(`크롤링 완료 - 응답 크기: ${html.length}자`);
    return html;
  } finally {
    // 에러가 발생해도 브라우저가 반드시 종료되도록 finally에서 닫는다
    await browser.close();
  }
}
