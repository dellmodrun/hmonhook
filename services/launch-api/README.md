# h/monhook launch API

This Worker is the independent metadata and verified-launch service for the existing GitHub Pages front end. It stores content-addressed artwork and metadata in R2. A launch appears in the directory only after the Worker reads a confirmed Pump `create_v2` transaction and checks the Mint and creator. The API is separate from issuer options and does not prove a developer lock.

The source of truth is `services/launch-api/worker.mjs`. Run `node services/launch-api/build.mjs <site-checkout>/worker/index.js` before publishing a Site version. The public Site project ID is `appgprj_6b04a10d4dbc8191979f45f72651b37a`, deployed at `https://hmonhook-launch-api.zaunmanx.chatgpt.site`; its source checkout is separate from this repository and the desktop backup. Its hosting manifest binds R2 as the string `"BUCKET"`.

Routes:

- `POST /metadata-upload` accepts the launch form's bounded multipart upload and returns a public `uri` and `image`.
- `GET /metadata/<sha256>.json` and `GET /images/<sha256>.<ext>` return immutable public objects.
- `POST /launch-registry` verifies a confirmed mainnet Pump creation before storing it.
- `GET /launch-registry` lists recent verified launches; `?name=` returns exact normalized name matches.
- `GET /official-token` returns the official Mint record from R2 with `no-store` caching; it returns `TBA` until published. The homepage and reserved first Markets card poll this endpoint every two seconds.
- `PUT /official-token` updates the record without redeploying GitHub Pages. It accepts `{ "mint": "TBA" }` or a Solana Mint and requires the `HMONHOOK_OFFICIAL_TOKEN_ADMIN_KEY` bearer secret stored in Sites runtime settings. The key is kept outside either repository in the owner's local profile and must never enter a frontend bundle.
- `POST /option-series` accepts a V3 series address and Mint only after the Mint's Pump launch is already indexed. It checks the live Solana account owner, V3 wire tag, issuer/Mint fields, series PDA, custody PDA and collateral ATA before storing a candidate address.
- `GET /option-series?mint=<Mint>` returns stored candidate addresses for that Mint. These are discovery hints, not current protection badges; the browser re-reads live Series data before listing them, and checks the vault and registered treasury before enabling a purchase.

The Worker limits requests per Cloudflare client IP with atomic conditional R2 writes. This prevents concurrent requests from exceeding one IP's daily cap, but clients with many IPs can still generate traffic. It requests Solana transaction version 1 and falls back from PublicNode to the official public RPC when necessary. A live image upload, public metadata and image fetch, empty directory read and CORS preflight passed. A real signed Pump launch, transaction-history lookup and cross-device directory read still need testing before the development branch can be called production ready. The existing GitHub Pages main branch has not been updated to these endpoints.

The V3 option-series route was deployed as Site version 6 on 2026-11-24. Live `/health` and empty `GET /option-series?mint=...` returned HTTP 200; a POST for a Mint absent from the launch directory returned HTTP 409. Because the V3 options program is not on mainnet, no real series can currently pass its registration check. A real signed V3 registration and cross-device lookup remain untested.
