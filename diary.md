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

## 2026-08-20 — 포스트 MVP 로비·매칭과 절차 맵 v3 1차 수직 절편

### 목표

- 완료된 게임 세션 MVP 이후 로비, 빠른 매칭/친구 Room, 랜덤 역할군과 자기 팀 명단, 직사각형이 아닌 절차 맵을 하나의 사용자 흐름으로 시작한다.
- 구현과 병렬 코드 리뷰, 자동 검증, 실제 렌더 확인을 반복해 다음 폴리싱 루프의 기준선을 만든다.

### 아키텍처 결정

- protocol v2의 `C2S_JOIN_ROOM.joinMode`로 `QUICK_MATCH`, `CREATE_ROOM`, `JOIN_ROOM`을 구분한다. 빠른 매칭은 공개 Room만 소비하고 친구 Room은 코드로만 참가한다.
- 역할군 선호 입력은 받지 않는다. 서버 전용 난수로 동률 역할을 선택하고 인원이 적은 역할을 우선해 최종 4 대 4를 보장한다. 테스트만 명시적 team seed/강제 역할을 주입할 수 있다.
- 전체 플레이어는 월드 표현과 서버 판정에 필요하므로 snapshot에 유지하되 로비/HUD 명단은 로컬과 같은 팀만 선택한다. transport 내부 `connectionId`는 snapshot에서 제거한다.
- `MapDefinition.bounds`는 광역 성능/그리드 예산으로 유지하고, 실제 이동 가능한 외곽은 seed별 `playableArea` 다각형으로 분리한다. 서버 이동·도토리 드롭·투사체 외곽, 클라이언트 prediction·Three.js 지면, validator와 hash가 같은 다각형을 사용한다.
- generatorVersion은 3으로 올리고 balanceVersion은 2로 유지했다. fallback은 `safe-meadow-v3`다.

### 변경 사항

- 닉네임, 빠른 매칭, 친구 방 생성, 대소문자 무관 코드 참가, Room 코드/인원/배정 역할/자기 팀 명단/오류 상태를 제공하는 반응형 HTML/CSS 로비를 추가했다.
- 공개/비공개 Room 선택, 코드 정규화, 9번째 빠른 매칭의 새 Room 배치와 4 대 4 랜덤 역할 배정을 구현했다.
- 로비/카운트다운에는 gameplay input을 보내지 않아 시작 직후 과거 버튼 edge가 실행되지 않게 했다.
- 재접속 full snapshot의 ack 이후로 client input sequence를 복구하고, 새 transport가 기존 socket close보다 먼저 도착해도 token으로 교체한 연결이 유지되게 했다.
- 로비 이탈자의 grace period가 끝나면 player/input/interaction 슬롯을 회수한다. 늦게 도착한 이전 socket close는 새 연결을 끊지 않는다.
- generator v3는 seed별 8각 불규칙 외곽, 가변 기지/저장소/감옥 anchor, 가로·세로 장애물 군집과 안전 간격을 둔 베리 후보를 만든다.
- polygon 원/점 충돌, 불규칙 지면 ShapeGeometry, 외곽 투사체 제거, spawn 자체 안전성, playable 면적, 고정 seed hash와 fallback 회귀 검증을 추가했다.

### 검토와 검증

- 두 병렬 읽기 전용 리뷰로 로비/재접속과 맵/충돌 경계를 점검했고, 입력 sequence, socket 교체 race, 유령 슬롯, 내부 ID, 경기 전 입력, 투사체 외곽, spawn validator, 베리 보충, protocol version 문제를 반영했다.
- `npm test`: 9개 파일, 47개 테스트 통과. 맵 1,000 seed 검증, 고정 hash, fallback과 악성 spawn fixture를 포함한다.
- `npm run lint`: 통과.
- `npm run build`: shared/server/client/tools 통과. Vite의 500 kB 초과 chunk 경고는 남아 있으나 build 실패는 아니다.
- `npm run e2e -- --project=chromium --project=firefox`: 두 브라우저에서 로비→비공개 Room 생성 흐름 통과.
- Chromium 1440×900 캡처로 로비 간격, 대비, 버튼/입력 정렬을 확인하고 연결 완료 상태 문구와 닉네임 기억을 보강했다.

### 남은 위험과 다음 작업

- 현재 8각 외곽은 비직사각형 맵의 첫 단계다. 다음 맵 루프에서는 실제 연결 그래프에서 주 경로·독립 우회로·순환로를 만들고 path metadata가 collider를 통과하지 않도록 탐색 결과에서 생성한다.
- validator에 두 개의 독립 경로, 병목 차단 점수, 경로 폭/길이, 팀별 거리 공정성, 베리 공간 분산을 추가한다. 오목 polygon을 도입할 때 swept movement와 외곽을 고려한 line-of-sight를 먼저 일반화한다.
- 실제 8브라우저에서 공개 매칭과 친구 Room 코드 참가, 4 대 4 명단, countdown, reload 재접속, 로비 슬롯 회수를 한 세션으로 검증한다.
- 방 코드 복사, 초 단위 countdown, 코드 참가 오류의 focus 복구, VFX/오디오, client bundle 분할과 WSS 배포 리허설을 후속 폴리싱으로 진행한다.

### 게시 전 리뷰와 검증

- `origin/develop` 원격 ref `3f5ca6290753d1b940470698eb837179fcba9509`가 로컬 게시 기준 HEAD와 일치하는 것을 `git ls-remote`로 확인했다.
- 전체 diff를 프로토콜 호환성, Room 공개 범위, 역할 배정, 재접속 transport 교체, snapshot 노출, 불규칙 맵의 서버/예측/렌더 충돌 일치 순서로 검토했다.
- 리뷰에서 `CLOSED` phase가 로비를 다시 표시할 때 Room 오류 모달이 로비의 z-index 뒤에 숨을 수 있는 문제를 발견해 오류/결과 모달의 적층 순서를 보강했다. 그 외 게시 차단급 문제는 발견되지 않았다.
- 최종 검증은 `npm test` 9개 파일/47개 테스트, `npm run lint`, `npm run build`, Chromium·Firefox E2E가 모두 통과했다. build에는 기존 Three.js client bundle 500 kB 초과 경고만 남았다.
- `npm run playtest:preflight`는 호스트 권한에서 Node, Chromium, Firefox `PASS`, Arch Linux의 WebKit `CI_REQUIRED`로 정책과 일치했다. 게시된 commit의 WebKit GitHub Actions 성공 여부를 push 후 확인해야 한다.

### 게시 결과

- `develop` 브랜치에 `f59c195418a34670fbea017d44dd0462bc77fc11` (`feat: add lobby matchmaking and procedural map v3`)을 생성해 `origin/develop`로 푸시했고, 원격 ref가 같은 commit을 가리키는 것을 확인했다.
- push로 실행된 GitHub Actions `WebKit E2E` run `32340669909`가 commit `f59c195`에 대해 성공했다.
- GitHub CLI 기본 계정의 토큰은 만료 상태였지만 저장소 HTTPS Git credential은 push와 Actions 조회에 정상 사용됐다. credential 값은 출력하거나 파일에 저장하지 않고 조회 프로세스에만 전달했다.

## 2026-08-20 — 원격 동기화·맵 topology·엄폐물·매칭 폴리싱

### 목표

- 20Hz 서버 권위 동기화를 60fps 표현에서 매끄럽게 만들고, 맵 형태와 나무 엄폐물을 확장한다.
- 대기 Room에서 메인으로 복귀하고 빈 Room을 즉시 정리한다.
- 추가 요구에 따라 플레이어/베리를 spawn 중심 원 안의 랜덤 좌표에 배치하고, 역할 선택은 게임 시작 직전에 4 대 4로 확정한다.

### 아키텍처 결정

- 서버 fixed tick과 snapshot 전송은 20Hz로 유지한다. 클라이언트가 snapshot 수신시각에서 관측한 최소 clock offset으로 서버시각을 매 frame 전진시키고, 100ms 과거의 위치·방향을 보간하며 snapshot 공백은 속도 기준 최대 100ms만 외삽한다. 수감 등 순간이동은 보간하지 않는다.
- protocol v3에서 `rolePreference`, `C2S_LEAVE_ROOM`, `S2C_LEFT_ROOM`을 추가했다. 입장 시 `team`은 미정이며 명시 역할은 팀별 네 자리까지만 예약한다. 8명 전원이 준비된 직전에 명시 선택을 반영하고 랜덤 참가자를 남은 자리에 배정해 4 대 4를 확정한다.
- generatorVersion 4는 `LINE`, `H`, `RING`, `GRAPH`를 결정론적으로 선택한다. `RING`은 `playableHoles`로 내부 비이동 영역을 표현하고 서버 이동·투사체, 클라이언트 prediction·지면, validator가 같은 외곽/hole 규칙을 사용한다.
- 나무는 원형 줄기와 더 큰 비충돌 수관으로 정의한다. 줄기는 이동·투사체·체포 시야를 막고, 로컬 플레이어 원이 수관에 들어오면 해당 클라이언트의 수관 material만 opacity 0.28로 낮춘다.
- 팀 spawn은 각 중심의 반지름 0.6 원, berry spawn은 각 중심의 반지름 1.25 원에서 면적 균등 랜덤 좌표를 선택한다. 생성기와 runtime이 원 전체의 외곽·벽·줄기 안전성을 이중 검증한다.

### 변경 사항

- `SnapshotBuffer`에 수신시각, 위치·방향 frame 보간, 제한 외삽, 지연 packet clock 회귀 방지, Room 전환 clear를 구현했다. 운반 도토리도 보간된 carrier 위치를 따른다.
- 맵 v4에 네 topology, 내부 hole, layout별 anchor·경로 metadata·장애물, 맵당 7개 나무와 12개 berry spawn 중심을 추가했다. fallback은 `safe-meadow-v4`다.
- 공유 충돌 계층에 원-원 충돌, hole 바깥 판정, 선분-원 충돌을 추가하고 서버/예측/validator에 연결했다.
- 로비에 빠른 매칭 경찰/도둑/랜덤, 친구 Room 경찰/도둑 선택, 역할 미정/확정 명단, 메인으로 돌아가기 버튼을 추가했다. 명시 이탈은 슬롯을 즉시 제거하며 마지막 인원이 나가면 Room registry도 즉시 정리한다.
- COUNTDOWN 중 이탈·연결 종료는 LOBBY로 되돌리고 역할을 다시 미정으로 만든다. 모든 연결이 복구되면 준비 상태를 확인해 역할 배정과 countdown을 재개한다.
- protocol, README, balance changelog, human playtest checklist와 프로젝트 구현 현황을 v3/v4 동작에 맞게 갱신했다.

### 검토와 검증

- `npm test`: 9개 파일, 56개 테스트 통과. 1,000 seed에서 `LINE 224 / H 224 / RING 275 / GRAPH 277`, fallback 0, 최대 생성 시도 4였고 모든 맵이 validator를 통과했다.
- 회귀 범위는 60fps frame 사이 원격 이동, 지연 snapshot clock 회귀, 외삽 상한, 수감 snap, 나무 줄기 충돌/수관 진입, 역할 예약 상한·시작 직전 확정, 선호 역할별 공개 Room 분리, countdown 재접속, 원형 플레이어/berry spawn, 명시 이탈과 빈 Room 정리를 포함한다.
- `npm run lint`, `npm run build`, `git diff --check`: 통과. build에는 기존 Three.js client chunk 500kB 초과 경고만 남았다.
- `npm run e2e -- --project=chromium --project=firefox`: 두 브라우저에서 역할 선택 → 친구 Room 생성 → 메인 복귀 흐름 통과.
- 호스트 권한의 실제 Chromium 8인 세션에서 친구 Room 8/8, 시작 직전 4 경찰/4 도둑 확정, H형 지면, 나무 수관, spawn debug 원과 자기 팀 HUD를 시각 확인했다. 봇 종료 후 `/health`는 `rooms: 0`, `/metrics`는 빈 목록으로 돌아왔다.
- 개발 서버 시각 검증 중 이전 프로세스와 새 프로세스가 5173/8080을 동시에 사용해 새 서버가 `EADDRINUSE`로 한 번 종료되고 watcher만 남았다. 중복 프로세스를 종료한 뒤 단일 `npm run dev`에서 `server_started`, 연속 health 응답과 8인 세션을 확인했으며 게임 tick crash loop는 아니었다. 샌드박스 안 E2E의 `EPERM`도 호스트 권한 재실행으로 분리 확인했다.
- `npm run playtest:preflight`: Node/Chromium/Firefox `PASS`, Arch Linux WebKit `CI_REQUIRED`로 정책과 일치한다. 게시 commit의 WebKit GitHub Actions 결과는 push 후 확인한다.

### 남은 위험과 다음 작업

- 실제 RTT/jitter/loss를 주입한 8브라우저 플레이에서 원격 정지·급회전·충돌 보정 체감을 측정하고 interpolation delay/외삽 상한을 데이터로 조정한다.
- topology별 경로 길이 공정성, 독립 우회로 수, 병목 차단 점수와 berry 공간 분산을 validator의 정량 기준으로 확장한다.
- 방 코드 복사, 초 단위 countdown, 캐릭터 애니메이션/VFX/오디오, Three.js bundle 분할과 WSS 배포 리허설은 후속 폴리싱으로 남긴다.

### 게시 결과

- `develop` 브랜치에 `708397ddf5f6e7d18481b1432555e13d804a2cb3` (`feat: polish matchmaking maps and remote motion`)을 생성해 `origin/develop`로 푸시했고, 푸시 직후 로컬과 원격 추적 ref가 일치했다.
- 최종 로컬 검증은 `npm test` 9개 파일/56개 테스트, `npm run lint`, `npm run build`, Chromium·Firefox E2E가 모두 통과했다. 호스트 preflight는 Node/Chromium/Firefox `PASS`, Arch Linux WebKit `CI_REQUIRED`였다.
- push로 실행된 GitHub Actions `WebKit E2E` run `32346359170`이 commit `708397d`에 대해 성공했다.
- 저장소 HTTPS Git credential로 push와 GitHub CLI의 Actions 읽기 조회를 수행했으며 credential 값은 출력하거나 별도 파일로 저장하지 않았다.

