# 도토리 대소동 — 4 vs 4 웹 액션게임 프로젝트 사양서

> 문서 상태: 구현 기준 초안 v1.0  
> 대상: 구현 에이전트 및 개발자  
> 플랫폼: 데스크톱 웹 브라우저  
> 핵심 스택: Three.js + TypeScript + Vite / Node.js + TypeScript / WebSocket  
> 문서의 규범 용어: **필수(MUST)**, **권장(SHOULD)**, **선택(MAY)**

---

## 1. 문서 목적

이 문서는 공모전 제출용 4 vs 4 실시간 웹게임 **「도토리 대소동」(가칭)**의 기획 의도와 기술 요구사항을 하나의 구현 기준으로 고정한다. 구현 에이전트는 기능을 추가하거나 구조를 변경하기 전에 이 문서의 게임 규칙, 권한 경계, 네트워크 모델, MVP 범위와 완료 조건을 우선 적용해야 한다.

이 프로젝트는 상용 서비스 규모의 인프라보다 다음 목표를 우선한다.

1. 브라우저에서 8명이 실제로 한 판을 끝까지 플레이할 수 있을 것
2. 조작 반응성과 원격 플레이어 움직임이 실시간 액션게임으로 납득 가능할 것
3. 도토리 소유권, 체포, 구출, 기절, 승패를 서버가 일관되게 판정할 것
4. 절차적 생성 맵이 매치마다 변화를 만들되, 항상 플레이 가능하고 대체로 공정할 것
5. 공모전 이후 Room 단위 수평 확장과 콘텐츠 확장이 가능한 경계를 가질 것

---

## 2. 게임 개요

### 2.1 한 줄 소개

> 겨울나기를 위해 도토리를 모으고 쟁탈하라! 도둑 다람쥐 4마리는 숲의 세 저장소를 털어 도토리를 굴로 옮기고, 경찰 다람쥐 4마리는 제한시간 동안 도토리를 지키며 도둑을 붙잡는다.

### 2.2 장르와 플레이 감정

- 장르: 4 vs 4 비대칭 목표형 탑뷰 팀 액션
- 매치 길이: 초기값 6분
- 핵심 루프: **훔치기 → 운반하기 → 추격/방해 → 체포 → 감옥 구출 → 재도전**
- 전투의 목적: 상대 제거가 아니라 시간 손실과 공간 통제 만들기
- 조작 목표: 이동 + 역할 상호작용 + 도토리 상호작용 + 단발성 원거리 방해
- 그래픽 방향: Three.js의 직교 카메라를 사용하는 2D/2.5D 탑뷰. 초기에는 평면 스프라이트/단순 메시를 사용하고 조명, 높이, 숲 오브젝트를 점진적으로 추가한다.

### 2.3 팀

| 팀 | 인원 | 역할 | 즉시 승리 목표 |
|---|---:|---|---|
| 도둑 | 4 | 저장소의 도토리를 훔쳐 도둑 기지로 운반 | 총 9개 도토리 확보 |
| 경찰 | 4 | 저장소 방어, 도토리 회수, 도둑 체포 | 도둑 4명 전원 수감 상태 1초 유지 |

제한시간이 끝났을 때 도둑이 9개를 확보하지 못했다면 경찰이 승리한다.

---

## 3. 설계 원칙

### 3.1 서버 권위 모델

게임 서버는 다음 상태와 판정의 유일한 최종 권위다.

- 플레이어의 유효 위치, 속도, 이동 가능 여부
- 도토리의 위치, 운반자, 저장소 귀속과 확보 상태
- 체포 시작/취소/성공과 감옥 이동
- 구출 진행률, 취소와 성공
- 베리 생성/획득, 람쥐썬더 발사/충돌/기절
- 매치 타이머, 점수, 승패와 종료 시점
- 절차적 맵의 seed, 결과 MapDefinition과 충돌 데이터

클라이언트는 입력과 행동 의도만 전송한다. `도토리를 얻었다`, `상대를 맞혔다`, `구출했다` 같은 결과를 전송해서는 안 된다.

### 3.2 상태와 표현의 분리

Three.js 객체는 렌더링 표현일 뿐 게임의 진실이 아니다.

```text
Network Snapshot / Local Prediction
                ↓
          Client GameState
                ↓
           RenderState
                ↓
      Three.js Scene Objects
```

`THREE.Mesh.position`을 충돌, 승패, 소유권 판정의 원본으로 사용해서는 안 된다. 서버 시뮬레이션은 Three.js에 의존하지 않아야 한다.

### 3.3 Room이 확장 단위

`MatchRoom` 하나는 다른 Room의 상태를 참조하지 않는 독립적인 한 경기다.

```text
Node.js Process
├─ Room A (최대 8명, 독립 tick/state/map)
├─ Room B (최대 8명, 독립 tick/state/map)
└─ Room C (최대 8명, 독립 tick/state/map)
```

MVP는 단일 Node.js 프로세스에서 여러 Room을 실행한다. 향후 여러 프로세스/호스트로 확장할 때 Room 배치 계층만 교체할 수 있어야 한다.

### 3.4 결정론과 데이터 중심 설정

- 밸런스 수치는 코드 곳곳에 하드코딩하지 않고 공유 설정으로 관리한다.
- 맵 생성기는 seed를 입력으로 받고 같은 버전과 seed에서 같은 결과를 생성해야 한다.
- 서버와 클라이언트가 공유할 수 있는 순수 수학, 충돌, 프로토콜 타입은 `shared` 패키지에 둔다.
- 서버 전용 판정과 숨겨야 할 상태는 공유 패키지에 두지 않는다.

---

## 4. 확정 게임 규칙

### 4.1 매치 흐름

```text
LOBBY → GENERATING → COUNTDOWN → PLAYING → FINISHED → CLOSED
```

1. Room 정원은 최대 8명이며 팀별 최대 4명이다.
2. MVP에서는 8명이 준비되면 시작한다. 개발 모드에서는 봇 또는 빈 슬롯 허용 여부를 설정할 수 있다.
3. 서버가 맵 seed를 확정하고 맵을 생성·검증한다.
4. 모든 클라이언트가 맵과 에셋 준비 완료를 알리면 3초 카운트다운 후 시작한다.
5. 플레이 시간 초기값은 360초다.
6. 승리 조건이 충족되면 서버가 즉시 매치를 종료한다.
7. 매치 종료 후 이동과 상호작용을 잠그고 결과 화면을 표시한다.

### 4.2 도토리 배치와 상태

- 경찰 측 저장소는 정확히 3개다.
- 각 저장소는 정확히 3개의 도토리로 시작한다.
- 한 매치의 도토리는 총 9개이며 런타임에 새로 생성되거나 사라지지 않는다.
- 한 플레이어는 한 번에 최대 1개의 도토리만 들 수 있다.

도토리 상태:

```text
POLICE_STORAGE ──도둑이 들기──▶ CARRIED
       ▲                         │
       │                         ├─ 일반 필드에 놓기/체포 시 낙하
       │                         ▼
경찰이 부족한 저장소에 반환 ◀── GROUND
                                 │
                                 └─ 도둑이 기지에 놓기 ──▶ SECURED
```

`SECURED`는 최종 상태이며 누구도 다시 들거나 이동할 수 없다.

### 4.3 도토리 상호작용 행렬

