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
