import { BlobServiceClient } from "@azure/storage-blob";
import { logger } from "../utils/logger";

/**
 * Azure Blob Storage에 텍스트 데이터를 저장하는 서비스
 * - 연결 문자열: 환경변수 STORAGE_CONNECTION_STRING
 *
 * 컨테이너 구분:
 * - raw-data        : 크롤링한 원본 데이터 (BLOB_CONTAINER_RAW_DATA)
 * - normalized-data : 정제된 데이터 (BLOB_CONTAINER_NORMALIZED_DATA)
 * - reports         : 리포트 데이터 (BLOB_CONTAINER_REPORTS)
 */
export class BlobService {
  private readonly client: BlobServiceClient;
  private readonly containerName: string;

  constructor(connectionString: string, containerName: string) {
    this.client = BlobServiceClient.fromConnectionString(connectionString);
    this.containerName = containerName;
  }

  /**
   * 지정한 prefix로 시작하는 Blob 이름 목록을 반환한다
   * @param prefix 경로 prefix (예: "2026-04-07/")
   */
  async listBlobNames(prefix: string): Promise<string[]> {
    const containerClient = this.client.getContainerClient(this.containerName);
    const names: string[] = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      names.push(blob.name);
    }
    return names;
  }

  /**
   * Blob에서 텍스트 데이터를 읽어 반환한다
   * @param blobName Blob 경로 (예: {marketDate}/{requestedAt}.json)
   */
  async load(blobName: string): Promise<string> {
    const containerClient = this.client.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const response = await blockBlobClient.downloadToBuffer();
    return response.toString("utf-8");
  }

  /**
   * 텍스트 데이터를 Blob에 저장한다
   * - 컨테이너가 없으면 자동 생성한다
   * @param blobName Blob 경로 (예: {marketDate}/{requestedAt}.txt)
   * @param content 저장할 텍스트
   * @param contentType Content-Type 헤더 (기본값: text/plain; charset=utf-8)
   */
  async save(
    blobName: string,
    content: string,
    contentType = "text/plain; charset=utf-8"
  ): Promise<void> {
    const containerClient = this.client.getContainerClient(this.containerName);
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    logger.info("Blob 저장 완료", {
      container: this.containerName,
      blobName,
      size: content.length,
    });
  }
}

/**
 * 연결 문자열과 컨테이너 환경변수를 검증하고 BlobService를 반환하는 헬퍼
 */
function createBlobServiceFromEnv(containerEnvKey: string): BlobService {
  const connectionString = process.env.STORAGE_CONNECTION_STRING;
  const containerName = process.env[containerEnvKey];

  if (!connectionString) {
    throw new Error("환경변수 STORAGE_CONNECTION_STRING이 설정되지 않았습니다.");
  }
  if (!containerName) {
    throw new Error(`환경변수 ${containerEnvKey}가 설정되지 않았습니다.`);
  }

  return new BlobService(connectionString, containerName);
}

/** 크롤링 원본 데이터 컨테이너 (raw-data) */
export function createRawDataBlobService(): BlobService {
  return createBlobServiceFromEnv("BLOB_CONTAINER_RAW_DATA");
}

/** 정제 데이터 컨테이너 (normalized-data) */
export function createNormalizedDataBlobService(): BlobService {
  return createBlobServiceFromEnv("BLOB_CONTAINER_NORMALIZED_DATA");
}

/** 리포트 데이터 컨테이너 (reports) */
export function createReportsBlobService(): BlobService {
  return createBlobServiceFromEnv("BLOB_CONTAINER_REPORTS");
}
