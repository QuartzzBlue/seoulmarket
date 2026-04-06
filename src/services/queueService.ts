import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import { logger } from "../utils/logger";

/**
 * Azure Storage Queue에 메시지를 적재하는 서비스
 * - 연결 문자열과 queue 이름은 생성자에서 받는다
 * - 메시지 타입에 무관하게 재사용할 수 있도록 제네릭으로 작성한다
 */
export class QueueService {
  private readonly queueClient: QueueClient;

  constructor(connectionString: string, queueName: string) {
    const serviceClient = QueueServiceClient.fromConnectionString(connectionString);
    this.queueClient = serviceClient.getQueueClient(queueName);
  }

  /**
   * 임의의 객체를 JSON 직렬화하여 queue에 적재한다
   * - Azure Storage Queue 요구사항에 맞게 Base64로 인코딩한다
   * - queue가 없으면 자동 생성한다
   */
  async sendMessage<T extends object>(message: T): Promise<void> {
    await this.queueClient.createIfNotExists();

    const encoded = Buffer.from(JSON.stringify(message)).toString("base64");
    await this.queueClient.sendMessage(encoded);

    logger.info("Queue 메시지 적재 완료", {
      queueName: this.queueClient.name,
      message,
    });
  }
}

/**
 * 연결 문자열과 큐 이름 환경변수를 검증하고 QueueService를 반환하는 헬퍼
 */
function createQueueServiceFromEnv(queueEnvKey: string): QueueService {
  const connectionString = process.env.STORAGE_JOB_CONNECTION_STRING;
  const queueName = process.env[queueEnvKey];

  if (!connectionString) {
    throw new Error("환경변수 STORAGE_JOB_CONNECTION_STRING 설정되지 않았습니다.");
  }
  if (!queueName) {
    throw new Error(`환경변수 ${queueEnvKey}가 설정되지 않았습니다.`);
  }

  return new QueueService(connectionString, queueName);
}

/** market-snapshot-queue에 적재하는 서비스 인스턴스를 반환한다 */
export function createMarketSnapshotQueueService(): QueueService {
  return createQueueServiceFromEnv("MARKET_SNAPSHOT_QUEUE_NAME");
}

/** report-generate-queue에 적재하는 서비스 인스턴스를 반환한다 */
export function createReportGenerateQueueService(): QueueService {
  return createQueueServiceFromEnv("REPORT_GENERATE_QUEUE_NAME");
}
