# h/monhook issuer options v1: implementation contract

This document fixes the financial rules that were previously only marketing copy. It is a proposed implementation specification, **not a deployed contract**. No interface may label a coin protected until its deployed program, escrow balance, terms and issuer commitment are verified on-chain.

The development branch contains a native Rust program under `programs/hmonhook-options` and a transaction builder in `options-client.mjs`. These are development artifacts. A disposable local Solana validator has exercised opening, purchase, exercise, registered treasury outflow default, claim, duplicate-claim rejection, early reclaim of unsold lots, continued exercise of sold lots, expiry and final issuer reclaim with Token-2022 accounts. It also rejected premature default, redirected exercise payout, unauthorized reclaim and late purchase. This is not a funded devnet test, an independent security review, or evidence that mainnet deployment is safe.

## Series and collateral

- One series is identified by a token Mint, issuer wallet and unique series number. The issuer signs its creation.
- The issuer deposits tokens into a program-controlled vault before options can be sold. The deposit is exactly 2% to 10% of the Mint supply observed at creation, measured in base units. The contract rejects a Mint whose supply can be increased by an active mint authority, and rejects a deposit below one whole token.
- V1 accepts Token-2022 Mints only when mint/freeze authority is removed and their extensions are limited to descriptive metadata or group data. Transfer fees, transfer hooks, permanent delegates, pause authority and confidential-balance extensions are rejected because they can make the escrowed lot unavailable or underdeliver it. The program also checks the exact token amount received by the vault and buyer.
- The vault has no issuer withdrawal instruction while active options remain. The contract records the deposited amount, Mint, issuer, price terms, sale deadline and exercise deadline immutably.
- A series with no escrow, an invalid Mint or no verified transaction is shown as **unlocked**. A name or ticker does not make it official.

## Option purchase and exercise

- One option lot represents one whole token, using the Mint's recorded decimals. Fractional lots are not sold in v1. The number of lots cannot exceed the vault's whole-token balance.
- The strike is a fixed number of lamports per lot, committed when the issuer opens the series. `openSeriesFromPumpCurve` now reads the Token-2022 Mint and Pump curve at one confirmed RPC slot, checks that the curve is SOL-quoted and active, and sets the one-token strike to `floor(lot_size * virtual_quote_reserves / (virtual_token_reserves - lot_size)) + 1`. The returned snapshot includes the exact slot, curve address, reserves and decimals for display and review. This is the pre-fee constant-product curve price, not a fee-inclusive Pump buy quote or a price guarantee. The creation UI still needs to surface these details and require an issuer review. The contract stores the numeric strike; it cannot trust an unauthenticated off-chain price label.
- The premium is `ceil(strike / 10)` lamports per lot and is paid when the option is bought. Both strike and premium are immutable for that series. A buyer can lose the entire premium.
- Each purchase must include the registered treasury account. The program checks its current token balance against the committed floor before accepting the premium. A buyer cannot purchase new options after the treasury is already breached but before a separate default transaction is submitted.
- A holder may exercise a purchased lot before expiry by paying the strike. The contract atomically releases the matching escrowed token lot. No oracle is required: the holder decides whether exercise is economically useful.
- Unsold lots can be reclaimed by the issuer after the sale deadline. Unexercised sold lots can be reclaimed only after the exercise deadline, subject to the default rule below. All transfers and arithmetic must be checked in the on-chain program.

## Observable early-outflow default

The chain cannot infer that every wallet controlled by a developer has sold. A claim of automatic detection across undisclosed wallets would be false. V1 therefore defines a narrower, verifiable commitment: the issuer designates one treasury token account and a minimum token balance at series creation. If that account's balance falls below the committed floor before expiry, anyone may submit the account to trigger a default. Moving tokens for a benign reason also triggers this rule. Moving tokens from an undisclosed wallet does not.

After a valid default, each outstanding purchased option becomes a claim to its already reserved token lot without paying the strike. Claims are independent; one claimant cannot consume another holder's reserved lot. The issuer cannot reclaim those lots. The interface must call this a **registered-treasury outflow default**, not proof that every developer wallet was monitored or that a market sale occurred.

## Premiums and buybacks

Premiums are paid into a separate system-owned PDA controlled by the options program. The issuer funds its minimum rent reserve at series creation. After all option lots sell and before expiry, a keeper may invoke a constrained Pump bonding-curve buy using at most the recorded unspent premium. The keeper funds incidental Pump account rent separately. Bought tokens go to a distinct PDA-owned Token-2022 vault; this program has no withdrawal instruction for them. The contract caps the effective buy price at twice the series strike, inclusive of fees, and checks the token output and remaining premium balance. After expiry, a buyer can claim a pro-rata refund of unspent premiums, including the final rounding remainder. Once all premiums have been spent or refunded, anyone can return the residual rent reserve to the issuer. **This route has passed local-validator tests with both a test double and a dump of Pump's deployed mainnet SBF. The real-program test used a manually selected strike to verify route compatibility, not the full strike policy. PumpSwap after migration, funded devnet tests and independent review remain missing; do not use the current program with real premiums.**

## Release gates

1. Implement the program and browser client with deterministic account derivation and tests for purchases, exercise, expiry, outflow default, double claims, account substitution and overflow.
2. Repeat the local-validator paths on devnet with funded test wallets, including supported Token-2022 metadata extensions and adversarial accounts.
3. Arrange independent review of the program and exact economic terms before accepting mainnet collateral.
4. Deploy a new h/monhook program whose upgrade authority is controlled by the project owner; record the program ID, SBF digest, authority and transactions.
5. Read series directly from confirmed on-chain program accounts by Mint; the client already verifies owner, PDA, vault and account layout. The static GitHub Pages registry is not a writeable database and cannot by itself discover every same-name Mint. A complete same-name search still needs an independently verifiable Mint metadata index.
6. Enable the frontend actions only after the deployed program and required backend/indexer are verified. Privacy Rings integration is a separate release and needs a Helius integration account.