| 도토리 위치/상태 | 도둑 행동 | 경찰 행동 |
|---|---|---|
| 경찰 저장소 내부 | 들 수 있음 | 들 수 없음 |
| 일반 필드 `GROUND` | 들기/놓기 가능 | 들기/놓기 가능 |
| 플레이어가 운반 중 | 일반 필드 또는 허용 구역에 놓기 | 일반 필드 또는 허용 구역에 놓기 |
| 도둑 기지 내부 | 운반 중 도토리를 놓아 `SECURED` 가능 | 도토리를 놓거나 가져갈 수 없음 |
| 부족한 경찰 저장소 | 도둑은 놓을 수 없음 | 운반 중 도토리를 반환 가능 |
| 이미 `SECURED` | 상호작용 불가 | 상호작용 불가 |

추가 규칙:

- 일반 필드에 놓을 때는 플레이어 발밑에서 가장 가까운 유효 지점에 생성한다.
- 벽 내부, 맵 외부, 다른 비통과 오브젝트와 겹치는 위치에는 놓을 수 없다.
- 경찰의 저장소 반환 대상은 현재 3개 미만인 저장소만 유효하다.
- 도둑이 도둑 기지의 확보 구역에 도토리를 놓는 순간 `SECURED`가 되며 도둑 확보 수가 증가한다.
- 체포가 완료된 도둑이 도토리를 들고 있었다면 감옥으로 이동하기 전에 체포 완료 위치에 도토리를 떨어뜨린다.
- 람쥐썬더 피격만으로는 도토리를 떨어뜨리지 않는다.

### 4.4 이동

- 기본 입력: WASD 또는 방향키(방향키는 접근성 선택 사항)
- 대각선 입력은 정규화하여 축 이동보다 빨라지지 않게 한다.
- 도토리 운반 중 이동속도는 기본 속도의 85%다.
- `STUNNED`, `JAILED` 상태에서는 이동할 수 없다.
- 서버는 tick마다 최대 이동거리와 충돌을 검증한다.
- 플레이어 충돌체는 원(circle), 벽/장애물은 AABB 또는 단순 다각형을 기본으로 한다.
- 범용 2D/3D 물리 엔진은 MVP에 사용하지 않는다. 공유 가능한 순수 2D 충돌 함수를 사용한다.

### 4.5 조작과 행동

| 입력 | 행동 |
|---|---|
| WASD | 이동 |
| 마우스 위치 | 조준 방향 |
| E 홀드 | 경찰: 체포 / 도둑: 감옥 구출 |
| F | 도토리 들기 또는 놓기 |
| 마우스 좌클릭 | 보유 중인 람쥐썬더 발사 |

- E와 F는 현재 문맥에서 가능한 행동 하나만 서버에 의도로 전달한다.
- 클라이언트는 가까운 유효 대상에 `[E] 체포`, `[E] 구출`, `[F] 들기`, `[F] 놓기` 안내를 표시한다.
- 최종 대상 선택과 성공 여부는 서버가 판정한다.
- 키 재지정은 MVP 이후 확장 사항이지만 입력 계층은 특정 키 코드에 결합하지 않는다.

### 4.6 체포

| 항목 | 초기 밸런스값 |
|---|---:|
| 체포 가능 거리 | 캐릭터 지름 약 1개(월드 단위는 맵 프로토타입에서 확정) |
| 입력 | 경찰이 E 홀드 |
| 필요 시간 | 0.6초 연속 유지 |
| 완료 결과 | 도둑을 감옥으로 이동 |

체포는 다음 조건을 모두 만족해야 진행된다.

- 행동자는 경찰이고 `NORMAL` 또는 허용된 이동 상태다.
- 대상은 수감되지 않은 상대 도둑이다.
- 두 플레이어 사이 거리가 체포 범위 이내다.
- 벽 등 체포를 막는 장애물이 사이에 없다.
- 경찰이 기절하지 않았다.

거리 이탈, E 해제, 경찰 기절, 대상의 선행 체포/수감, 매치 종료 시 진행률은 즉시 취소된다. 완료 시 서버는 도둑의 도토리를 유효한 필드 위치에 떨어뜨리고, 도둑을 감옥 슬롯에 배치하고, 상태를 `JAILED`로 바꾼다.

### 4.7 감옥과 구출

- 감옥은 맵에 정확히 1개 존재한다.
- 수감자는 이동, 도토리 상호작용, 람쥐썬더 사용, 구출 행동을 할 수 없다.
- 비수감 도둑이 감옥 구출 지점에서 E를 3.0초 연속 유지하면 한 명을 구출한다.
- 구출 대상은 가장 오래 수감된 도둑이다.
- 한 번의 구출 행동으로 여러 명을 구출하지 않는다.
- 구출자는 도토리를 들고 있어도 구출할 수 있다.

다음 상황에서는 구출 진행률이 취소된다.

- E 해제
- 구출 범위 이탈
- 구출자 기절 또는 체포
- 구출할 팀원이 없어짐
- 매치 종료

구출 성공 시:

1. 서버가 감옥 주변의 유효한 탈출 포인트 중 하나를 선택한다.
2. 구출된 도둑을 해당 위치로 이동시킨다.
3. 1.0초 동안 **체포 면역만** 부여한다.
4. 이동, 도토리 상호작용, 람쥐썬더 사용은 허용한다.

탈출 포인트는 최소 4개 후보를 맵 생성 결과에 포함하고, 경찰/벽과 겹치지 않는 지점을 우선 선택한다.

### 4.8 베리와 람쥐썬더

베리는 양 팀이 획득할 수 있는 중립 자원이다.

| 항목 | 초기 밸런스값 |
|---|---:|
| 맵 동시 존재 베리 | 최대 2개 |
| 생성 간격 | 15~25초 사이 서버 난수 |
| 개인 보유 한도 | 1개 |
| 획득 방식 | 접촉 또는 짧은 자동 획득 범위 |
| 사용 | 마우스 좌클릭 |
| 투사체 기절 시간 | 1.5초 |
| 아군 오사 | 없음 |
| 벽 관통 | 없음 |
| 도토리 강제 낙하 | 없음 |

- 베리 위치는 완전한 임의 좌표가 아니라 절차적으로 생성·검증된 `berrySpawnPoints` 중에서 선택한다.
- 이미 람쥐썬더를 보유한 플레이어는 베리를 획득할 수 없다.
- 발사 시 보유 상태를 즉시 소모하고, 서버가 발사 위치·방향·속도로 투사체를 생성한다.
- 투사체는 상대 플레이어 한 명 또는 벽과 처음 충돌하면 제거된다.
- 상대에게 명중하면 `STUNNED` 상태를 1.5초 적용한다.
- 동일 대상에게 기절이 중복될 경우 MVP 기본 정책은 `max(currentStunEnd, newStunEnd)`로 종료 시각을 갱신하며, 무한 누적 시간은 허용하지 않는다.
- 기절은 진행 중인 체포/구출을 취소한다.

### 4.9 승리 조건

도둑 승리:

- 9개 도토리가 모두 `SECURED`가 된 tick에 즉시 승리한다.

경찰 승리:

- 제한시간이 0이 되었을 때 확보된 도토리가 9개 미만이다.
- 또는 도둑 4명이 모두 `JAILED`인 상태가 1.0초 연속 유지된다.

동일 tick에 여러 조건이 충족되는 경우 판정 순서는 다음과 같다.

1. 해당 tick의 모든 확정 게임 이벤트를 적용한다.
2. 도둑의 9번째 도토리 확보를 확인한다.
3. 전원 수감 유지 조건을 확인한다.
4. 제한시간 만료를 확인한다.

따라서 동일 tick에 마지막 도토리가 확보되었다면 도둑 승리를 우선한다. 이 순서는 테스트로 고정한다.

---

## 5. 초기 밸런스 설정

아래 값은 첫 플레이테스트를 위한 기본값이며 `shared/config/gameBalance.ts` 같은 단일 설정에서 관리한다.

