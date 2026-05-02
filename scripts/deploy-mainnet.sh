
#!/usr/bin/env bash
# BagsCreatorFund — Deploy BCF contract to Solana MAINNET
# ─────────────────────────────────────────────────────────────────────────────
# WARNING: This deploys with REAL SOL. A 316K program costs ~2.3 SOL to deploy.
# Make sure your wallet has at least 3 SOL before running this.
#
# Usage (from WSL):
#   bash scripts/deploy-mainnet.sh
#
# After successful deployment:
#   1. Update .env: VITE_NETWORK=mainnet, VITE_SOLANA_RPC=https://api.mainnet-beta.solana.com
#   2. Update .env: VITE_BCF_PROGRAM_ID_MAINNET=<printed program id>
#   3. npm run build && npm run dev
# ─────────────────────────────────────────────────────────────────────────────
set -e

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${RED}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║   BagsCreatorFund — MAINNET Deployment               ║${NC}"
echo -e "${RED}║   This uses REAL SOL. Verify balance before proceed. ║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Switch to mainnet
solana config set --url mainnet-beta --commitment confirmed
echo -e "${GREEN}✓ Configured for Mainnet${NC}"

# Check balance
BALANCE_SOL=$(solana balance 2>/dev/null | awk '{print $1}')
echo "Wallet: $(solana address)"
echo "Balance: ${BALANCE_SOL} SOL"

if ! python3 -c "import sys; sys.exit(0 if float('${BALANCE_SOL:-0}') >= 3.0 else 1)" 2>/dev/null; then
  echo -e "${RED}✗ Insufficient funds. Need at least 3 SOL on Mainnet.${NC}"
  echo "  Fund: $(solana address)"
  exit 1
fi

echo -e "${GREEN}✓ Sufficient balance${NC}"
echo ""

# Ask for confirmation
read -p "$(echo -e "${YELLOW}Deploying to MAINNET with real SOL. Continue? [y/N]: ${NC}")" confirm
[ "$confirm" != "y" ] && { echo "Cancelled."; exit 0; }

BUILD_DIR="/tmp/bcf-anchor-build"
SBF_TARGET="/tmp/bcf-sbf-target"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANCHOR_DIR="$PROJECT_ROOT/anchor"

lockfile_v3() {
  local f="${1:-Cargo.lock}"
  [ -f "$f" ] || return 0
  sed -i 's/\r//' "$f" 2>/dev/null || true
  sed -i 's/^version = [0-9][0-9]*/version = 3/' "$f" 2>/dev/null || true
}

# Remove edition2024 crates (block-buffer ≥0.11, digest ≥0.11) from lock
clean_lockfile() {
  [ -f "Cargo.lock" ] || return 0
  python3 - << 'PYEOF'
import re
with open("Cargo.lock") as f: content = f.read()
parts = re.split(r'(?=^\[\[package\]\])', content, flags=re.MULTILINE)
header, pkgs = parts[0], parts[1:]
def bad(p):
    for name in ["block-buffer","digest"]:
        if re.search(rf'name\s*=\s*"{name}"', p):
            m = re.search(r'version\s*=\s*"(\d+)\.(\d+)', p)
            if m and (int(m.group(1)) > 0 or int(m.group(2)) >= 11): return True
    return False
kept = [p for p in pkgs if not bad(p)]
result = header + "".join(kept)
result = re.sub(r'"block-buffer 0\.1[1-9][^"]*"', '"block-buffer 0.10.4"', result)
result = re.sub(r'"digest 0\.1[1-9][^"]*"',       '"digest 0.10.7"',       result)
with open("Cargo.lock","w") as f: f.write(result)
PYEOF
}

echo -e "${YELLOW}[1/4] Building program...${NC}"
rm -rf "$BUILD_DIR" "$SBF_TARGET"
cp -r "$ANCHOR_DIR" "$BUILD_DIR"
cd "$BUILD_DIR"
grep -q 'members = \["programs/\*"\]' Anchor.toml 2>/dev/null && \
  sed -i 's|members = \["programs/\*"\]|members = ["programs/bags-creator-fund"]|' Anchor.toml
rm -rf target
cargo generate-lockfile 2>&1 | tail -2 || true
lockfile_v3 "Cargo.lock"
clean_lockfile

cd "$BUILD_DIR/programs/bags-creator-fund"
CARGO_TARGET_DIR="$SBF_TARGET" cargo-build-sbf 2>&1 | grep -E "^(   Compiling|    Finished|^error)" || true
cd "$BUILD_DIR"

FINAL_SO=""
for src in \
  "$SBF_TARGET/deploy/bags_creator_fund.so" \
  "$SBF_TARGET/bpfel-unknown-unknown/release/bags_creator_fund.so"; do
  [ -f "$src" ] && FINAL_SO="$src" && break
done
[ -z "$FINAL_SO" ] && echo -e "${RED}✗ Build failed${NC}" && exit 1
echo -e "${GREEN}✓ Build complete: $(du -sh "$FINAL_SO" | cut -f1)${NC}"

echo ""
echo -e "${YELLOW}[2/4] Resolving program keypair...${NC}"
KEYPAIR_FILE=""
for kp in \
  "$ANCHOR_DIR/target/deploy/bags_creator_fund-mainnet-keypair.json" \
  "$ANCHOR_DIR/target/deploy/bags_creator_fund-keypair.json"; do
  [ -f "$kp" ] && KEYPAIR_FILE="$kp" && break
