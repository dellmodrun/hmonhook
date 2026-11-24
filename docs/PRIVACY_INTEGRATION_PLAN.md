# Privacy Rings integration gate

The permissionless Helius default Ring is available on Solana mainnet. This does not mean h/monhook offers private transfers today. The default Ring conceals the asset and amount, while sender and recipient addresses remain visible. Custom anonymous Rings have different controls and are not part of this release.

Official references: [Helius privacy overview](https://www.helius.dev/docs/privacy), [endpoints](https://www.helius.dev/docs/privacy/endpoints.md), [SDK](https://www.helius.dev/docs/privacy/sdk.md), and [Helius agent account setup](https://www.helius.dev/docs/agents/cli.md).

## Product boundary

- Offer private transfer only as a separate, user-chosen action after a public trade. Do not conceal issuer collateral, series terms, default status, or the evidence needed for an option claim.
- Show the actual privacy level before the user signs: addresses remain public in the default Ring; deposits and withdrawals reveal different information than private-to-private transfers.
- Keep the user's signing and shielded key material in their wallet/client context. Never ask for or store a private key in the repository, Sites Worker, GitHub Pages, or project logs.
- Do not relay unrestricted Helius requests from an anonymous browser through a project API key. The provider warns that API keys should not be exposed in client-side code. A production relay needs request authentication, method allowlisting, rate and credit limits, and a review of what ciphertext or viewing data it handles.

## Implementation sequence

1. Establish a project-owned Helius account and API key. Account signup requires the owner's email and name; the agent signup path currently offers a paid one-time plan. Store the key only in server-side secret configuration.
2. Pin one compatible SDK release and verify its deployed-program identifiers, mainnet endpoint, signed TEE policy, proof source and transaction format against the current Helius docs. The public TypeScript package is currently a prerelease; do not assume the example repository's version matches a later production deployment.
3. Implement a narrow privacy service that authenticates the user and rate-limits proof and indexer calls. Expose no general-purpose RPC proxy and no API key to the browser.
4. Build wallet registration, deposit, private transfer, private balance/history and withdrawal as separate reviewed flows. Each must show fees, exact public/private fields, network, destination and pending/confirmed states before signing.
5. Run a funded Devnet lifecycle, then a small funded mainnet lifecycle with a project-controlled wallet. Verify submitted signatures and resulting public and shielded balances. Perform independent security review before advertising the feature as active.

Until the account, key handling, transaction flow and tests exist, the site's privacy text must remain clearly marked as planned.