| 키 | 기본값 | 설명 |
|---|---:|---|
| `MATCH_DURATION_SEC` | 360 | 한 경기 시간 |
| `TEAM_SIZE` | 4 | 팀당 인원 |
| `STORAGE_COUNT` | 3 | 경찰 저장소 수 |
| `ACORNS_PER_STORAGE` | 3 | 저장소당 도토리 |
| `MAX_CARRY_ACORNS` | 1 | 개인 운반 한도 |
| `CARRY_SPEED_MULTIPLIER` | 0.85 | 운반 감속 |
| `ARREST_HOLD_SEC` | 0.6 | 체포 유지 시간 |
| `RESCUE_HOLD_SEC` | 3.0 | 구출 유지 시간 |
| `RESCUE_ARREST_IMMUNITY_SEC` | 1.0 | 구출 직후 체포 면역 |
| `ALL_JAILED_CONFIRM_SEC` | 1.0 | 전원 수감 승리 확인 |
| `THUNDER_STUN_SEC` | 1.5 | 기절 시간 |
| `MAX_ACTIVE_BERRIES` | 2 | 필드 베리 상한 |
| `BERRY_SPAWN_MIN_SEC` | 15 | 생성 간격 하한 |
| `BERRY_SPAWN_MAX_SEC` | 25 | 생성 간격 상한 |
| `SERVER_TICK_RATE` | 20 | 초당 시뮬레이션 tick |
| `SNAPSHOT_RATE` | 10~20 | 실측 후 선택 |
| `CLIENT_RENDER_TARGET` | 60 | 렌더링 목표 FPS |

플레이어 이동속도, 충돌 반지름, 투사체 속도/사거리, 상호작용 반경은 회색 상자 맵에서 이동시간을 측정한 후 확정한다. 목표 이동시간은 다음과 같다.

| 구간 | 일반 상태 목표 시간 |
|---|---:|
| 도둑 기지 → 가까운 저장소 | 6~8초 |
| 도둑 기지 → 먼 저장소 | 10~12초 |
| 저장소 ↔ 저장소 | 7~10초 |
| 감옥 → 도둑 기지 | 7~9초 |
| 맵 가로 횡단 | 12~15초 |

---

## 6. 절차적 맵 생성

### 6.1 목표

절차적 생성을 장식 배치에만 제한하지 않고 매치의 경로, 시야 차단, 저장소 접근 방식, 베리 경쟁 지점을 변화시키는 핵심 시스템으로 사용한다. 단, 완전 무작위 지형보다 **제약 기반 생성 + 검증 + 재시도**를 사용해 플레이 가능성과 팀 공정성을 보장한다.

### 6.2 생성 책임과 동기화

- 서버가 Room 생성 시 `mapSeed`, `generatorVersion`, `balanceVersion`을 확정한다.
- `shared/map-generator`의 결정론적 생성기를 서버가 실행한다.
- 서버는 생성 결과를 검증하고 실패하면 파생 seed로 재시도한다.
- 서버가 승인한 `MapDefinition`이 최종 권위다.
- MVP에서는 서버가 클라이언트에 전체 `MapDefinition`과 해시를 전송한다. 클라이언트 단독 재생성 결과에 게임 진행을 의존하지 않는다.
- 클라이언트는 MapDefinition으로 Three.js 장면과 로컬 예측용 정적 충돌 공간을 구성한다.
- 생성기 변경 시 `generatorVersion`을 올려 리플레이/디버깅 가능성을 보존한다.

### 6.3 생성 파이프라인

```text
Seed 확정
  ↓
플레이 영역과 외곽 경계 생성
  ↓
핵심 앵커 배치
(도둑 기지 1, 감옥 1, 저장소 3, 팀 스폰)
  ↓
앵커 연결 그래프 생성
(주 경로 + 우회 경로 + 순환로)
  ↓
숲 장애물/공터/좁은 길 생성
  ↓
베리 후보, 감옥 탈출 포인트, 장식 소켓 생성
  ↓
충돌 데이터와 시야 차단 데이터 생성
  ↓
도달성·거리·병목·공정성 검증
  ↓
실패 시 재시도 / 성공 시 MapDefinition 확정
```

### 6.4 핵심 앵커 규칙

- 저장소는 정확히 3개이며 서로 겹치지 않는 세 구역에 분산한다.
- 도둑 기지는 저장소 세 곳 모두에 연결되되, 최소 두 개의 독립적인 탈출 방향을 가진다.
- 감옥은 단일 저장소나 도둑 기지 입구를 완전히 봉쇄하는 위치에 둘 수 없다.
- 경찰 스폰은 저장소 방어에 접근 가능하되 도둑 스폰을 즉시 체포 가능한 위치에 둘 수 없다.
- 도둑 기지, 감옥, 저장소 주변에는 상호작용 판정을 위한 평탄한 여유 공간을 둔다.
- 각 핵심 앵커 사이에는 최소 하나의 경로가 존재하고, 중요한 쌍에는 가능한 한 두 개 이상의 경로를 제공한다.

### 6.5 지형과 장애물 규칙

- MVP 지형은 단일 평면에서 판정한다. 시각적 높이는 게임플레이 높이와 분리한다.
- 나무, 바위, 울타리, 덤불 군집은 충돌/비충돌 프리팹으로 분류한다.
- 통과 경로의 폭은 플레이어 두 명이 교차할 수 있는 기본 폭을 우선하고, 일부 좁은 지점만 의도적으로 만든다.
- 막다른 길은 짧고 보상 지점이 있을 때만 허용한다.
- 한 장애물 군집이 저장소, 감옥, 기지의 모든 진입로를 차단할 수 없다.
- 맵 경계 밖으로 플레이어, 도토리, 투사체가 나갈 수 없어야 한다.

### 6.6 베리와 탈출 포인트

- `berrySpawnPoints`는 최소 8개, 권장 10~16개 생성한다.
- 베리 후보는 핵심 상호작용 구역 내부, 벽 내부, 플레이어 스폰 바로 위에 배치하지 않는다.
- 후보군은 맵 여러 구역에 분포해야 하며 한 팀 시작점에 과도하게 편중되지 않아야 한다.
- 감옥 `escapePoints`는 최소 4개 생성하고 서로 다른 방향에 분산한다.
- 탈출 지점은 충돌하지 않고, 감옥 상호작용 구역 밖이며, 즉시 맵 밖으로 나가지 않는 위치여야 한다.

### 6.7 생성 검증기 필수 조건

생성 결과는 다음 검사를 모두 통과해야 한다.

1. 모든 팀 스폰에서 저장소 3개, 감옥, 도둑 기지까지 경로가 존재한다.
2. 도토리를 든 플레이어의 충돌 반경으로도 저장소에서 도둑 기지까지 이동 가능하다.
3. 핵심 앵커의 상호작용 구역이 벽과 겹치지 않는다.
4. 저장소/기지/감옥 주변에 최소 요구 면적이 확보된다.
5. 경로 길이가 목표 이동시간 범위의 허용 오차 안에 든다.
6. 단 하나의 병목을 막는 것으로 세 저장소 전체가 봉쇄되지 않는다.
7. 베리 후보와 감옥 탈출 후보 수가 최소값 이상이다.
8. 플레이어와 도토리의 유효 드롭 위치 탐색이 모든 핵심 구역에서 성공한다.
9. 정적 충돌 도형 수와 렌더 오브젝트 수가 성능 예산 이하이다.

검증 실패 시 최대 재시도 횟수까지 새 파생 seed로 생성한다. 모두 실패하면 테스트된 안전 seed의 fallback 맵을 사용하고 경고 로그를 남긴다.

