# seoulmarket

> 한국 주식 시장 데이터를 수집·정규화·분석하여 Microsoft Teams로 브리핑 리포트를 발송하는 자동화 서비스

---

## 서비스 개요

`seoulmarket`은 매 평일 장 전·중·후 시점에 한국 주식 시장 데이터를 크롤링하고,  
LLM을 통해 인사이트를 생성한 뒤 Microsoft Teams 채널로 리포트를 발송하는 서버리스 자동화 파이프라인입니다.

- **크롤링**: GitHub Actions에서 Playwright + Cheerio로 데이터 수집
- **처리**: Azure Blob Storage에 raw → normalized 데이터 저장
- **분석**: OpenAI API를 통한 시황 요약 및 인사이트 생성
- **발송**: Microsoft Teams Webhook으로 Adaptive Card 형식 리포트 전달

---

## 실행 일정

크롤링은 GitHub Actions `schedule` 트리거(UTC 기준)로 매 평일 자동 실행됩니다.

| 한국 시간 (KST) | UTC cron 표현식 | 설명 |
|---|---|---|
| 평일 08:00 | `0 23 * * 0-4` (전일) | 장 시작 전 브리핑 |
| 평일 15:00 | `0 6 * * 1-5` | 장 마감 전 브리핑 |
| 평일 19:00 | `0 10 * * 1-5` | 장 마감 후 정리 |

---

## 시스템 구조

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Actions                     │
│                                                     │
│  schedule (cron) ──► crawl.yml                      │
│                       │                             │
│                  Playwright + Cheerio                │
│                  index-board.space 크롤링            │
│                       │                             │
│                  scripts/crawl.ts 실행               │
│                       │                             │
│              Azure Storage Queue에 메시지 push        │
│              + raw-data Blob에 HTML 저장              │
└──────────────────────┬──────────────────────────────┘
                       │ Queue Trigger
┌──────────────────────▼──────────────────────────────┐
│               Azure Functions (Flex Consumption)     │
│                                                     │
│  generateReportJob  (Timer Trigger)                 │
│    │                                                │
│    ├─ normalizerService  : raw → NormalizedSnapshot  │
│    ├─ llmService         : OpenAI 인사이트 생성       │
│    ├─ blobService        : reports/ 에 JSON 저장     │
│    └─ teamsService       : Teams Webhook 발송        │
│                                                     │
│  pushLatestReport  (HTTP Trigger / POST)            │
│    └─ 가장 최근 리포트를 수동으로 Teams에 재발송        │
└─────────────────────────────────────────────────────┘
```

### 데이터 플로우

```
크롤링 (GitHub Actions)
  └─► raw-data Blob 저장
        └─► normalize
              └─► normalized-data Blob 저장
                    └─► LLM 분석
                          └─► reports Blob 저장
                                └─► Teams 리포트 발송
```

### Blob Storage 경로 구조

```
[raw-data]
  └── {YYYY-MM-DD}/{requestedAt}.html

[normalized-data]
  └── {YYYY-MM-DD}/{requestedAt}.json

[reports]
  └── {YYYY-MM-DD}/{requestedAt}.json
