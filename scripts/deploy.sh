#!/usr/bin/env bash
# BagsCreatorFund — Deploy to Solana DevNet
# ──────────────────────────────────────────────────────────────────────────────
# ROOT CAUSE of "lock file version 4 requires -Znext-lockfile-bump":
#
#   System Rust 1.95  → writes Cargo.lock v4
#   BPF toolchain Rust 1.75 → cannot PARSE v4
#
#   cargo-build-sbf delegates dependency resolution to whichever cargo is
#   on the PATH first. That cargo (system Rust 1.95) writes v4. The BPF
#   compiler then tries to read it and fails.
#
#   FIX (two-step):
#   1. Run `cargo generate-lockfile` explicitly (system cargo, v4 output)
#   2. Convert v4 → v3 with sed before cargo-build-sbf reads it
#   3. cargo-build-sbf finds a COMPLETE v3 lock → reads it fine → compiles
#
#   Deleting Cargo.lock does NOT work: cargo-build-sbf regenerates it with
#   system cargo → v4 again.
#
# OTHER FIXES:
#   - Build in /tmp (ext4) → avoids NTFS "Permission denied" on /mnt/c/
#   - Pass keypair FILE to `solana program deploy` → required for first deploy
# ──────────────────────────────────────────────────────────────────────────────
set -e

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   BagsCreatorFund — Deploy to DevNet     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

BUILD_DIR="/tmp/bcf-anchor-build"
SBF_TARGET="/tmp/bcf-sbf-target"

# ─── Convert Cargo.lock v4 → v3 ───────────────────────────────────────────────
# Strips CRLF then forces version = 3.
# Called AFTER cargo generate-lockfile so we don't fight cargo regenerating it.
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

# ══════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[1/6] Checking tools...${NC}"
for tool in solana cargo-build-sbf; do
  command -v $tool &>/dev/null || { echo -e "${RED}✗ $tool not found${NC}"; exit 1; }
done
echo -e "${GREEN}✓ $(solana --version | head -n1)${NC}"
echo -e "${GREEN}✓ cargo-build-sbf available${NC}"

echo ""
echo -e "${YELLOW}[2/6] Configuring Solana for DevNet...${NC}"
solana config set --url devnet --commitment confirmed
[ ! -f "$HOME/.config/solana/id.json" ] && \
  solana-keygen new --no-passphrase --outfile "$HOME/.config/solana/id.json"
echo -e "${GREEN}✓ Wallet: $(solana address)${NC}"

echo ""
echo -e "${YELLOW}[3/6] Checking SOL balance...${NC}"

# First: close any orphaned deploy buffers to recover locked SOL
echo "  Recovering SOL from any orphaned deploy buffers..."
solana program close --buffers --quiet 2>/dev/null && echo -e "  ${GREEN}✓ Buffers closed${NC}" || true
sleep 2

BALANCE_SOL=$(solana balance 2>/dev/null | awk '{print $1}')
echo "Current balance: ${BALANCE_SOL} SOL"

if python3 -c "import sys; sys.exit(0 if float('${BALANCE_SOL:-0}') >= 3.0 else 1)" 2>/dev/null; then
  echo -e "${GREEN}✓ Sufficient${NC}"
else
  echo -e "${YELLOW}Balance low — requesting DevNet airdrops...${NC}"
  for i in 1 2 3; do
    solana airdrop 2 2>/dev/null && echo "  +2 SOL" && sleep 8 || true
    BALANCE_SOL=$(solana balance 2>/dev/null | awk '{print $1}')
    python3 -c "import sys; sys.exit(0 if float('${BALANCE_SOL:-0}') >= 3.0 else 1)" 2>/dev/null && break
  done
fi