### 6.8 MapDefinition 예시

```ts
interface MapDefinition {
  id: string;
  seed: string;
  generatorVersion: number;
  layoutKind: 'LINE' | 'H' | 'RING' | 'GRAPH';
  width: number;
  height: number;
  bounds: Aabb;
  playableArea: Vec2[]; // seed별 불규칙 다각형 실제 플레이 경계
  playableHoles: Vec2[][]; // O형 등 내부 비이동 영역
  teamSpawns: Record<Team, Vec2[]>;
  thiefBase: ZoneDefinition;
  jail: JailDefinition;
  storages: StorageDefinition[]; // 정확히 3개
  staticColliders: ColliderDefinition[];
  occluders: OccluderDefinition[];
  trees: TreeDefinition[]; // 원형 충돌 줄기 + 비충돌 수관
  paths: PathMetadata[];
  berrySpawnPoints: Vec2[];
  decorativeSockets: DecorationSocket[];
  hash: string;
}
```

### 6.9 맵 생성 테스트

- 고정 seed 회귀 테스트: 주요 seed의 MapDefinition 해시가 의도치 않게 변하지 않아야 한다.
- 속성 기반 테스트: 최소 1,000개 seed를 생성해 필수 검증 조건 위반이 없어야 한다.
- 성능 테스트: 개발 환경 기준 한 맵 생성+검증의 p95 시간을 기록한다.
- 시각 디버그: 앵커, 경로 그래프, 충돌체, 베리 후보, 탈출 포인트, 거리 heatmap을 오버레이할 수 있어야 한다.
- 실패 seed를 로그와 테스트 fixture로 보존해 재현 가능하게 한다.

---

## 7. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 언어 | TypeScript strict mode | client/server/shared 공통 |
| 클라이언트 빌드 | Vite | 개발 서버 및 프로덕션 번들 |
| 렌더링 | Three.js | 직교 카메라, WebGL 기반 |
| UI | HTML + CSS | React는 MVP 비필수 |
| 서버 런타임 | Node.js + TypeScript | 단일 프로세스 다중 Room |
| 실시간 통신 | WebSocket, 배포 시 WSS | 서버 구현은 `ws` 계열 사용 가능 |
| 테스트 | Vitest 계열 | 순수 로직/통합 테스트 |
| E2E | Playwright | 다중 브라우저 흐름 |
| 패키지 구성 | npm/pnpm workspace 모노레포 | 하나를 선택해 고정 |
| 배포 | 정적 호스팅 + Node 컨테이너/VM | Docker 사용 가능 |

MVP 메시지 직렬화는 디버깅이 쉬운 JSON을 허용한다. 대역폭 측정 후 MessagePack/바이너리 프로토콜과 delta snapshot을 확장할 수 있도록 프로토콜 계층을 게임 로직과 분리한다.

---

## 8. 시스템 아키텍처

### 8.1 전체 구조

```text
┌──────────────────── Browser ────────────────────┐
│ HTML/CSS UI                                     │
│ GameClient                                      │
│ ├─ InputSampler                                 │
│ ├─ NetworkClient                                │
│ ├─ LocalPrediction + Reconciliation             │
│ ├─ SnapshotBuffer + RemoteInterpolation         │
│ ├─ ClientGameState                              │
│ └─ Presentation                                 │
│    ├─ ThreeRenderer / OrthographicCamera        │
│    ├─ Animation / VFX                           │
│    ├─ Audio                                     │
│    └─ HUD                                       │
└──────────────────────┬──────────────────────────┘
                       │ WSS
┌──────────────────────▼──────────────────────────┐
│ Node.js Authoritative Game Server               │
│ ConnectionGateway                               │
│ └─ RoomManager                                  │
│    ├─ MatchRoom A                               │
│    ├─ MatchRoom B                               │
│    └─ MatchRoom C                               │
│                                                 │
│ MatchRoom                                       │
│ ├─ FixedTickLoop / InputQueue                   │
│ ├─ WorldState                                   │
│ ├─ Movement / Collision                         │
│ ├─ Interaction / Acorn                          │
│ ├─ Arrest / Jail / Rescue                       │
│ ├─ Berry / Thunder                              │
│ ├─ Objective / WinCondition                     │
│ └─ Snapshot / Event Broadcast                   │
└─────────────────────────────────────────────────┘
```

### 8.2 서버 tick

- 고정 시뮬레이션 20Hz(50ms/tick)로 시작한다.
- wall-clock 지연을 그대로 여러 tick 크기로 적용하지 않고 accumulator 기반 fixed step을 사용한다.
- 한 프레임에 처리할 catch-up tick 상한을 두어 spiral of death를 방지한다.
- Room별 논리 tick을 가지며 입력은 `sequence`, `clientTick`, 수신 시각과 함께 큐에 저장한다.
- 시스템 적용 순서를 고정하고 테스트한다.

권장 tick 순서:

```text
1. 입력 큐 반영 및 유효성 검사
2. 상태 타이머 갱신(STUN/면역 등)
3. 이동 의도 계산
4. 정적/동적 충돌 해결
5. 상호작용 진행(체포/구출/도토리)
6. 투사체 이동 및 충돌
7. 베리 생성/획득
8. 도토리 확보와 목표 상태 반영
9. 승패 검사
10. 이벤트 확정 및 snapshot 생성
```

### 8.3 클라이언트 렌더 루프

- `requestAnimationFrame`으로 렌더링하며 서버 tick과 독립적이다.
- 로컬 플레이어는 입력 즉시 예측한다.
- 원격 플레이어와 원격 동적 엔티티는 snapshot buffer에서 과거 시점을 보간한다.
- 네트워크 상태 적용과 Three.js 객체 생성/삭제/갱신은 presentation adapter를 통해 수행한다.
- 탭 비활성화, 큰 frame delta 이후에는 시뮬레이션을 무제한 따라잡지 않고 최신 서버 상태로 안전하게 복구한다.

---

## 9. 네트워크 모델

### 9.1 로컬 플레이어: prediction + reconciliation

1. 클라이언트가 고유 `sequence`를 붙인 입력을 서버에 전송한다.
2. 같은 입력을 공유 이동/충돌 함수에 즉시 적용하여 로컬 위치를 예측한다.
3. 서버는 입력을 검증하고 권위 위치를 계산한다.
4. snapshot에 `ackInputSequence`와 권위 위치를 포함한다.
5. 클라이언트는 ack된 입력을 버리고 권위 상태로 되감은 뒤 미확인 입력을 순서대로 재적용한다.
6. 오차가 작으면 짧게 시각 보정하고, 임계값을 넘으면 안전하게 snap한다.

클라이언트 예측은 이동과 단순 충돌에 우선 적용한다. 체포, 구출, 도토리 확보, 람쥐썬더 명중은 서버 확정 전에 UI/VFX로 완료 처리하지 않는다.

### 9.2 원격 엔티티: snapshot interpolation

- snapshot을 서버 tick/시간 순서로 buffer에 저장한다.
- 초기 interpolation delay는 약 100ms를 기준으로 측정한다.
- 렌더 시점 전후 두 snapshot 사이의 위치와 방향을 보간한다.
- 짧은 snapshot 누락은 제한된 외삽으로 감추고, 상한을 넘으면 마지막 상태를 유지한다.
- 순간이동(감옥 이동, 구출 탈출, 스폰)은 보간하지 않고 명시적 이벤트/플래그로 snap한다.

### 9.3 메시지 공통 envelope