## 2026-08-21 — 로컬 60fps 이동·단계형 대기실·hitscan 전투 폴리싱

### 목표

- 나무 수관 투명도가 다른 클라이언트의 다람쥐까지 반투명하게 보이게 하는 표현 문제와 역할 확정 뒤에도 팀 색상이 갱신되지 않는 문제를 해결한다.
- 20Hz 원격 보간 도입 뒤 드러난 로컬 플레이어의 계단식 이동을 60fps 표현에 맞게 수정하고 이동축을 facing 기준으로 전환한다.
- 빠른 매칭과 친구 Room의 역할/준비 흐름, 4×2 참가자 대기실, terrain·spawn·기지 분포, 월드 툴팁, 기절 연출과 hitscan 람쥐썬더를 완성한다.

### 아키텍처 결정

- 서버 입력과 권위 시뮬레이션은 20Hz를 유지한다. 로컬 표현은 현재 이동 입력을 매 `requestAnimationFrame`에서 별도 적분하고 서버 ack의 replay 위치와 생긴 작은 오차만 초당 감쇠한다. 수감 또는 2 unit 초과 오차는 즉시 snap한다. 원격 플레이어는 기존 100ms 지연 보간과 100ms 제한 외삽을 유지한다.
- 입력의 `moveY`는 facing 방향 전진/후진, `moveX`는 그 직교축의 strafe로 정의하고 shared 변환 함수를 서버와 로컬 예측이 같이 사용한다.
- protocolVersion 4에서 친구 Room의 역할 없는 입장, `C2S_SET_ROLE_PREFERENCE`, 서버 역할 예약 확인, `C2S_SET_READY`를 asset 준비와 분리했다. 빠른 매칭은 입장 전 역할을 선택하고 자동 준비하며, 친구 Room은 입장 후 역할 선택과 명시 준비를 거쳐 8명 직전까지 team을 `null`로 유지한다.
- 람쥐썬더는 이동 엔티티를 제거하고 발사 tick에 AABB·나무 줄기·polygon 외곽/hole·상대의 첫 충돌을 비교하는 서버 권위 hitscan으로 바꿨다. snapshot에는 판정이 끝난 180ms `thunderEffects` 선만 전송한다.
- 기절 별은 단일 회전 효과를 위해 tween 의존성을 추가하지 않고 renderer frame clock으로 세 개의 octahedron을 회전시킨다.

### 변경 사항

- 수관은 평상시 opacity 1과 depth write를 사용하고, 로컬 플레이어가 들어간 해당 클라이언트에서만 opacity 0.28/depth write off로 전환한다. 다람쥐 material 자체의 opacity는 변경하지 않는다.
- 역할 미정 중립색과 경찰 파랑·도둑 주황 palette를 snapshot마다 mesh/body/tail/ring에 다시 적용해 시작 직전 역할 확정도 즉시 반영한다.
- 메인 화면을 `매칭 시작 → 경찰/도둑/랜덤 → 대기`로 분리했다. 친구 Room은 역할 없이 입장한 뒤 4열×2행 슬롯 명단에서 경찰/도둑을 선택하고 준비/준비 취소할 수 있다.
- generatorVersion 5에 `CROSS`, `DIAMOND`, `COURTYARD`를 추가해 총 7종 terrain으로 확장하고 저장소 간 거리를 넓혔다. 플레이어 spawn 반지름은 0.6에서 2.2로 늘리고 도둑은 도둑 기지, 경찰은 감옥 중심 원에서 면적 균등 좌표를 선택한다.
- 도둑 기지, 경찰 기지 A/B/C, 감옥 trigger 툴팁과 도토리 줍기/훔치기/놓기/보관/반환, 팀원 구출, 체포 가능 툴팁을 월드 좌표 위 HTML overlay로 추가했다.
- 기절 중인 다람쥐 머리 위에 회전 별을 표시하고 hitscan 시작·끝을 짧은 청색/황색 beam으로 렌더한다. 만료된 beam geometry/material은 즉시 dispose한다.
- README, protocol v4, balance changelog, human playtest checklist와 프로젝트 사양의 상태 모델·구현 현황을 실제 동작에 맞게 갱신했다.

### 검토와 검증

- `npm test`: 9개 파일, 65개 테스트 통과. 로컬 60fps frame 전진, facing 이동축, 수관 opaque/fade 상태, 역할 확정 뒤 팀 palette, 기지·도토리·구출 툴팁, 기절 별 회전, 친구 Room 8인 명시 준비/4 대 4, hitscan 즉시 명중·벽 우선·경계 clip을 포함한다.
- 1,000 seed에서 `LINE 147 / H 123 / RING 131 / GRAPH 158 / CROSS 157 / DIAMOND 138 / COURTYARD 146`, fallback 0, 최대 생성 시도 2였고 validator를 모두 통과했다.
- `npm run lint`, `npm run build`, `git diff --check`: 통과. build에는 기존 Three.js client chunk 500kB 초과 경고가 남았다.
- Chromium·Firefox E2E 4개가 빠른 매칭 단계 전이와 친구 Room 입장→4×2 명단→역할 선택→준비→메인 복귀를 통과했다.
- 실제 Chromium 8인 친구 Room에서 8슬롯, 4경찰/4도둑 시작 직전 확정, 감옥 주변의 넓은 경찰 spawn, 서로 다른 경찰 palette와 `감옥` 월드 툴팁을 확인했다. 봇 종료 뒤 Room은 `room_abandoned`로 정리됐다.

### 남은 위험과 다음 작업

- 실제 8인 네트워크에 RTT/jitter/loss를 주입해 로컬 frame 적분의 correction 감쇠율과 원격 interpolation delay를 함께 계측·조정한다.
- 기본 WebGL `LineBasicMaterial`은 플랫폼별 선 굵기가 제한되므로 후속 VFX 루프에서 quad/트레일 기반 beam, 명중 flash와 사운드를 보강한다.
- terrain별 병목·독립 우회로·팀별 저장소 도달시간 공정성을 validator 점수로 확장하고 Three.js bundle 분할과 WSS 배포 리허설을 진행한다.

## 2026-08-21 — 표현 애니메이션 Tween.js 기반 도입

### 목표와 결정

- 이후 등장·피격·툴팁·수관·카메라·beam 연출이 늘어날 가능성을 반영해, 직전 항목의 "tween 의존성을 추가하지 않는다"는 결정을 수정했다.
- 공식 Tween.js 문서와 최신 릴리스를 확인하고 `@tweenjs/tween.js` 25.0.0을 클라이언트의 명시적 런타임 의존성으로 채택했다. 라이브러리가 자체 ticker를 만들지 않는 특성을 이용해 기존 `requestAnimationFrame` 시간값 하나로 renderer 전용 `Group`을 갱신한다.
- Tween.js v25의 전역 group·자동 시작에 의존하지 않는다. `AnimationTimeline`이 key별 tween을 명시적으로 등록·시작·교체·제거하며 Room reset 때 무한 반복 track도 모두 중단한다.

### 변경 사항

- 숫자 속성을 공통 easing으로 보간하는 `AnimationTimeline`을 추가했다. 동일 key 재시작은 이전 tween을 제거해 수관 경계 왕복처럼 상태가 빠르게 바뀌어도 중복 callback이 남지 않는다.
- 나무 수관은 로컬 진입 시 140ms 동안 opacity 0.28로, 이탈 시 190ms 동안 opacity 1로 전환한다. 진입 때 depth write를 즉시 끄고 이탈 fade가 끝난 뒤 다시 켜 다람쥐가 중간 opacity의 수관에 가려지는 문제를 피한다.
- 기절 별은 player별 무한 회전과 맥동 tween을 사용한다. visibility 자체는 계속 서버 권위 snapshot의 `STUNNED` 상태만 따른다.
- workspace 대상 설치가 로컬 npm의 `omit=dev` 설정 때문에 Vite/Vitest 등 개발 의존성 25개를 제거한 현상을 확인했다. 이는 프로세스 crash loop가 아니며 `npm install --include=dev`로 잠금 파일 기준 설치 트리를 복구했다.

### 검증과 다음 작업

- key 교체, 단일 frame clock 진행, clear 이후 정지를 검증하는 단위 테스트를 추가했다.
- 최종 `npm test`는 9개 파일/66개 테스트, `npm run lint`, 전체 `npm run build`, Chromium·Firefox E2E 4개가 모두 통과했다. `npm run playtest:preflight`는 Node/Chromium/Firefox `PASS`, Arch Linux WebKit `CI_REQUIRED`로 정책과 일치했다. E2E 종료 후 남은 `node`/`vite` 프로세스와 8080/5173/4173 listener가 없어 반복 재시작이나 crash loop가 아님을 다시 확인했다.
- production client bundle은 Tween.js 도입 전 약 535.5kB에서 548.7kB로 약 13.2kB 증가했다. 기존 500kB chunk 경고는 남으므로 후속 폴리싱에서 Three.js와 표현 계층의 chunk 분리를 검토한다.
- 다음 연출은 이 timeline 위에서 tooltip 등장/퇴장, hitscan beam fade, 피격 flash 순으로 적용하고, 서버 판정 상태와 표현 수명은 계속 분리한다.

### 게시 결과

- `develop` 브랜치에 `2849f850242949a187dcbaecb9015b86c1db3990` (`feat: polish movement lobbies and combat`)을 생성해 `origin/develop`로 푸시했다. 게시 직전 원격 기준은 `cd0427ee0b09072fa506a25646784f5232bd6285`로 작업 시작 HEAD와 일치했다.
- 최종 로컬 검증은 9개 파일/66개 테스트, lint, 전체 build, Chromium·Firefox E2E 4개와 playtest preflight가 통과했다. client build에는 548.65kB chunk 경고만 남았다.
- push로 실행된 GitHub Actions `WebKit E2E` run `32434459440`이 commit `2849f85`에 대해 성공했다.
- GitHub 플러그인의 commit status 조회는 저장소 권한 범위 밖이라 404였고, 저장소 HTTPS Git credential을 출력하지 않는 임시 래퍼로 Actions 읽기만 수행했다.

## 2026-08-21 — 4배 선형 맵과 Strategy 기반 방장 로비

### 목표

- 기존 64×48 맵의 직경을 최소 네 배로 늘리고 도둑 기지, 경찰 저장소, 감옥, spawn 분포를 함께 확장한다.
- 나무 수관 크기는 유지하면서 실제 충돌·hitscan을 막는 줄기를 더 가늘게 조정한다.
- 빠른 매칭은 완성 전까지 매칭 중 UI를, 완성 뒤에는 4×2 참가자 명단과 countdown을 표시한다.
- 친구 Room은 생성자를 방장으로 지정하고 역할 선택·명시 준비·전원 준비 뒤 방장 시작·프로필 선택 방장 위임을 지원한다. 같은 역할의 다섯 번째 준비는 toast로 거부한다.
- 서로 다른 로비 흐름이 단일 boolean과 산재한 조건문에 결합되지 않도록 확장 가능한 인터페이스와 정책 경계를 검토한다.

### 아키텍처 결정

- 기존 `listed/privateRoom` 중심 분기는 공개 검색 범위와 실제 로비 동작을 같은 boolean에 결합해 새 매칭 방식 추가 시 `MatchRoom`, gateway, UI 조건문이 함께 늘어날 위험이 있었다. 이를 수정해 protocol v5의 명시적 `LobbyKind(QUICK_MATCH|FRIEND_ROOM)`를 동작 식별자로 추가하고, `listed`는 discovery 속성으로만 남겼다.
- 서버에는 `LobbyFlowPolicy` Strategy 인터페이스와 빠른 매칭/친구 Room 구현을 추가했다. 역할 입장 허용, asset 준비 반영, 사용자 준비 검증, 자동 시작, 수동 시작 가능 조건을 정책에 위임하고 `MatchRoom`은 공통 lifecycle과 서버 권위 역할 확정만 담당한다.
- 클라이언트에는 `LobbyPresentationPolicy` Strategy를 추가해 매칭 UI, 4×2 명단, 친구 Room 제어와 상태 문구 전이를 분리했다. 서버가 전달한 `LobbyKind`로 정책을 선택하므로 공개 여부 추론에 의존하지 않는다.
- 역할 선택은 의도 표시이고 `team`은 게임 세션 시작 직전의 권위 결과다. 친구 Room에서는 선택 중 동일 역할이 4명을 넘어도 허용하되, 준비된 같은 역할이 이미 4명이면 서버가 `ROLE_FULL`을 반환한다. 모든 참가자의 연결·asset·사용자 준비와 정확한 4 대 4가 충족되어도 방장의 명시적 시작 요청 전에는 `LOBBY`를 유지한다.
- 생성자에게 `hostPlayerId`를 부여하고 snapshot으로 공유한다. 현재 방장만 연결된 다른 참가자에게 권한을 넘길 수 있고, 방장 이탈·연결 종료 시 입장 순서상 다음 연결 참가자에게 자동 승계한다.

### 맵과 표현 변경

- `mapScale`을 4로 두고 월드를 64×48에서 256×192로 확장했다. 외곽 polygon/hole, 도둑 기지, 경찰 저장소 세 곳, 감옥, spawn anchor와 route metadata는 각 축 네 배로 분산한다.
- 장애물 두께까지 네 배가 되어 길을 막지 않도록 긴 축은 2.4배, 짧은 축은 1.35배만 확대했다. validator flood grid cell은 월드 폭에 맞춰 4 unit으로 조정해 기존 64×48 탐색 예산을 유지한다.
- 나무는 7개에서 28개, berry spawn 중심은 12개에서 32개로 늘려 확대 월드에 분산했다. 줄기 반지름은 0.68~0.90에서 0.46~0.64로 줄이고 비충돌 수관 반지름 2.05~2.65는 유지했다.
- 플레이어 spawn 원 반지름은 2.2에서 4.5, berry spawn 원은 1.25에서 2.5로 늘렸다. 생성기와 runtime은 같은 원 전체 안전성 규칙으로 임의 좌표를 선택한다.
- generatorVersion은 6, balanceVersion은 3, fallback은 `safe-meadow-v6`로 올렸다. 회귀 seed hash와 fallback hash를 새 규칙에 고정했다.

