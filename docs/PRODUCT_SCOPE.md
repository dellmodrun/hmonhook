# h/monhook product scope

h/monhook connects three decisions across a token's lifecycle: what an issuer commits to before trading, what outcome a trader authorizes during a supported route, and whether a later user transfer should be confidential. These decisions have different contracts, evidence and release states. They are not one automatic protection switch.

## Code lineage and deployment identity

h/monhook reuses the earlier Joltwork Guard implementation for its currently deployed trade path. The `programs/jolt-guard` source, `sdk` package, `JOLT` wire marker and `JRC1` receipt format belong to that earlier protocol. The existing mainnet and devnet Program IDs in `deployments/mainnet.json` and `deployments/devnet.json` identify Jolt Guard deployments built from source commit `d1f21ed424a880479d11417a5ccce27de47d7fc8`. Publishing the h/monhook site did not change those binaries, addresses or their upgrade authorities. The new `programs/hmonhook-guard` and `hmonhook-sdk` in the development branch use h/monhook's own wire marker and are not mainnet deployments. The legacy SDK's four test suites currently contain 11 passing tests; the new SDK is tested separately.

## Current release

Jolt Guard is the implemented settlement core. Its Solana program is deployed on mainnet and devnet. It binds a signer, route, expiry, maximum input and minimum output to a JOLT V1 instruction. A supported route is invoked through CPI; the guard reloads token accounts and rejects a result outside the signed bounds. The SDK includes a Jupiter adapter, and the browser provides a Jupiter quote and protected-swap assembly path. Deployment and integration do not replace an independent audit or production monitoring.

The launcher can create a Token-2022 coin through Pump `create_v2` after wallet approval. Its JLM1 output is a local plan. The Pump creation transaction does **not** publish or enforce the selected default Jolt policy. The browser's JLM1 plan hash and trade preview hash are local JSON digests, not on-chain JOLT intent identifiers.

Markets shows receipts saved on the creator's device, entries deliberately published in the registry, and any Mint entered by a visitor. Third-party indexing supplies observed market figures. A search result does not prove issuer identity, supply lock or protection status.

## Issuer accountability: design stage

The proposed issuer module adapts the Vamend mechanism. Same-name token Mints would appear side by side so a buyer can compare the developer, Mint, verified lock, option coverage and protection state. A coin without a valid lock would remain visible and marked unlocked.

The proposed terms allow a developer to lock 2%–10% of supply and sell options, while separately registering tokens in program custody. The premium is 10% of the strike price per option; the strike follows a Pump-style bonding-curve rule. If the market exceeds the strike, an eligible holder could exercise at the strike. If it never does, the holder risks the premium. An issuer withdrawal of registered tokens before expiry triggers collateral forfeiture for eligible option holders. This rule does not detect sales from unrelated wallets. Once the locked allocation is sold out, premiums could fund market buybacks through a separate reviewed route.

This module is not available through the public h/monhook product. The earlier V2 SBF is temporarily deployed on Devnet through Kora; V3 has not been deployed to a public cluster. No current market card, launch transaction or Jolt Guard receipt proves a V3 issuer lock, option position or claim. The development branch has browser forms to review issuer locks and inspect, buy or settle a series, but `options/program.json` disables every signing action until a verified mainnet program is configured. A production version still needs an independent security review, funded public-cluster transaction validation, an indexer for same-name comparisons and production operations.

The `options-custody-v3` development branch separates the 2%–10% option collateral from an additional issuer-declared token allocation held in program custody. An issuer withdrawal before expiry atomically records default for that series; unrelated wallets are not monitored. The earlier V2 binary was tested with Pump curve and PumpSwap buyback routes, but those results do not validate the changed V3 binary. Acquired buyback tokens remain in a separate vault; buyers can claim eligible unspent premiums after expiry. Local-validator lifecycle tests, funded public-cluster tests, real pool checks and independent review remain before real option purchases.

The browser suggests a curve-derived strike and rechecks its quote before signing. The development program now reads the canonical Pump curve and rejects a different strike at series initialization. This change still needs a funded public-cluster transaction and independent review before the options release is enabled.

## Optional user privacy: integration planned

Helius's [Solana Privacy Rings documentation](https://www.helius.dev/docs/privacy) says its permissionless default Ring is live on mainnet. The default Ring conceals asset and amount while sender and recipient addresses remain visible; custom anonymous Rings are a separate product. Helius's [current documentation index](https://www.helius.dev/docs/llms.txt) lists an API key and SDK as integration requirements. h/monhook has not integrated these transfers into the launcher, intent composer or Guard program, and has not verified a real private transaction through its own interface.

Issuer collateral, option terms and evidence of an alleged violation need to stay verifiable. A confidential transfer cannot be treated as proof of a developer sale, and hidden amounts cannot be advertised as automatically monitored. Any future private payout or transfer flow must preserve the public facts needed to adjudicate claims.

## How the layers meet

1. **Before:** compare the issuer's public commitment and option terms. This layer is a design proposal.
2. **During:** sign limits for a supported route and let Jolt Guard check the actual result. This is the implemented core, with adapter-specific support.
3. **After:** choose an eligible confidential transfer without concealing evidence that protection claims depend on. This integration is planned.

The official h/monhook token Mint remains TBA. None of these layers implies a price guarantee or support for every Solana token, router or wallet.