```ts
interface MessageEnvelope<TType extends string, TPayload> {
  type: TType;
  protocolVersion: number;
  roomId?: string;
  requestId?: string;
  payload: TPayload;
}
```

서버는 크기 제한, 메시지 빈도 제한, 타입/범위 검사를 통과하지 못한 메시지를 거부한다. 프로토콜 타입만 믿지 말고 런타임 검증을 수행한다.

### 9.4 클라이언트 → 서버 패킷

#### `C2S_JOIN_ROOM`

```ts
interface JoinRoomRequest {
  joinMode: 'QUICK_MATCH' | 'CREATE_ROOM' | 'JOIN_ROOM';
  roomCode?: string;
  displayName: string;
  clientVersion: string;
}
```

#### `C2S_CLIENT_READY`

```ts
interface ClientReady {
  mapHash: string;
  assetsReady: boolean;
}
```

#### `C2S_INPUT`

```ts
interface InputCommand {
  sequence: number;
  clientTick: number;
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimX: number;  // 정규화 방향
  aimY: number;
  buttons: number; // bit flags: INTERACT, ACORN, FIRE
}
```

버튼의 press/hold/release 의미를 프로토콜에 고정한다. 체포/구출은 hold 상태가 매 tick 유지되어야 하며, F/발사는 rising edge로 한 번만 처리한다.

#### `C2S_PING`

RTT와 시계 오차 추정용. 클라이언트 시각을 포함하고 서버가 그대로 반환한다.

#### `C2S_REQUEST_RESYNC`

snapshot 누락 또는 map/state hash 불일치 시 전체 상태 재전송을 요청한다.

### 9.5 서버 → 클라이언트 패킷

#### `S2C_JOINED_ROOM`

플레이어 ID, 팀, Room 상태, protocol version을 전달한다.

#### `S2C_MAP_DEFINITION`

`mapSeed`, `generatorVersion`, 전체 MapDefinition과 `mapHash`를 전달한다.

#### `S2C_MATCH_PHASE`

카운트다운, 시작, 종료와 승리팀/사유를 전달한다.

#### `S2C_WORLD_SNAPSHOT`

```ts
interface WorldSnapshot {
  serverTick: number;
  serverTimeMs: number;
  ackInputSequence: number;
  phase: MatchPhase;
  remainingMs: number;
  players: PlayerSnapshot[];
  acorns: AcornSnapshot[];
  berries: BerrySnapshot[];
  projectiles: ProjectileSnapshot[];
  interactions: InteractionSnapshot[];
  thiefSecuredCount: number;
  stateHash?: string;
}
```

MVP는 전체 snapshot을 허용하되, 프로토콜 adapter를 통해 이후 delta snapshot으로 교체 가능하게 한다.

#### `S2C_GAME_EVENTS`

체포 완료, 수감, 구출, 도토리 획득/낙하/반환/확보, 베리 획득, 람쥐썬더 발사/명중, 승패 등 일회성 연출용 이벤트를 `eventId`와 함께 전달한다. 클라이언트는 중복 eventId를 재생하지 않는다.

#### `S2C_FULL_STATE`

초기 접속과 resync/reconnect를 위한 전체 권위 상태다.

#### `S2C_ERROR`

사용자 표시 가능 코드와 개발용 세부 코드를 분리한다.

### 9.6 접속 종료와 재접속

MVP 필수 최소 정책:

- 연결이 끊긴 플레이어의 서버 엔티티는 즉시 제거하지 않고 짧은 grace period 동안 입력 없는 정지 상태로 유지한다.
- 동일한 재접속 토큰으로 grace period 안에 돌아오면 기존 플레이어에 다시 연결하고 full state를 전송한다.
- grace period 이후 정책은 개발 단계에서 봇 대체 또는 슬롯 이탈 중 하나로 고정한다.
- 연결이 끊긴 플레이어가 들던 도토리 처리 정책은 악용을 막기 위해 서버가 결정한다. 권장 기본값은 grace period 동안 유지하고 만료 시 유효 위치에 낙하하는 것이다.

---

## 10. 상태 모델

### 10.1 MatchRoom

```ts
interface MatchRoomState {
  id: string;
  phase: MatchPhase;
  serverTick: number;
  startedAtMs: number | null;
  remainingMs: number;
  map: MapDefinition;
  players: Map<PlayerId, PlayerState>;
  acorns: Map<AcornId, AcornState>;
  berries: Map<BerryId, BerryState>;
  projectiles: Map<ProjectileId, ThunderProjectileState>;
  interactions: Map<PlayerId, InteractionState>;
  nextBerrySpawnAtMs: number;
  allThievesJailedSinceMs: number | null;
  winner: Team | null;
  endReason: MatchEndReason | null;
}
```

### 10.2 PlayerState

```ts
type PlayerMode = 'NORMAL' | 'STUNNED' | 'JAILED';

interface PlayerState {
  id: PlayerId;
  connectionId: string | null;
  team: 'POLICE' | 'THIEF';
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  mode: PlayerMode;
  heldAcornId: AcornId | null;
  hasThunder: boolean;
  stunUntilMs: number;
  arrestImmuneUntilMs: number;
  jailedAtMs: number | null;
  lastProcessedInputSequence: number;
  lastValidInput: InputCommand;
}
```

`ARRESTING`과 `RESCUING`은 이동 불가 상태가 아니라 진행 중 상호작용이므로 별도의 `InteractionState`로 표현한다. 이를 통해 `NORMAL + carrying + RESCUING` 같은 조합을 명확히 다룬다.

### 10.3 InteractionState

```ts
type InteractionState =
  | { kind: 'NONE' }
  | {
      kind: 'ARREST';
      actorId: PlayerId;
      targetId: PlayerId;
      startedAtTick: number;
      progressMs: number;
    }
  | {
      kind: 'RESCUE';
      actorId: PlayerId;
      targetId: PlayerId;
      startedAtTick: number;
      progressMs: number;
    };
```

### 10.4 AcornState

```ts
type AcornLocation =
  | { kind: 'POLICE_STORAGE'; storageId: StorageId; slot: number }
  | { kind: 'GROUND'; position: Vec2 }
  | { kind: 'CARRIED'; carrierId: PlayerId }
  | { kind: 'SECURED'; slot: number };

interface AcornState {
  id: AcornId;
  location: AcornLocation;
}
```

불변 조건:

- 9개 Acorn ID는 항상 존재한다.
- 한 도토리는 정확히 한 location만 가진다.
- 플레이어의 `heldAcornId`와 `CARRIED.carrierId`는 양방향으로 일치한다.
- 저장소의 도토리 수 + 필드 + 운반 + 확보 수의 합은 항상 9다.

### 10.5 베리와 투사체

```ts
interface BerryState {
  id: BerryId;
  position: Vec2;
  spawnedAtTick: number;
}

interface ThunderProjectileState {
  id: ProjectileId;
  ownerId: PlayerId;
  team: Team;
  position: Vec2;
  direction: Vec2;
  remainingRange: number;
  spawnedAtTick: number;
}
```

---

## 11. 충돌과 공간 질의

- 게임플레이 계산은 X/Y 2D 좌표계를 사용하고 Three.js 표현에서 X/Z 평면으로 변환한다.
- 정적 충돌: circle-vs-AABB 및 필요 시 circle-vs-convex polygon.
- 플레이어 간 충돌은 초기 플레이테스트에서 켜되, 끼임/밀기 악용이 심하면 소프트 분리 또는 팀원 통과를 실험한다.
- 투사체: swept segment/raycast 방식으로 빠른 물체의 터널링을 방지한다.
- 상호작용: 원형 범위 + 필요 시 line-of-sight 검사.
- 도토리 낙하: 목표점에서 나선형/격자형으로 가장 가까운 유효 위치를 탐색한다.
- 엔티티 수가 적어도 공간 질의 인터페이스를 두고, 필요 시 uniform grid spatial hash로 교체한다.

