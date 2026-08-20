# Protocol v2

All messages use JSON and `{ type, protocolVersion, roomId?, requestId?, payload }`. The server rejects payloads over 8 KiB, unknown versions/types, out-of-range inputs, duplicate/old input sequences, and more than 60 inputs per second.

Client messages: `C2S_JOIN_ROOM`, `C2S_CLIENT_READY`, `C2S_INPUT`, `C2S_PING`, `C2S_REQUEST_RESYNC`.

`C2S_JOIN_ROOM`은 `joinMode`로 `QUICK_MATCH`, `CREATE_ROOM`, `JOIN_ROOM`을 구분한다. `JOIN_ROOM`은 영문·숫자 4~8자리 `roomCode`가 필수다. v2 payload에서 joinMode를 생략한 레거시 부하 도구는 roomCode 유무에 따라 코드 참가 또는 빠른 매칭으로 해석하지만, 새 클라이언트는 항상 joinMode를 보낸다. 빠른 매칭은 공개 Room만 선택하고, 생성한 친구 Room은 코드로만 참가한다. 역할군은 클라이언트 선호를 받지 않고 서버 전용 난수와 팀 인원 균형으로 배정한다.

Server messages: `S2C_JOINED_ROOM`, `S2C_MAP_DEFINITION`, `S2C_MATCH_PHASE`, `S2C_WORLD_SNAPSHOT`, `S2C_GAME_EVENTS`, `S2C_FULL_STATE`, `S2C_PONG`, `S2C_ERROR`.

`INTERACT` is a hold bit. `ACORN` and `FIRE` are handled on a rising edge. The server consumes all queued inputs in sequence order so a press/release pair received before one simulation tick does not lose its action edge; movement uses the final input state. For each input, the server normalizes and applies its non-zero `aimX/aimY` before handling the `FIRE` edge, so a projectile uses the aim carried by the same click input. Snapshots acknowledge the local player's last accepted input sequence. Event consumers deduplicate by `eventId`.

If an unrecoverable tick error occurs, only that Room transitions to `CLOSED`. Clients receive `S2C_MATCH_PHASE(CLOSED)` and `S2C_ERROR(ROOM_SIMULATION_FAILED)`, then the server closes those Room connections with WebSocket code 1011. Other Rooms continue ticking.

입장 오류 `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_ALREADY_STARTED`는 같은 연결에서 다른 Room을 다시 선택할 수 있다. `RECONNECT_EXPIRED`는 저장된 token을 폐기하고 새 로비 세션을 시작해야 한다. 재접속 full snapshot의 `ackInputSequence` 이후부터 입력 sequence를 재개하며, 동일 token의 새 transport가 먼저 도착하면 기존 transport를 교체한다.

v2는 `MapDefinition.playableArea`를 필수로 추가한다. 서버 이동·투사체 외곽, 클라이언트 prediction과 Three.js 지면은 모두 이 다각형을 사용한다. v1 클라이언트와 v2 서버는 호환되지 않는다.
