# h/monhook protocol release status

The public GitHub Pages site is still using the existing deployed Guard program. The new h/monhook programs in this branch are **development artifacts**, not deployed to Solana mainnet.

## Verified locally

- `programs/hmonhook-guard` builds to SBF. Its own wire marker is `HMON`, and `hmonhook-sdk` builds matching instructions and receipts.
- A disposable local validator executed a Token-2022 transfer routed through the new Guard; the SDK's exact max-input rule rejected a second transfer and reverted its token movement. Run `node scripts/test-guard-local.mjs <local-guard-program-id>` after deploying the SBF program to a local validator.
- `programs/hmonhook-options` builds to SBF. The disposable local validator exercised series creation, purchase, exercise, registered-treasury default, default claim, duplicate-claim rejection, expiry, and reclaim. Run `node scripts/test-options-local.mjs <local-options-program-id>` after deploying the SBF program to a local validator.
- CI checks both Rust programs, both SDKs, and the options client. Local-validator tests need a running Solana validator and remain manual.

## Release blockers

1. A dedicated management wallet was generated on the project owner's Windows computer. Its public address is `DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG`. Its private key is outside the repository under that Windows user's application data, with access limited to that user. It has **0 SOL on mainnet** as checked on 2026-11-24, so it cannot currently pay to deploy. The owner still needs an offline recovery backup before any production authority is entrusted to it. The local-validator payer is separate and must never become the production authority.
2. Stable public addresses were reserved for the new Guard (`Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ`) and options (`Cz1jDZv12iXcK5JTY3s4wFX6HH8Y48xDeRxPWDgqshNQ`) programs; their private program keypair files are stored outside the repository. These addresses currently identify local-validator deployments only, not mainnet programs.
3. The options program currently has no premium release, buyback, or refund path. Premium SOL would remain locked. Do not deploy it with real user funds.
4. A funded devnet deployment, adversarial runtime tests, and independent security review are needed before mainnet collateral or options are accepted. The public devnet airdrop returned a rate-limit error on 2026-11-24.
5. The same-name market view needs an independently verifiable index of token metadata. GitHub Pages cannot write that index. The client can list on-chain option series by Mint, but that is narrower than the promised all-token market.
6. Helius Privacy Rings integration requires a project Helius account, API access and production configuration. No privacy claim should be shown as live until a real transaction is verified.
7. Wallet launch and Jupiter paths need end-to-end signed tests with the eventual project-owned Guard program and production RPC.

The current website must keep unsupported actions clearly labeled until these gates are met. Do not point it to the disposable local program IDs in this branch.
