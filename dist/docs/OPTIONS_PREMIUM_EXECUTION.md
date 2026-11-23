# Option premium execution gate

This document defines the money path that must exist before h/monhook options can accept real SOL. The development contract currently collects premiums in the series PDA but has no spend, buyback, or refund instruction. The frontend must keep option purchases unavailable until the complete path below is implemented, tested on a funded devnet deployment, and independently reviewed.

## Owner decision

When a sold-out series uses premiums to buy back its Mint, the acquired tokens go into a program-owned token vault with no issuer withdrawal path. They are not credited to the issuer or to an operator wallet. This vault must be distinct from the collateral vault used to pay option claims.

## Required accounting

- Account for series rent separately from premiums. At every state transition, recorded unspent premiums must be backed by spendable lamports in program custody.
- Track total premium received, amount committed to completed buybacks, amount refunded, and remaining balance. A retry cannot spend or refund the same lamports twice.
- A buyback is eligible only after `sold_lots == total_lots`. It must use an explicitly allowed on-chain venue, the series Mint, a bounded SOL input, a committed minimum token output, and the immutable buyback vault as destination.
- The program must compare custody balances before and after the market CPI. It must reject a zero-output purchase, excess SOL spend, changed destination, unrelated token Mint, arbitrary program invocation, and any attempt to drain collateral.
- If no supported market route can execute by a published cutoff, buyers need a permissionless claim on their unspent premium share. The refund rule, cutoff, and interaction with exercised or defaulted positions must be fixed in the contract before purchase; no funds may remain indefinitely inaccessible.
- No issuer, operator, upgrade authority, or keeper withdrawal may bypass these rules. A keeper may submit a transaction and pay its own network fee but may not receive premium principal or bought tokens.

## Release evidence

1. Local-validator tests cover partial sale, sold-out eligibility, a successful buyback, slippage rejection, a venue migration or unavailable route, refund fallback, concurrent/repeated calls, default, exercise, expiry, and invariant preservation after failed CPI.
2. A funded devnet deployment repeats the full sequence with real signed transactions and independently inspectable program accounts.
3. An independent review examines both program binaries, the SDK transaction builder, and the exact supported market route before mainnet options are enabled.

The current contract does not meet these requirements. The mainnet release gate remains closed.
