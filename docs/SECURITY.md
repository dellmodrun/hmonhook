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

The h/monhook Guard is executable on mainnet at `Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ`; its deployed SBF matches SHA-256 `f90a8834e85f0e7094aa387000dbcf5e4c337f9cbc160eb537d2b6d36559776c` and retains the project management wallet as upgrade authority. A read-only mainnet Jupiter simulation executed it and produced an `HMON_RECEIPT`. This is not an independent audit or a signed user transaction test. The earlier Jolt Guard remains documented separately. Integrators should review the applicable program, adapters and deployment manifest before enabling production value.

## Reporting

Do not publish an exploitable issue before maintainers can respond. Send a minimal reproduction and affected commit to the project through the repository's private security advisory workflow. Include transaction signatures only when they contain no private material.
