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

The same published **legacy Jolt Guard** SBF digest is deployed on mainnet and devnet. The mainnet deployment is executable and independently inspectable, but it is not presented as independently audited. The separate h/monhook Guard and options programs have temporary Devnet deployments only; their byte identity and invalid-instruction smoke checks do not establish a safe money path. Integrators should review the applicable program, adapters and deployment manifest before enabling production value.

The `options-custody-v3` development branch replaces the freely controlled issuer-account balance check with a separately registered, program-controlled token account. An issuer withdrawal before expiry marks that series in default in the same transaction, so a later refill cannot erase the event. This covers only tokens actually deposited into that custody account; the contract cannot identify unrelated wallets owned by the same developer. V3 has not passed a funded public-cluster lifecycle or independent review and is not enabled on the public site.

## Reporting

Do not publish an exploitable issue before maintainers can respond. Send a minimal reproduction and affected commit to the project through the repository's private security advisory workflow. Include transaction signatures only when they contain no private material.
