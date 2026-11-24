# h/monhook product scope

h/monhook connects three decisions across a token's lifecycle: what an issuer commits to before trading, what outcome a trader authorizes during a supported route, and whether a later user transfer should be confidential. These decisions have different contracts, evidence and release states. They are not one automatic protection switch.

## Code lineage and deployment identity

h/monhook builds on the earlier Joltwork Guard implementation. The `programs/jolt-guard` source, `sdk` package, `JOLT` wire marker and `JRC1` receipt format belong to that earlier protocol. The existing mainnet and devnet Program IDs in `deployments/mainnet.json` and `deployments/devnet.json` identify those Jolt Guard deployments built from source commit `d1f21ed424a880479d11417a5ccce27de47d7fc8`. The new h/monhook Guard and SDK use the `HMON` instruction format and `HRC1` receipt. The new Guard was deployed on mainnet at `Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ`; `deployments/hmonhook-mainnet.json` records its verified binary hash and retained upgrade authority. The older programs were not renamed or overwritten.

## Current release

h/monhook Guard is the current settlement core on mainnet. It binds a signer, route, expiry, maximum input and minimum output to an `HMON` V1 instruction. A supported route is invoked through CPI; the Guard reloads token accounts and rejects a result outside the signed bounds. The SDK includes a Jupiter adapter, and the browser assembles a supported protected swap after verifying the deployed binary. Deployment and integration do not replace an independent audit or production monitoring.

The launcher can create a Token-2022 coin through Pump `create_v2` after wallet approval. Its JLM1 output is a local plan. The Pump creation transaction does **not** publish or enforce a default Guard policy. The browser's JLM1 plan hash and trade preview hash are local JSON digests, not on-chain `HMON` intent identifiers.

Markets shows receipts saved on the creator's device, entries deliberately published in the registry, and any Mint entered by a visitor. Third-party indexing supplies observed market figures. A search result does not prove issuer identity, supply lock or protection status.

## Issuer accountability: design stage

The proposed issuer module adapts the Vamend mechanism. Same-name token Mints would appear side by side so a buyer can compare the developer, Mint, verified lock, option coverage and protection state. A coin without a valid lock would remain visible and marked unlocked.

The proposed terms allow a developer to lock 2%–10% of supply and sell options. The proposed premium is 10% of the strike price per option; the strike would follow a published Pump-style bonding-curve rule. Exact arithmetic, expiry, exercise, collateral and payout rules must be fixed in a reviewed contract before use. If the market exceeds the strike, an eligible holder could exercise at the strike. If it never does, the holder risks the premium. A verified developer sale before expiry could trigger forfeiture of locked collateral to eligible option holders. Once the locked allocation is sold out, premiums could fund market buybacks through a separate reviewed route.

This module is not deployed through h/monhook. No current market card, launch transaction or Guard receipt proves an issuer lock, option position, sale violation or claim. A production version needs audited contracts, an independently reviewable evidence and attestation path, an indexer and an explicit user interface for each right and risk.

## Optional user privacy: integration planned

Helius Privacy Rings are an external technology that may support confidential transfers for eligible user assets. According to Helius's [Privacy Rings explanation](https://www.helius.dev/blog/solana-privacy-rings), the default Ring can conceal asset and amount while wallet addresses remain visible. h/monhook has not integrated these transfers into the launcher, intent composer or Guard program.

Issuer collateral, option terms and evidence of an alleged violation need to stay verifiable. A confidential transfer cannot be treated as proof of a developer sale, and hidden amounts cannot be advertised as automatically monitored. Any future private payout or transfer flow must preserve the public facts needed to adjudicate claims.

## How the layers meet

1. **Before:** compare the issuer's public commitment and option terms. This layer is a design proposal.
2. **During:** sign limits for a supported route and let h/monhook Guard check the actual result. This is the implemented core, with adapter-specific support.
3. **After:** choose an eligible confidential transfer without concealing evidence that protection claims depend on. This integration is planned.

The official h/monhook token Mint remains TBA. None of these layers implies a price guarantee or support for every Solana token, router or wallet.
