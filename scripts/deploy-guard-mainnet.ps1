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
    Write-Output 'Preflight only. Use -Deploy after funding and the remaining release checks.'
    exit 0
}

$env:HMONHOOK_MANAGEMENT_KEYFILE = $managementKey
$balance = node -e "const fs=require('fs');const {Connection,Keypair}=require('@solana/web3.js');const k=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HMONHOOK_MANAGEMENT_KEYFILE,'utf8'))));new Connection('https://api.mainnet-beta.solana.com','confirmed').getBalance(k.publicKey).then(x=>console.log(x)).catch(e=>{console.error(e.message);process.exit(1)})"
if ($LASTEXITCODE -ne 0) { throw 'Could not check mainnet balance' }
$lamports = [long]$balance.Trim()
if ($lamports -lt 400000000) { throw "Guard deployment preflight blocked: management wallet has $lamports lamports; at least 0.4 SOL is required by this conservative preflight." }

function Convert-ToWslPath([string]$path) {
    $resolved = (Resolve-Path -LiteralPath $path).Path
    $drive = $resolved.Substring(0, 1).ToLowerInvariant()
    return '/mnt/' + $drive + $resolved.Substring(2).Replace('\', '/')
}

$wslManagementKey = Convert-ToWslPath $managementKey
$wslProgramKey = Convert-ToWslPath $programKey
$wslProgramBinary = Convert-ToWslPath $programBinary
wsl -d Ubuntu-24.04 -e /root/.local/share/solana/install/active_release/bin/solana program deploy $wslProgramBinary --program-id $wslProgramKey --keypair $wslManagementKey --upgrade-authority $wslManagementKey --url mainnet-beta --use-rpc
if ($LASTEXITCODE -ne 0) { throw 'Guard deployment failed; inspect any leftover buffer account before retrying.' }
wsl -d Ubuntu-24.04 -e /root/.local/share/solana/install/active_release/bin/solana program show $expectedProgram --url mainnet-beta
if ($LASTEXITCODE -ne 0) { throw 'Guard deployed but post-deploy verification failed.' }
