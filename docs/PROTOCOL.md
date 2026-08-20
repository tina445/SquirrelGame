# Protocol v3

All messages use JSON and `{ type, protocolVersion, roomId?, requestId?, payload }`. The server rejects payloads over 8 KiB, unknown versions/types, out-of-range inputs, duplicate/old input sequences, and more than 60 inputs per second.

Client messages: `C2S_JOIN_ROOM`, `C2S_LEAVE_ROOM`, `C2S_CLIENT_READY`, `C2S_INPUT`, `C2S_PING`, `C2S_REQUEST_RESYNC`.

`C2S_JOIN_ROOM`은 `joinMode`로 `QUICK_MATCH`, `CREATE_ROOM`, `JOIN_ROOM`을 구분한다. `JOIN_ROOM`은 영문·숫자 4~8자리 `roomCode`가 필수다. 빠른 매칭의 `rolePreference`는 `POLICE`, `THIEF`, `RANDOM`, 친구 Room은 `POLICE`, `THIEF`만 허용한다. 입장 시 선택은 예약일 뿐 `team`은 `null`이며, 8명이 준비된 시작 직전에 명시 선택을 우선하고 랜덤 참가자를 남은 자리에 배정해 4 대 4를 확정한다. 명시 역할의 네 자리가 찬 Room은 `ROLE_FULL`을 반환한다.

`C2S_LEAVE_ROOM`은 `LOBBY` 또는 `COUNTDOWN`에서만 허용한다. 서버는 플레이어 슬롯을 즉시 제거하고 `S2C_LEFT_ROOM`으로 확인하며, 마지막 인원이 나간 Room은 registry에서 즉시 정리한다. COUNTDOWN 이탈은 남은 역할을 미정으로 되돌리고 LOBBY로 복귀시킨다.

Server messages: `S2C_JOINED_ROOM`, `S2C_LEFT_ROOM`, `S2C_MAP_DEFINITION`, `S2C_MATCH_PHASE`, `S2C_WORLD_SNAPSHOT`, `S2C_GAME_EVENTS`, `S2C_FULL_STATE`, `S2C_PONG`, `S2C_ERROR`.

`INTERACT` is a hold bit. `ACORN` and `FIRE` are handled on a rising edge. The server consumes all queued inputs in sequence order so a press/release pair received before one simulation tick does not lose its action edge; movement uses the final input state. For each input, the server normalizes and applies its non-zero `aimX/aimY` before handling the `FIRE` edge, so a projectile uses the aim carried by the same click input. Snapshots acknowledge the local player's last accepted input sequence. Event consumers deduplicate by `eventId`.

If an unrecoverable tick error occurs, only that Room transitions to `CLOSED`. Clients receive `S2C_MATCH_PHASE(CLOSED)` and `S2C_ERROR(ROOM_SIMULATION_FAILED)`, then the server closes those Room connections with WebSocket code 1011. Other Rooms continue ticking.

입장 오류 `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_ALREADY_STARTED`는 같은 연결에서 다른 Room을 다시 선택할 수 있다. `RECONNECT_EXPIRED`는 저장된 token을 폐기하고 새 로비 세션을 시작해야 한다. 재접속 full snapshot의 `ackInputSequence` 이후부터 입력 sequence를 재개하며, 동일 token의 새 transport가 먼저 도착하면 기존 transport를 교체한다.

v3는 generator v4의 `layoutKind`, `playableHoles`, 원형 줄기와 비충돌 수관을 가진 `trees`를 필수로 추가한다. 서버 이동·투사체·시야, 클라이언트 prediction과 Three.js 지면은 같은 외곽/hole/줄기 충돌을 사용한다. v2 클라이언트와 v3 서버는 호환되지 않는다.
