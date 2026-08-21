# Protocol v6

All messages use JSON and `{ type, protocolVersion, roomId?, requestId?, payload }`. The server rejects payloads over 8 KiB, unknown versions/types, out-of-range inputs, duplicate/old input sequences, and more than 60 inputs per second.

Client messages: `C2S_JOIN_ROOM`, `C2S_LEAVE_ROOM`, `C2S_CLIENT_READY`, `C2S_SET_ROLE_PREFERENCE`, `C2S_SET_READY`, `C2S_START_MATCH`, `C2S_TRANSFER_HOST`, `C2S_INPUT`, `C2S_PING`, `C2S_REQUEST_RESYNC`.

`C2S_JOIN_ROOM`은 `joinMode`로 `QUICK_MATCH`, `CREATE_ROOM`, `JOIN_ROOM`을 구분한다. `JOIN_ROOM`은 영문·숫자 4~8자리 `roomCode`가 필수다. 빠른 매칭은 입장 전에 `POLICE`, `THIEF`, `RANDOM` 중 `rolePreference`를 필수로 보내며, 8명의 asset 준비가 끝나면 자동으로 역할을 확정하고 시작한다. 친구 Room은 역할 없이 먼저 입장한 뒤 `C2S_SET_ROLE_PREFERENCE(POLICE|THIEF)`와 `C2S_SET_READY`를 순서대로 보낸다. `C2S_CLIENT_READY`는 맵/asset 준비만 뜻하며 친구 Room의 사용자 준비를 대신하지 않는다. 역할 선택 자체는 4명을 초과할 수 있지만, 이미 준비한 같은 역할이 4명이면 다섯 번째 `C2S_SET_READY(true)`는 `ROLE_FULL`로 거부한다.

빠른 매칭 Room은 첫 참가 후 60초가 지나도 8명이 아니면 서버가 10초마다 내장 봇 한 명을 추가한다. 봇은 `RANDOM` 역할 선호와 asset-ready 상태로 들어오며 인간의 명시 역할을 보존한 남은 자리에 배정된다. 친구 Room, 활성 인간이 없는 Room, 시작된 경기에는 봇을 추가하지 않는다. 봇의 내부 제어 유형은 `PlayerSnapshot` wire shape에 포함하지 않으며 모든 게임 행동은 사람과 동일한 `InputCommand` 경계를 통과한다.

친구 Room을 만든 첫 플레이어가 방장이며 `S2C_JOINED_ROOM`과 snapshot의 `hostPlayerId`로 식별한다. 모든 플레이어가 연결·asset·역할·사용자 준비를 완료하고 정확히 경찰 4명/도둑 4명이 되면 방장만 `C2S_START_MATCH`를 보낼 수 있다. `C2S_TRANSFER_HOST`는 현재 방장이 연결된 다른 참가자의 `targetPlayerId`를 지정할 때만 성공한다. 방장이 이탈하거나 재접속 유예가 끝나면 서버가 남은 연결 참가자에게 방장을 승계한다. 실제 `team`은 시작 요청이 승인되어 countdown에 진입하기 직전에 확정한다.

`C2S_LEAVE_ROOM`은 `LOBBY` 또는 `COUNTDOWN`에서만 허용한다. 서버는 플레이어 슬롯을 즉시 제거하고 `S2C_LEFT_ROOM`으로 확인하며, 마지막 인원이 나간 Room은 registry에서 즉시 정리한다. COUNTDOWN 이탈은 남은 역할을 미정으로 되돌리고 LOBBY로 복귀시킨다.

Server messages: `S2C_JOINED_ROOM`, `S2C_ROLE_PREFERENCE_UPDATED`, `S2C_LEFT_ROOM`, `S2C_MAP_DEFINITION`, `S2C_MATCH_PHASE`, `S2C_WORLD_SNAPSHOT`, `S2C_GAME_EVENTS`, `S2C_FULL_STATE`, `S2C_PONG`, `S2C_ERROR`.

`S2C_JOINED_ROOM`은 공개 목록 여부인 `listed`와 별도로 동작 정책 식별자인 `lobbyKind(QUICK_MATCH|FRIEND_ROOM)`, `hostPlayerId`를 전달한다. `listed`는 discovery 범위만 표현하며 시작·준비 규칙을 결정하는 플래그로 사용하지 않는다. snapshot의 플레이어 항목은 확정 `team` 외에 대기실 표시용 `rolePreference`와 `ready`를 포함한다.

`INTERACT` is a hold bit. `ACORN` and `FIRE` are handled on a rising edge. The server consumes all queued inputs in sequence order so a press/release pair received before one simulation tick does not lose its action edge; movement uses the final input state. `moveY` is forward/back and `moveX` is strafe, both rotated by the same input's normalized `aimX/aimY`. `FIRE` resolves an authoritative hitscan immediately against the nearest wall, tree, boundary, or enemy. Snapshots expose short-lived `thunderEffects { start, end, hitPlayerId }` for rendering, not moving projectile state. Snapshots acknowledge the local player's last accepted input sequence. Event consumers deduplicate by `eventId`.

If an unrecoverable tick error occurs, only that Room transitions to `CLOSED`. Clients receive `S2C_MATCH_PHASE(CLOSED)` and `S2C_ERROR(ROOM_SIMULATION_FAILED)`, then the server closes those Room connections with WebSocket code 1011. Other Rooms continue ticking.

입장 오류 `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_ALREADY_STARTED`는 같은 연결에서 다른 Room을 다시 선택할 수 있다. 친구 Room의 `ROLE_FULL`, `HOST_ONLY`, `PLAYERS_NOT_READY`, `HOST_TRANSFER_REJECTED`도 연결을 유지한 채 역할·준비·대상을 다시 선택할 수 있는 복구 가능 오류다. `RECONNECT_EXPIRED`는 저장된 token을 폐기하고 새 로비 세션을 시작해야 한다. 재접속 full snapshot의 `ackInputSequence` 이후부터 입력 sequence를 재개하며, 동일 token의 새 transport가 먼저 도착하면 기존 transport를 교체한다.

v6는 generator v7의 확대된 기지·감옥과 감옥 원형 collision footprint를 반영한다. 서버 이동·hitscan·시야와 클라이언트 prediction이 외곽/hole/나무 줄기뿐 아니라 `MapDefinition.jail.center/radius`도 같은 충돌체로 사용한다. 구출은 수감 플레이어 위치가 아니라 감옥 prefab 외곽에서 `jail.radius + interactionRadius` 범위로 판정한다. 이 동작은 v5 클라이언트의 예측 규칙과 호환되지 않으므로 protocol version을 올렸다.

`LobbyKind`, 친구 Room 방장·수동 시작·방장 위임 구조는 유지한다. 서버의 `LobbyFlowPolicy`가 빠른 매칭/친구 Room 규칙을 선택하고 클라이언트의 `LobbyPresentationPolicy`가 화면 전이를 선택하므로 `listed` 같은 단일 boolean에 동작을 결합하지 않는다. 미니맵은 새 권위 상태를 만들지 않고 기존 `MapDefinition`과 `WorldSnapshot`만 읽는 presentation adapter다. v5 클라이언트와 v6 서버는 호환되지 않는다.

내장 봇과 게스트 세션 닉네임은 protocol v6의 메시지 구조를 변경하지 않는다. 게스트 클라이언트는 탭 세션에 저장한 `다람쥐####` 이름을 기존 `displayName` 필드로 보내며, 같은 이름을 재접속 handshake에도 사용한다.