done

if [ -z "$KEYPAIR_FILE" ]; then
  mkdir -p "$ANCHOR_DIR/target/deploy"
  KEYPAIR_FILE="$ANCHOR_DIR/target/deploy/bags_creator_fund-mainnet-keypair.json"
  solana-keygen new --no-passphrase --outfile "$KEYPAIR_FILE" --force
  echo -e "  ${GREEN}✓ New mainnet keypair generated${NC}"
fi

MAINNET_PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR_FILE")
echo -e "  ${GREEN}✓ Mainnet Program ID: $MAINNET_PROGRAM_ID${NC}"

# Patch declare_id in a temp copy
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$MAINNET_PROGRAM_ID\")/" \
  "$BUILD_DIR/programs/bags-creator-fund/src/lib.rs"

echo "  Final build with patched Mainnet ID..."
cargo generate-lockfile 2>/dev/null || true
lockfile_v3 "Cargo.lock"
clean_lockfile
cd "$BUILD_DIR/programs/bags-creator-fund"
CARGO_TARGET_DIR="$SBF_TARGET" cargo-build-sbf 2>&1 | grep -E "^(   Compiling|    Finished)" || true
cd "$BUILD_DIR"

for src in \
  "$SBF_TARGET/deploy/bags_creator_fund.so" \
  "$SBF_TARGET/bpfel-unknown-unknown/release/bags_creator_fund.so"; do
  [ -f "$src" ] && FINAL_SO="$src" && break
done

echo ""
echo -e "${YELLOW}[3/4] Deploying to Mainnet...${NC}"
# Close orphaned buffers first
solana program close --buffers --quiet 2>/dev/null || true

MAX_RETRIES=5
SUCCESS=false
for i in $(seq 1 $MAX_RETRIES); do
  echo "  Attempt $i / $MAX_RETRIES..."
  if solana program deploy \
      --program-id "$KEYPAIR_FILE" \
      --keypair    "$HOME/.config/solana/id.json" \
      --commitment  confirmed \
      --url mainnet-beta \
      --with-compute-unit-price 50000 \
      "$FINAL_SO"; then
    SUCCESS=true; break
  else
    [ $i -eq $MAX_RETRIES ] && break
    echo -e "${YELLOW}  Retry in 8s...${NC}"; sleep 8
    solana program close --buffers --quiet 2>/dev/null || true
  fi
done

[ "$SUCCESS" != true ] && { echo -e "${RED}✗ Mainnet deployment failed.${NC}"; exit 1; }

echo ""
echo -e "${YELLOW}[4/4] Updating project config...${NC}"
# Patch IDL metadata
python3 << PYEOF
import json, os
p = "$PROJECT_ROOT/src/lib/idl.json"
if os.path.exists(p):
    with open(p) as f: idl = json.load(f)
    idl.setdefault("metadata", {})["mainnetAddress"] = "$MAINNET_PROGRAM_ID"
    with open(p,"w") as f: json.dump(idl, f, indent=2)
    print(f"  idl.json mainnetAddress → $MAINNET_PROGRAM_ID")
PYEOF

# Update .env if it exists
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q "VITE_BCF_PROGRAM_ID_MAINNET" "$ENV_FILE"; then
    sed -i "s|VITE_BCF_PROGRAM_ID_MAINNET=.*|VITE_BCF_PROGRAM_ID_MAINNET=$MAINNET_PROGRAM_ID|" "$ENV_FILE"
  else
    echo "VITE_BCF_PROGRAM_ID_MAINNET=$MAINNET_PROGRAM_ID" >> "$ENV_FILE"
  fi
  echo "  .env VITE_BCF_PROGRAM_ID_MAINNET updated"
fi

# Update constants.js fallback
CONSTANTS_FILE="$PROJECT_ROOT/src/lib/constants.js"
if [ -f "$CONSTANTS_FILE" ]; then
  sed -i "s#|| '[A-Za-z0-9]*'; // update after mainnet deploy#|| '$MAINNET_PROGRAM_ID'; // update after mainnet deploy#g" "$CONSTANTS_FILE"
  echo "  constants.js BCF_PROGRAM_ID_MAINNET updated"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              MAINNET DEPLOYMENT COMPLETE ✓                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Mainnet Program ID : ${CYAN}$MAINNET_PROGRAM_ID${NC}"
echo -e "  Explorer           : ${CYAN}https://explorer.solana.com/address/$MAINNET_PROGRAM_ID${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Update .env:"
echo "     VITE_NETWORK=mainnet"
echo "     VITE_SOLANA_RPC=https://api.mainnet-beta.solana.com"
echo "     VITE_BCF_PROGRAM_ID_MAINNET=$MAINNET_PROGRAM_ID"
echo "  2. Start Frontend (Mainnet):"
echo "     export VITE_SOLANA_RPC=https://api.mainnet-beta.solana.com"
echo "     export BCF_PROGRAM_ID=$MAINNET_PROGRAM_ID"
echo "     npm run dev"
echo "  3. Deploy frontend to Vercel/Netlify/Pages:"
echo "     npm run build"