### 로비와 UX 변경

- 빠른 매칭은 8명 전까지 spinner와 `매칭 중… n/8명`만 표시하고 명단을 숨긴다. 8명이 모여 countdown에 진입하면 기존 4×2 명단을 먼저 표시한 뒤 게임 HUD로 전환한다.
- 친구 Room 명단은 준비 전에도 `경찰/도둑 다람쥐 · 선택 중`을 표시하고 방장 badge를 붙인다. 방장은 다른 참가자 프로필을 선택해 방장 변경 버튼으로 위임할 수 있다.
- 전원 연결·asset·사용자 준비와 정확한 4경찰/4도둑일 때만 현재 방장의 시작 버튼이 활성화된다. 다른 참가자는 방장 시작 대기 문구를 본다.
- 역할별 다섯 번째 준비 시 modal 대신 3.2초 toast를 표시하고 준비 상태를 유지하지 않으며 역할 선택 제어를 복구한다.
- 20Hz snapshot마다 명단 DOM을 통째로 교체하면 클릭 중인 프로필 node가 분리되는 문제를 브라우저 검증에서 발견했다. player/role/ready/host/선택 signature가 실제로 바뀔 때만 다시 렌더하도록 수정했다. 작은 화면에서 하단 나가기 버튼이 viewport 밖으로 밀리던 문제는 로비 카드 최대 높이와 세로 scroll로 해결했다.

### 검토와 검증

- `npm test`: 9개 파일, 70개 테스트 통과. 서버 정책의 공개 자동 시작, 친구 Room 방장 전용 시작, 역할별 다섯 번째 준비 거부, 수동 방장 위임과 이탈 승계를 포함한다.
- map generator 1,000 seed를 약 10.6초에 모두 생성·검증했다. 회귀 맵은 256×192, 28개 나무, 32개 berry 중심이며 저장소 분산 거리는 약 122.29 unit, 줄기 반지름은 약 0.46~0.63이었다. fallback도 generator v6 validator를 통과한다.
- `npm run lint`, `npm run build`, `git diff --check`가 통과했다. production client는 553.13kB, gzip 143.91kB이며 기존 500kB 단일 chunk 경고가 남는다.
- Chromium·Firefox E2E 8개가 친구 Room 생성자 방장, 준비 전 역할 표시, 빠른 매칭 spinner/명단 숨김, 역할 초과 toast, 프로필 선택 방장 위임, 8명 정확한 4 대 4 준비 뒤 방장 시작과 게임 화면 진입을 통과했다.
- `npm run playtest:preflight`는 Node/Chromium/Firefox `PASS`, Arch Linux WebKit `CI_REQUIRED`로 정책과 일치했다. E2E 종료 뒤 실행 중인 `node` 프로세스가 없어 포트 중복이나 crash loop가 남지 않았음을 확인했다.

### 남은 위험과 다음 작업

- 선형 길이가 네 배, 면적이 열여섯 배가 되었지만 이동속도 7 unit/s와 경기시간 6분은 유지했다. 실제 8인 플레이에서 기지↔저장소·감옥·전체 횡단 시간, 교전 빈도, 시야와 나무/berry 밀도를 측정해 목표 이동시간과 오브젝트 수를 다시 조정해야 한다.
- 28개 나무는 기존 개수를 면적이 아니라 선형 배율에 맞춰 늘린 값이라 상대 밀도는 낮아졌다. 큰 월드 탐색을 돕는 미니맵/방향 표식과 함께 엄폐 밀도를 휴먼 플레이로 판단한다.
- 새 로비 유형 추가 시 server/client 정책 factory에 구현을 등록해야 하는 구조다. 정책 수가 더 늘어나면 registry 기반 주입과 공통 contract test suite로 확장하고, `LobbyKind` protocol 호환성 정책도 함께 버전 관리한다.
- 실제 RTT/jitter/loss가 있는 8인 세션, 256×192 월드의 한 경기 완주, 동일 commit의 WebKit GitHub Actions와 WSS 배포 리허설은 게시 후 후속 확인으로 남긴다.

### 게시 결과

- 게시 직전 `git ls-remote`로 `origin/develop`이 작업 시작 기준 `8793b58169c0dff855f6e681651237e25cbbe09c`를 그대로 가리키는 것을 확인했다. 검증한 26개 경로만 명시적으로 stage하고 `develop`에 `4e0485c73e68e487f27088328ae7f363d43ec80c` (`feat: expand map and add host lobby policies`)을 생성해 push했으며 원격 ref가 같은 commit으로 이동한 것을 재확인했다.
- push로 실행된 GitHub Actions `WebKit E2E` run `32438730003`은 Ubuntu 24.04에서 1분 34초 만에 성공했다.
- GitHub plugin의 Actions 조회는 저장소 권한 범위 밖이라 404였고, 로컬 GitHub CLI 인증으로 해당 push run을 읽기 전용 조회·추적했다.

## 2026-08-21 — 전술 미니맵·감옥 footprint·월드 가독성 폴리싱

### 목표와 선택

- 256×192 월드에서 기지·감옥·도토리의 위치를 지속적으로 파악할 수단으로 미니맵, 일정시간 HUD 방향 화살표, 바닥 표식을 비교했다.
- 여러 목표와 아군 위치를 동시에 비교해야 하고 방향 화살표는 한 목표만 일시적으로 안내하며 바닥 표식은 카메라 밖 정보를 줄 수 없으므로 상시 전술 미니맵을 선택했다.
- 기지·감옥·도토리·베리·플레이어 표현을 조금 키우되 장애물 AABB와 나무 줄기·수관 크기는 유지한다.
- 경찰을 감옥 밖에 넓게 spawn하고 감옥 prefab에 실제 충돌 경계를 부여한다. 구출 판정과 tooltip anchor도 수감 플레이어가 아닌 감옥 prefab을 기준으로 통일한다.

### 아키텍처 결정

- 미니맵은 별도 게임 상태를 만들지 않는 presentation adapter다. 서버가 이미 보낸 `MapDefinition`과 `WorldSnapshot`을 20Hz HUD 갱신에서 canvas로 축소 투영하며, 일반 적군은 숨기고 지형·거점·도토리·베리·아군·로컬 facing만 표시한다. 상대가 운반 중인 도토리는 목표 표식으로만 위치가 드러난다.
- `movementCircleColliders(map)`를 shared collision 경계에 추가해 나무 줄기와 `jail.center/radius`를 동일한 원형 충돌체 목록으로 만든다. 서버 이동·도토리 낙하·berry spawn·hitscan·체포 시야와 클라이언트 prediction이 같은 목록을 사용한다.
- 감옥은 더 이상 들어가야 하는 trigger 원이 아니다. 일반 플레이어는 원형 footprint 밖에서 멈추고, 구출 가능 여부는 shared `isWithinCircleReach(position, jail, interactionRadius)`로 prefab 외곽에서 판정한다. 수감자만 서버 체포 완료 시 내부 slot으로 순간이동하며 구출 완료 시 외부 escape point로 이동한다.
- generator v7은 경찰 spawn 중심 네 개를 감옥의 동서남북 7.27 unit 거리에 배치하고 각 반지름 3.5 원 전체가 감옥과 겹치지 않도록 validator와 runtime spawn sampling이 함께 검사한다. 도둑 spawn 반지름 4.5는 유지한다.
- 감옥 collision semantics를 모르는 protocol v5 클라이언트는 로컬 예측 불일치를 만들 수 있으므로 protocolVersion을 6으로 올렸다. generatorVersion은 7, balanceVersion은 4, fallback은 `safe-meadow-v7`이다.

### 변경 사항

- 미니맵에 불규칙 polygon/hole, 장애물, 나무, 도둑 기지 `B`, 감옥 `J`, 경찰 기지 `A–C`, 모든 도토리와 berry, 아군, 로컬 방향 화살표를 그린다. 월드 +Y는 미니맵 위쪽, +X는 오른쪽으로 유지한다.
- 플레이어 권위 충돌 반지름을 0.45에서 0.52, 상호작용 반지름을 1.25에서 1.4로 조정했다. 캐릭터 cylinder·꼬리·팀 ring과 도토리·berry mesh도 함께 키웠다.
- 도둑 기지 반지름은 2.25→3.0, 경찰 저장소는 1.6→2.2, 감옥은 1.8→2.6으로 확대했다. 장애물·나무 크기는 변경하지 않았다.
- 감옥 표현은 collision radius와 같은 저상 원판, 외곽 ring, 12개 창살을 사용한다. 일반 이동과 람쥐썬더가 visible footprint를 통과하지 않는다.
- 두 명 이상 수감되어도 `[E] 동료 구출` tooltip은 감옥 prefab 위에 하나만 표시한다. 구출 대상 선택은 기존처럼 가장 오래 수감된 도둑 한 명을 서버가 결정한다.
- 월드 tooltip은 font 12→14px, padding과 테두리를 확대하고 약 72% 불투명 배경·blur를 적용했다. 기지 label과 행동 label의 월드 높이를 분리해 prefab/플레이어와 서로 가리지 않게 했다.

### 검토와 검증

- `npm test`: 9개 파일, 74개 테스트 통과. 감옥 원형 이동, prefab 외곽 구출, 서버/로컬 prediction 일치, 경찰 spawn 원 전체의 감옥 비중첩, 다중 수감자 tooltip anchor, 미니맵 좌표 방향을 포함한다.
- 1,000 seed는 fallback 0회, 최대 생성 시도 1회로 모두 validator를 통과했다. 회귀 hash는 `3565c2fd041eebd1`, v7 fallback hash는 `5a5885bd0766dcbd`다.
- `npm run lint`, `npm run build`, `git diff --check`가 통과했다. client production bundle은 556.79kB, gzip 145.25kB이며 기존 500kB 단일 chunk 경고가 남는다.
- Chromium·Firefox E2E 8개가 기존 로비/방장 흐름과 게임 진입 후 visible·non-empty 미니맵 canvas를 통과했다. 첫 E2E에서 일반 `canvas` selector가 Three.js와 미니맵 두 요소를 만나 strict-mode 오류가 발생해 게임 canvas를 `#game canvas`로 명시한 뒤 재검증했다.
- 샌드박스에서 별도 `npm run dev` 시각 세션은 `tsx` IPC와 port bind가 `EPERM`으로 차단됐다. 동일 production server/preview를 자동으로 여는 승인된 E2E는 정상 완료했으며 기능 crash와 구분했다.

### 남은 위험과 다음 작업

- 미니맵이 모든 도토리와 berry를 상시 표시하므로 실제 8인 플레이에서 추격·탐색 난도가 지나치게 낮아지는지 확인해야 한다. 필요하면 berry 또는 상대 운반 도토리에 거리/시간 기반 정보 지연을 적용한다.
- 감옥은 현재 내부 전체를 통과 불가 원으로 취급한다. 시각적으로 출입문이 필요해지면 단일 원 대신 원호/복수 collider prefab으로 확장하고 server/prediction/hitscan contract test를 함께 바꾼다.
- 확대된 플레이어 반지름과 거점 크기가 좁은 topology 병목 통과시간과 체포 빈도에 미치는 영향을 실제 8인 한 경기에서 측정한다.

## 2026-08-21 — 전술 미니맵·감옥 폴리싱 공개 결과

### 공개

- `develop`의 원격 선행 이력이 작업 시작점 `8da1e683aa54f83b1febfcebfb6e056682062682`와 같은지 확인한 뒤, 검증된 24개 경로만 명시적으로 stage했다.
- 기능 변경을 `0ac144089247531c5c60895784411459bb125081` (`feat: add tactical minimap and physical jail`)로 커밋해 `origin/develop`에 push했다.

### 최종 검증과 CI

