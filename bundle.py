"""Bundle index.html into a single self-contained file by inlining all
external assets (fonts, images, favicon) as base64 data: URIs."""
import base64
import os
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

def b64(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")

assets = {
    "./fonts/eb-garamond-regular.woff2":   ("font/woff2",     ROOT / "fonts/eb-garamond-regular.woff2"),
    "./fonts/eb-garamond-italic.woff2":    ("font/woff2",     ROOT / "fonts/eb-garamond-italic.woff2"),
    "./fonts/jetbrains-mono-regular.woff2":("font/woff2",     ROOT / "fonts/jetbrains-mono-regular.woff2"),
    "./hmonhook.png":                      ("image/png",      ROOT / "hmonhook.png"),
    "./favicon.svg":                       ("image/svg+xml",  ROOT / "favicon.svg"),
}

app = (ROOT / "app.js").read_text(encoding="utf-8")
wallet_icons = (ROOT / "wallet-icons.js").read_text(encoding="utf-8")
launch_client = (ROOT / "launch-client.js").read_text(encoding="utf-8")
intent_client = (ROOT / "intent-client.js").read_text(encoding="utf-8")
markets_client = (ROOT / "markets.js").read_text(encoding="utf-8")
home_markets_client = (ROOT / "home-markets.js").read_text(encoding="utf-8")
styles = (ROOT / "styles.css").read_text(encoding="utf-8")
enhancements = (ROOT / "enhancements.css").read_text(encoding="utf-8")
sources = [ROOT / "index.html"] + [ROOT / name / "index.html" for name in ("launch", "markets", "intent", "protocol", "code", "research")]

for src in sources:
    html = src.read_text(encoding="utf-8")
    html = re.sub(r'<script src="\./app\.js">\s*</script>', lambda _: "<script>" + app + "</script>", html)
    html = re.sub(r'<script src="\./wallet-icons\.js">\s*</script>', lambda _: "<script>" + wallet_icons + "</script>", html)
    html = re.sub(r'<script src="\./launch-client\.js">\s*</script>', lambda _: "<script>" + launch_client + "</script>", html)
    html = re.sub(r'<script src="\./intent-client\.js">\s*</script>', lambda _: "<script>" + intent_client + "</script>", html)
    html = re.sub(r'<script src="\./markets\.js">\s*</script>', lambda _: "<script>" + markets_client + "</script>", html)
    html = re.sub(r'<script src="\./home-markets\.js">\s*</script>', lambda _: "<script>" + home_markets_client + "</script>", html)
    html = html.replace('<link rel="stylesheet" href="./styles.css">', "<style>" + styles + "</style>")
    html = html.replace('<link rel="stylesheet" href="./enhancements.css">', "<style>" + enhancements + "</style>")
    replacements = 0
    for url, (mime, path) in assets.items():
        if not path.exists():
            print(f"WARN missing asset: {path}")
            continue
        data_uri = f"data:{mime};base64,{b64(path)}"
        before = html.count(url)
        html = html.replace(url, data_uri)
        replacements += before - html.count(url)

    relative = src.relative_to(ROOT)
    out = DIST / relative
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{relative!s:24s} -> {out.relative_to(ROOT)} ({replacements} URLs, {out.stat().st_size / 1024:.1f} KB)")

registry_source = ROOT / "markets" / "registry.json"
registry_output = DIST / "markets" / "registry.json"
registry_output.parent.mkdir(parents=True, exist_ok=True)
registry_output.write_text(registry_source.read_text(encoding="utf-8"), encoding="utf-8")

registry_service_source = ROOT / "markets" / "registry-service.json"
registry_service_output = DIST / "markets" / "registry-service.json"
registry_service_output.write_text(registry_service_source.read_text(encoding="utf-8"), encoding="utf-8")

metadata_service_source = ROOT / "launch" / "metadata-service.json"
metadata_service_output = DIST / "launch" / "metadata-service.json"
metadata_service_output.write_text(metadata_service_source.read_text(encoding="utf-8"), encoding="utf-8")
test_metadata_source = ROOT / "markets" / "test-token" / "metadata.json"
test_metadata_output = DIST / "markets" / "test-token" / "metadata.json"
test_metadata_output.parent.mkdir(parents=True, exist_ok=True)
test_metadata_output.write_text(test_metadata_source.read_text(encoding="utf-8"), encoding="utf-8")

# The code browser fetches these files by path. Keep the standalone build usable.
published_source_paths = (
    "programs/jolt-guard/src/lib.rs", "programs/jolt-guard/Cargo.toml",
    "sdk/src/index.ts", "sdk/src/constants.ts", "sdk/src/types.ts",
    "sdk/src/codec.ts", "sdk/src/instruction.ts", "sdk/src/receipt.ts",
    "sdk/src/adapters/jupiter.ts", "sdk/test/codec.test.js",
    "sdk/test/instruction.test.js", "sdk/test/jupiter.test.js",
    "sdk/test/receipt.test.js", "launch-client.ts", "intent-client.ts",
    "app.js", "build-client.mjs", "markets.js", "markets/registry.json",
    "package.json", "sdk/package.json", "deployments/devnet.json",
    "deployments/mainnet.json", "scripts/verify-deployment.mjs",
    "scripts/check-site.mjs", "README.md", "docs/PRODUCT_SCOPE.md",
    "docs/ARCHITECTURE.md", "docs/INTEGRATION.md", "docs/SECURITY.md",
    "docs/OPERATIONS.md", "JOLT_GUARD.md", "CONTRIBUTING.md",
)
for relative_path in published_source_paths:
    source = ROOT / relative_path
    output = DIST / relative_path
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, output)
