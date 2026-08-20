# 도토리 대소동 작업 일지

이 파일은 구현 결정, 실제 변경, 검증 결과와 다음 작업을 시간순으로 누적한다. 완료된 과거 기록은 덮어쓰지 않고 정정이 필요하면 새 항목을 추가한다.

## 2026-08-20 — P0~P6 MVP 수직 절편과 플레이 환경

### 목표

- 프로젝트 사양서 16절의 P0부터 P6까지 서버 권위 MVP를 구축하고 현재 Arch Linux 환경에서도 사람이 플레이할 수 있게 한다.

### 주요 결정과 작업

- npm workspace를 `client`, `server`, `shared`, `tools`로 구성하고 TypeScript strict, Vitest, ESLint, Playwright 명령을 연결했다.
- 클라이언트는 Three.js와 브라우저 기본 WebSocket, 서버는 `ws`와 고정 20Hz 권위 시뮬레이션을 사용한다.
- Room tick 실패 시 해당 Room만 `CLOSED`로 전환하고 오류를 알린 뒤 연결을 종료하며 다른 Room은 계속 실행한다.
- 맵 크기를 32×24에서 64×48로 늘려 면적을 4배로 만들되 이동속도와 상호작용 수치는 유지했다. generatorVersion과 balanceVersion은 2다.
- P0~P5의 기반, 네트워크 이동, 절차 맵, 8인/도토리, 체포/감옥/구출, 베리/람쥐썬더를 구현했다. P6에는 HUD, 기본 오디오, 재접속/full resync, 부하 도구, Room 격리와 브라우저 사전 점검이 포함된다.
- Arch Linux에서 로컬 WebKit 실행은 공식 Playwright 배포 대상 ABI와 맞지 않아 Chromium·Firefox를 로컬 필수 검사로 사용하고 WebKit은 GitHub Actions의 지원 환경에서 검사하도록 정리했다.

### 검증

- 맵 생성기는 1,000개 seed 결정론/validator 테스트를 통과했다.
- Room 장애가 다른 Room으로 전파되지 않는 통합 테스트를 추가했다.
- Chromium과 Firefox에서 클라이언트 연결/렌더 E2E를 통과했다.

### 남은 작업

- 실제 8인 지연 환경 플레이테스트, 연출 완성도, WSS 배포 리허설과 동일 revision의 WebKit CI 확인이 남아 있다.

## 2026-08-20 — 화면 이동축과 커서 조준 수정

### 목표

- 화면에서 A/D/W/S 방향을 직관적으로 일치시키고 캐릭터와 람쥐썬더가 현재 커서 방향을 따르게 한다.

### 아키텍처 결정

- 게임 좌표는 `+X=화면 오른쪽`, `+Y=화면 위`로 유지하고 Three.js 표현 계층에서 `(x, y)`를 `(x, height, -y)`로 변환한다.
- 로컬 캐릭터의 방향만 커서 위치로 즉시 예측 표시한다. 발사 가능 여부, 투사체 생성/이동, 벽·상대 충돌과 기절은 계속 서버 권위다.
- `InputCommand`와 protocol v1 wire format은 변경하지 않는다.
- 커서가 플레이어와 겹치거나 캔버스를 벗어나 유효한 방향을 만들지 못하면 마지막 유효 조준 방향을 유지한다.

### 변경 사항

- 카메라 handedness와 모든 맵/엔티티/카메라 추적 좌표를 단일 게임→Three.js 변환에 맞췄다.
- 실제 캔버스 경계와 현재 카메라를 사용해 포인터 ray를 지면에 투영하고 예측된 로컬 위치에서 조준 벡터를 계산한다.
- 로컬 렌더 방향은 매 프레임 갱신하고 원격 플레이어는 서버 snapshot의 `facing`을 계속 사용한다.
- 서버가 최신 입력의 조준을 먼저 적용한 다음 `FIRE` 상승 에지를 처리하도록 순서를 수정했다.
- 이동키 `D`와 겹치던 충돌 디버그 토글을 백틱 키로 옮겼다.

### 자동 검증 결과

- `npm test`: 8개 파일, 34개 테스트 통과.
- `npm run lint`: 통과.
- `npm run build`: shared/server/client/tools 전체 통과.
- `npm run e2e -- --project=chromium --project=firefox`: 2개 브라우저 테스트 통과.
- `npm run playtest:preflight`: Arch Linux에서 Chromium·Firefox `PASS`, 로컬 WebKit `CI_REQUIRED`로 예상된 정책과 일치했다. 휴먼 세션 전 동일 revision의 WebKit GitHub Actions 확인은 여전히 필요하다.
- 추가 회귀 범위: WASD/방향키 벡터, 대각선 정규화, 화면 투영축, 이동한 카메라와 비정사각 viewport의 포인터 역변환, 캔버스 외부 포인터, 클릭 입력과 같은 패킷의 최신 조준 발사.
- 수정된 개발 서버를 다시 실행하고 봇 7명으로 Room `89957D`를 8명 `PLAYING` 상태로 시작했다. 확인 시 invalid message는 0건이고 Room tick p95는 약 1.39ms였다.

