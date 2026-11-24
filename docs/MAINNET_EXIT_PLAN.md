# Mainnet SOL recovery and shutdown plan

Status: **deployment blocked**. This document is a release gate, not a claim that all SOL can be recovered.

## Read-only snapshot, 2026-11-24

`node scripts/preflight-mainnet-release.mjs` checked Solana mainnet-beta, the reserved program addresses, local keypair identities, reviewed SBF hashes, live rent, and management balance without sending a transaction.

| Item | Current result |
| --- | --- |
| Management address | `DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG` |
| Management balance | 0 SOL |
| New Guard / options accounts | Both reserved addresses unoccupied |
| Final program-account rent floor | 0.95419672 SOL (current reviewed binaries) |
| Simultaneous temporary buffer rent | 0.95244920 SOL; staging, not an additional permanent cost |
| Transaction fees and other accounts | Excluded from the rent floor |

These figures describe the earlier reviewed binary, **not** the new shutdown build. The read-only preflight still checks the earlier binary until a new independent review and digest update. Recompute from the final reviewed binaries and current network rent before any deployment.

## Which SOL can be recovered

| SOL location | Recovery condition |
| --- | --- |
| Unspent SOL in the management wallet | The holder of that wallet's private key can transfer it. The key must have an offline recovery backup. |
| New upgradeable Program and ProgramData rent | The retained upgrade authority can close a program and receive its account lamports. Do not use `set-upgrade-authority --final`; an immutable program cannot be closed. Closing permanently disables that Program ID. |
| Deployment buffer rent | Retain the buffer authority and record buffer addresses. Close stranded buffers after interrupted deployments; a successful deployment may drain the buffer automatically. |
| V3 options Series and buyer Position account rent | A development-only close path has been added. It is **not release-verified**: the SBF must be built, run through a complete shutdown on a local validator and funded public cluster, and independently reviewed before mainnet. A Position closes to its buyer after expiry and claim settlement; a Series closes to its issuer after all positions and dependent accounts close. |
| Options collateral and registered treasury token-account rent | A development-only instruction closes an empty vault to the issuer after expiry. Outstanding entitlements must remain claimable; full lifecycle testing is still required. |
| Buyback token vault rent | A development-only instruction closes the vault only when it holds zero tokens. If premium-funded buybacks have filled the permanent vault, that rent cannot currently be returned without changing the token-custody promise. |
| Buyback PDA rent and empty PumpSwap quote account rent | The V3 program has constrained reclaim instructions, but they depend on completed premium spending/refunds and account state. Test the full shutdown on a public cluster before mainnet value is accepted. |
| Option premiums and SOL already spent in a buyback | These are not an owner deposit. Buyers have defined refund rights to unspent premiums after expiry; spent premiums cannot be withdrawn as deployment rent. |
| Transaction and priority fees | Never refunded, including on failed transactions. |

The earlier Jolt Guard mainnet deployment uses a different recorded upgrade authority. Control of the new management wallet does not prove the ability to close that older program or recover its rent.

## Required release gates

1. Verify the new close instructions against every Series, Position, collateral vault, registered treasury, and buyback vault without cancelling buyer claims or refunds. The permanent buyback vault's nonempty case remains unresolved. Keep enough state until all claims are settled.
2. Complete expiry, default, partial exercise, outstanding claims, incomplete refunds, a failed buyback, and interrupted deployment tests. The current local-validator lifecycle already rejects a close with an unclaimed premium refund or outstanding Position and verifies the Position, empty vault, and Series rent is returned after settlement. The default and nonempty permanent-buyback shutdown cases still need dedicated tests and a custody-policy decision.
3. Run funded public-cluster lifecycle and recovery tests with disposable wallets, then obtain independent review of the final binaries and economic rules. Local-validator and synthetic-pool tests do not cover this gate.
4. Back up the management and program keypairs offline. Retain the upgrade authority; never mark the programs immutable if shutdown recovery is required. Record ProgramData, authority, binary digest, deployment and buffer addresses.
5. Complete the remaining product release gates in `HMONHOOK_RELEASE_STATUS.md`, including production RPC/monitoring, same-name indexing, and the privacy integration before claiming a unified mainnet product.

## Shutdown order after a future release

Stop new positions; keep the program available while users exercise, claim, or receive refunds. Settle remaining issuer collateral and treasury obligations, then close eligible token, Position, Series, and buyback accounts to their authorized recipients. Only after all user obligations are discharged should the upgrade authority close the programs and transfer the wallet's remaining SOL. Never close a program while it is needed to release user funds.

Official Solana references: [deploying and closing programs](https://solana.com/docs/programs/deploying), [loader-v3 close behavior](https://solana.com/docs/core/programs/program-deployment), [closing token accounts](https://solana.com/docs/tokens/basics/close-account), [transaction fee structure](https://solana.com/docs/core/fees/fee-structure).
