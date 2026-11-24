# Security model

## Protected invariants

- The authority must sign the outer transaction.
- The intent expires at a specific slot.
- The intent ID commits to constraints, account order, route indices, hook indices and instruction bytes.
- Source spend cannot exceed `maxInput`.
- Destination receipt cannot fall below `minOutput`.
- Route and hook program accounts cannot be smuggled back as ordinary CPI data accounts.
- Arithmetic uses checked balance differences.

## Integration risks

Adapters are part of the security boundary. A malicious or incorrectly decoded route instruction can select unintended accounts even when the guard itself behaves correctly. Production adapters should pin known program IDs, validate writable/signing roles and test adversarial account layouts.

The published **h/monhook Guard** SBF is deployed on mainnet at `Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ`; its deployed bytes match SHA-256 `f90a8834e85f0e7094aa387000dbcf5e4c337f9cbc160eb537d2b6d36559776c` and the project management wallet retains upgrade authority. This is an executable, inspectable deployment, not an independent audit or a funded end-to-end Jupiter trade test. The earlier Jolt Guard deployments remain separately documented. The h/monhook options program has no mainnet deployment and must not accept user collateral or premiums. Integrators should review the applicable program, adapters and deployment manifest before enabling production value.

The `options-custody-v3` development branch replaces the freely controlled issuer-account balance check with a separately registered, program-controlled token account. An issuer withdrawal before expiry marks that series in default in the same transaction, so a later refill cannot erase the event. This covers only tokens actually deposited into that custody account; the contract cannot identify unrelated wallets owned by the same developer. V3 has not passed a funded public-cluster lifecycle or independent review and is not enabled on the public site.

## Reporting

Do not publish an exploitable issue before maintainers can respond. Send a minimal reproduction and affected commit to the project through the repository's private security advisory workflow. Include transaction signatures only when they contain no private material.