```

---

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| **런타임** | Node.js 22, TypeScript 5 |
| **서버리스** | Azure Functions v4 (Flex Consumption Plan) |
| **스토리지** | Azure Blob Storage, Azure Storage Queue |
| **크롤링** | Playwright 1.51, Cheerio 1.2 |
| **LLM** | OpenAI API (`openai` SDK) |
| **스키마 검증** | Zod |
| **알림** | Microsoft Teams (Adaptive Card via Incoming Webhook) |
| **CI/CD** | GitHub Actions |

---

## 프로젝트 구조

```
seoulmarket/
├── .github/
│   └── workflows/
│       ├── crawl.yml                         # 크롤링 자동화 (스케줄 + Playwright)
│       └── main_func-az01-dev-seoulmarket.yml # Azure Functions 배포
├── scripts/
│   └── crawl.ts                              # 크롤링 진입점 (GitHub Actions에서 실행)
├── src/
│   ├── functions/
│   │   ├── generateReportJob.ts              # Timer Trigger - 리포트 생성 및 발송
│   │   └── pushLatestReport.ts               # HTTP Trigger - 최신 리포트 수동 재발송
│   ├── models/
│   │   ├── insightSchema.ts                  # MarketInsight 타입 / Zod 스키마
│   │   └── normalizedData.ts                 # NormalizedSnapshot 타입
│   ├── services/
│   │   ├── blobService.ts                    # Blob 읽기/쓰기/목록 조회
│   │   ├── crawlerService.ts                 # Playwright 크롤링 로직
│   │   ├── llmService.ts                     # OpenAI 프롬프트 및 응답 파싱
│   │   ├── normalizerService.ts              # raw HTML → NormalizedSnapshot 변환
│   │   ├── queueService.ts                   # Storage Queue 메시지 발행
│   │   └── teamsService.ts                   # Teams Adaptive Card 구성 및 발송
│   └── utils/
│       └── logger.ts                         # 로깅 유틸리티
├── host.json
├── local.settings.json.example               # 로컬 개발용 환경변수 예시
├── package.json
└── tsconfig.json
```

---

## 환경 변수

`local.settings.json.example`을 복사하여 `local.settings.json`으로 로컬 개발 환경을 설정합니다.  
운영 환경 변수는 GitHub Actions Secrets 및 Azure Function App Settings에서 관리합니다.

| 변수명 | 설명 |
|---|---|
| `CRAWL_TARGET_URL` | 크롤링 대상 URL |
| `STORAGE_CONNECTION_STRING` | Azure Storage 연결 문자열 |
| `REPORT_GENERATE_QUEUE_NAME` | 리포트 생성 트리거 큐 이름 |
| `BLOB_CONTAINER_RAW_DATA` | raw HTML 저장 컨테이너명 |
| `BLOB_CONTAINER_NORMALIZED_DATA` | 정규화 데이터 저장 컨테이너명 |
| `BLOB_CONTAINER_REPORTS` | 리포트 JSON 저장 컨테이너명 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `TEAMS_WEBHOOK_URL` | Teams Incoming Webhook URL |

---

## 로컬 개발

```bash
# 의존성 설치
npm ci

# 빌드
npm run build

# Azure Functions 로컬 실행 (azure-functions-core-tools 필요)
npm start

# 크롤링 스크립트 단독 실행
npm run crawl
```

---

## 트러블슈팅

### GitHub Actions에서 빌드한 Playwright Chromium을 Azure Functions에서 사용 불가

**문제**

초기 설계에서 GitHub Actions의 빌드 단계에서 `playwright install chromium --with-deps`를 실행하고, 해당 바이너리를 zip에 포함하여 Azure Functions에 배포하려 했습니다.  
그러나 실제 동작하지 않았고, zip 용량이 150MB+ 증가하는 문제가 있었습니다.

**원인**

- GitHub Actions Ubuntu 러너에서 빌드된 Chromium 바이너리는 해당 **OS와 시스템 라이브러리 버전에 종속**됩니다.
- Azure Functions Flex Consumption 플랜의 런타임 환경은 GitHub 러너와 **OS 및 동적 라이브러리가 다를 수 있어** 바이너리를 직접 실행할 수 없습니다.
- 또한 Flex Consumption은 `WEBSITE_RUN_FROM_PACKAGE` 기반으로 동작하여 `wwwroot`가 읽기 전용이므로, 런타임에 `playwright install`을 실행하는 것도 제약이 있습니다.

**해결**

크롤링 책임을 **Azure Functions에서 GitHub Actions으로 이관**했습니다.

- GitHub Actions Ubuntu 러너는 OS 환경이 고정되어 있어 `--with-deps` 옵션으로 Chromium과 시스템 패키지를 안정적으로 설치 가능합니다.
- 크롤링 결과는 Azure Storage(Blob + Queue)에 저장하고, Functions는 Queue 트리거로 후처리(정규화 → LLM 분석 → 발송)만 담당합니다.
- 배포 zip에서 `.playwright/`, `src/`, `*.ts`, `tsconfig*`를 제외하여 런타임에 불필요한 파일을 제거했습니다.

```
# Functions 배포 zip 구성 (런타임 필요 파일만 포함)
dist/          ← 컴파일된 JS
node_modules/  ← 런타임 의존성
host.json
package.json
```
