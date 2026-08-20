# Protocol v1

All messages use JSON and `{ type, protocolVersion, roomId?, requestId?, payload }`. The server rejects payloads over 8 KiB, unknown versions/types, out-of-range inputs, duplicate/old input sequences, and more than 60 inputs per second.

Client messages: `C2S_JOIN_ROOM`, `C2S_CLIENT_READY`, `C2S_INPUT`, `C2S_PING`, `C2S_REQUEST_RESYNC`.

Server messages: `S2C_JOINED_ROOM`, `S2C_MAP_DEFINITION`, `S2C_MATCH_PHASE`, `S2C_WORLD_SNAPSHOT`, `S2C_GAME_EVENTS`, `S2C_FULL_STATE`, `S2C_PONG`, `S2C_ERROR`.

`INTERACT` is a hold bit. `ACORN` and `FIRE` are handled on a rising edge. The server consumes all queued inputs in sequence order so a press/release pair received before one simulation tick does not lose its action edge; movement uses the final input state. For each input, the server normalizes and applies its non-zero `aimX/aimY` before handling the `FIRE` edge, so a projectile uses the aim carried by the same click input. Snapshots acknowledge the local player's last accepted input sequence. Event consumers deduplicate by `eventId`.

If an unrecoverable tick error occurs, only that Room transitions to `CLOSED`. Clients receive `S2C_MATCH_PHASE(CLOSED)` and `S2C_ERROR(ROOM_SIMULATION_FAILED)`, then the server closes those Room connections with WebSocket code 1011. Other Rooms continue ticking.
