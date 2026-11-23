# h/monhook launch API

This Worker is the independent metadata and verified-launch service for the existing GitHub Pages front end. It stores content-addressed artwork and metadata in R2. A launch appears in the directory only after the Worker reads a confirmed Pump `create_v2` transaction and checks the Mint and creator. The API is separate from issuer options and does not prove a developer lock.

The source of truth is `services/launch-api/worker.mjs`. Run `node services/launch-api/build.mjs <site-checkout>/worker/index.js` before publishing a Site version. The Site project ID is `appgprj_6b04a10d4dbc8191979f45f72651b37a`; its source checkout is separate from this repository and the desktop backup. Its hosting manifest must bind R2 as `BUCKET`.

Routes:

- `POST /metadata-upload` accepts the launch form's bounded multipart upload and returns a public `uri` and `image`.
- `GET /metadata/<sha256>.json` and `GET /images/<sha256>.<ext>` return immutable public objects.
- `POST /launch-registry` verifies a confirmed mainnet Pump creation before storing it.
- `GET /launch-registry` lists recent verified launches; `?name=` returns exact normalized name matches.

The Worker limits requests per Cloudflare client IP on a best-effort R2 counter. It is not a durable anti-abuse guarantee under concurrent requests or distributed clients. Before opening public writes, confirm the service is public, R2 is bound, the production RPC can read transaction history, CORS works from the GitHub Pages origin, and rate controls withstand real traffic. Run a real wallet launch and cross-device directory read before setting the endpoints in `launch/metadata-service.json` and `markets/registry-service.json`. Until then, both public endpoint values remain empty.
