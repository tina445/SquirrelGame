# 도토리 대소동 (Squirrel Heist)

4 대 4 비대칭 실시간 웹 액션게임 **도토리 대소동**의 기획 및 구현 기준 저장소입니다. 도둑 다람쥐 4명은 숲의 저장소에서 도토리를 훔쳐 기지로 운반하고, 경찰 다람쥐 4명은 이를 방어하고 체포합니다.

P0~P5 MVP 수직 절편은 구현되어 있고 P6 안정화와 포스트 MVP 폴리싱을 진행 중입니다. 현재 매칭 중 UI와 매칭 완료 명단을 갖춘 빠른 매칭, 방장·준비·방장 위임을 갖춘 4×2 친구 Room, 시작 직전 4 대 4 확정, 20Hz 권위 입력 위의 60fps 로컬 예측·원격 보간, generatorVersion 7의 256×192 월드와 7종 terrain, 상시 전술 미니맵, 충돌 감옥 prefab, 나무 엄폐물, 가독성 높은 월드 툴팁과 hitscan 람쥐썬더가 동작합니다. 상세 구현 기준은 [프로젝트 사양서](squirrel-heist-project-spec.md), 저장소 작업 지침은 [AGENTS.md](AGENTS.md), 시간순 작업 기록은 [diary.md](diary.md)를 우선합니다.

## 기획 상세

### 핵심 게임 루프

`훔치기 → 운반하기 → 추격/방해 → 체포 → 감옥 구출 → 재도전`

- 매치 길이: 기본 6분
- 팀: 도둑 4명 대 경찰 4명
- 맵: 경찰 저장소 3곳, 저장소당 도토리 3개, 감옥 1곳
- 자원: 양 팀이 획득하는 중립 베리와 단발성 람쥐썬더
- 조작: `W/A/S/D` 또는 방향키 이동, 마우스 조준, `E` 홀드 상호작용, `F` 도토리 들기/놓기, 좌클릭 발사, 백틱 키 충돌 디버그

`W/S`는 현재 커서 방향 기준 전진/후진, `A/D`는 좌우 이동입니다. 로컬 캐릭터 방향과 이동 표현은 매 렌더 frame에 즉시 반응하지만 람쥐썬더의 hitscan 명중·벽 차단·기절은 서버가 확정합니다.

### 승리 조건

- 도둑: 도토리 9개를 모두 도둑 기지에 확보하면 즉시 승리
- 경찰: 제한시간 종료 시 도토리가 남아 있거나, 도둑 4명 전원을 1초간 수감하면 승리
- 같은 tick에 조건이 겹치면 도둑의 9개 확보를 먼저 판정

### 기술 방향

- 클라이언트: TypeScript, Vite, Three.js, Tween.js, HTML/CSS
- 서버: Node.js, TypeScript, WebSocket 기반 authoritative simulation
- 테스트: Vitest 단위·통합 테스트, Playwright 다중 브라우저 테스트
- 구조: `client/`, `server/`, `shared/` npm workspace 모노레포

서버는 위치, 충돌, 도토리 소유권, 체포·구출, 기절, 승패의 최종 권위입니다. 클라이언트는 입력 의도만 전송하며, Three.js 객체와 Tween.js timeline은 표현 상태로만 사용합니다. 순수 수학·충돌·프로토콜 타입은 `shared/`에 두고 서버 전용 판정은 공유하지 않습니다. 빠른 매칭과 친구 Room의 서로 다른 규칙은 서버 `LobbyFlowPolicy`, 화면 전이는 클라이언트 `LobbyPresentationPolicy` Strategy로 분리합니다.

## MVP 범위

