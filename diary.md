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
