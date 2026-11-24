#!/usr/bin/env bash
# Disposable local-validator funding rehearsal. Never reads production keys or sends mainnet transactions.
set -euo pipefail
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

root="$(cd "$(dirname "$0")/.." && pwd)"
guard="$root/.local-deploy/release-review/guard/hmonhook_guard.so"
options="$root/.local-deploy/release-review/options-v3/hmonhook_options.so"
test -f "$guard"
test -f "$options"

work="$(mktemp -d /tmp/hmonhook-funding.XXXXXX)"
rpc=http://127.0.0.1:18899
cleanup() {
  if [[ -n "${validator_pid:-}" ]]; then kill "$validator_pid" 2>/dev/null || true; wait "$validator_pid" 2>/dev/null || true; fi
  rm -rf -- "$work"
}
trap cleanup EXIT

solana-keygen new --no-bip39-passphrase --silent --outfile "$work/payer.json" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --outfile "$work/guard.json" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --outfile "$work/options.json" >/dev/null
payer_address="$(solana-keygen pubkey "$work/payer.json")"
guard_address="$(solana-keygen pubkey "$work/guard.json")"
options_address="$(solana-keygen pubkey "$work/options.json")"

solana-test-validator --ledger "$work/ledger" --rpc-port 18899 --faucet-port 18999 >"$work/validator.log" 2>&1 &
validator_pid=$!
for i in {1..60}; do
  if solana --url "$rpc" cluster-version >/dev/null 2>&1; then break; fi
  sleep 1
done
solana --url "$rpc" cluster-version >/dev/null
solana --url "$rpc" airdrop "${1:-1.1999945}" "$payer_address" >/dev/null

balance() { solana --url "$rpc" balance "$payer_address" --lamports | awk '{print $1}'; }
printf 'initial_lamports=%s\n' "$(balance)"
printf 'guard_address=%s\noptions_address=%s\n' "$guard_address" "$options_address"

deploy_failed=0
for kind in guard options; do
  if [[ "$kind" == guard ]]; then binary="$guard"; program_key="$work/guard.json"; else binary="$options"; program_key="$work/options.json"; fi
  printf '%s_deploy_start_lamports=%s\n' "$kind" "$(balance)"
  if solana --url "$rpc" --keypair "$work/payer.json" program deploy --program-id "$program_key" "$binary" >"$work/$kind.deploy.log" 2>&1; then
    printf '%s_deploy_result=success\n' "$kind"
  else
    printf '%s_deploy_result=failed\n' "$kind"
    grep '^Error:' "$work/$kind.deploy.log" | tail -n 1 || true
    printf '%s_deploy_failed_balance_lamports=%s\n' "$kind" "$(balance)"
    deploy_failed=1
    break
  fi
  printf '%s_deploy_end_lamports=%s\n' "$kind" "$(balance)"
done

# Loader v3 rejects closure in the same block as deployment.
sleep 2
for kind in options guard; do
  if [[ "$kind" == options ]]; then program_address="$options_address"; else program_address="$guard_address"; fi
  if solana --url "$rpc" program show "$program_address" >/dev/null 2>&1; then
    if solana --url "$rpc" --keypair "$work/payer.json" program close "$program_address" --bypass-warning --recipient "$payer_address" >"$work/$kind.close.log" 2>&1; then
      printf '%s_close_end_lamports=%s\n' "$kind" "$(balance)"
    else
      printf '%s_close_result=failed\n' "$kind"
      tail -n 5 "$work/$kind.close.log"
    fi
  fi
done
if solana --url "$rpc" --keypair "$work/payer.json" program close --buffers --bypass-warning --recipient "$payer_address" >"$work/buffers.close.log" 2>&1; then
  printf 'buffers_close_end_lamports=%s\n' "$(balance)"
else
  printf 'buffers_close_result=failed\n'
  tail -n 5 "$work/buffers.close.log"
fi
printf 'final_lamports=%s\n' "$(balance)"
if [[ "$deploy_failed" == 1 ]]; then exit 2; fi
