# Option premium execution gate

This document defines the money path that must exist before h/monhook options can accept real SOL. The development contract collects premiums in the series PDA and now lets buyers reclaim unspent premiums after expiry. It has no buyback instruction. The frontend must keep option purchases unavailable until the complete path below is implemented, tested on a funded devnet deployment, and independently reviewed.

## Owner decision

When a sold-out series uses premiums to buy back its Mint, the acquired tokens go into a program-owned token vault with no issuer withdrawal path. They are not credited to the issuer or to an operator wallet. This vault must be distinct from the collateral vault used to pay option claims.

## Required accounting

- Account for series rent separately from premiums. At every state transition, recorded unspent premiums must be backed by spendable lamports in program custody.
- Track total premium received, amount committed to completed buybacks, amount refunded, and remaining balance. A retry cannot spend or refund the same lamports twice. The development contract records these amounts and allows post-expiry claims; its buyback spending field is currently zero because no buyback instruction exists.
- A buyback is eligible only after `sold_lots == total_lots`. It must use an explicitly allowed on-chain venue, the series Mint, a bounded SOL input, a committed minimum token output, and the immutable buyback vault as destination.
- The program must compare custody balances before and after the market CPI. It must reject a zero-output purchase, excess SOL spend, changed destination, unrelated token Mint, arbitrary program invocation, and any attempt to drain collateral.
- If no supported market route can execute by expiry, each buyer can claim a proportional share of unspent premiums after expiry, even if their option was exercised or the series defaulted. The final buyer claim receives any integer-rounding remainder. The current local-validator test covers this fallback without a prior buyback. A future route must stop spending at expiry and preserve the same accounting invariant.
- No issuer, operator, upgrade authority, or keeper withdrawal may bypass these rules. A keeper may submit a transaction and pay its own network fee but may not receive premium principal or bought tokens.

## Route implementation notes

- The collateral vault is already the Token-2022 associated account owned by the series PDA. It cannot also be the permanent buyback destination. Derive a separate buyback authority PDA from the series and use its Token-2022 associated account for acquired tokens. No instruction may transfer tokens out of that account. The final program upgrade authority must be addressed before calling it permanently unwithdrawable.
- `options-client.mjs` now derives this separate PDA and its token accounts and verifies the installed Pump SDK's generated curve-buy route. The on-chain program does not yet invoke that route or move premiums into it.
- For a token still trading on its Pump bonding curve, the official `buy_exact_quote_in_v3` instruction accepts an exact quote input and minimum base-token output with 17 accounts. Build and pin its instruction data and account layout, require the official Pump program, the series Mint, Token-2022, wrapped SOL, the distinct buyback authority and its own token account. The series program must measure the quote spent and tokens received across the CPI, enforce a price ceiling derived from published series terms, and preserve all unspent premium for refunds. The SDK document is [Pump Bonding Curve Trades V3](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/TRADE_V3.md).
- A migrated token requires a separate, equally constrained PumpSwap route. Pump's [PumpSwap Trades V2](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/PUMP_SWAP_TRADE_V2.md) documents the post-migration instruction family. A bonding-curve failure must never cause a keeper to receive premium SOL directly. If neither verified route executes before expiry, the current refund instruction remains available.
- Funding any wrapped-SOL account, temporary account rent, and any Pump-created user volume account must be accounted for separately from the amount committed to buyback. Do not let a keeper supply arbitrary CPI program IDs, swap destinations, or token accounts. A failed CPI must atomically revert the funding step.

## Release evidence

1. Local-validator tests cover partial sale, sold-out eligibility, a successful buyback, slippage rejection, a venue migration or unavailable route, refund fallback, concurrent/repeated calls, default, exercise, expiry, and invariant preservation after failed CPI.
2. A funded devnet deployment repeats the full sequence with real signed transactions and independently inspectable program accounts.
3. An independent review examines both program binaries, the SDK transaction builder, and the exact supported market route before mainnet options are enabled.

The current contract meets the basic post-expiry refund path but does not meet the buyback, venue, funded-devnet or independent-review requirements. The mainnet release gate remains closed.
