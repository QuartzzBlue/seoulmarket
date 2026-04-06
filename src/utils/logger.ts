/**
 * 공통 로거 유틸
 * - 현재는 console 기반으로 동작
 * - 나중에 Application Insights 등으로 교체 시 이 파일만 수정하면 된다
 */
export const logger = {
  info: (message: string, data?: unknown) => {
    if (data !== undefined) {
      console.log(`[INFO] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.log(`[INFO] ${message}`);
    }
  },

  warn: (message: string, data?: unknown) => {
    if (data !== undefined) {
      console.warn(`[WARN] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },

  error: (message: string, err?: unknown) => {
    if (err !== undefined) {
      console.error(`[ERROR] ${message}`, err);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },
};