서버와 로컬 예측이 같은 정적 충돌 함수와 맵 충돌 데이터를 사용하되, 최종 위치는 항상 서버 상태를 따른다.

---

## 12. 클라이언트 구성

### 12.1 Three.js 장면

```text
THREE.Scene
├─ WorldRoot
│  ├─ GroundLayer
│  ├─ StaticObstacleLayer
│  ├─ ObjectiveLayer
│  ├─ CharacterLayer
│  ├─ ItemLayer
│  └─ EffectLayer
├─ DebugLayer
└─ OrthographicCamera
```

- 카메라는 로컬 플레이어를 추적하고 맵 경계를 벗어나지 않는다.
- 월드 정렬 순서는 명시적 레이어 또는 높이값으로 관리한다.
- 같은 종류의 나무/바위가 많으면 instancing을 검토한다.
- HUD, 로비, 결과, 상호작용 안내는 HTML/CSS로 구현한다.
- 에셋 로더는 진행률과 실패 상태를 노출한다.

### 12.2 HUD 필수 정보

- 남은 시간
- 도둑 확보량 `n/9`
- 저장소 A/B/C의 남은 도토리 수
- 팀원별 수감/기절 상태
- 로컬 도토리 보유 여부
- 로컬 람쥐썬더 보유 여부
- 체포/구출 진행 바
- 문맥 상호작용 안내
- 연결 상태/재접속 안내

### 12.3 오디오/연출 이벤트

서버 이벤트를 기준으로 최소한 다음 피드백을 제공한다.

- 도토리 들기, 놓기, 반환, 확보
- 체포 시작/취소/완료
- 감옥 이동, 구출 진행/완료
- 베리 획득
- 람쥐썬더 발사, 벽 충돌, 명중, 기절 종료
- 마지막 30초 경고
- 승리/패배

연출은 권위 상태를 늦추거나 변경하지 않는다.

---

## 13. 서버 구성

### 13.1 RoomManager

- Room 생성, 조회, 입장, 퇴장, 정리
- 팀 정원 검증
- Room 코드/매치메이킹의 최소 구현
- Room 장애가 다른 Room으로 전파되지 않도록 예외 경계 설정
- 빈 Room과 종료된 Room 정리

### 13.2 MatchRoom 시스템

- `FixedTickLoop`: 고정 tick 실행과 지연 계측
- `InputSystem`: 입력 큐, sequence, rate/범위 검증
- `MovementSystem`: 속도, 감속, 상태 제한, 충돌
- `AcornSystem`: 들기, 놓기, 반환, 확보와 불변 조건
- `ArrestSystem`: 대상 탐색, 홀드 진행, 취소, 수감
- `RescueSystem`: 대상 선택, 홀드 진행, 탈출 위치, 면역
- `BerrySystem`: seed 기반 생성 시각/지점 선택, 획득
- `ThunderSystem`: 발사, 이동, 충돌, 기절
- `ObjectiveSystem`: 타이머와 승패
- `SnapshotSystem`: 클라이언트별 ack와 snapshot/event 전송

시스템 간 결합은 공유 상태를 직접 임의 변경하는 방식보다 명시적 명령/함수와 도메인 이벤트를 사용한다.

### 13.3 관측 가능성

최소 로그/지표:

- Room 생성/종료, seed, generatorVersion, mapHash
- 플레이어 입장/이탈/재접속
- 평균/p95 tick 실행 시간, catch-up 발생 횟수
- 송수신 메시지 수/바이트와 invalid message 수
- 평균 RTT와 reconciliation 오차
- 맵 생성 재시도/실패 seed
- 매치 종료 사유, 경기 시간, 확보 도토리 수, 체포/구출 횟수

로그는 Room ID, player ID, server tick을 포함하되 재현에 불필요한 개인정보는 저장하지 않는다.

---

## 14. 권장 모노레포 구조

```text
project/
├─ package.json
├─ tsconfig.base.json
├─ client/
│  ├─ index.html
│  ├─ src/
│  │  ├─ app/
│  │  ├─ input/
│  │  ├─ network/
│  │  ├─ prediction/
│  │  ├─ state/
│  │  ├─ rendering/
│  │  │  └─ three/
│  │  ├─ audio/
│  │  ├─ ui/
│  │  └─ debug/
│  ├─ public/assets/
│  ├─ tests/
│  └─ vite.config.ts
├─ server/
│  ├─ src/
│  │  ├─ bootstrap/
│  │  ├─ gateway/
│  │  ├─ room/
│  │  ├─ simulation/
│  │  │  ├─ movement/
│  │  │  ├─ collision/
│  │  │  ├─ acorn/
│  │  │  ├─ arrest/
│  │  │  ├─ rescue/
│  │  │  ├─ berry/
│  │  │  ├─ thunder/
│  │  │  └─ objective/
│  │  ├─ snapshot/
│  │  ├─ security/
│  │  └─ observability/
│  └─ tests/
├─ shared/
│  ├─ src/
│  │  ├─ protocol/
│  │  ├─ domain/
│  │  ├─ math/
│  │  ├─ collision/
│  │  ├─ map-generator/
│  │  │  ├─ generation/
│  │  │  ├─ validation/
│  │  │  └─ fixtures/
│  │  ├─ config/
│  │  └─ ids/
│  └─ tests/
├─ tools/
│  ├─ load-bot/
│  ├─ map-preview/
│  └─ protocol-inspector/
└─ docs/
   ├─ PROJECT_SPEC.md
   ├─ PROTOCOL.md
   └─ BALANCE_CHANGELOG.md
```

구현 초기에 디렉터리를 모두 빈 채로 만들 필요는 없다. 기능이 생길 때 경계에 맞춰 추가하되, client/server/shared 의존 방향은 유지한다.

---

## 15. 테스트 전략과 완료 조건

### 15.1 단위 테스트

- 벡터/충돌/유효 드롭 위치
- 도토리 상태 전이와 9개 보존 불변 조건
- 운반 감속
- 체포/구출 진행 및 모든 취소 조건
- 기절과 체포 면역 시간
- 람쥐썬더 팀/벽/플레이어 충돌
- 승리조건과 동일 tick 우선순위
- 입력 sequence와 ack 처리
- map generator 결정론 및 validator

### 15.2 서버 통합 테스트

- 두 클라이언트의 이동 상태 동기화
- 8명 Room 입장/준비/시작/종료
- 도토리 9개를 훔쳐 도둑 승리
- 도둑 4명 수감 후 경찰 승리
- 타임아웃 경찰 승리
- 체포 중 기절로 취소
- 구출 중 범위 이탈/기절/체포로 취소
- 끊김/재접속/full resync
- invalid input, 과속, 중복 상호작용 거부

### 15.3 네트워크 환경 테스트

개발 도구로 최소 다음 조건을 에뮬레이션한다.

- RTT 0/50/100/200ms
- jitter 0/20/50ms
- packet loss에 준하는 snapshot 누락 0/1/5%

확인 항목:

- 로컬 조작이 즉시 반응하는가
- reconciliation이 지속 진동하지 않는가
- 원격 이동이 순간이동 없이 보이는가
- 감옥 이동/구출 등 실제 순간이동은 즉시 반영되는가
- 오래된/중복 입력과 이벤트가 재적용되지 않는가

### 15.4 성능 목표

