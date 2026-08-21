# Protocol v4

All messages use JSON and `{ type, protocolVersion, roomId?, requestId?, payload }`. The server rejects payloads over 8 KiB, unknown versions/types, out-of-range inputs, duplicate/old input sequences, and more than 60 inputs per second.

Client messages: `C2S_JOIN_ROOM`, `C2S_LEAVE_ROOM`, `C2S_CLIENT_READY`, `C2S_SET_ROLE_PREFERENCE`, `C2S_SET_READY`, `C2S_INPUT`, `C2S_PING`, `C2S_REQUEST_RESYNC`.

`C2S_JOIN_ROOM`은 `joinMode`로 `QUICK_MATCH`, `CREATE_ROOM`, `JOIN_ROOM`을 구분한다. `JOIN_ROOM`은 영문·숫자 4~8자리 `roomCode`가 필수다. 빠른 매칭은 입장 전에 `POLICE`, `THIEF`, `RANDOM` 중 `rolePreference`를 필수로 보낸다. 친구 Room은 역할 없이 먼저 입장한 뒤 `C2S_SET_ROLE_PREFERENCE(POLICE|THIEF)`와 `C2S_SET_READY`를 순서대로 보낸다. `C2S_CLIENT_READY`는 맵/asset 준비만 뜻하며 친구 Room의 사용자 준비를 대신하지 않는다. 성공한 역할 예약은 `S2C_ROLE_PREFERENCE_UPDATED`로 확인한다. 8명의 asset·역할·준비가 모두 충족된 시작 직전에 팀을 4 대 4로 확정한다.

`C2S_LEAVE_ROOM`은 `LOBBY` 또는 `COUNTDOWN`에서만 허용한다. 서버는 플레이어 슬롯을 즉시 제거하고 `S2C_LEFT_ROOM`으로 확인하며, 마지막 인원이 나간 Room은 registry에서 즉시 정리한다. COUNTDOWN 이탈은 남은 역할을 미정으로 되돌리고 LOBBY로 복귀시킨다.

Server messages: `S2C_JOINED_ROOM`, `S2C_ROLE_PREFERENCE_UPDATED`, `S2C_LEFT_ROOM`, `S2C_MAP_DEFINITION`, `S2C_MATCH_PHASE`, `S2C_WORLD_SNAPSHOT`, `S2C_GAME_EVENTS`, `S2C_FULL_STATE`, `S2C_PONG`, `S2C_ERROR`.

`INTERACT` is a hold bit. `ACORN` and `FIRE` are handled on a rising edge. The server consumes all queued inputs in sequence order so a press/release pair received before one simulation tick does not lose its action edge; movement uses the final input state. `moveY` is forward/back and `moveX` is strafe, both rotated by the same input's normalized `aimX/aimY`. `FIRE` resolves an authoritative hitscan immediately against the nearest wall, tree, boundary, or enemy. Snapshots expose short-lived `thunderEffects { start, end, hitPlayerId }` for rendering, not moving projectile state. Snapshots acknowledge the local player's last accepted input sequence. Event consumers deduplicate by `eventId`.

If an unrecoverable tick error occurs, only that Room transitions to `CLOSED`. Clients receive `S2C_MATCH_PHASE(CLOSED)` and `S2C_ERROR(ROOM_SIMULATION_FAILED)`, then the server closes those Room connections with WebSocket code 1011. Other Rooms continue ticking.

입장 오류 `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_ALREADY_STARTED`는 같은 연결에서 다른 Room을 다시 선택할 수 있다. `RECONNECT_EXPIRED`는 저장된 token을 폐기하고 새 로비 세션을 시작해야 한다. 재접속 full snapshot의 `ackInputSequence` 이후부터 입력 sequence를 재개하며, 동일 token의 새 transport가 먼저 도착하면 기존 transport를 교체한다.

v4는 generator v5의 7종 `layoutKind`, 확대된 원형 spawn, 역할/asset/사용자 준비 분리와 `thunderEffects`를 반영한다. 서버 이동·hitscan·시야, 클라이언트 prediction과 Three.js 지면은 같은 외곽/hole/줄기 충돌을 사용한다. v3 클라이언트와 v4 서버는 호환되지 않는다.