1. 로비에서 빠른 매칭 또는 비공개 Room 생성·코드 참가, 8명(4 대 4)의 준비·카운트다운·종료 화면과 목표·도토리·아군 전술 미니맵
2. seed 기반 불규칙 다각형 절차 맵 생성·검증 및 클라이언트/서버 맵·충돌 일치
3. 9개 도토리의 저장소 배치, 운반, 필드 드롭, 반환, 확보 상태 전이
4. 서버 tick 기반 이동, 정적 충돌, 운반 중 85% 감속
5. 경찰 체포(0.6초 홀드), 감옥 수감, 도둑 구출(3초 홀드), 탈출 후 1초 체포 면역
6. 베리 생성·획득과 양 팀의 람쥐썬더 hitscan·벽/상대 최초 명중·1.5초 기절
7. 로컬 prediction/reconciliation, 원격 플레이어 interpolation, 지연·손실 환경 검증
8. 도토리 보존, 입력 검증, 체포/구출 취소, 연결 종료·재접속, 동시 승리 조건 테스트

## 실행과 검증

```sh
npm install
npm run dev       # WebSocket 서버 :8080 + Vite 클라이언트 :5173
npm run build
npm test
npm run lint
npm run e2e
npm run playtest:preflight
```

`npm run map:preview -- demo-seed`는 재현 가능한 MapDefinition을 출력합니다. 서버 실행 중 `LOAD_BOTS=80 LOAD_DURATION_MS=10000 npm run load:test`로 10 Room/80봇 부하 기준을 확인할 수 있습니다. 서버 상태와 Room별 tick 지표는 `/health`, `/metrics`에서 확인합니다.

### Arch Linux에서 로컬 플레이

WebKit은 CI 호환성 검사에만 사용하며 게임 실행 의존성이 아닙니다. Arch Linux에서는 Chromium 또는 Firefox로 플레이합니다.

```sh
npm run dev
# http://127.0.0.1:5173 접속
```

현재 빠른 매칭은 8명의 asset 준비가 끝나면 자동으로 시작하며, 친구 Room은 8명이 역할을 선택하고 준비한 뒤 방장이 시작합니다. 한 명이 테스트할 때는 서버/클라이언트를 먼저 실행한 뒤 별도 터미널에서 7개 봇으로 나머지 슬롯을 채울 수 있습니다.

```sh
LOAD_BOTS=7 LOAD_DURATION_MS=600000 npm run load:test
```

휴먼 플레이테스트 직전에는 `npm run playtest:preflight`를 다시 실행하고, 동일 commit의 **WebKit E2E** GitHub Actions가 성공했는지 확인합니다.

구현 순서는 명세와 동일하게 `P0 기반/공유 규칙 → P1 회색상자 네트워크 이동 → P2 절차적 맵 → P3 8인 Room/도토리 → P4 체포/감옥/구출 → P5 베리/람쥐썬더 → P6 안정화`입니다. P0~P5 자동 검증과 포스트 MVP 로비/매칭 수직 절편은 완료되었습니다. 다음 우선순위는 256×192 월드의 실제 이동시간·시야·오브젝트 밀도 밸런싱, 실제 8인 지연 플레이테스트, 방 코드 복사·카운트다운 표시 같은 UX 폴리싱, 연결 그래프·우회로·병목 점수 확장, 연출 보강과 WSS 배포 리허설입니다.

각 단계는 정상 흐름과 경계 조건을 자동 테스트하거나 재현 가능한 수동 검증으로 완료합니다. 새 밸런스 값은 `shared/config/`와 기획서에 함께 반영하고, 새 프로토콜은 버전·런타임 검증·중복/순서 처리 정책을 정의해야 합니다.

## 문서

- [상세 프로젝트 사양](squirrel-heist-project-spec.md)
- [기여자 가이드](AGENTS.md)
- [작업 일지](diary.md)
- [프로토콜 v6](docs/PROTOCOL.md)
- [밸런스 변경 기록](docs/BALANCE_CHANGELOG.md)
- [배포/WSS 안내](docs/DEPLOYMENT.md)
- [휴먼 플레이테스트 사전 점검](docs/HUMAN_PLAYTEST_CHECKLIST.md)