- 클라이언트: 권장 데스크톱 브라우저에서 1080p, 8명, 대표 절차 맵 기준 60 FPS 목표
- 서버: 한 Room tick p95가 50ms budget을 크게 밑돌아야 한다.
- 초기 부하 목표: 단일 프로세스에서 10 Room/80명 봇 테스트. 절대 보장치가 아니라 병목 확인 기준이다.
- snapshot 크기와 초당 송수신량을 기록하고 최적화는 측정 후 수행한다.

### 15.5 MVP 수용 기준

다음 조건을 모두 만족하면 MVP 기능 완료로 본다.

1. 8개 브라우저/봇이 한 Room에서 4 vs 4로 입장한다.
2. 서버가 seed 기반 맵을 생성·검증하고 모든 클라이언트가 같은 맵을 표시한다.
3. 세 저장소에 각 3개의 도토리가 있고 모든 상태 전이/배치 규칙이 지켜진다.
4. 운반 중 속도가 서버와 클라이언트 예측 모두에서 85%로 적용된다.
5. 경찰 체포, 감옥, 3초 1인 구출, 탈출 포인트, 1초 체포 면역이 동작한다.
6. 베리 생성/획득과 양 팀의 람쥐썬더 발사/기절이 동작한다.
7. 세 가지 경찰 승리 경로 중 전원 수감과 시간 종료, 도둑의 9개 확보 승리가 정확히 판정된다.
8. 로컬 prediction/reconciliation과 원격 interpolation이 지연 환경에서 동작한다.
9. 매치 시작부터 결과 화면까지 서버 오류 없이 완료된다.
10. 핵심 규칙 테스트와 맵 생성 속성 테스트가 통과한다.

---

## 16. 구현 우선순위

각 단계는 가능한 한 수직 절편으로 완성하고, 다음 단계로 가기 전에 자동 테스트 또는 재현 가능한 수동 검증을 남긴다.

### 16.0 구현 현황 (2026-08-20)

| 단계 | 상태 | 현재 증거와 남은 확인 |
|---|---|---|
| P0 | 구현 완료 | npm workspace, strict TypeScript, lint/test/build, WebSocket gateway와 Three.js 장면이 동작한다. |
| P1 | 구현 완료·휴먼 재검증 필요 | 20Hz 권위 이동과 snapshot을 유지하면서 수신시각 기반 서버시계, 100ms buffer, 위치·방향 frame 보간과 100ms 제한 외삽을 적용했다. 화면 기준 WASD/커서 조준 회귀 테스트도 갖췄으며 실제 지연 환경의 8인 체감 검증은 남아 있다. |
| P2 | 구현 완료·topology 확장 중 | generatorVersion 4가 `LINE`, `H`, `RING`, `GRAPH` topology, 내부 hole, 나무 엄폐물, 원형 랜덤 spawn 영역을 생성한다. 서버/예측/렌더/validator와 1,000 seed 속성 테스트가 같은 경계를 사용하며 병목·거리 공정성 점수는 후속 확장이다. |
| P3 | 구현 완료 | 8인 Room, 9개 도토리 상태 전이, 운반 감속과 도둑 승리를 서버 통합 테스트로 검증한다. |
| P4 | 구현 완료 | 체포·취소·수감·구출·면역 및 경찰 승리 조건을 서버 통합 테스트로 검증한다. |
| P5 | 구현 완료·휴먼 재검증 필요 | 베리, 최신 커서 조준 발사, 벽/상대 충돌과 기절을 자동 검증한다. 실제 포인터 조작감 확인은 남아 있다. |
| P6 | 진행 중 | HUD, 기본 오디오, 재접속/full resync, Room 장애 격리, 입력 edge 보존, abandoned Room 회수, 부하 도구와 브라우저 점검이 있다. 연출 완성도, 실제 8인 플레이, WSS 배포 리허설은 후속 작업이다. |

### P0. 기반과 공유 규칙

1. workspace, TypeScript strict, lint/test/build 구성
2. 공유 ID/Vec2/충돌/프로토콜/밸런스 설정
3. 서버 WebSocket gateway와 단일 Room lifecycle
4. 클라이언트 연결 상태와 빈 Three.js 장면

### P1. 회색 상자 네트워크 이동

1. 고정 20Hz 서버 tick
2. 단일 플레이어 authoritative 이동/정적 충돌
3. 2개 클라이언트 snapshot 동기화
4. 로컬 prediction/reconciliation
5. 원격 snapshot interpolation

완료 표식: 두 브라우저가 지연 환경에서도 서로 부드럽게 움직인다.

### P2. 절차적 맵 수직 절편

1. seed PRNG와 generatorVersion
2. 앵커/연결 그래프/장애물 생성
3. validator와 fallback seed
4. MapDefinition 전송/해시 검증
5. Three.js 맵 렌더와 collision debug overlay
6. 대량 seed 속성 테스트

완료 표식: 여러 seed에서 플레이 가능한 맵이 생성되고 클라이언트와 서버 충돌이 일치한다.

### P3. 8인 Room과 도토리 핵심 루프

1. 팀 배정, 준비, 카운트다운
2. 세 저장소 × 3개 도토리 생성
3. F 들기/놓기, 일반 필드/저장소/도둑 기지 규칙
4. 운반 감속, 체포 시 낙하
5. 확보 수와 도둑 승리

완료 표식: 8명이 도토리를 훔치고 회수하며 9개 확보로 매치를 끝낸다.

### P4. 체포·감옥·구출

1. E 홀드 체포와 취소
2. 수감, 감옥 슬롯, 도토리 낙하
3. 3초 1인 구출과 취소
4. 탈출 포인트와 1초 체포 면역
5. 전원 수감/시간 종료 경찰 승리

### P5. 베리·람쥐썬더

1. 절차 맵의 베리 후보와 서버 생성 스케줄
2. 획득/개인 1개 보유
3. 조준/발사/벽 충돌/상대 명중
4. 1.5초 기절과 진행 행동 취소

### P6. 완성도와 안정화

1. HUD, 튜토리얼 안내, 결과 화면
2. 애니메이션, VFX, 오디오
3. 재접속/full resync
4. 봇 부하 테스트와 성능 계측
5. 브라우저 호환성, 배포 WSS, 오류 화면
6. 밸런스 플레이테스트와 수치 조정

### 16.1 향후 구현 계획

1. 현재 개발 환경에서 네 방향 이동, 정지/이동 중 커서 추적, 같은 방향의 람쥐썬더 발사를 휴먼 플레이로 재검증한다.
2. 8명의 실제 브라우저 세션에서 RTT/jitter/snapshot 누락 조건을 적용해 조작감과 reconciliation을 측정한다.
3. 기본 도형 캐릭터와 단순 오디오를 애니메이션, 조준/발사 VFX, 명중·기절 피드백으로 보강한다.
4. 배포 후보 revision에서 WSS/reverse proxy, 재접속/full resync, Room 장애 격리와 10 Room/80봇 부하를 다시 검증한다.
5. Chromium·Firefox 로컬 결과와 동일 revision의 WebKit GitHub Actions 결과를 묶어 휴먼 플레이테스트 기록으로 남긴다.

### 16.2 포스트 MVP 핵심 기능 현황 (2026-08-20)

