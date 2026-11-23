# h/monhook protocol release status

The public GitHub Pages site is still using the existing deployed Guard program. The new h/monhook programs in this branch are **development artifacts**, not deployed to Solana mainnet.

## Unified mainnet release

The owner chose to finish the product and deploy it as one release. The old Guard-only deployment script is inspection-only; its `-Deploy` switch deliberately fails. Do not deploy the Guard, options program, database, or production front-end separately. The final release needs a single plan covering both program binaries, the launch and metadata service, the market index, privacy integration, site configuration, authority backup, funding, and post-deployment transactions. No mainnet release date or SOL amount is established yet.

## Verified locally

- `programs/hmonhook-guard` builds to SBF. Its own wire marker is `HMON`, and `hmonhook-sdk` builds matching instructions and receipts.
- A disposable local validator executed a Token-2022 transfer routed through the new Guard; the SDK's exact max-input rule rejected a second transfer and reverted its token movement. Run `node scripts/test-guard-local.mjs <local-guard-program-id>` after deploying the SBF program to a local validator.
- `programs/hmonhook-options` builds to SBF. The disposable local validator exercised series creation, purchase, exercise, registered-treasury default, default claim, duplicate-claim rejection, early reclaim of unsold collateral while sold lots remained exercisable, expiry, and final reclaim. It also rejected premature default, buying after the registered treasury was already breached, redirected exercise payout, purchase after the sale deadline, and unauthorized collateral reclaim; the premium deposit was checked against the series' SOL balance. The vault now rejects a preapproved token delegate and a nonempty balance before opening; Rust unit tests check both delegate fields. Run `node scripts/test-options-local.mjs <local-options-program-id>` after deploying the SBF program to a local validator.
- CI checks both Rust programs, both SDKs, and the options client. Local-validator tests need a running Solana validator and remain manual.

## Release blockers

1. A dedicated management wallet was generated on the project owner's Windows computer. Its public address is `DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG`. Its private key is outside the repository under that Windows user's application data, with access limited to that user. It has **0 SOL on mainnet** as checked on 2026-11-24, so it cannot currently pay to deploy. The owner still needs an offline recovery backup before any production authority is entrusted to it. The local-validator payer is separate and must never become the production authority.
2. Stable public addresses were reserved for the new Guard (`Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ`) and options (`Cz1jDZv12iXcK5JTY3s4wFX6HH8Y48xDeRxPWDgqshNQ`) programs; their private program keypair files are stored outside the repository. These addresses currently identify local-validator deployments only, not mainnet programs.
3. The options program currently has no premium release, buyback, or refund path. Premium SOL would remain locked. Do not deploy it with real user funds.
4. A funded devnet deployment, adversarial runtime tests, and independent security review are needed before mainnet collateral or options are accepted. The public devnet airdrop returned a rate-limit error on 2026-11-24.
5. The new R2 launch directory verifies submitted Pump `create_v2` transactions and indexes those launches by exact normalized name, but it has not passed a real signed launch registration yet. It is narrower than a global index of every Solana token with the same name. GitHub Pages cannot write that index by itself.
6. Helius Privacy Rings integration requires a project Helius account, API access and production configuration. No privacy claim should be shown as live until a real transaction is verified.
7. Wallet launch and Jupiter paths need end-to-end signed tests with the eventual project-owned Guard program and production RPC.

## Launch front-end state

- The website's coin creation action builds Pump `create_v2` for Solana mainnet and requires a wallet signature. It does **not** call the new Guard or create an issuer option position. The current live GitHub Pages branch still requires an existing public metadata URI; the development branch now points to the separate upload service.
- The launch client now checks that the connected wallet matches the payer and rechecks the transaction signature after an RPC confirmation timeout. Unit tests cover confirmed, failed and unresolved signatures. This is not a funded mainnet launch test.
- `scripts/launch-mainnet-test.mjs` now uses h/monhook test metadata and an explicit `HMONHOOK_KEYPAIR_PATH`; it only simulates and rejects `--send` while the unified release is incomplete.
- After a confirmed launch, the website generates a shareable `markets/?mint=<address>` link. A viewer on another device can inspect that Mint through the market-data provider, but this does not publish the coin into a network-wide h/monhook directory. The only automatic launch receipt is still stored in the creator's browser.
- A separate public Sites Worker/R2 service now exists under `services/launch-api`. Its mocked end-to-end test covers upload, public image/JSON retrieval, verified Pump launch registration and exact-name search. The Sites project `appgprj_6b04a10d4dbc8191979f45f72651b37a` is deployed at `https://hmonhook-launch-api.zaunmanx.chatgpt.site`. A real HTTP upload, public JSON and PNG fetch, empty directory read and CORS preflight passed on 2026-11-24. The development branch now points its upload and registry configs to this endpoint. These changes have not been published on the existing GitHub Pages main branch. No funded Pump launch or cross-device registration test has yet been run, and best-effort R2 counters are not a complete abuse defense.
- A production RPC read exposed Solana v1 transactions. The Sites service was updated to request `maxSupportedTransactionVersion: 1` and to try the official Solana public RPC if its primary provider fails. Site version 2 deployed successfully, then `/health` and the directory returned 200. The alternate Supabase function now requests v1 as well. This does not substitute for a real signed launch registration.
- The older Supabase migration and Edge Functions remain as an unused alternative. The deployed Sites/R2 service avoids needing a Supabase project for this launch path, but still needs a real signed launch registration, a production RPC reliability check and stronger abuse controls before the main branch uses it. See `supabase/README.md` for the older design.

The current website must keep unsupported actions clearly labeled until these gates are met. Do not point it to the disposable local program IDs in this branch.
