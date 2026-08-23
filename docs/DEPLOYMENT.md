# 공개 테스트 배포

공개 테스트는 Firebase Hosting이 `client/dist`를 HTTPS CDN으로 제공하고, Cloud Run이 별도 WSS origin에서 권위 게임 서버만 실행한다. Firebase Hosting의 Cloud Run rewrite는 60초 요청 제한이 있어 6분 경기 WebSocket에 사용하지 않는다. Cloud Run WebSocket의 최대 요청 시간은 60분이므로 클라이언트의 기존 재접속 흐름을 유지한다.

초기 환경은 **최대 24명(8인 Room 3개), Cloud Run 인스턴스 1개**로 고정한다. Room 상태가 프로세스 메모리에 있으므로 인스턴스를 늘리면 같은 Room의 참가자가 분산될 수 있다.

## 1. Google Cloud/Firebase 프로젝트 준비

새 Blaze Firebase 프로젝트를 만든다. 프로젝트 ID는 소문자·숫자·하이픈으로 구성하고, 이 문서에서는 `PUBLIC_PROJECT_ID`로 표기한다.

1. Google Cloud Console에서 새 프로젝트를 만들고 Billing 계정을 연결한다.
2. Firebase Console에서 같은 Google Cloud 프로젝트에 Firebase를 추가하고 Hosting을 활성화한다.
3. Cloud Run, Cloud Build, Artifact Registry, Firebase Hosting API를 활성화한다.
4. 운영자 로컬에서 Google Cloud CLI와 Firebase CLI를 설치한 뒤 각각 로그인한다.

```sh
gcloud auth login
firebase login
gcloud config set project "$PUBLIC_PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com
```

Google Cloud Billing에서 이 프로젝트의 예산 알림을 만든다. 공개 테스트 예산은 팀이 정한 월 상한의 50%, 90%, 100%에서 이메일 알림을 보내도록 설정한다. 알림은 비용을 자동으로 중단하지 않으므로 Cloud Run의 `max-instances=1`과 서버의 24명 입장 상한을 함께 유지한다.

## 2. 한 번의 배포

`METRICS_TOKEN`은 32자 이상 임의 문자열이며 절대 저장소에 넣지 않는다. 스크립트는 이를 Secret Manager의 `squirrel-metrics-token` 새 version으로 저장해 Cloud Run에 주입하고, Docker 이미지를 Artifact Registry에 빌드한 뒤 실제 Cloud Run URL을 `VITE_WS_URL`로 주입해 Firebase Hosting을 배포한다.

```sh
export PUBLIC_PROJECT_ID="your-public-test-project"
export METRICS_TOKEN="replace-with-a-32-character-or-longer-random-token"
npm run deploy:public
```

고정값은 다음과 같다.

- Region: `asia-northeast3`
- Cloud Run: 1 CPU, 512 MiB, `min-instances=1`, `max-instances=1`, concurrency 32, timeout 3600초, public ingress
- 서버 환경: `MAX_PUBLIC_PLAYERS=24`, `JOIN_ATTEMPTS_PER_MINUTE=6`, `MATCH_BOT_FILL_DELAY_MS=60000`, `MATCH_BOT_FILL_INTERVAL_MS=10000`, `TRUST_PROXY=true`
- 허용 WebSocket origin: `https://<project>.web.app`, `https://<project>.firebaseapp.com`

실행 전 명령만 검토하려면 `npm run deploy:public -- --dry-run`을 사용한다. 스크립트는 Firebase project alias를 파일에 저장하지 않고 `--project`를 매번 전달한다.

## 3. 공개 URL과 운영 확인

플레이어는 `https://<PUBLIC_PROJECT_ID>.web.app`로 접속한다. Cloud Run의 `run.app` URL은 WSS endpoint와 health check용이며, 게임 HTML 배포 경로가 아니다.

```sh
curl -fsS "$(gcloud run services describe squirrel-heist --region asia-northeast3 --format='value(status.url)')/health"
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" "$(gcloud run services describe squirrel-heist --region asia-northeast3 --format='value(status.url)')/metrics"
```

`/metrics`는 `METRICS_TOKEN`이 설정되면 Bearer token 없이는 401을 반환한다. 운영자는 `export METRICS_TOKEN="$(gcloud secrets versions access latest --secret=squirrel-metrics-token)"`으로 token을 읽어 아래 metrics 요청에 사용한다. `/health`는 Cloud Run probe와 공개 상태 점검을 위해 token 없이 응답한다.

## 4. 배포 리허설

공개 링크에서 Chromium·Firefox로 각각 접속해 Firebase HTTPS 페이지가 Cloud Run `wss://` endpoint에 연결되는지 확인한다. 이후 24명을 3개 Room으로 채워 각 Room이 8명으로 시작하는지, 25번째 신규 입장이 `SERVER_FULL`로 거부되는지, 동일 IP의 7번째 신규 입장이 1분 동안 `JOIN_RATE_LIMITED`로 거부되는지 검증한다. 재접속 토큰을 가진 참가자는 정원이 찬 상태에서도 grace period 안에 복귀해야 한다.

Cloud Run revision 교체와 60분 request timeout은 연결을 끊을 수 있다. 실제 공개 전에 8명 경기 중 revision 배포를 한 번 수행해 자동 재접속·full resync가 정상인지 확인한다.

공개 빠른 매칭은 첫 참가 뒤 60초 동안 8명이 모이지 않으면 공통 rule-based bot을 한 명 추가하고, 이후 10초마다 한 명씩 추가한다. bot도 일반 플레이어 슬롯을 쓰며, 사람이 모두 떠난 bot Room은 자동 회수한다.

## 범위 밖

custom domain, CI/CD 자동 배포, Google 로그인, Cloud Armor, 다중 Cloud Run 인스턴스는 이번 공개 테스트 범위에 포함하지 않는다. 24명 이상이 필요하면 Room 상태를 Redis 등 공용 계층으로 분리하거나 Cloudflare Durable Objects 기반으로 서버 권위 계층을 다시 설계한다.