| 항목 | 상태 | 구현 증거와 다음 루프 |
|---|---|---|
| 로비 화면 | 2차 완료 | 빠른 매칭은 경찰/도둑/랜덤, 친구 Room은 경찰/도둑 선택을 제공한다. 대기·카운트다운 중 메인 복귀와 빈 Room 즉시 정리를 지원하며 방 코드 복사와 초 단위 카운트다운 표시를 후속 폴리싱한다. |
| 매칭·Room 생성/참가 | 2차 완료 | 공개 빠른 매칭과 코드 전용 비공개 Room을 분리하고 명시 역할의 4자리 예약 상한을 강제한다. 실제 8브라우저 생성→참가→이탈→시작 흐름을 휴먼 검증한다. |
| 역할 선택·팀 명단 | 2차 완료 | 입장 선택은 예약으로만 저장하고 8명 준비 직전에 랜덤 참가자를 남은 자리에 배정해 4 대 4를 확정한다. 확정 전에는 참가자 명단, 확정 후에는 자기 팀만 표시한다. |
| 복잡한 절차 맵 | 2차 확장 완료 | generatorVersion 4의 일자/H/O형·graph topology, 내부 hole, 원형 나무 줄기와 비충돌 수관, 랜덤 spawn 영역을 서버/예측/렌더/validator가 공유한다. 다음은 병목·공정성 점수를 정량 검증하는 루프다. |
| 검토·폴리싱 | 반복 중 | 52개 이상 단위·통합 테스트, 1,000 seed, lint/build, Chromium·Firefox E2E를 기준선으로 사용한다. 실제 8인 지연 세션, WSS, 연출과 topology 품질은 계속 반복한다. |

---

## 17. MVP 범위

### 17.1 필수

- 데스크톱 브라우저 4 vs 4 Room
- Three.js 직교 탑뷰 렌더링
- 서버 권위 이동과 단순 2D 충돌
- prediction/reconciliation/interpolation
- seed 기반 제약형 절차 맵 생성과 검증
- 저장소 3개 × 도토리 3개
- 모든 도토리 들기/놓기/반환/확보 규칙
- 운반 중 15% 감속
- 0.6초 체포, 감옥, 3초 구출, 1초 체포 면역
- 베리, 람쥐썬더, 1.5초 기절
- 승리 조건과 매치 타이머
- 기본 로비/준비/결과/HUD
- WSS 배포와 최소 재접속 처리
- 핵심 자동 테스트와 맵 seed 재현 도구

### 17.2 있으면 좋은 기능

- 간단한 봇으로 빈 슬롯 채우기
- 맵 seed 공유/재경기
- 관전자 모드
- 효과음/배경음 볼륨 설정
- 게임패드 또는 키 재지정
- 간단한 닉네임 기억

---

## 18. 비목표

공모전 MVP에서는 다음을 구현하지 않는다.

- 계정/소셜 로그인, 복잡한 인증
- PostgreSQL 기반 영구 진행도, 랭킹, 상점, 인벤토리
- Redis, 마이크로서비스, Kubernetes, Agones
- WebRTC, WebTransport, UDP 유사 전송 계층
- 복잡한 lag compensation/서버 rewind
- 완전한 리플레이 시스템
- 캐릭터 클래스, 개별 스킬 트리, 장비, 스킨 시스템
- 여러 게임 모드/여러 수작업 맵
- 범용 물리 엔진과 복잡한 파괴 물리
- 모바일 터치 UI 및 모바일 성능 보장
- 음성 채팅
- 치트 방지 커널/클라이언트 신뢰 모델
- 클라이언트가 승패나 충돌 결과를 결정하는 구조

비목표 기능을 추가하려면 MVP 일정과 필수 수용 기준에 미치는 영향을 먼저 기록해야 한다.

---

## 19. 확장 포인트

### 19.1 콘텐츠

- 생성 biome/타일셋 교체(설원, 단풍숲, 밤의 숲)
- 장애물/공터/비밀길 생성 규칙 추가
- 새 중립 아이템과 일회성 도구
- 역할별 외형과 애니메이션
- 역할 교대 2라운드 경쟁 규칙

### 19.2 게임플레이

- 저장소별 특성, 이동형 목표, 일시적 문/다리
- 도토리 일부 확보 점수제와 동점 규칙
- 구출 대상 선택 UI
- 제한적인 캐릭터 능력. 핵심 루프가 검증된 뒤에만 추가한다.

### 19.3 네트워크/서버

- JSON → MessagePack/바이너리
- full snapshot → delta snapshot
- spatial interest management. 8인 단일 소형 맵에서는 우선 불필요하다.
- Room directory + Redis를 통한 여러 서버 프로세스 배치
- 매치메이커와 파티 서비스
- 영속 계정/전적 PostgreSQL

### 19.4 맵 생성

- generatorVersion별 규칙 집합
- 맵 품질 점수와 자동 seed 선별
- 플레이 로그 기반 병목/승률 heatmap 분석
- 서버가 선생성한 seed pool
- 공모전 심사용 고정 seed 모드와 일반 플레이용 랜덤 seed 모드

---

## 20. 구현 에이전트 작업 규칙

1. 기능 구현 전에 관련 상태의 소유자(client/server/shared)를 명확히 한다.
2. 서버 권위 규칙을 우회하는 클라이언트 판정을 추가하지 않는다.
3. Three.js 객체를 도메인 상태로 사용하지 않는다.
4. 새 밸런스 수치는 공유 설정과 이 문서의 표에 반영한다.
5. 새 패킷은 protocol version, 런타임 검증, 중복/순서 처리 방식을 함께 정의한다.
6. 새 절차 생성 규칙은 결정론, validator, 실패 fallback, seed 회귀 테스트를 함께 추가한다.
7. 도토리 수 보존, 소유권 단일성, 팀 정원 같은 불변 조건을 테스트한다.
8. 기능 완료 시 정상 흐름뿐 아니라 연결 종료, 중복 입력, 거리 이탈, 기절, 동시 완료 같은 실패/경계 조건을 검증한다.
9. 최적화는 tick 시간, FPS, snapshot 크기 등 측정값을 근거로 수행한다.
10. MVP 비목표를 무단으로 추가하지 않는다. 확장이 필요하면 별도 제안으로 분리한다.

---

## 21. 미확정 항목과 플레이테스트 결정사항

다음 항목은 아키텍처를 막지 않으므로 데이터화한 뒤 회색 상자 플레이테스트로 결정한다.

- 정확한 월드 크기와 기본 이동속도
- 플레이어 반지름과 체포/도토리/베리 상호작용 반경
- 람쥐썬더 투사체 속도와 최대 사거리
- snapshot rate 10Hz와 20Hz 중 기본값
- 원격 interpolation delay
- 플레이어 간 물리 충돌의 강도 또는 팀원 통과 여부
- 감옥/저장소/기지의 최종 절차 배치 제약 가중치
- 연결 종료 grace period와 이후 봇 대체 여부
- 8명 미만 시작을 공모전 시연 모드에서 허용할지 여부

이 값들은 `BALANCE_CHANGELOG.md`에 변경 이유와 플레이테스트 결과를 기록한다.

---

## 22. 최종 성공 기준

이 프로젝트의 성공은 기술 요소의 개수가 아니라 다음 경험으로 판단한다.

> 매치마다 길과 장애물 배치가 달라져 팀이 즉석에서 동선을 판단하고, 도둑은 도토리를 훔쳐 느려진 채 도망가며, 경찰은 추격과 저장소·감옥 방어 사이에서 선택한다. 붙잡힌 도둑 때문에 팀의 운반력이 줄고, 동료가 위험을 감수해 3초 구출을 시도하며, 베리 한 개의 람쥐썬더가 추격이나 구출의 흐름을 뒤집는다. 이 모든 결과는 서버가 일관되게 판정하고 브라우저에서는 즉각적이고 부드럽게 보인다.

위 경험이 8인 한 경기에서 안정적으로 반복되면 공모전 MVP의 목적을 달성한 것으로 본다.
