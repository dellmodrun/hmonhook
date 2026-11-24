# JavaScript dependency review (2026-11-24)

`npm audit` reports 15 vulnerable packages in the pinned frontend dependency tree: 8 high and 7 moderate. This is a release blocker until each reachable issue has either a compatible fix or a reviewed mitigation. `npm audit fix --force` proposes changing major versions of Pump and Solana SDKs and is not a validated fix for this project.

The relevant installed paths are:

| Vulnerable package | Installed through | Browser bundle? | Next action |
| --- | --- | --- | --- |
| `bigint-buffer@1.1.5` | `@solana/spl-token` → `@solana/buffer-layout-utils` | Yes, launch and options | Check whether the advisory's native `toBigIntLE` overflow is reachable in the bundled pure-JS implementation; replace or mitigate before release if so. No patched package version is listed. |
| `toml@3.0.0` | Pump SDK → Anchor | No | Confirm no untrusted TOML is parsed by build or server paths; track upstream replacement. |
| `stream-json@1.9.1` | `@solana/web3.js` → `jayson` | No (browser build uses the browser client) | Check server/RPC parsing paths and a compatible upstream update. |
| `uuid@8.3.2` | `@solana/web3.js` → `jayson` | Yes | Check whether affected v3/v5/v6 calls with caller-supplied output buffers are reachable; track compatible upstream update. |

The remaining high/moderate audit rows for `@pump-fun/pump-sdk`, `@solana/spl-token`, `@solana/web3.js`, Anchor and their helpers inherit these vulnerable paths. Bundle reachability was checked with esbuild's metafile for `launch-client.ts`, `options-browser-client.ts`, and `intent-client.ts`; it does not prove that an exploit is reachable at runtime. An independent review must inspect the exact production bundles and lockfile before enabling mainnet funding actions.

Advisory records: [bigint-buffer](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), [TOML](https://github.com/advisories/GHSA-82x6-q7mm-w9cf), [stream-json](https://github.com/advisories/GHSA-mjw6-4jj6-33hc).
