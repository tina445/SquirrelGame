# Protocol v1

All messages use JSON and `{ type, protocolVersion, roomId?, requestId?, payload }`. The server rejects payloads over 8 KiB, unknown versions/types, out-of-range inputs, duplicate/old input sequences, and more than 60 inputs per second.

Client messages: `C2S_JOIN_ROOM`, `C2S_CLIENT_READY`, `C2S_INPUT`, `C2S_PING`, `C2S_REQUEST_RESYNC`.

Server messages: `S2C_JOINED_ROOM`, `S2C_MAP_DEFINITION`, `S2C_MATCH_PHASE`, `S2C_WORLD_SNAPSHOT`, `S2C_GAME_EVENTS`, `S2C_FULL_STATE`, `S2C_PONG`, `S2C_ERROR`.

`INTERACT` is a hold bit. `ACORN` and `FIRE` are handled on a rising edge. Snapshots acknowledge the local player's last accepted input sequence. Event consumers deduplicate by `eventId`.