BALANCE_SOL=$(solana balance 2>/dev/null | awk '{print $1}')
echo -e "${GREEN}✓ Balance: ${BALANCE_SOL} SOL${NC}"
if ! python3 -c "import sys; sys.exit(0 if float('${BALANCE_SOL:-0}') >= 2.5 else 1)" 2>/dev/null; then
  echo -e "${RED}✗ Still insufficient. Visit https://faucet.solana.com and airdrop to:${NC}"
  echo -e "  ${CYAN}$(solana address)${NC}"
  echo -e "${RED}  Then re-run this script.${NC}"
  exit 1
fi

# ─── Copy workspace to Linux filesystem ────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/6] Building program on Linux filesystem...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANCHOR_DIR="$PROJECT_ROOT/anchor"
echo "  Project root : $PROJECT_ROOT"
echo "  Build dir    : $BUILD_DIR"

echo "  Copying workspace..."
rm -rf "$BUILD_DIR" "$SBF_TARGET"
cp -r "$ANCHOR_DIR" "$BUILD_DIR"
cd "$BUILD_DIR"

# Fix Anchor.toml workspace path if needed
grep -q 'members = \["programs/\*"\]' Anchor.toml 2>/dev/null && \
  sed -i 's|members = \["programs/\*"\]|members = ["programs/bags-creator-fund"]|' Anchor.toml
rm -rf target
echo -e "  ${GREEN}✓ Workspace copied${NC}"

# ─── Step 1: use system cargo to resolve deps (writes v4 lock) ────────────────
echo "  Resolving dependencies with system cargo..."
cargo generate-lockfile 2>&1 | grep -v "^$" | tail -3 || true

# ─── Step 2: convert v4 → v3 so BPF toolchain can parse it ───────────────────
lockfile_v3 "Cargo.lock"
clean_lockfile
echo -e "  ${GREEN}✓ Cargo.lock prepared (v4 → v3, BPF-compatible)${NC}"

# ─── Step 3: build with cargo-build-sbf (reads the v3 lock, no regeneration) ──
echo ""
echo "  Building with cargo-build-sbf..."
cd "$BUILD_DIR/programs/bags-creator-fund"
if CARGO_TARGET_DIR="$SBF_TARGET" cargo-build-sbf 2>&1 | \
    grep -v "^warning: Patch" | grep -v "^Patch \`" | \
    grep -v "was not used in the crate graph" | \
    grep -v "^Check that the patched" | \
    grep -v "^with the dependency" | \
    grep -v "^run \`cargo update" | \
    grep -v "^This may also occur"; then
  echo -e "  ${GREEN}✓ Build complete${NC}"
else
  echo -e "${RED}✗ cargo-build-sbf failed${NC}"; exit 1
fi
cd "$BUILD_DIR"

# Locate .so
FINAL_SO=""
for src in \
  "$SBF_TARGET/deploy/bags_creator_fund.so" \
  "$SBF_TARGET/bpfel-unknown-unknown/release/bags_creator_fund.so" \
  "$BUILD_DIR/target/deploy/bags_creator_fund.so"; do
  [ -f "$src" ] && FINAL_SO="$src" && break
done
[ -z "$FINAL_SO" ] && echo -e "${RED}✗ .so not found${NC}" && exit 1
echo -e "  ${GREEN}✓ .so: $(du -sh "$FINAL_SO" | cut -f1)${NC}"
echo -e "${GREEN}✓ Build successful${NC}"

# ─── Keypair ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5/6] Resolving program keypair...${NC}"
KEYPAIR_FILE=""
for kp in \
  "$ANCHOR_DIR/target/deploy/bags_creator_fund-keypair.json" \
  "$SBF_TARGET/deploy/bags_creator_fund-keypair.json" \
  "$BUILD_DIR/target/deploy/bags_creator_fund-keypair.json"; do
  [ -f "$kp" ] && KEYPAIR_FILE="$kp" && break
done

if [ -z "$KEYPAIR_FILE" ]; then
  mkdir -p "$ANCHOR_DIR/target/deploy"
  KEYPAIR_FILE="$ANCHOR_DIR/target/deploy/bags_creator_fund-keypair.json"
  solana-keygen new --no-passphrase --outfile "$KEYPAIR_FILE" --force
  echo -e "  ${GREEN}✓ Generated new program keypair${NC}"