### 다음 작업

- 현재 개발 서버와 봇으로 네 방향 이동, 정지/이동 중 커서 추적, 람쥐썬더 발사 방향을 사람 조작으로 확인한다.
- 휴먼 플레이테스트 직전에 의존성 preflight와 동일 revision의 WebKit GitHub Actions를 다시 확인한다.
- 이후 실제 8인 지연 플레이테스트, 애니메이션/VFX/오디오 보강, WSS 배포 리허설 순으로 P6를 진행한다.

## 2026-08-20 — 핵심 아키텍처 메서드 주석과 코드 리뷰 (진행 중)

### 목표

- 핵심 아키텍처의 메서드 경계에 책임, 권위, 순서, 불변조건과 부작용을 설명하는 주석을 추가하고 게시 전 코드를 검토한다.

### 변경 사항

- 공유 수학·충돌·프로토콜·맵 생성/검증, 서버 gateway·RoomManager·fixed tick·MatchRoom·관측 지표, 클라이언트 입력·네트워크·prediction·snapshot·Three.js adapter에 한국어 JSDoc을 추가했다.
- `.codex/AGENTS.md`에 핵심 메서드 주석의 필수 범위와 작성 기준, 동작 변경 시 주석 동기화 규칙을 추가했다.
- `npm test` 34개, `npm run lint`, `npm run build`가 모두 통과했다.

### 코드 리뷰에서 확인한 후속 결정

- 하나의 서버 tick 전에 버튼 press와 release가 함께 도착하면 현재 마지막 입력만 소비하므로 rising edge 행동이 유실될 수 있다. sequence 순서대로 모든 버튼 edge를 처리하고 이동·조준은 최신 입력을 사용하는 개선이 필요하다.
- 로컬 prediction 초기화 여부를 좌표 `(0, 0)`으로 추정하고 있어 실제 권위 위치가 원점이면 pending 입력이 반복 초기화될 수 있다. 명시적인 초기화 상태가 필요하다.
- 재접속 유예 만료 후 플레이어 슬롯이 연결 없이 남고, 연결이 0인 PLAYING Room도 자동 정리되지 않는다. 빈 Room 종료와 부분 이탈자 처리 정책을 확정해야 한다.

### 승인 후 해결

- 입력 큐를 sequence 순서로 모두 소비해 한 tick 전에 press/release가 함께 도착해도 rising edge를 보존하고, 이동·조준의 지속 상태는 마지막 입력을 사용하도록 수정했다.
- `LocalPrediction.isConfigured`로 초기화 상태를 명시해 권위 위치가 `(0, 0)`이어도 pending 입력을 유지하도록 수정했다.
- 모든 연결의 재접속 유예가 끝난 빈 Room을 오류 없이 `CLOSED`로 전환하고 fixed tick frame 후 `RoomManager.cleanup()`이 회수하도록 연결했다. 일부 플레이어만 이탈한 경기는 기존 슬롯을 유지한다.
- 각 수정에 queued edge, 원점 prediction 초기화, abandoned Room 회수 회귀 테스트를 추가했다.

### 게시 상태

- 현재 작업 폴더의 `.git`에는 Git 이력과 remote가 없으며 GitHub CLI의 `tina445` 인증 토큰도 만료되어 commit/push는 대기 중이다.

### 게시 준비 완료

- `https://github.com/tina445/SquirrelGame.git`의 기존 `main` 이력 4개 커밋을 확인하고 로컬 작업 파일을 덮어쓰지 않은 채 연결했다.
- 통합 변경 브랜치는 사용자 결정에 따라 `develop`로 생성했다.
- 원격 루트의 `AGENTS.md`와 `squirrel-heist-project-spec.md` 경로를 보존하고 최신 지침·구현 현황을 반영했다. 로컬 `.codex/` 사본은 Git 게시 대상에서 제외했다.
- 최종 검증 결과는 `npm test` 8개 파일/37개 테스트, `npm run lint`, `npm run build`, Chromium·Firefox E2E 모두 통과다.
- 최종 diff에서 whitespace 오류와 추가 차단급 코드 리뷰 문제는 발견되지 않았다. 게시 commit은 전체 MVP 구현·안정화 범위를 나타내는 Conventional Commit으로 작성한다.

### 게시 결과

- `develop` 브랜치에 `f38c8329c30046516eddadf2ad94384eaae31f45` (`feat: complete MVP implementation and stabilization`)을 생성해 `tina445/SquirrelGame`의 `origin/develop`로 푸시하고 원격 ref 일치를 확인했다.
- push로 실행된 GitHub Actions `WebKit E2E` run `32335993442`가 Ubuntu 24.04에서 의존성 설치와 WebKit 브라우저 테스트를 모두 통과했다.
- 로컬 GitHub CLI의 초기 인증 진단과 달리 저장소의 HTTPS Git credential 및 승인된 GitHub Actions 조회는 정상 동작했다.
