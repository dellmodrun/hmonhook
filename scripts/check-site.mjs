import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pages = ["index.html", "launch/index.html", "markets/index.html", "intent/index.html", "protocol/index.html", "code/index.html", "research/index.html"];
for (const page of pages) assert.ok(existsSync(resolve(root, page)), `missing route: ${page}`);
assert.ok(!existsSync(resolve(root, "CNAME")), "copied site must not claim the original custom domain");

for (const page of pages) {
  const html = readFileSync(resolve(root, page), "utf8");
  assert.ok(html.includes('href="https://x.com/hmonhook"'), `current X account missing in ${page}`);
  assert.ok(!html.includes("x.com/Joltworkrunit"), `old X account remains in ${page}`);
  const baseAtRoot = /<base\s+href=["']\.\.\/["']/i.test(html);
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|tel:|#)/i.test(href)) continue;
    if (baseAtRoot && href === "../") continue;
    const clean = href.split(/[?#]/, 1)[0];
    const target = baseAtRoot ? resolve(root, clean) : resolve(dirname(resolve(root, page)), clean);
    const fileTarget = clean.endsWith("/") ? resolve(target, "index.html") : target;
    assert.ok(existsSync(fileTarget), `broken local link in ${page}: ${href}`);
    const fragment = href.split("#")[1];
    if (fragment) {
      const targetHtml = readFileSync(fileTarget, "utf8");
      assert.ok(targetHtml.includes(`id="${decodeURIComponent(fragment)}"`), `broken section link in ${page}: ${href}`);
    }
  }
}

const code = readFileSync(resolve(root, "code/index.html"), "utf8");
const protocol = readFileSync(resolve(root, "protocol/index.html"), "utf8");
const legacySdkTests = ["codec", "instruction", "jupiter", "receipt"].reduce((count, name) => {
  const source = readFileSync(resolve(root, `sdk/test/${name}.test.js`), "utf8");
  return count + [...source.matchAll(/^test\(/gm)].length;
}, 0);
assert.ok(legacySdkTests > 0, "legacy SDK test count was not found");
assert.ok(code.includes(`LEGACY SDK TESTS<b>${legacySdkTests} PASSING`), "Source Code SDK test count differs from the test files");
assert.ok(protocol.includes(`LEGACY GUARD / ${legacySdkTests} SDK TESTS PASSING`), "Protocol SDK test count differs from the test files");
assert.match(code, /Code lineage and deployment:/, "Source Code does not explain the Jolt inheritance");
assert.match(protocol, /currently deployed Guard is the earlier Jolt Guard/, "Protocol does not identify the deployed legacy program");
for (const id of ["code-view", "code-filter", "code-copy", "code-download"]) {
  assert.match(code, new RegExp(`id=["']${id}["']`), `code browser missing ${id}`);
}
const app = readFileSync(resolve(root, "app.js"), "utf8");
const marketsClient = readFileSync(resolve(root, "markets.js"), "utf8");
assert.ok(existsSync(resolve(root, "docs/PRODUCT_SCOPE.md")), "product scope document missing");
assert.match(app, /productScope: "docs\/PRODUCT_SCOPE\.md"/, "source browser cannot open product scope");
assert.match(app, /local-proposal-not-published/, "launcher must mark the policy plan as local");
assert.match(app, /localPreviewHash/, "trade preview must not use the on-chain intent ID label");
assert.match(app, /Trade changed\. Get a fresh quote/, "editing a trade must invalidate the signing preview");
assert.match(app, /3gAqr1U9CzYhZBoqDJeEQFtphjVGvr24h4znUK2knfVG|codePaths/);
const home = readFileSync(resolve(root, "index.html"), "utf8");
assert.match(home, /id=["']official-ca["']>TBA</, "official CA placeholder missing from home page");
assert.ok(!home.match(/id=["']official-ca["']>[1-9A-HJ-NP-Za-km-z]{32,44}</), "a live official CA remains on home page");
const publicFrontend = [...pages.map((page) => readFileSync(resolve(root, page), "utf8")), app, marketsClient].join("\n");
for (const forbidden of ["github.com", "raw.githubusercontent.com", "dellmodrun", "github.io"]) {
  assert.ok(!publicFrontend.toLowerCase().includes(forbidden), `public frontend exposes forbidden host or account: ${forbidden}`);
}
const intent = readFileSync(resolve(root, "intent/index.html"), "utf8");
for (const id of ["intent-input-mint", "intent-output-mint", "intent-slippage", "intent-quote", "intent-submit"]) {
  assert.match(intent, new RegExp(`id=["']${id}["']`), `intent workbench missing ${id}`);
}
assert.match(app, /api\.jup\.ag\/swap\/v2\/order/, "intent workbench must use Jupiter Swap API V2");
assert.ok(existsSync(resolve(root, "intent-client.js")), "protected swap browser bundle missing");
const launch = readFileSync(resolve(root, "launch/index.html"), "utf8");
const metadataService = JSON.parse(readFileSync(resolve(root, "launch/metadata-service.json"), "utf8"));
assert.equal(typeof metadataService.endpoint, "string", "metadata upload endpoint configuration missing");
assert.ok(existsSync(resolve(root, "supabase/functions/metadata-upload/index.ts")), "metadata upload service source missing");
assert.ok(existsSync(resolve(root, "supabase/migrations/20261124_metadata_bucket.sql")), "metadata bucket migration missing");
if (existsSync(resolve(root, "dist"))) assert.ok(existsSync(resolve(root, "dist/launch/metadata-service.json")), "bundled site misses metadata upload configuration");
for (const id of ["coin-description", "coin-image", "coin-uri", "metadata-check", "launch-submit"]) {
  assert.match(launch, new RegExp(`id=["']${id}["']`), `launch workbench missing ${id}`);
}
for (const id of ["coin-upload-image", "coin-upload-description", "metadata-upload"]) {
  assert.match(launch, new RegExp(`id=["']${id}["']`), `launch metadata upload missing ${id}`);
}
assert.ok(!launch.includes('<option value="USDC">') && !launch.includes('<option value="PUMP_COIN">'), "launcher offers unsupported live quote assets");
assert.match(launch, /INTENDED POLICY \/ LOCAL PLAN/, "launcher policy status is unclear");
assert.match(launch, /id="issuer-protection"/, "issuer concept missing from launch page");
const markets = readFileSync(resolve(root, "markets/index.html"), "utf8");
for (const id of ["market-grid", "market-search", "market-refresh", "market-sort", "market-total"]) {
  assert.match(markets, new RegExp(`id=["']${id}["']`), `markets page missing ${id}`);
}
assert.match(marketsClient, /api\.dexscreener\.com\/tokens\/v1\/solana/, "markets must resolve live Solana market data");
assert.ok(!marketsClient.includes('source: "search", createdAt: Date.now()'), "market search must not invent a launch date");
assert.match(app, /joltwork\.launches\.v1/, "confirmed launches must be persisted for market discovery");
const marketRegistry = JSON.parse(readFileSync(resolve(root, "markets/registry.json"), "utf8"));
const registryService = JSON.parse(readFileSync(resolve(root, "markets/registry-service.json"), "utf8"));
assert.equal(typeof registryService.endpoint, "string", "launch registry endpoint configuration missing");
if (existsSync(resolve(root, "dist"))) assert.ok(existsSync(resolve(root, "dist/markets/registry-service.json")), "bundled site misses registry configuration");
assert.equal(marketRegistry.format, "JOLTWORK_MARKETS_V1", "unexpected markets registry format");
for (const launch of marketRegistry.launches) {
  assert.match(launch.mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "registry contains an invalid Solana Mint");
  if (launch.signature) assert.match(launch.signature, /^[1-9A-HJ-NP-Za-km-z]{64,88}$/, "registry contains an invalid transaction signature");
}
assert.ok(!marketRegistry.launches.some((launch) => launch.official), "an official token remains in markets registry while CA is TBA");
assert.ok(!marketRegistry.launches.some((launch) => launch.independent), "a removed independent launch remains in markets registry");
console.log(`site contract: ${pages.length} routes, live markets, live quote controls, metadata gate, same-origin code browser, no GitHub links, no custom domain`);
