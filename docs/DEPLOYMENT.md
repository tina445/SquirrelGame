# Deployment

Build with `npm ci && npm run build`. Serve `client/dist` from static hosting and run `npm run start -w server` behind a TLS reverse proxy. Set `VITE_WS_URL=wss://game.example/ws` at client build time and proxy that endpoint to server port `8080`. The server exposes `/health` and `/metrics` without player personal data.

Production must terminate TLS (WSS), cap request/body sizes, set an origin allow-list at the proxy, and retain structured Room logs only as long as needed for diagnostics.
