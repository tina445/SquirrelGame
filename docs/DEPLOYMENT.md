# Deployment

Build with `npm ci && npm run build`. Serve `client/dist` from static hosting and run `npm run start -w server` behind a TLS reverse proxy. Set `VITE_WS_URL=wss://game.example/ws` at client build time and proxy that endpoint to server port `8080`. The server exposes `/health` and `/metrics` without player personal data.

Quick-match bots are enabled by default. Set `MATCH_BOTS_ENABLED=false` to disable filling. `MATCH_BOT_FILL_DELAY_MS` and `MATCH_BOT_FILL_INTERVAL_MS` are intended for controlled testing; production should retain the 60,000/10,000 ms defaults unless a measured matchmaking policy change is recorded. Monitor `botCount`, `botsAdded`, `botDecisionAverageMs`, `botDecisionP95Ms`, and `botDecisionErrors` in `/metrics` alongside Room tick p95.

Production must terminate TLS (WSS), cap request/body sizes, set an origin allow-list at the proxy, and retain structured Room logs only as long as needed for diagnostics.