else
  echo -e "  ${GREEN}✓ Keypair: $KEYPAIR_FILE${NC}"
  [ "$KEYPAIR_FILE" != "$ANCHOR_DIR/target/deploy/bags_creator_fund-keypair.json" ] && {
    mkdir -p "$ANCHOR_DIR/target/deploy"
    cp "$KEYPAIR_FILE" "$ANCHOR_DIR/target/deploy/bags_creator_fund-keypair.json"
  }
fi

PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR_FILE")
echo -e "  ${GREEN}✓ Program ID: $PROGRAM_ID${NC}"

# Patch Program ID into all source files
echo "  Patching Program ID..."

# 1. Rust: declare_id! in lib.rs
for f in \
  "$BUILD_DIR/programs/bags-creator-fund/src/lib.rs" \
  "$ANCHOR_DIR/programs/bags-creator-fund/src/lib.rs"; do
  [ -f "$f" ] && sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" "$f"
done

# 2. Anchor.toml
for f in "$BUILD_DIR/Anchor.toml" "$ANCHOR_DIR/Anchor.toml"; do
  [ -f "$f" ] && sed -i "s/bags-creator-fund = \"[^\"]*\"/bags-creator-fund = \"$PROGRAM_ID\"/" "$f"
done

# 3. Update .env with new DEVNET Program ID so constants.js picks it up
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q "VITE_BCF_PROGRAM_ID_DEVNET" "$ENV_FILE"; then
    sed -i "s|VITE_BCF_PROGRAM_ID_DEVNET=.*|VITE_BCF_PROGRAM_ID_DEVNET=$PROGRAM_ID|" "$ENV_FILE"
  else
    echo "VITE_BCF_PROGRAM_ID_DEVNET=$PROGRAM_ID" >> "$ENV_FILE"
  fi
  echo -e "  ${GREEN}✓ .env VITE_BCF_PROGRAM_ID_DEVNET = $PROGRAM_ID${NC}"
else
  # Create .env if it doesn't exist
  cat > "$ENV_FILE" << ENVEOF
VITE_BAGS_API_KEY=bags_prod_NvTYIGgjDiUlNIYgRf3M0PcSL9XvGlYCGrEcrPvADrA
VITE_BAGS_API_BASE=https://public-api-v2.bags.fm/api/v1
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_NETWORK=devnet
VITE_BCF_PROGRAM_ID_DEVNET=$PROGRAM_ID
ENVEOF
  echo -e "  ${GREEN}✓ .env created with VITE_BCF_PROGRAM_ID_DEVNET = $PROGRAM_ID${NC}"
fi

# 4. Patch the hardcoded fallback in constants.js so it also works without .env
CONSTANTS_FILE="$PROJECT_ROOT/src/lib/constants.js"
if [ -f "$CONSTANTS_FILE" ]; then
  # Update both the devnet fallback AND mainnet comment placeholder
  sed -i "s#|| '[A-Za-z0-9]*'; // update after mainnet deploy#|| '$PROGRAM_ID'; // update after mainnet deploy#g" "$CONSTANTS_FILE"
  # Update the devnet fallback specifically
  python3 << PYEOF
import re
with open('$CONSTANTS_FILE', 'r') as f:
    c = f.read()
# Replace the devnet fallback string
c = re.sub(
    r"(BCF_PROGRAM_ID_DEVNET\s*=\s*import\.meta\.env\.VITE_BCF_PROGRAM_ID_DEVNET\s*\|\| ')[A-Za-z0-9]+'",
    r"\g<1>$PROGRAM_ID'",
    c
)
with open('$CONSTANTS_FILE', 'w') as f:
    f.write(c)
print("  constants.js fallback → $PROGRAM_ID")
PYEOF
  echo -e "  ${GREEN}✓ constants.js fallback updated${NC}"
fi

