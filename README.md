# h/monhook

Public issuer commitments, transaction-bound settlement and an optional privacy direction for Solana. The implemented mainnet settlement core is the h/monhook Guard; issuer options and Privacy Rings remain separate development and integration work. See [product scope](docs/PRODUCT_SCOPE.md) for the exact boundary.

h/monhook is not a block explorer. Its Guard changes whether a supported route is allowed
to settle. A user signs maximum-input, minimum-output and expiry constraints;
the program executes the route through CPI and atomically rejects settlement if
the realized token-account deltas violate the intent.

## Current Guard and code lineage

The supported website trade path uses the h/monhook Guard at
[`Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ`](https://explorer.solana.com/address/Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ).
Its on-chain binary matches SHA-256 `f90a8834e85f0e7094aa387000dbcf5e4c337f9cbc160eb537d2b6d36559776c`;
the project management wallet retains upgrade authority. The website checks that binary and authority before asking for a protected swap signature. A read-only live Jupiter simulation succeeded, but no signed user swap or independent audit is claimed.

The current `hmonhook-sdk` uses the `HMON` instruction format and `HRC1` receipt. The earlier Jolt Guard and SDK remain published for code lineage:

- programs/jolt-guard: native Rust Solana program.
- sdk/src/codec.ts: canonical intent commitment and JOLT V1 wire encoder.
- sdk/src/instruction.ts: ordered account assembly and privilege deduplication.
- sdk/src/adapters/jupiter.ts: validated Jupiter v6 route adapter.
- sdk/src/receipt.ts: JRC1 settlement receipt decoder.
- JOLT_GUARD.md: wire format, accounts and policy-hook interface.
- docs: architecture, integration, security and operations guides.

The program supports optional PRE and POST policy hooks. A policy program can
reject a route based on its own payload and accounts. Successful execution
returns a compact JRC1 receipt containing the intent id, realized input and
realized output.

The SDK includes a Jupiter v6 adapter that rejects unexpected route program
ids, verifies that the selected settlement accounts are writable in the swap
instruction, and wraps the exact route bytes in a canonical JOLT intent.

## Web product

- index.html and app.js: public h/monhook interface.
- dist/index.html: single-file build with embedded visual assets.
- bundle.py: regenerates the single-file build.

Run the site locally with:

    python -m http.server 8000

Build and test the SDK with:

    cd sdk
    npm ci
    npm test

Check all public routes and repository-browser controls with:

    npm run test:site

Verify a live program account and deployed SBF digest with:

    npm run verify:devnet
    npm run verify:mainnet

Test the on-chain program with:

    cargo test --manifest-path programs/jolt-guard/Cargo.toml

## Deployment

GitHub Pages serves the repository root. The protocol CI compiles the Rust
program and TypeScript SDK independently from the static-site deployment.

Jolt Guard is deployed on Solana devnet at
[`3gAqr1U9CzYhZBoqDJeEQFtphjVGvr24h4znUK2knfVG`](https://explorer.solana.com/address/3gAqr1U9CzYhZBoqDJeEQFtphjVGvr24h4znUK2knfVG?cluster=devnet).
The source commit, loader, program-data account and SBF SHA-256 are recorded in
[`deployments/devnet.json`](deployments/devnet.json). This Kora-sponsored
deployment is an integration target, not a mainnet production claim; Kora may
reclaim devnet programs after seven days without on-chain activity.

The earlier Jolt Guard mainnet deployment remains at
[`6HfEuWvEmargNraXeqCiqCZRJ223kGjxsCB7H9S3ENTY`](https://explorer.solana.com/address/6HfEuWvEmargNraXeqCiqCZRJ223kGjxsCB7H9S3ENTY).
Its ProgramData address, deployment signature, upgrade authority and matching
SBF digest are published in [`deployments/mainnet.json`](deployments/mainnet.json).
