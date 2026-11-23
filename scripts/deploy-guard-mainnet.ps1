param([switch]$Deploy)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$keyDir = Join-Path $env:APPDATA 'hmonhook\keys'
$managementKey = Join-Path $keyDir 'management-keypair.json'
$programKey = Join-Path $keyDir 'guard-program-keypair.json'
$programBinary = Join-Path $repo 'programs\hmonhook-guard\target\deploy\hmonhook_guard.so'
$expectedManagement = 'DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG'
$expectedProgram = 'Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ'

foreach ($file in @($managementKey, $programKey, $programBinary)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing required local file: $file" }
}

function Get-PublicKey([string]$file) {
    $env:HMONHOOK_KEYFILE = $file
    $result = node -e "const fs=require('fs');const {Keypair}=require('@solana/web3.js');console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HMONHOOK_KEYFILE,'utf8')))).publicKey.toBase58())"
    if ($LASTEXITCODE -ne 0) { throw "Could not read public key from $file" }
    return $result.Trim()
}

if ((Get-PublicKey $managementKey) -ne $expectedManagement) { throw 'Unexpected management wallet' }
if ((Get-PublicKey $programKey) -ne $expectedProgram) { throw 'Unexpected Guard program ID' }
$binary = Get-Item -LiteralPath $programBinary
$digest = (Get-FileHash -LiteralPath $programBinary -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Output "Management wallet: $expectedManagement"
Write-Output "Guard program ID: $expectedProgram"
Write-Output "Guard SBF: $($binary.Length) bytes, SHA-256 $digest"
if (-not $Deploy) {
    Write-Output 'Inspection only. Mainnet deployment is reserved for the unified h/monhook release.'
    exit 0
}

throw 'Standalone Guard deployment is disabled. Complete and verify the full h/monhook release, then deploy all programs and services together.'