# 5. Update IDL metadata
python3 << PYEOF
import json, os
p = "$PROJECT_ROOT/src/lib/idl.json"
if os.path.exists(p):
    with open(p) as f: idl = json.load(f)
    idl.setdefault("metadata", {})["address"] = "$PROGRAM_ID"
    with open(p, "w") as f: json.dump(idl, f, indent=2)
    print(f"  idl.json → $PROGRAM_ID")
PYEOF

# Final rebuild with patched Program ID
echo "  Final rebuild with patched Program ID..."
cargo generate-lockfile 2>/dev/null || true
lockfile_v3 "Cargo.lock"
cd "$BUILD_DIR/programs/bags-creator-fund"
CARGO_TARGET_DIR="$SBF_TARGET" cargo-build-sbf 2>&1 | \
  grep -E "^(   Compiling|    Finished|^error\[E)" || true
cd "$BUILD_DIR"

# Final .so
FINAL_SO=""
for src in \
  "$SBF_TARGET/deploy/bags_creator_fund.so" \
  "$SBF_TARGET/bpfel-unknown-unknown/release/bags_creator_fund.so" \
  "$BUILD_DIR/target/deploy/bags_creator_fund.so"; do
  [ -f "$src" ] && FINAL_SO="$src" && break
done
[ -z "$FINAL_SO" ] && echo -e "${RED}✗ Final .so not found${NC}" && exit 1
mkdir -p "$ANCHOR_DIR/target/deploy"
cp "$FINAL_SO" "$ANCHOR_DIR/target/deploy/bags_creator_fund.so"
echo -e "  ${GREEN}✓ .so ready: $(du -sh "$FINAL_SO" | cut -f1)${NC}"

# ─── Deploy ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[6/6] Deploying to Solana DevNet...${NC}"
echo "  Program ID : $PROGRAM_ID"
echo ""
MAX_RETRIES=5
for i in $(seq 1 $MAX_RETRIES); do
  echo "  Attempt $i / $MAX_RETRIES..."
  solana program close --buffers --quiet 2>/dev/null || true
  if solana program deploy \
      --program-id "$KEYPAIR_FILE" \
      --keypair    "$HOME/.config/solana/id.json" \
      --commitment  confirmed \
      --with-compute-unit-price 50000 \
      "$FINAL_SO"; then
    echo -e "${GREEN}✓ Deployment successful!${NC}"
    break
  else
    [ $i -eq $MAX_RETRIES ] && { echo -e "${RED}✗ Deployment failed.${NC}"; exit 1; }
    echo -e "${YELLOW}  Retrying in 5s...${NC}"; sleep 5
  fi
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              DEPLOYMENT COMPLETE ✓                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
# 7. Launching Dual-Engine (Watcher + Frontend)
echo -e "${GREEN}  Program ID : ${CYAN}$PROGRAM_ID${NC}"
echo -e "${GREEN}  Network    : ${CYAN}$NETWORK${NC}"
echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
echo ""

# 7. Launching Dual-Engine (Watcher + Frontend)
echo -e "${YELLOW}🚀 Launching Services...${NC}"

# Find node
NODE_BIN=$(command -v node || which node || echo "node")

# Set environment variables
export VITE_SOLANA_RPC="$RPC_URL"
export BCF_PROGRAM_ID="$PROGRAM_ID"

# Start Watcher in background
echo -e "  Starting Watcher with $NODE_BIN..."
$NODE_BIN scripts/watcher.mjs > watcher.log 2>&1 &
WATCHER_PID=$!

# Cleanup on exit
trap "kill $WATCHER_PID 2>/dev/null || true; exit" SIGINT SIGTERM EXIT

echo -e "${GREEN}✓ Watcher is running (PID: $WATCHER_PID)${NC}"
echo -e "  Logs: tail -f watcher.log"
echo ""

echo -e "${YELLOW}Launching Frontend...${NC}"
cd "$PROJECT_ROOT"
npm run dev
