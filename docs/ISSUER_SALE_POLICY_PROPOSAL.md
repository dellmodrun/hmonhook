# Issuer withdrawal and forfeiture policy — proposed V3

## Decision needed

The current development contract locks 2%–10% of Mint supply as option collateral and watches one issuer token account's **current** balance. A withdrawal followed by a refill before another transaction registers default cannot be proved from that balance. The current contract therefore does not deliver the historical developer-sale promise.

The recommended V3 rule is: **the issuer separately deposits a declared token allocation into a program-controlled custody account. Any withdrawal of that registered allocation before option expiry irrevocably marks the series in default.** Sold option lots then claim the collateral without paying the strike. Unsold collateral remains returnable to the issuer after the sale window. After expiry, the issuer can withdraw its registered allocation without default; ordinary unexercised option collateral follows the existing expiry rule.

This changes the issuer's commitment. The 2%–10% option collateral remains separate, and the registered allocation is also held in custody while the series is active. The interface must show both amounts and require explicit approval of both transfers. An issuer with no additional registered allocation cannot advertise sale protection. A token account needs additional rent; the exact amount depends on the Mint's required Token-2022 account extensions and current cluster rent.

## Enforceable scope

- The rule covers only tokens the issuer actually deposits into the registered custody account. It cannot identify unrelated wallets controlled by the same person.
- A withdrawal is treated as a violation even if the issuer does not sell the withdrawn tokens. This is the enforceable on-chain event. A market sale from another wallet is outside this rule.
- A later deposit cannot undo default. The default status is stored in the program's Series account before the custody transfer completes in the same transaction.
- The custody token account must be controlled by a Series-derived PDA with no delegate and no withdrawal instruction other than the issuer's explicit default/expiry path. Collateral remains in a distinct vault.
- The Mint must have no mint, freeze, permanent-delegate, transfer-fee or transfer-hook authority that could defeat delivery. The existing extension allowlist remains a release check.
- An upgrade authority could still change the program's behavior. Production authority policy and independent review are required before describing custody as irreversible.

## V3 transaction flow

1. The issuer reviews a canonical Pump Mint and curve-derived strike, then specifies a 2%–10% collateral deposit plus a separate registered allocation. The browser shows both token amounts, premium, strike, sale deadline and expiry.
2. In one atomic transaction, the program creates the Series and custody token account, moves collateral to the option vault, and moves the registered allocation to custody. It verifies both received amounts, Token-2022 ownership and absence of token delegates.
3. Buyers may purchase only while the series is active and before the sale deadline. The existing position, premium and buyback accounting continues.
4. Before expiry, an issuer withdrawal first marks `DEFAULT`, then sends the registered allocation to an issuer-owned token account. Any failure rolls back both actions. Option holders claim their sold lots from collateral without paying the strike.
5. After expiry, the issuer may withdraw the registered allocation without default. Unexercised collateral, unused premium refunds and rent are settled under the existing rules.

## Required changes before release

- Version the Series wire tag and SDK decoder, add a separately derived custody token account, and remove current-balance monitoring of the issuer's freely controlled account as a forfeiture signal.
- Add a withdrawal instruction with exact account, signer, Mint, deadline and status checks; never provide a generic PDA-signed token transfer.
- Update the browser to show registered custody separately from 2%–10% collateral and state the wallet-scope limitation before signing.
- Test withdrawal/default atomically, refill after default, an unrelated-wallet sale, no delegate, wrong destination, expiry boundary, unsold and sold lots, exercise/claim/refund, Pump and PumpSwap buyback, and rent recovery on a local validator.
- Rebuild and verify new SBF artifacts, repeat funded public-cluster tests, and obtain an independent review. The temporary Devnet V2 deployment and its SHA-256 cannot be reused as V3 release evidence.

## Alternative requiring a separate trust decision

The issuer could keep all unlocked tokens in a freely controlled wallet while an off-chain monitor records historical transfers and signs a violation attestation. The options contract would then trust the monitor's key and availability, and the product would need durable indexing, evidence retention, key rotation and an appeals policy. It still cannot prove which unregistered wallets belong to the same developer. This is a different security model and must be selected explicitly before implementation.