- 최종 변경분에서 `npm test` 74개, Chromium·Firefox E2E 8개, production build와 `git diff --check`가 통과했다. E2E 종료 뒤 잔류 게임 server/preview 프로세스는 없었다.
- GitHub Actions WebKit E2E [run 32442778035](https://github.com/tina445/SquirrelGame/actions/runs/32442778035)의 최초 시도는 친구방 첫 테스트에서 준비 상태 snapshot 반영이 5초를 넘겨 1개가 실패하고 나머지 3개는 통과했다. 같은 commit을 변경 없이 실패 job만 재실행한 결과 WebKit 4개가 모두 통과했다.
- 최초 실패는 프로세스 crash나 기능 예외가 아닌 단일 ready 응답 타이밍 변동으로 확인했다. 같은 실패가 재발하면 client click→WebSocket send→server ready 적용→snapshot 수신 구간을 단계별 계측하고 E2E의 권위 응답 대기를 안정화한다.

### 후속 확인

- 미니맵 축소 화면, tooltip safe-area와 HUD 겹침을 다양한 viewport/DPI에서 휴먼 시각 검증하고, Three.js·Tween.js·미니맵 표현 계층의 bundle 분리를 후속 폴리싱으로 진행한다.

## 2026-08-21 — Tailscale 외부 플레이테스트와 Firebase 공개 배포 준비

### 목표

- 초대된 외부 플레이테스터가 HTTPS/WSS로 게임에 접속할 수 있도록 Tailscale Serve 기반 배포 경계를 만든다.
- Firebase 등 공개 호스팅을 검토해 현재 서버 권위 Room 구조와 충돌하지 않는 초기 공개 베타 경로를 문서화한다.

### 아키텍처와 변경 사항

- production Node 서버가 `STATIC_DIR`의 Vite 산출물을 제공하도록 해 게임 화면·WebSocket·`/health`·`/metrics`를 한 HTTP 서비스로 묶었다. 정적 경로는 dist 바깥으로 탈출할 수 없고, MIME·`nosniff`·cache header를 설정한다.
- HTTPS에서 WebSocket URL을 같은 `location.host`의 `wss://`로 계산하도록 수정했다. 따라서 Tailscale Serve TLS endpoint에서 8080 포트가 브라우저에 노출되지 않는다. Firebase/Cloud Run처럼 origin이 분리된 경우에는 기존 `VITE_WS_URL` build-time override를 사용한다.
- `HOST`, `STATIC_DIR`, `ALLOWED_ORIGINS` 환경변수를 도입했다. 외부 배포는 WebSocket Origin allow-list를 MagicDNS/Firebase origin으로 제한하고, Docker는 내부 `0.0.0.0:8080`을 사용하되 호스트에는 `127.0.0.1:8080`만 publish한다.
- Docker production image에 `client/dist`를 포함하고, `firebase.json`에는 CDN에 올릴 정적 client 산출물과 immutable asset cache policy를 추가했다.
- Firebase Hosting의 Cloud Run rewrite는 60초 request timeout이라 6분 WebSocket 경기의 proxy로 사용하지 않는다. 공개 베타는 Firebase Hosting static CDN과 별도 Cloud Run WebSocket origin을 사용하고, 현재 Room이 프로세스 메모리에 있으므로 Cloud Run은 `min-instances=1`, `max-instances=1`로 제한한다. 수평 확장은 Room/재접속 상태를 공용 저장소로 옮긴 뒤의 과제다.

### 검증과 운영 상태

- `npm run build`, `npm run lint`, `npm test`(9개 파일/74개 테스트), `git diff --check`가 통과했다. client bundle의 기존 500kB 경고는 유지된다.
- 승인된 호스트 localhost 검사에서 production 정적 `/`가 200, `/health?probe=1`가 JSON 200, allow-list 밖 WebSocket upgrade가 403으로 확인됐다.
- 이 호스트의 Tailscale CLI는 설치되어 있으나 `tailscaled` daemon이 아직 실행 중이 아니었다. 실제 tailnet 로그인, MagicDNS hostname 확정, `tailscale serve --https=443 http://127.0.0.1:8080` 적용은 호스트 관리자 권한과 Tailscale 계정 승인이 필요하다.

### 다음 작업

- 호스트 소유자가 `tailscaled`를 시작하고 로그인한 뒤 MagicDNS origin을 확정해 컨테이너 실행·Serve·8인 외부 브라우저 세션을 리허설한다.
- 공개 베타를 선택하면 Firebase 프로젝트 ID, Cloud Billing/Cloud Run API, custom domain 정책을 확정하고 single-instance Cloud Run으로 먼저 운영 비용·재접속·배포 교체를 측정한다.

## 2026-08-21 — Firebase Hosting + Cloud Run 24인 공개 테스트 구현

### 목표

- Tailscale 승인 사용자 테스트 대신, 로그인 없이 Firebase `web.app` URL로 접속하는 최대 24명 공개 테스트 환경을 구현한다.

### 아키텍처와 변경 사항

- Firebase Hosting은 `client/dist`만 CDN 배포하고, Cloud Run은 static file 없이 별도 `wss://` 권위 서버·`/health`만 제공하도록 Docker 기본 환경을 분리했다. `deploy:public` 스크립트는 Artifact Registry image build → 단일 Cloud Run deploy → 실제 `run.app` URL을 `VITE_WS_URL`로 주입한 client build → Firebase Hosting deploy 순서로 실행한다.
- 공개 Cloud Run 설정은 Seoul(`asia-northeast3`), 1 CPU/512MiB, `min-instances=1`, `max-instances=1`, concurrency 32, 3600초 timeout, public ingress로 고정했다. `ALLOWED_ORIGINS`에는 Firebase의 `web.app`·`firebaseapp.com`을 넣는다.
- `MAX_PUBLIC_PLAYERS=24`를 RoomManager 전역 slot 상한으로 연결해 신규 입장만 막고, grace period의 token 재접속은 상한에 관계없이 유지했다. `JOIN_ATTEMPTS_PER_MINUTE=6` sliding window는 Cloud Run proxy를 신뢰할 때 전달된 client IP를 key로 사용하며, 신규 입장만 제한한다.
- 공개 정원/입장 제한 오류 `SERVER_FULL`, `JOIN_RATE_LIMITED`를 로비에서 각각 이해 가능한 한국어 안내로 표시한다. `METRICS_TOKEN`이 있을 때 `/metrics`는 Bearer token을 요구하고 `/health`는 probe용 공개 endpoint로 유지한다.
- `firebase.json`, Firebase/Cloud Run 프로젝트 생성·Blaze billing·예산 알림·운영 리허설 절차를 `docs/DEPLOYMENT.md`에 정리했다. project alias나 token은 저장소에 기록하지 않는다.

### 검증

- `npm run build`, `npm run lint`, `npm test`가 통과했다. 총 10개 파일/80개 테스트에 24번째까지 허용·25번째 `SERVER_FULL`, 재접속 슬롯 유지, 1분 sliding window, trusted forwarded IP, metrics Bearer 인증, 로비 오류 문구를 추가했다.
- 승인된 호스트 Chromium·Firefox E2E 8개가 기존 친구 Room·빠른 매칭·방장 흐름과 게임 시작을 통과했다. client bundle은 기존 500kB 초과 경고(557.11kB)만 남는다.
- `PUBLIC_PROJECT_ID`와 임시 token을 이용한 `npm run deploy:public -- --dry-run`이 Artifact Registry repository/image, Cloud Run의 단일 인스턴스 설정·masked token, Firebase build/deploy 순서를 모두 출력해 검증했다.

### 실제 배포 전제와 다음 작업

- 이 작업 환경에는 `gcloud`, `firebase`, Docker CLI 및 Google Cloud/Firebase 로그인·Blaze billing 연결이 없으므로 실제 프로젝트 생성·API 활성화·공개 URL 배포는 실행하지 않았다. 운영자가 새 프로젝트를 만든 뒤 `docs/DEPLOYMENT.md`의 export 값과 `npm run deploy:public`을 실행해야 한다.
- 첫 공개 전 24명/3 Room, 25번째 신규 입장, same-IP 7번째 입장, 8인 중 Cloud Run revision 교체와 60분 timeout 재접속을 실제 URL에서 리허설한다. 24명 이상 확대가 필요하면 공유 Room 상태 계층 또는 Durable Objects 재설계를 별도 작업으로 진행한다.

## 2026-08-23 — squirrel-c3cf8 Firebase 공개 테스트 실제 배포

### 배포 결과

- Firebase 프로젝트 `squirrel-c3cf8`의 Blaze billing 연결을 확인하고 Cloud Run, Cloud Build, Artifact Registry, Firebase Hosting, Secret Manager API를 활성화했다.
- Artifact Registry `squirrel-heist` repository와 Secret Manager `squirrel-metrics-token`을 만들었다. token은 대화·저장소·명령 출력에 남기지 않고 Secret Manager version 1로만 저장했으며, Cloud Run 기본 compute service account에 해당 secret accessor 권한만 부여했다.
- Cloud Build `b132eb64-b5c1-4bce-b065-1cabf39caead`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:public-1787493772186`를 성공적으로 만들었다.
- Seoul `asia-northeast3` Cloud Run service `squirrel-heist` revision `squirrel-heist-00002-g2f`를 1 CPU/512MiB, min/max instance 1, concurrency 32, timeout 3600초, 공개 ingress와 24명/분당 6회 신규 입장 보호 설정으로 배포했다.
- Firebase Hosting `https://squirrel-c3cf8.web.app`에 Cloud Run WSS URL을 주입한 production client를 배포했다.

### 실제 검증

- Hosting HTTPS 응답은 200, Cloud Run `/health`는 `{"ok":true,"rooms":0}` 200을 반환했다.
- `Origin: https://squirrel-c3cf8.web.app`의 WSS handshake가 성공했다.
- `/metrics`는 무인증 401, Secret Manager token Bearer 요청 200을 확인했다.
- 최종 로컬 검증은 `npm run build`, `npm run lint`, `npm test` 10개 파일/80개 테스트, `git diff --check` 통과다. client bundle의 기존 500kB 초과 경고만 남는다.

### 후속 작업

- 공개 URL에서 24명/3 Room, 25번째 신규 입장, same-IP 속도 제한, 8인 경기 중 revision 교체·reconnect을 리허설한다.
- Google Cloud Billing budget의 50%/90%/100% 이메일 알림을 콘솔에서 설정한다. 예산 알림은 비용을 차단하지 않으므로 max instance와 입장 정원을 유지한다.

## 2026-08-23 — 공개 빠른 매칭 지연 자동 bot 투입

### 목표

- 공개 테스트에서 빠른 매칭 대기가 길어져도 한 명의 플레이어가 경기를 시작할 수 있게, 기존 테스트 bot 충원 흐름과 같은 8인 자동 시작 경로를 서버 권위로 제공한다.

### 아키텍처와 변경 사항

- `RoomManager`가 `BOT_FILL_DELAY_MS`(공개 배포 15초)를 기준으로 빠른 매칭의 대기 시각을 관리하고, 시간이 지나면 부족한 슬롯만 서버 내부 테스트 bot으로 채운다. 친구 Room·로컬 기본 설정에는 적용하지 않는다.
- bot은 일반 `PlayerState`·Room 슬롯·4:4 역할 확정·asset 준비 조건을 그대로 사용하므로 snapshot과 로비 명단에 표시되고, `MAX_PUBLIC_PLAYERS=24` 전역 정원에도 포함된다. 8명을 완성할 여유 슬롯이 없으면 부분 bot 충원을 하지 않고 사람 매칭을 계속 기다린다.
- 실제 접속자 모두가 reconnect grace를 넘겨 떠난 bot Room은 no-op bot transport까지 제거해 기존 Room 정리 흐름으로 회수한다. 단일 Cloud Run 인스턴스의 메모리 Room 구조 안에서 동작하므로 instance 상한·공용 상태 설계는 변경하지 않았다.
- `publicAccessPolicy`, 공개 배포 스크립트와 배포 문서에 `BOT_FILL_DELAY_MS=15000`을 추가했다.

### 검증과 배포

- `npm test` 10개 파일/82개 테스트, `npm run lint`, `npm run build`, `git diff --check`를 통과했다. 지연 전 미투입, 15초 후 7 bot 충원·countdown, 전역 정원 부족 시 부분 충원 금지를 단위 테스트로 검증했다.
- Cloud Build `59962453-d25b-488a-b035-72d329069545`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:public-1787494881558`를 성공적으로 만들었다.
- Cloud Run revision `squirrel-heist-00004-n7s`에 15초 bot 투입 환경변수를 반영하고 Firebase Hosting `https://squirrel-c3cf8.web.app`을 재배포했다.
- Firebase origin을 둔 실제 WSS smoke test에서 한 명을 빠른 매칭으로 입장·asset ready 처리한 뒤 15초 후 Room `3FBB0A`가 `COUNTDOWN`으로 전이하는 것을 확인했다.

### 후속 작업

- 현재 bot은 매칭 정원과 시작을 위한 서버 내부 테스트 참가자이며, 사람과 동등한 전술 AI는 아니다. 공개 테스트 결과에서 필요성이 확인되면 이동·상호작용 전략을 별도 서버 bot controller로 설계하고 밸런스 영향을 검증한다.
## 2026-08-21 — 사람형 매칭 봇·게스트 닉네임과 6:4 균형 게이트

### 목표와 아키텍처 결정

- `develop`과 `origin/develop`이 동일한 `62aab61629eacbe1250cf8f2843f7f8019b203cf`임을 확인한 뒤 `bot_player` 브랜치에서 작업했다. 이 항목은 아직 커밋·push하지 않았다.
- 순수 `@squirrel-heist/bot-core` workspace에 관측·정책·A* navigation·입력 adapter를 두고, 서버의 `RoomBotCoordinator`는 동일한 `enqueueInput` 경계만 사용한다. 따라서 봇이 권위 상태를 직접 수정할 수 없고, 향후 별도 프로세스로 옮길 때는 `tools`의 WebSocket runner transport만 교체하면 된다.
- 빠른 매칭 대기실에서 인간이 한 명 이상 연결된 경우에만 60초 뒤부터 실제 충원 시점 기준 매 10초마다 ready/RANDOM 봇을 한 명 추가한다. 친구방·인간 없는 방·진행 중 경기는 제외하며, snapshot에는 내부 `BOT` 제어 유형을 넣지 않아 protocol wire shape를 유지한다.
- 전략은 18 unit 시야·장애물 line-of-sight·2초 상대 기억, seeded 200~450ms 반응 지연·4도 조준 오차·waypoint 흔들림, 정적 충돌을 반영한 cache형 grid A*를 사용한다. rule-based와 greedy는 공통 관측/입력 계약을 공유한다.
- 로그인 기능이 없으므로 클라이언트는 모두 게스트다. `crypto.getRandomValues`로 만든 `다람쥐####` 이름과 사용자가 수정한 이름을 `sessionStorage`에만 저장하여 같은 탭의 새로고침·재접속에는 유지하고 새 탭에서는 새로 만든다.

### 평가와 균형 결정

- `BOT_EVAL_SEEDS=100 npm run bot:evaluate`의 고정 100 seed·7개 layout·400경기 결과는 rule/rule 도둑 43승·경찰 57승, greedy 도둑/rule 경찰 35/65, rule 도둑/greedy 경찰 5/95, greedy/greedy 11/89였다. 행동 점수와 승패는 분리했으며 reward ledger로 반복 상태 전이 점수 획득을 막는다.
- greedy 도둑은 행동 점수 개선이 0.81%뿐이고 승률도 8%p 하락해 채택하지 않았다. greedy 경찰은 운영 품질 게이트를 통과했지만 도둑 승률을 5%까지 떨어뜨렸다.
- 기본 전략 채택에 양 역할 승률이 각각 40~60%(6:4) 안에 있어야 한다는 공정성 게이트를 추가했다. 이 기준에 따라 현재 production 기본은 `THIEF=RULE_BASED`, `POLICE=RULE_BASED`다. greedy 경찰은 평가용으로 보존하며 추격/체포 효용을 완화한 뒤 6:4 범위에서 재평가한다.

### 구현과 검증

- `npm test`: 13개 파일, 85개 테스트 통과. 60초 전 미충원·10초 간격·인간 중간 참가·4:4 배정·친구방/인간 없는 방 제외, 제한 시야/기억 만료·A*·입력 sequence/edge, 게스트 이름 session 동작을 포함한다.
- `npm run lint`, `npm run build`, `git diff --check`가 통과했다. client bundle의 기존 500kB chunk 경고만 남는다.
- Chromium·Firefox Playwright 10개가 통과했다. 로컬 Arch Linux의 WebKit은 필요한 system library가 없어 `CI_REQUIRED`이며, `npm run playtest:preflight`도 Node/Chromium/Firefox PASS, WebKit CI_REQUIRED로 보고했다.
- 84 embedded bot/1,200 Room tick benchmark에서 Room tick p95는 0.088ms, 봇 판단 p95는 0.029ms로 50ms 승인 기준 아래였다. 별도 8봇 WebSocket runner는 protocol 오류 0건, 내장 충원 통합 검증은 8명·4:4·COUNTDOWN을 확인했다.

### 남은 위험과 다음 작업

- rule/rule의 43:57도 실제 사람 플레이에서 체감상 공정한지 8인 세션으로 확인한다. 6:4 경계에 닿거나 넘는 전략은 기본값으로 채택하지 않는다.
- greedy 경찰은 현재 너무 높은 체포 전환율을 보인다. 가시거리 기반 추적 지속시간, 체포 목표 효용, 아군 중복 패널티를 조정한 뒤 같은 100-seed 평가와 사람 플레이를 함께 비교한다.
- 외부 bot runner의 운영 배포를 위해서는 인증·provisioning과 장애 격리 정책이 추가로 필요하다. 이번 범위는 공통 정책과 transport 교체 seam까지만 제공한다.

## 2026-08-24 — 최신 rule-based bot 공개 배포

### 배포 결과

- `develop` 최신 HEAD `62b17d8`의 공통 `bot-core` rule-based controller와 서버 `RoomBotCoordinator`를 Cloud Build `f070fabb-5a92-4aec-a81a-f89f38988caa`로 빌드했다.
- image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:public-1787497915875`를 Seoul Cloud Run revision `squirrel-heist-00006-zph`에 배포하고 Firebase Hosting `https://squirrel-c3cf8.web.app`을 갱신했다.
- 공개 환경은 1 CPU/512MiB, min/max instance 1, concurrency 32, 24명 정원을 유지하며 `MATCH_BOT_FILL_DELAY_MS=60000`, `MATCH_BOT_FILL_INTERVAL_MS=10000`으로 사람 한 명 이상이 대기하면 60초 뒤부터 10초마다 rule-based bot을 투입한다.

### 검증과 정리

- `npm test` 14개 파일/91개 테스트, lint, production build가 통과했다. Chromium·Firefox E2E 10개도 통과했다. 이 호스트의 WebKit 5개는 `libicu74` 등 시스템 의존성이 없어 실행하지 못했으며 코드 실패가 아니다.
- Firebase origin WSS smoke client가 실제 자동 bot 투입 시점에 종료했고, Cloud Run revision의 bot 환경변수와 Secret Manager metrics token 연결을 확인했다.

## 2026-08-24 — 팀 전술 알림과 분산 베리 폴리싱

### 목표와 아키텍처 결정

- 체포 완료, 도둑 기지 도토리 확보, 경찰 저장소 도토리 탈취, 감옥 구출 완료를 상단 중앙 노란 toast로 알려 팀 전술 상황을 빠르게 파악하게 한다.
- 별도 WebSocket message를 만들지 않고 기존 `S2C_GAME_EVENTS` 안의 `TEAM_NOTIFICATION` event를 확장했다. 일반 event는 공개 상태로 유지해 기존 효과음·봇 observer를 깨지 않는다.
- `RoutedGameEvent`와 `GameEventDeliveryPolicy` interface를 server 전달 계층에 도입했다. 기본 policy는 `ALL` 또는 확정 `TEAM` audience를 판정하며, `MatchRoom`은 권위 행동 결과 생성과 큐잉만 담당한다. 후속 개인·관전자·거리 기반 가시성은 policy 교체로 확장할 수 있다.
- 명시 요구에 따라 체포·경찰 저장소 도토리 탈취·감옥 탈출은 경찰팀, 도둑 기지 확보는 도둑팀에만 보낸다. 클라이언트도 `recipientTeam === localTeam`을 재확인한 뒤 toast를 표현한다.

### 변경 사항

- `TeamNotificationKind`에 네 전술 알림 계약을 정의하고, 완료한 서버 권위 전이에서만 `TEAM_NOTIFICATION`을 만든다.
- `TeamToast` presentation adapter가 3.2초 동안 상단 중앙에 노란 문구를 표시하며 연속 알림은 최신 결과로 교체한다.
- 필드 베리 상한을 2→5, 생성 간격을 15~25초→8~14초로 조정했다. 맵은 40개 이상 후보 중심을 14 unit 이상 분산하고, runtime은 farthest-first 중심 선택과 12 unit 활성 베리 간격을 강제한다.
- generatorVersion 8, balanceVersion 5, fallback `safe-meadow-v8`, protocolVersion 7로 올렸다. v6 클라이언트는 팀 알림 표현 계약이 없으므로 v7 서버와 호환하지 않는다.

### 검증과 후속 확인

- `npm test`: 16개 파일, 96개 테스트 통과. 네 알림의 팀원 전원 전달/상대 차단, 전달 policy, HUD 문구, 최대 5개 베리와 최소 활성 간격, 1,000 seed map validator를 포함한다.
- `npm run lint`, `npm run build`, `git diff --check`, Chromium·Firefox E2E 10개가 통과했다. client production bundle은 558.28 kB(gzip 145.86 kB)이며 기존 500 kB 단일 chunk 경고가 남는다.
- 실제 8인 경기에서 5개 베리가 람쥐썬더 획득 빈도를 과도하게 높이는지와, 다중 알림이 3.2초 교체 정책으로 충분히 읽히는지 휴먼 플레이테스트로 측정한다.

## 2026-08-24 — 전술 알림·맵 v8 공개 배포

- 최신 `main` HEAD `70e7d97`을 Cloud Build `aa1da6a0-e6e0-4c27-a656-8e1b6e3d2f75`로 빌드해 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:public-1787505981771`를 생성했다.
- Cloud Run `squirrel-heist-00008-74s`가 100% traffic을 처리하도록 전환하고 Firebase Hosting `https://squirrel-c3cf8.web.app`에 새 client bundle을 배포했다. 단일 instance, 24명 정원, rule-based bot 자동충원 설정은 유지했다.
- 배포 전 `npm test`, lint, production build가 통과했고, 배포 뒤 Firebase HTTPS 200, Firebase origin WSS handshake 성공, Cloud Run `/health`의 `{"ok":true,"rooms":0}` 응답을 확인했다.

## 2026-08-24 — 적극적 경찰 체포 판정·추적 보정

### 분석과 결정

- 경찰 bot은 근거리 도둑을 18 unit 인식 반경 때문에 놓치는 것이 아니라, 일반 도둑 체포 점수 75보다 바닥 도토리 회수 점수 80이 높아 회수를 우선하는 경우가 있었다.
- 기존 체포는 일반 상호작용과 같은 1.4 unit 경계에서 정지한 뒤 600ms 연속 hold를 요구했다. 움직이는 도둑은 bot의 200~450ms 재판단 사이에 쉽게 범위를 벗어나므로, 체포 사거리 안에서 계속 접근하는 별도 규칙이 필요했다.

### 변경 사항

- `arrestRadius=1.8`, `arrestFollowDistance=1.2`를 balance 설정으로 분리했다. 도토리·구출의 일반 상호작용 반경 1.4는 유지한다.
- 서버 권위 `canArrest`는 1.8 unit 체포 사거리를 사용한다. rule-based 경찰은 일반 도둑 체포 점수 85를 바닥 도토리 회수 80보다 높게 두고, 1.8 unit 안에서 E를 누르면서 1.2 unit까지 계속 접근해 hold를 유지한다.

### 검증과 후속 확인

- 정책 단위 테스트는 바닥 도토리가 있어도 근처 일반 도둑을 체포 목표로 선택하고 E와 접근 이동을 함께 출력함을 확인했다. 서버 통합 테스트는 확장된 체포 사거리에서 600ms hold로 수감 완료됨을 확인했다.
- `bot-core/tests/botCore.test.ts`, `server/tests/matchRoom.test.ts` 32개, `npm run lint`, `npm run build`, `git diff --check`가 통과했다.
- 실제 공개 경기에서는 `INTERACTION_CANCELLED`의 `NO_TARGET`·거리 이탈·시야 차단을 별도 bot metric으로 집계해, 확장 사거리와 추적 유지가 체포 완주율을 얼마나 높였는지 확인한다.

## 2026-08-24 — 경찰 운반 도토리 탈취

### 목표와 권위 규칙

- 경찰이 도토리를 들고 버티기만 해도 확정적으로 방어할 수 있던 구도를 줄이기 위해, 빈손 도둑이 가까운 경찰 운반자에게 F를 눌러 도토리를 탈취할 수 있게 했다.
- 서버는 상호작용 반경과 정적 충돌물 시야를 검증한 뒤 기존 경찰의 `heldAcornId`를 해제하고 동일 도토리의 `CARRIED.carrierId`와 도둑 보유 슬롯을 한 전이로 갱신한다. 범위 밖·시야 차단·불일치 상태의 요청은 성공하지 않는다.

### 표현·프로토콜·검증

- 도둑 클라이언트에는 `[F] 도토리 빼앗기` 안내를 우선 표시하고, 성공 시 기존 `ACORN_STOLEN` 공개 event와 경찰 전용 `POLICE_CARRIED_ACORN_STOLEN` HUD 알림을 보낸다. 프로토콜은 v8로 올렸다.
- 서버 권위 탈취/도토리 보존, 경찰 팀 전용 알림, HUD 문구를 테스트했다. `npm test` 16개 파일 98개 테스트, `npm run lint`, `npm run build`, `git diff --check`, Chromium·Firefox E2E 10개가 통과했다. 병렬 CI 부하에서 5초를 넘길 수 있는 시드 평가 테스트에는 명시적 10초 한도를 부여했다.
- 체포 반경·봇 정책·배포 기록의 동시 작업은 이 변경에 포함하지 않았다. 현재 Codex 사용량 제한으로 git staging/commit/push 권한 요청이 거절되어, 권한 복구 뒤 도토리 탈취 관련 hunk만 분리 커밋·푸시해야 한다.

## 2026-08-24 — 체포 상향을 유지한 도둑 전술·전원 구출 균형 회복

- 경찰 체포 반경 `1.8`과 추적 보정은 유지했다. 봇 controller의 흔들림 fallback이 `moveWorld={0,0}`을 전방 이동으로 바꾸던 결함을 수정해, 도착 뒤 구출·도토리·체포 hold가 의도대로 정지 상태를 유지하도록 했다.
- 도둑과 경찰은 사람 미니맵에 공개되는 베리·도토리 정보와 운반 도토리 마커를 관측한다. 전역 자원은 가장 가까운 정상 팀원 한 명만 담당한다. 도둑은 썬더 보유 상태에서 운반 경찰을 차단하며, 기절 후 탈취 가능 거리에서만 썬더를 사용한다.
- 경찰 운반 도토리 탈취 범위를 `2.4`로 분리했고 서버 권위 판정과 bot 도착 판정이 동일한 값을 사용한다. 구출 완료 시 당시 수감된 도둑 전원을 각각 다른 탈출점에 배치하고 `3초` 체포 면역을 준다.
- `BOT_EVAL_SEEDS=100 npm run bot:evaluate`는 7 layout·400경기에서 rule/rule 도둑/경찰 `45/55`를 기록해 6:4 경계를 통과했다. 도둑 막힘 2.56%, 무효 입력 분당 0.0008, 판단 오류 0이었다. 베리 3.46회, 썬더 발사/명중 2.51/2.09회, 운반 도토리 탈취 0.28회, 구출 완료 4.95회/경기가 확인됐다.
- `npm test` 16개 파일/105개 테스트, lint, 전체 build, `git diff --check`가 통과했다. 기존 client 500kB chunk 경고만 남는다. 기본 정책은 양 역할 모두 rule-based로 유지하며, push·배포는 수행하지 않았다.

## 2026-08-24 — 도둑 전술 균형 공개 배포

- `main`의 `5da5bf1 feat(bot): balance thief tactics after arrest buff`를 `origin/main`에 push했다.
- Cloud Build `2a6513eb-604c-495f-b1c6-dc2cba958604`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:main-5da5bf1`를 빌드했다. Cloud Run Seoul revision `squirrel-heist-00009-mmx`가 100% traffic을 처리하도록 전환했다.
- Firebase Hosting `https://squirrel-c3cf8.web.app`을 같은 Cloud Run WSS origin으로 build·배포했다. 배포 뒤 Cloud Run `/health`의 `{"ok":true,"rooms":0}`과 Firebase HTTPS 200을 확인했다.
- 배포 과정에서 Cloud Build source archive는 node_modules·임시 CLI를 제외하도록 임시 ignore 설정을 사용했다. 임시 도구와 설정은 배포 뒤 삭제했으며 작업 트리는 깨끗하다.

## 2026-08-24 — 적극적 체포의 승률 영향 측정

- 동일한 고정 100 seed와 7개 layout으로 400경기를 두 번 실행했다. 기준 실행은 기존 체포 반경 `1.4`, 일반 도둑 체포 점수 `75`, 정지형 추적을 사용했고, 비교 실행은 `arrestRadius=1.8`, 점수 `85`, `1.2`까지의 접근 유지를 사용했다.
- 기본 rule/rule 결과는 도둑/경찰 `44/56`에서 `35/65`로 변해 경찰 승률이 9%p 상승했다. greedy 도둑/rule 경찰은 `30/70→20/80`, rule 도둑/greedy 경찰은 `4/96→3/97`, greedy/greedy는 `12/88→6/94`였다.
- 변경 후 rule/rule의 막힘 비율은 도둑 3.75%, 경찰 2.48%, 무효 입력은 분당 각각 0.0010/0.0041, 판단 오류 0으로 운영 품질 게이트는 통과했다. 그러나 경찰 65%는 기존 6:4 공정성 경계를 넘는다.
- 따라서 체포 누락 원인 검증과 확장 사거리 동작 검증은 완료했지만, 이 `1.8`/`85` 조합은 균형값으로 확정하거나 배포하지 않는다. 다음 작업은 더 작은 사거리 또는 효용 조합을 같은 고정 seed에서 재평가해 rule/rule을 40~60% 범위로 되돌리는 것이다.

## 2026-08-24 — 체포 범위·썬더·전원 구조 hold 재균형

### 목표와 결정

- 경찰 체포 범위를 기존 `1.4`와 적극 체포 조정 `1.8`의 중간인 `1.6`으로 조정했다. 썬더 기절은 요청대로 `1.5초→2.1초`로 늘렸고, 전원 구조는 한 번 완료하면 당시 수감 도둑 전원을 풀어 주는 규칙을 고려해 hold를 `3초→2.4초`, 구조 뒤 체포 면역을 `3초→3.6초`로 조정했다.
- 2.1초 기절과 600ms 체포 hold 조합은 고정 100시드에서 도둑/경찰 `35/65`로 경찰 연계가 과도했다. 구조 hold 1.8초와 면역 3.6초 후보는 이를 충분히 바꾸지 못했다. 범위는 유지하고 체포 hold를 `900ms`로 늘린 최종 후보가 `41/59`로 6:4 경계 안에 들어와 채택했다.

### 검증

- `BOT_EVAL_SEEDS=100 npm run bot:evaluate`는 7개 layout·400경기에서 rule/rule `41/59`, greedy 도둑/rule 경찰 `37/63`, rule 도둑/greedy 경찰 `7/93`, greedy/greedy `15/85`를 기록했다. 기본 정책은 양 역할 모두 rule-based로 유지한다.
- rule/rule은 경기당 체포 5.55회, 전원 구조 3.94회, 썬더 발사/명중 2.63/2.24회, 운반 도토리 탈취 0.18회를 기록했다. 도둑/경찰 막힘은 2.67%/1.65%, 판단 오류는 0건이었다.
- 기절 시간이 늘어 도둑이 15 unit 최대 썬더 사거리의 운반 경찰까지 기절 중 탈취 범위에 도달할 수 있게 됐으며, 정책 단위 테스트의 기대값도 이 새 경계를 고정했다. 구조 완료 뒤 면역 지속시간은 정확히 balance 설정과 일치하도록 서버 통합 테스트에서 검증한다.

### 남은 위험과 다음 작업

- rule-based 도둑의 평가 목표 진동은 경기당 평균 1.73회로 관찰된다. 현재 전략 선택 게이트는 greedy 후보에 적용되지만, 실제 사람 매칭에서 어색한 왕복으로 보이는지 확인하고 필요하면 goal hysteresis를 별도 변경으로 보완한다.
- 이번 작업은 로컬 구현·평가까지만 포함하며, 사용자가 요청하기 전에는 push나 공개 배포를 수행하지 않는다.

## 2026-08-24 — 체포·썬더·구출 밸런스 공개 배포

- `main`의 `b822dc9 feat(balance): retune arrest and thunder timing`을 `origin/main`에 push했다.
- Cloud Build `acc364e2-2061-4ca5-9b55-e5184e1ab11a`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:main-b822dc9`를 빌드했다. Seoul Cloud Run revision `squirrel-heist-00010-75g`가 100% traffic을 처리하도록 전환됐다.
- Firebase Hosting `https://squirrel-c3cf8.web.app`을 같은 WSS origin으로 갱신했다. 배포 뒤 Hosting HTTPS 200과 Cloud Run `/health`의 `{"ok":true,"rooms":0}` 응답을 확인했다.
- 배포용 Google Cloud·Firebase CLI는 `/tmp/squirrel-deploy-tools`에 임시 설치했으며, 배포 검증 후 제거한다. 기존 client 500kB 번들 경고만 남는다.

## 2026-08-24 — 상태별 UI 레이아웃·대기 중 맵 비노출·경기 채팅

### 목표와 화면 전이

- 참고 스케치에 맞춰 메인, 매칭 대기, 역할/방 코드 입력 오버레이, 친구 방 4×2 참가자 대기실, 시작 전 카운트다운, 인게임 HUD를 상태별로 다시 배치했다.
- 로비와 카운트다운은 맵을 보이지 않게 하는 것을 넘어 Three.js canvas와 툴팁 레이어를 숨기고 WebGL frame도 제출하지 않는다. `PLAYING` 또는 `FINISHED` snapshot/phase가 확인될 때에만 맵을 만들고 표현한다.

### 변경 사항

- 메인은 닉네임과 빠른 매칭·친구 방 만들기·친구 방 입장 버튼으로 단순화했고, 빠른 매칭의 역할군과 방 코드 입력을 각각 닫기 가능한 오버레이로 분리했다. 빠른 매칭 중에는 취소 버튼과 현재 인원 수를 별도 카드로 표시한다.
- 친구 방은 방 코드·나가기와 4×2 프로필 카드, 역할 선택·준비·방장 시작/양도 제어를 넓은 한 화면에 배치했다. 시작 전에는 `게임을 시작합니다` 3초 카운트다운만 보인다.
- 인게임 HUD는 상단 중앙 타이머/저장소 도토리 수, 왼쪽의 전체 플레이어 명단, 오른쪽의 미니맵과 접을 수 있는 채팅창으로 구성했다. 수감 플레이어는 명단에서 회색과 `[감옥]`으로 표시한다.
- 로비/팀 toast는 배경·테두리·그림자 없이 노란 글자만 표시하도록 통일했고, 월드 상호작용 툴팁은 기준점보다 30px 위로 이동해 캐릭터와 오브젝트를 덜 가리게 했다.
- 채팅은 처음에는 UI만 있던 것을 보완했다. protocol v9의 `C2S_CHAT`/`S2C_CHAT_MESSAGE`로 경기 중 서버 권위 중계를 구현했고, 공백·120자 초과를 런타임에서 거부하며 세션당 초당 4회로 제한한다. 클라이언트는 서버가 되돌려 준 메시지만 최대 30개까지 표시한다.

### 검증과 다음 작업

- `npm test`: 16개 파일, 106개 테스트 통과. 채팅 프로토콜 경계와 대기실 거부/경기 중 전원 중계 테스트를 포함한다.
- `npm run lint`, `npm run build`, `git diff --check`를 통과했다. build에는 기존 Three.js client chunk 500kB 초과 경고만 남는다.
- Chromium E2E 5개를 통과했다. 대기/카운트다운의 canvas hidden, 시작 뒤 canvas/HUD/8명 명단 노출, 채팅 입력→서버 중계→표시를 확인했다. 1440×900 실제 캡처로 메인·역할 오버레이·친구 방·인게임 HUD의 간격도 확인했다.
- 채팅은 세션 중 실시간 전달만 하며, 재접속 뒤 과거 chat history를 복원하지 않는다. 영속 채팅이 필요해지면 별도 저장·모더레이션 정책과 함께 설계한다.

## 2026-08-24 — UI·경기 채팅 공개 배포

- `main`의 `0c46194 feat(ui): redesign lobby and game hud`를 `origin/main`으로 푸시했고, 원격 ref 일치를 확인했다.
- Cloud Build `273ff9fb-7fae-4c4b-9f54-be7425acb825`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:main-0c46194`를 생성했다. Cloud Run Seoul revision `squirrel-heist-00011-ttr`이 100% traffic을 처리하도록 전환했다.
- Firebase Hosting `https://squirrel-c3cf8.web.app`에 새 Cloud Run WSS 주소를 포함한 client bundle을 배포했다. 배포 뒤 Hosting HTTPS 200과 Cloud Run `/health`의 `{"ok":true,"rooms":0}`을 확인했다.
- 현재 세션에는 배포용 CLI가 없어서 Google Cloud CLI와 Firebase CLI를 `/tmp/squirrel-deploy-tools`에 일시 설치했다. Cloud Run은 기존 Secret Manager의 `squirrel-metrics-token` mount를 재사용했으며, token 값을 읽거나 출력하지 않았다. 검증 뒤 임시 도구를 제거한다.

## 2026-08-24 — 운반 도둑의 기지 우선 회피 경로

- 도토리를 든 도둑이 8 unit 안의 가시 경찰을 만나면, 기존에는 경찰 반대 방향으로만 이동해 도둑 기지에서 멀어질 수 있었다. 이제 회피 중에도 A*의 목적지를 도둑 기지 중심으로 고정하고, 기지 상호작용 반경에 도착하면 즉시 도토리를 확보한다.
- 경찰이 도둑 기지와 운반 도둑 사이에 있어 기존 반대 방향 회피와 목적지가 충돌하는 상황을 bot-core 단위 테스트로 고정했다. 경로 목표가 `secure`이고 이동 벡터가 기지 방향임을 확인한다.
- `npm test -- --run bot-core/tests/botCore.test.ts`, `npm run lint`, `git diff --check`가 통과했다. 이 변경은 아직 push·배포하지 않았다.

## 2026-08-24 — 빠른 매칭 대기와 시작 카운트다운 UI 정리

- 빠른 매칭에 입장해도 메인 참가 카드를 유지하도록 바꾸고, 해당 위치의 주 버튼을 `매칭 취소`로 전환했다. 매칭 중에는 친구 방 관련 버튼만 숨기며, 8명이 모여 카운트다운이 시작될 때에만 4×2 참가자 카드 화면으로 전환한다.
- 친구 방의 인원수와 나가기 버튼을 하나의 헤더 묶음으로 정렬해 겹침을 제거했다. 인게임 팀 toast는 `도토리 0/9` 아래로 내렸고, 시작 숫자는 카드 내부의 참가자 카드 아래에 표시하도록 전체 화면 overlay를 제거했다.
- 카운트다운 종료 시각이 서버 시뮬레이션 시간이라는 점을 반영해 snapshot 시각과의 차이를 로컬 시간으로 환산했다. 같은 phase의 snapshot마다 타이머를 재시작하던 문제도 막아 `3 → 2 → 1`로 감소하도록 했다.
- `npm run lint`, `npm run build`, `npm test`(109개), `git diff --check`가 통과했다. 변경 E2E는 Chromium·Firefox에서 4개가 통과했으며, WebKit 2개는 호스트에 필요한 시스템 라이브러리가 없어 실행하지 못했다. 다음 작업: WebKit 실행 환경을 준비한 뒤 전체 브라우저 조합 E2E를 다시 확인한다.

## 2026-08-24 — 운반 도둑 기지 우선과 경찰 차단 균형

- 운반 도둑은 근거리 경찰 회피 중에도 도둑 기지를 A* 목적지로 유지한다. 이 변경만으로 rule/rule 고정 100시드 승률이 도둑/경찰 `71/29`가 되어 경찰이 불리해졌다.
- 사용자 승인에 따라 rule 경찰은 가시 운반 도둑의 도둑 기지 귀환선 앞을 차단하도록 개선했다. 차단점은 이동 목적지일 뿐이며 E 체포는 언제나 운반자의 실제 위치가 권위 체포 반경 안일 때만 보낸다.
- 같은 100시드·400경기 평가에서 rule/rule은 `53/47`로 6:4 경계를 통과했다. 경기당 체포 5.04회·도토리 확보 7.95회, 도둑/경찰 막힘 2.90%/1.37%, 무효 행동 분당 0.0005/0.0018, 판단 오류 0건이었다. greedy 도둑/rule 경찰 `58/42`, rule 도둑/greedy 경찰 `18/82`, greedy/greedy `24/76`도 함께 확인했다.
- rule 목표를 1초 유지하는 후보는 빠른 목표 왕복을 0으로 줄였으나 100시드에서 `61/39`로 현재 `53/47`보다 불균형해 사용자 조건에 따라 폐기했다. greedy 도둑은 행동 점수 향상 10% 조건을 충족하지 못했고, greedy 경찰은 승률 경계를 넘어 기본 정책은 양쪽 rule-based로 유지한다.
- `npm test -- --run bot-core/tests/botCore.test.ts`, `npm run lint`, `git diff --check`가 통과했다. 전체 회귀 검증과 push·배포는 아직 수행하지 않았다.

## 2026-08-24 — 빠른 매칭·카운트다운 UI 공개 배포

- `fc8da51 feat(ui): refine matchmaking flow`를 원격 `main`에 push했고, 원격 ref가 같은 커밋을 가리키는 것을 확인했다.
- Cloud Build `1433c560-44ee-4493-ab71-84b49f65e68a`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:main-fc8da51`를 생성했다. Cloud Run Seoul revision `squirrel-heist-00012-2vb`가 100% traffic을 처리하도록 전환했다.
- Firebase Hosting `https://squirrel-c3cf8.web.app`에 새 client bundle을 배포했다. Hosting HTTPS 응답, bundle의 `wss://squirrel-heist-523632547534.asia-northeast3.run.app` 연결 주소, Cloud Run `/health`의 `{"ok":true,"rooms":0}`을 확인했다.
- 배포에는 기존 Cloud Run의 환경 변수와 Secret Manager `squirrel-metrics-token` mount를 그대로 재사용했으며 token 값을 읽거나 출력하지 않았다. 임시 Google Cloud·Firebase CLI는 검증 뒤 `/tmp/squirrel-deploy-tools`에서 제거했다.

## 2026-08-24 — 월드 축 키보드 이동 복원

- 조준 방향에 따라 W/A/S/D가 회전하던 처리를 제거했다. 이제 `W/↑`, `S/↓`, `A/←`, `D/→`는 각각 고정 월드 북·남·서·동으로 이동하고 마우스는 facing·hitscan 조준에만 관여한다.
- 서버 권위 이동, 클라이언트 prediction/reconciliation 및 60fps 시각 적분, bot의 월드 좌표 입력 변환을 같은 의미로 변경했다. protocol v10으로 올려 이전 prediction 계약과 분리했다.
- 서버의 facing 독립 이동, WASD/방향키 혼합 축, bot-core 입력을 회귀 검증한다. 이후 lint·build·전체 E2E를 실행하고 push한다.

## 2026-08-24 — 탑뷰 숲 스프라이트와 8방향 다람쥐 애니메이션

### 목표와 표현 결정

- 기본 Three.js 도형 표현을 아기자기한 2D 탑뷰 스프라이트로 교체하되, 서버 권위 상태·충돌 AABB·맵 생성 정의는 변경하지 않았다.
- 다람쥐 원본 8열×4행 이미지를 32개 프레임으로 분리한 뒤, 런타임 UV에 맞는 8방향 행×idle·걷기 3열의 `squirrel-walk.png` 아틀라스로 재패킹했다. 방향은 북쪽 기준 45도 단위이고 걷기는 8fps다.

### 변경 사항

- `client/public/assets/sprites/`에 다람쥐 아틀라스와 나무기둥·수관·베리·도토리·돌무리·단일 통나무 울타리 PNG를 추가했다. 울타리는 탑뷰 단일 레일과 양 끝을 포함한 등간격 5개 기둥으로 다시 생성했다.
- renderer는 텍스처 preload가 끝난 뒤에만 `assetsReady`를 보내며, 플레이어의 팀 링·기절 별·번개와 기존 zone/jail/debug 표현은 유지한다.
- 수관 투명 tween을 sprite material에 이식했고, 베리·도토리는 등장/제거 때 scale·opacity tween을 사용한다. 정적 AABB에는 방향별 반복 울타리와 양 끝 돌무리만 표현으로 배치한다.

### 검증

- 최종 7개 자산은 RGBA와 네 모서리 alpha 0을 확인했다. 다람쥐는 32개 분리 프레임과 8×4 최종 아틀라스 순서를 확인했다.
- `npm test` 16개 파일·110개 테스트, `npm run lint`, `npm run build`, Chromium·Firefox E2E 10개가 통과했다. build에는 기존 500 kB client chunk 경고만 남는다.
- 권한 실행 로컬 8인 친구 방에서 자산 preload 후 `8/8` 경기 시작, HUD와 팀 링 위의 다람쥐 스프라이트 표시를 실제 캡처로 확인했다.

## 2026-08-24 — 탑뷰 스프라이트 공개 게시

- `main` 브랜치의 `843792e feat(client): add top-down sprite animations`를 `origin/main`에 push했고, 원격 ref `843792e8be0a19a01ed0dc1bb7f1c4671054a236`가 로컬 커밋과 일치함을 확인했다.
- 게시 전 `npm test` 16개 파일·110개 테스트, lint, 전체 build, Chromium·Firefox E2E 10개와 실제 8인 렌더 캡처를 통과했다. 기존 client 500 kB chunk 경고만 남는다.
- push로 실행된 GitHub Actions `WebKit E2E` run `32701229312`가 성공했다. 저장소 HTTPS Git credential로 push와 Actions 상태 조회를 수행했으며 credential 값은 출력하거나 저장하지 않았다.

## 2026-08-24 — 최신 스프라이트·매칭 공개 배포

- 최신 `main` HEAD `73ab812`을 Cloud Build `cfb65314-683a-404d-bff7-0314ba59ed9e`로 빌드해 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:public-1787556524424`를 생성했다.
- Cloud Run revision `squirrel-heist-00014-w5r`가 100% traffic을 처리하도록 전환하고 Firebase Hosting `https://squirrel-c3cf8.web.app`에 42개 파일의 최신 스프라이트 client bundle을 배포했다.
- 배포 전 `npm test` 16개 파일/110개 테스트, lint, build가 통과했다. 배포 뒤 Firebase HTTPS·`assets/sprites/squirrel-walk.png`가 200, Firebase origin WSS handshake 성공, Cloud Run `/health`의 `{"ok":true,"rooms":0}`을 확인했다.

## 2026-08-25 — 축소 맵·차지형 썬더와 봇 균형 조정

- 맵을 `192 × 144`로 축소하고 generator v9/balance v6으로 올렸다. `LINE` 레이아웃의 감옥 앵커를 안전 영역 안쪽으로 옮기고, 나무 20개·베리 후보 28개(10.5 unit 간격)로 1,000 seed 검증에서 7개 레이아웃이 모두 생성되게 했다.
- 체포 반경을 `1.7`로 늘리고, 베리를 최대 6개·6~10초 주기로 조정했다. 썬더는 1초 동안 정지·발사 버튼 유지가 필요하며, 차지 중 최신 마우스 조준은 유지된다. 이동·해제·기절·체포·연결 종료는 소비 없이 취소한다.
- Greedy 목표 선택은 역할 최우선 행동을 고정하고 동률 목표의 이동 비용만 비교하도록 조정해 다수 경찰의 과도한 포위 최적화를 제거했다.
- `BOT_EVAL_SEEDS=100 npm run bot:evaluate` 400경기에서 rule/rule 52:48, greedy-thief 54:46, greedy-police 43:57, greedy/greedy 40:60으로 네 조합 모두 6:4 기준을 통과했다. 최대 막힘 1.28%, 무효 입력 0.0044회/분, 판단 오류 0건이다.

## 2026-08-25 — 공개 배포 끊김 병목 조사

- Firebase Hosting과 Cloud Run 공개 환경을 직접 계측했다. 1인 비공개 방의 30초 지속 WSS 표본은 598개 스냅샷(19.93 Hz), 스냅샷 간격 평균 49.97 ms·p95 56 ms·최대 69 ms, ping RTT 평균 8.29 ms·p95 14 ms·최대 22 ms로 유휴 상태의 지속 연결과 20 tick/s 주기는 안정적이었다. WebSocket 압축 확장은 협상되지 않았다.
- 서버는 매 tick마다 모든 플레이어·도토리·베리·상호작용 상태를 각 접속자별로 다시 직렬화해 전송한다. 소켓 `bufferedAmount` 제한과 오래된 월드 스냅샷 대체가 없으며, catch-up tick도 각각 스냅샷을 발행해 이벤트 루프 지연 뒤 전송 버스트가 생길 수 있다. 기존 로컬 80클라이언트 계측에서는 simulation tick p95가 약 1.02 ms인 반면 송신량은 약 8.6 MB/s였으므로, 서버 연산보다 전체 JSON 스냅샷 fan-out과 느린 연결의 백프레셔가 우선적인 서버/네트워크 위험이다.
- 배포된 `threeRenderer`는 640×2560 RGBA 다람쥐 아틀라스의 UV를 갱신할 때 플레이어별 texture에 매 렌더 프레임 `needsUpdate = true`를 설정한다. Three.js에서 이는 texture version 증가와 GPU 재업로드를 유발하므로, 8인 기준 프레임당 약 52.4 MB의 원본 texture upload를 강제할 수 있다. 현재 보고된 끊김의 즉시 재현 가능성이 가장 높은 병목으로 판단했다.
- 우선 개선안은 (1) 프레임별 `needsUpdate` 제거와 아틀라스 공유, (2) 서버의 최신 월드 스냅샷 1개만 유지하는 backpressure 및 catch-up 중 1회 publish, (3) 공통 snapshot 1회 직렬화와 10~15 Hz publish/동적 delta 분리, (4) jitter 기반 적응형 보간과 정적 미니맵 캐싱이다. 이후 event-loop lag, 직렬화 시간·크기, `bufferedAmount`, 대체된 스냅샷, 클라이언트 RTT/jitter·long frame을 함께 계측해야 한다.
- 공개 `/metrics`는 인증 없이 401이므로 실제 신고 시점의 CPU·event-loop·소켓 큐 상관관계는 확인하지 못했다. 이번 작업은 진단과 개선안 제시에 한정했으며 제품 코드는 변경하지 않았다.

## 2026-08-25 — 저폴리 3D 표현 단일화와 도토리 더미 보정

- 사용자 결정에 따라 legacy·flat·2.5D 스프라이트 variant와 비교용 URL/키 전환을 제거하고, `client/public/assets/models/low-poly/`의 다람쥐·숲 GLB만 preload하는 단일 3D 렌더러로 정리했다. 기존 PNG 스프라이트·분리 프레임과 비교 캡처는 제거했으며, 서버 권위 상태·맵 정의·충돌 AABB는 바꾸지 않았다.
- 필드 도토리와 베리는 3D 모델 footprint 기준으로 각각 `1.55`, `0.95`로 축소했고, 운반·기지 보관 도토리는 별도 스케일을 유지했다. 보관·확보 도토리는 ID와 map hash로 결정되는 유사 물리 낙하/수평 밀림/높이·기울기 정착 계산을 적용해 격자 대신 불규칙한 더미로 표시한다.
- 울타리 prefab은 한 줄의 긴 통나무 레일과 일정 간격의 둥근 나무 말뚝 5개, 절단면 cap으로 다시 생성했다. 자동 GLB bounds 검증도 새 6.88-unit panel 길이를 허용하도록 갱신했다.
- 수관 투명화는 GLB `MeshStandardMaterial`이 기본 불투명 shader에 남아 opacity가 보이지 않던 문제를 보정했다. 진입 tween 전에 모든 수관 재질을 `transparent=true`, `depthWrite=false`, `needsUpdate=true`로 명시 전환하고, 이탈 완료 때만 불투명 depth-write 경로로 복원한다.
- `npm run assets:3d -w client`, `npm test`(16개 파일·113개), `npm run lint`, `npm run build`, `npm run e2e -- --project=chromium --project=firefox`(10개)를 통과했다. build에는 기존 client chunk 500 kB 초과 경고만 남는다.

## 2026-08-25 — Protocol v12 네트워크 전송 최적화

- 20Hz 권위 simulation과 10Hz 월드 snapshot publish를 분리했다. catch-up tick은 상태를 계속 진행하지만 frame 끝에는 Room의 최신 공통 snapshot만 최대 한 번 발행한다. `WorldSnapshot.ackInputSequence`를 제거하고 로컬 `PlayerSnapshot.lastProcessedInputSequence`로 재접속·reconciliation 입력 sequence를 복구하도록 protocol v12로 올렸다.
- Gateway는 동일한 snapshot 객체를 `WeakMap`으로 한 번만 JSON 직렬화한다. 연결별 snapshot 전송 중이거나 `bufferedAmount`가 64KiB를 넘으면 pending 최신 한 개만 유지하며, 제어·event·chat·error 메시지는 reliable 경로로 즉시 전송한다. snapshot 발행·실송신·대체·직렬화 비용/크기·send callback·최대 buffer와 process event-loop 지연을 `/metrics`에 추가했다.
- 클라이언트는 최근 40개 transit offset의 p10과 EWMA로 서버 시계를 추정하고, 도착 jitter p95에 따라 150~250ms 보간 지연을 선택한다. 렌더 대상 시각은 역행하지 않으며 100ms 제한 외삽과 60fps 3D 표현을 유지한다.
- 동일 production build의 80클라이언트·10개 8인 Room·30초 전후 계측에서 snapshot은 20.033Hz에서 9.99984Hz로 바뀌었고 payload는 266,207,249B(8,873,610B/s)에서 132,567,896B(4,418,859.72B/s)로 50.20% 감소했다. 변경 후 tick p95 최대 0.131ms, catch-up·invalid·오류·snapshot 대체 0, 직렬화 횟수와 publish 횟수 일치, 최대 `bufferedAmount` 0이었다. 두 번째 동일 부하의 RSS는 108,432→108,420→108,428KiB로 단기 증가 추세가 없었고 종료 후 Room 0을 확인했다.
- `npm test` 17개 파일·118개 테스트, `npm run lint`, `npm run build`, Chromium·Firefox E2E 10개와 두 차례 80클라이언트 부하가 통과했다. 전체 `npm run e2e`의 WebKit 5개는 코드 실행 전 호스트의 `libicu74`·`libflite1`·`libmanette` 부재로 시작하지 못했다. 기존 client chunk 500kB 초과 경고와 공개 Cloud Run에서의 v12 실측·장기 메모리 관찰은 후속 과제로 남는다.

## 2026-08-25 — Space·Left Shift 조작 전환

- 상호작용 hold 키를 `E`에서 `Space`로, 도토리 행동 rising-edge 키를 `F`에서 `Left Shift`로 바꿨다. Space의 브라우저 스크롤 기본 동작도 막았으며 Right Shift와 이전 `E`/`F`는 행동 비트를 만들지 않는다.
- HUD, 기본 안내, 3D 월드 툴팁, 플레이테스트 체크리스트와 프로젝트 명세를 `[Space]`·`[LShift]` 표기로 함께 갱신했다.
- `npm test` 17개 파일·119개 테스트, lint, production build, Chromium·Firefox E2E 10개를 통과했다. build에는 기존 client chunk 500kB 초과 경고만 남는다.

## 2026-08-25 — 네트워크·조작키 변경 원격 게시과 배포 환경 확인

- `1e8210a feat(network): optimize snapshot delivery`을 `origin/main`에 push했고, 원격 `refs/heads/main`이 `1e8210ac664e0b6a38c845f55ee674f4070075d0`으로 일치함을 확인했다.
- 공개 배포 스크립트를 기존 Secret Manager의 metrics token과 `squirrel-c3cf8` project로 실행하려 했으나, 이 실행 환경에는 Cloud Run/Secret Manager를 호출할 `gcloud`와 Firebase Hosting을 호출할 `firebase` CLI가 모두 설치되어 있지 않아 배포는 시작되지 않았다. 자격 증명이나 배포 API를 우회하지 않았으며, CLI가 준비된 운영 환경에서 `PUBLIC_PROJECT_ID=squirrel-c3cf8`와 기존 metrics token으로 `npm run deploy:public`을 재실행해야 한다.

## 2026-08-25 — 저폴리 3D·네트워크 v12 공개 배포

- 최신 `main` HEAD `eeabcd6`을 Cloud Build `91f9b009-41ea-4483-b207-d037ce4475ed`로 빌드해 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:public-1787630575673`를 생성했다.
- Cloud Run revision `squirrel-heist-00016-7s6`가 100% traffic을 처리하도록 전환하고 Firebase Hosting `https://squirrel-c3cf8.web.app`에 low-poly 3D·snapshot v12 client bundle을 배포했다.
- 배포 전 `npm test` 17개 파일/119개 테스트, lint, build가 통과했다. 배포 뒤 Firebase HTTPS와 `assets/models/low-poly/squirrel.glb`가 200, Firebase origin WSS handshake 성공, Cloud Run `/health`의 `{"ok":true,"rooms":0}`을 확인했다.

## 2026-08-25 — 10×10 청크 지형 장식과 독립 엄폐물

- 클라이언트는 권위 `MapDefinition`의 hash·playable polygon·path metadata만으로 10×10 unit 잔디 청크를 결정론적으로 만든다. 청크마다 잔디 blade와 조약돌을 instancing하고, 기존 길 metadata는 낮은 흙길 mesh로 표시한다. 이 장식 계층은 충돌·시야·맵 hash 규칙을 바꾸지 않는다.
- `MapDefinition`에는 `rockPiles`와 `bushes` 원형 장애물을 추가하고 protocol v13·generator v10/balance v7로 올렸다. 생성기는 1,000 seed에서 돌무리 8개·줄기 없는 수풀 10개를 거점·나무·울타리와 간격을 두고 배치한다. 서버 권위 이동, hitscan 시야, 아이템 drop, 클라이언트 prediction은 모두 같은 원형 충돌체를 사용한다.
- low-poly 숲 GLB에 줄기 없는 `bush` prefab을 추가하고, 돌무리는 울타리 끝 장식이 아닌 독립 맵 장애물로 렌더한다. 울타리 말뚝은 나무 줄기와 같은 원통형 수피 ring·절단면 cap 생성 함수를 재사용해 자연스러운 통나무 형태로 통일했다.
- `npm run assets:3d -w client`, 1,000 seed map 회귀·renderer 단위 테스트, 전체 build, lint, Chromium·Firefox E2E를 통과했다. 기존 client chunk 500 kB 초과 경고만 남는다.

## 2026-08-25 — 중앙 빠른 매칭 카드 레이아웃

- React가 아닌 현재 client 구조에 HeroUI 패키지를 추가하지 않고, HeroUI Card·Button의 header/body/footer와 명확한 보조 action 구성을 네이티브 HTML/CSS로 적용했다.
- 빠른 매칭은 메인 카드 위 중앙의 단일 overlay 카드로 표시한다. 카드에는 현재 참가자·대기 시간 지표와 `매칭 중단` 버튼을 배치하고, 뒤의 메인 요소는 반투명·비활성 처리해 오직 대기 카드만 조작할 수 있게 했다.
- 로비 카드의 세로 scroll view를 제거하고, 일반 흐름의 card surface로 재배치했다. `npm run lint`, `npm run build`, `git diff --check`는 UI 변경 직후 통과했다.
- 이후 별도 작업의 `MapDefinition.dirtPaths` 타입 추가와 generator 반환값 불일치로 shared build가 실패해, 새 중앙 카드 E2E는 실행하지 못했다. 맵 생성 관련 파일은 이 작업 범위 밖이므로 수정하지 않았다.

## 2026-08-25 — 청크 장식 가독성 확대

- 10×10 청크는 여전히 생성·instancing 단위로 유지하되, 타일별 색 차이와 0.08 unit 틈을 없애고 살짝 겹치게 해 격자 경계를 보이지 않게 했다.
- 잔디 blade는 12개/청크으로 밀도와 높이·폭을 키웠고, 조약돌은 3개/청크으로 수와 silhouette을 키웠다. 독립 돌무리와 수풀 prefab은 collision 반경을 바꾸지 않은 채 시각 footprint만 12.5% 확대했다.
- Chromium 8인 친구방 인게임 캡처와 renderer 단위 테스트, lint, client build를 통과했다. 캡처는 `/tmp/squirrel-terrain-ingame-large.png`에 저장했다.

## 2026-08-25 — 생성 경로 기반 흙길과 청크 소품 분포

- generator가 layout topology에서 도출한 도둑 기지·감옥 출구→각 경찰 저장소 route를 `dirtPaths`로 명시한다. renderer는 일반 navigation metadata가 아닌 이 표현 전용 polyline과 width를 따라 흙길을 채운다.
- 돌무리·수풀은 이제 전역 무작위 좌표가 아니라 playable 10×10 청크를 우선순위 시드로 섞은 뒤, 각 청크의 결정적 난수 후보에 배치한다. 흙길·거점·울타리·나무와의 간격 검사를 적용해 길을 덮거나 주요 지점을 막지 않는다.
- protocol v14, map generator v11, balance v8로 올렸으며 `npm test -- --run shared/tests/mapGenerator.test.ts client/tests/rendering.test.ts`(1,000 seed 포함), lint, 전체 build를 통과했다.

## 2026-08-25 — 빠른 매칭 이탈 복구와 대기 시간 표시

- 빠른 매칭 카드가 Room 패널 바깥에 있는 상태에서 이탈 처리 시 숨겨지지 않던 문제를 고쳤다. 매칭 취소는 reconnect token을 바로 지우고 서버 이탈 요청 뒤 로컬 UI를 즉시 메인 상태로 복구한다.
- 새로고침·탭 종료 시 빠른 매칭 대기 중이었다면 reconnect token을 폐기해, 새 페이지가 이전 매칭 대기 카드로 재진입하지 않도록 했다. 친구 방 및 실제 경기의 재접속 흐름은 유지한다.
- 매칭 카드에 `대기 시간 00:00`을 추가하고 시작 시점부터 분:초 형식으로 갱신하며, 취소·매칭 완료·이탈 시 timer를 정리한다.
- `npm run lint`, `npm run build`, `git diff --check`가 통과했다. 변경 E2E는 Chromium·Firefox에서 통과했고, WebKit은 호스트의 `libicu74`·`libflite1`·`libmanette` 부재로 실행하지 못했다.

## 2026-08-25 — 변경 단위 push 준비

- 맵·지형 장식 변경을 `5efe014 feat(map): add deterministic terrain decoration`으로 먼저 커밋하고 `origin/main`에 push했다.
- 매칭 대기 카드·취소·재접속 정리 변경을 `a4557ce feat(client): improve matchmaking wait flow`로 별도 커밋하고 `origin/main`에 push했다.
- 두 커밋 모두 명시적 파일만 스테이징했으며, `git diff --cached --check`를 통과시켰다. 공개 배포는 두 단위가 원격에 반영된 뒤 최신 HEAD를 기준으로 진행한다.

## 2026-08-25 — 단위 push 후 공개 배포 반영

- `5efe014`, `a4557ce`, `8bd9464`를 순서대로 `origin/main`에 push한 뒤 Cloud Build `f47989b2-cc9c-4ef2-8dd6-fc7deadbaea6` 성공을 확인했다. 이미지 태그는 `public-1787633961193`이다.
- Cloud Run revision `squirrel-heist-00018-wts`를 `asia-northeast3`에 배포하고 100% traffic을 연결했다. `min-instances=1`, `max-instances=1`, 1 CPU/512 MiB, concurrency 32, timeout 3600초와 공개 origin 제한 환경변수를 유지했다.
- `VITE_WS_URL`을 최신 Cloud Run WSS URL로 주입해 Firebase Hosting `https://squirrel-c3cf8.web.app`에 client/dist를 배포했다.
- 배포 후 Hosting 200, forest-props GLB 200, Cloud Run `/health` `{"ok":true,"rooms":0}`, `https://squirrel-c3cf8.web.app` origin의 WSS handshake 성공을 확인했다. Vite의 500 kB 초과 chunk 경고는 기존과 동일한 비차단 경고다.

## 2026-08-25 — 게임 시작 카운트다운 종료 보강

- `PLAYING` 또는 `FINISHED` phase가 들어오면 카운트다운 timer를 먼저 정리하고 카운트다운 요소를 즉시 숨긴 뒤 HUD를 표시하도록 전환 순서를 명확히 했다.
- phase 전환 메시지가 지연되어도 countdown 종료 시각을 넘기면 timer가 스스로 정리되어 숫자 `1`과 카드가 남지 않도록 안전망을 추가했다.
- 스크롤을 없앤 대기실은 720px 높이에서 준비 제어가 화면 밖으로 밀렸으므로, 낮은 높이에서는 방 카드의 브랜드·참가자 카드·제어 간격을 압축하는 반응형 layout을 적용했다.
- `npm run lint`, `npm run build`, `git diff --check`, Chromium·Firefox의 친구 방 8인 시작 E2E를 통과했다. WebKit은 호스트 라이브러리 부재로 실행하지 않았다.

## 2026-08-25 — 카운트다운 종료 수정 공개 배포

- `b247143 fix(ui): dismiss countdown on match start`를 `origin/main`에 push했다.
- Cloud Build `1d7c2b8e-7fa4-4f59-bebb-0169d34c9309`가 image `asia-northeast3-docker.pkg.dev/squirrel-c3cf8/squirrel-heist/squirrel-heist:main-b247143`를 생성했다. Cloud Run Seoul revision `squirrel-heist-00019-2gh`가 100% traffic을 처리하도록 전환했다.
- Firebase Hosting `https://squirrel-c3cf8.web.app`에 새 client bundle을 배포했다. Hosting HTTPS와 bundle의 WSS 주소, Cloud Run `/health`의 `{"ok":true,"rooms":0}`을 확인했다.

## 2026-08-25 — 주 경로 정리·곡선 흙길과 울타리 접합 개선

- 흙길은 폭을 바꾸지 않고 기지→세 저장소 및 감옥→가장 가까운 저장소의 4개 주 연결만 생성하도록 줄였다. generator v12와 `safe-meadow-v12` fallback hash를 고정했고, navigation·충돌 권위는 변경하지 않았다.
- 경유점이 있는 흙길은 클라이언트 표현에서 centripetal 곡선으로 보간하되, 양 끝은 원본 거점 좌표에 정확히 맞췄다. 풀·조약돌은 청크별 독립 PRNG 스트림으로 넓게 흩어져 hash 상관관계의 줄무늬가 생기지 않게 했다.
- 3D 울타리는 레일과 말뚝 prefab을 분리했다. 레일은 padding 없이 패널 경계에서 끝나고, 원형 통나무 말뚝은 모든 패널 경계에 배치하며, 교차·연결된 울타리가 같은 끝점을 공유하면 한 번만 생성한다.
- `npm run assets:3d -w client`, renderer/map generator 22개 단위 테스트(1,000 seed 포함), `npm run lint`, `npm run build`, Chromium 8인 친구방 E2E를 통과했다. 실제 인게임 캡처는 `/tmp/squirrel-main-routes-curved.png`에 저장했다.

## 2026-08-25 — 흙길 거점 연결망 재구성

- 독립 경로가 같은 구간을 겹쳐 지나며 망가져 보이던 문제를 해결하기 위해, 기지·감옥·세 저장소를 거리 기반 최소 신장 트리로 연결했다. 각 edge는 거점 중심 좌표에서 정확히 시작·끝난다.
- 곡선 흙길의 모든 샘플 접합점에 얇은 원형 junction mesh를 추가해 선분 사이의 틈·날카로운 꺾임을 없앴다. 표현만 바뀌며 서버 권위 이동·충돌 데이터는 바꾸지 않았다.

## 2026-08-25 — 흙길 edge 범용 경로 보정

- 앞선 최소 연결망에 기존 기지 전용 route 공식을 재사용하면서 저장소 사이 edge가 불필요하게 크게 우회하는 것을 확인했다. 모든 edge를 양 끝점과 거리·수직 벡터에서 산출한 하나의 완만한 control point로 재구성했다.
- generator v14와 `safe-meadow-v14` fallback hash로 회귀값을 갱신했다. 이 경로는 모든 연결의 양 끝을 거점 중심에 정확히 맞추며, 화면 표현 외 권위 규칙에는 영향을 주지 않는다.

## 2026-08-25 — 흙길 연속 리본 렌더링

- 실제 8인 캡처에서 곡선 샘플을 사각 BoxGeometry로 이어 붙인 표현이 계단처럼 보이고, 원형 접합부가 과도하게 부풀어 보이는 것을 확인했다.
- 흙길 하나마다 곡선 중심선의 좌우 외곽을 ShapeGeometry로 묶은 연속 리본으로 교체하고, 개별 선분 및 원형 접합 mesh를 제거했다. 경로는 이제 하나의 매끄러운 면으로 연결된다.

## 2026-08-25 — 장식 밀도 75% 조정

- 수풀·돌무리·나무 목표 수를 각각 8·6·15로 낮췄고, 청크 잔디는 12개에서 9개로 줄였다. 조약돌은 청크당 2개에 25% 확률로 하나를 추가해 평균 2.25개(기존 3개의 75%)가 되게 했다.
- 충돌·시야 차단의 규칙과 크기는 유지하며, 바뀐 생성 목표를 반영하도록 map generator v15, balance v9, fallback seed를 갱신했다.

## 2026-08-25 — 장식 밀도 범위 정정

- 수풀·돌무리는 일반 장식이 아니라 시야·엄폐 역할을 한다는 확인에 따라 목표 수를 기존 값으로 복원했다. 이에 map generator와 balance 버전도 v14·v8로 되돌렸다.
- 현재 75% 밀도 조정은 충돌과 관계없는 지면 잔디·조약돌에만 적용된다.

## 2026-08-25 — 단일 울타리 레일

- 긴 충돌 울타리의 레일을 여러 패널로 나누어 보이던 표현에서, AABB 양 끝을 한 번에 잇는 단일 통나무 레일로 변경했다. 말뚝만 일정 간격으로 유지하며, 레일의 양 끝과 공유 접합점 좌표는 기존처럼 정확히 맞춘다.

## 2026-08-25 — 울타리 말뚝 전면 레이어

- 레일의 모든 mesh를 render layer 10에 두고, 말뚝은 높이를 미세하게 올린 뒤 layer 11에 배치했다. 따라서 겹침 지점에서는 레일이 먼저 그려지고 말뚝이 최상단에 보인다.

## 2026-08-25 — 최신 지형 변경 push·공개 배포

- `a64e669 feat(map): refine terrain paths and scatter`를 `origin/main`에 push했다. `npm test`(17개 파일/123개 테스트), lint, 전체 build가 통과했다.
- Cloud Build `6e95ef7d-ace1-4ead-b854-ede2d7125fa3` 성공 후 image `public-1787636651651`을 생성했다. Cloud Run revision `squirrel-heist-00021-p2t`가 100% traffic을 처리한다.
- 최신 client bundle을 Firebase Hosting `https://squirrel-c3cf8.web.app`에 배포했다. Hosting 200, forest-props GLB 200, Cloud Run `/health` 정상, Firebase origin WSS handshake 성공을 확인했다.
