# h/monhook issuer options v1: implementation contract

This document fixes the financial rules that were previously only marketing copy. It is a proposed implementation specification, **not a deployed contract**. No interface may label a coin protected until its deployed program, escrow balance, terms and issuer commitment are verified on-chain.

The development branch contains a native Rust program under `programs/hmonhook-options` and a transaction builder in `options-client.mjs`. These are development artifacts. A disposable local Solana validator has exercised opening, purchase, exercise, registered treasury outflow default, claim, duplicate-claim rejection, early reclaim of unsold lots, continued exercise of sold lots, expiry and final issuer reclaim with Token-2022 accounts. This is not a funded devnet test, an independent security review, or evidence that mainnet deployment is safe.

## Series and collateral

- One series is identified by a token Mint, issuer wallet and unique series number. The issuer signs its creation.
- The issuer deposits tokens into a program-controlled vault before options can be sold. The deposit is exactly 2% to 10% of the Mint supply observed at creation, measured in base units. The contract rejects a Mint whose supply can be increased by an active mint authority, and rejects a deposit below one whole token.
- V1 accepts Token-2022 Mints only when mint/freeze authority is removed and their extensions are limited to descriptive metadata or group data. Transfer fees, transfer hooks, permanent delegates, pause authority and confidential-balance extensions are rejected because they can make the escrowed lot unavailable or underdeliver it. The program also checks the exact token amount received by the vault and buyer.
- The vault has no issuer withdrawal instruction while active options remain. The contract records the deposited amount, Mint, issuer, price terms, sale deadline and exercise deadline immutably.
- A series with no escrow, an invalid Mint or no verified transaction is shown as **unlocked**. A name or ticker does not make it official.

## Option purchase and exercise

- One option lot represents one whole token, using the Mint's recorded decimals. Fractional lots are not sold in v1. The number of lots cannot exceed the vault's whole-token balance.
- The strike is a fixed number of lamports per lot, committed when the issuer opens the series. The creation interface derives a suggested strike from a published Pump bonding-curve snapshot and displays the exact slot, accounts and arithmetic. The contract stores the numeric strike; it cannot trust an unauthenticated off-chain price label.
- The premium is `ceil(strike / 10)` lamports per lot and is paid when the option is bought. Both strike and premium are immutable for that series. A buyer can lose the entire premium.
- A holder may exercise a purchased lot before expiry by paying the strike. The contract atomically releases the matching escrowed token lot. No oracle is required: the holder decides whether exercise is economically useful.
- Unsold lots can be reclaimed by the issuer after the sale deadline. Unexercised sold lots can be reclaimed only after the exercise deadline, subject to the default rule below. All transfers and arithmetic must be checked in the on-chain program.

## Observable early-outflow default

The chain cannot infer that every wallet controlled by a developer has sold. A claim of automatic detection across undisclosed wallets would be false. V1 therefore defines a narrower, verifiable commitment: the issuer designates one treasury token account and a minimum token balance at series creation. If that account's balance falls below the committed floor before expiry, anyone may submit the account to trigger a default. Moving tokens for a benign reason also triggers this rule. Moving tokens from an undisclosed wallet does not.

After a valid default, each outstanding purchased option becomes a claim to its already reserved token lot without paying the strike. Claims are independent; one claimant cannot consume another holder's reserved lot. The issuer cannot reclaim those lots. The interface must call this a **registered-treasury outflow default**, not proof that every developer wallet was monitored or that a market sale occurred.

## Premiums and buybacks

Premiums currently remain in the series' program-controlled SOL account. **There is no release, buyback, or refund instruction for those funds. Do not use the current program with real premiums.** The earlier text promised market buybacks after all locked tokens sold, but a safe buyback needs a specific router, slippage bound, destination token account, deadline, and execution permissions. Until that route is implemented and tested, premiums cannot be advertised as automatically buying tokens. The contract must not expose an unrestricted issuer withdrawal of premium escrow.

## Release gates

1. Implement the program and browser client with deterministic account derivation and tests for purchases, exercise, expiry, outflow default, double claims, account substitution and overflow.
2. Repeat the local-validator paths on devnet with funded test wallets, including supported Token-2022 metadata extensions and adversarial accounts.
3. Arrange independent review of the program and exact economic terms before accepting mainnet collateral.
4. Deploy a new h/monhook program whose upgrade authority is controlled by the project owner; record the program ID, SBF digest, authority and transactions.
5. Read series directly from confirmed on-chain program accounts by Mint; the client already verifies owner, PDA, vault and account layout. The static GitHub Pages registry is not a writeable database and cannot by itself discover every same-name Mint. A complete same-name search still needs an independently verifiable Mint metadata index.
6. Enable the frontend actions only after the deployed program and required backend/indexer are verified. Privacy Rings integration is a separate release and needs a Helius integration account.
