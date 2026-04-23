#!/usr/bin/env bash
# BagsCreatorFund — Deploy to Solana DevNet
# Tested on: WSL2 + Ubuntu + Solana CLI 2.x + Anchor 0.29.0
# Run from project root: bash scripts/deploy.sh
set -e

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   BagsCreatorFund — Deploy to DevNet     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ─── downgrade Cargo.lock v4 → v3 ─────────────────────────────────────────────
downgrade_lockfile() {
  if [ -f "Cargo.lock" ] && grep -q '^version = 4$' "Cargo.lock"; then
    echo -e "  ${YELLOW}⚠ Cargo.lock v4 — downgrading to v3...${NC}"
    sed -i 's/^version = 4$/version = 3/' "Cargo.lock"
    echo -e "  ${GREEN}✓ Cargo.lock v3${NC}"
  fi
}

# ─── remove [patch.crates-io] block ───────────────────────────────────────────
remove_patch_block() {
  local toml="${1:-Cargo.toml}"
  # Don't remove if it contains our manual BPF compat patch
  if grep -q 'BPF compat:' "$toml" 2>/dev/null; then
    echo -e "  ${CYAN}ℹ Keeping manual BPF compat patch in $(basename "$toml")${NC}"
    return 0
  fi
  if grep -q 'Compatibility pins' "$toml" 2>/dev/null; then
    sed -i '/^# ── Compatibility pins/,$d' "$toml"
    echo -e "  ${GREEN}✓ Removed stale pins comment from $(basename "$toml")${NC}"
  fi
  if grep -qE '^\[patch\.' "$toml" 2>/dev/null; then
    sed -i '/^\[patch\./,$d' "$toml"
    echo -e "  ${GREEN}✓ Removed [patch.crates-io] from $(basename "$toml")${NC}"
  fi
}

# ─── pin incompatible crates as [dependencies] ────────────────────────────────
pin_crates_as_deps() {
  local prog_toml="programs/bags-creator-fund/Cargo.toml"
  if grep -q 'block-buffer.*0\.10' "$prog_toml" 2>/dev/null; then
    echo -e "  ${GREEN}✓ Crate version pins already present${NC}"
    return 0
  fi
  if grep -q '^\[dependencies\]' "$prog_toml"; then
    sed -i '/^\[dependencies\]/a # BPF compat: Rust 1.75 cannot compile edition2024 crates\nblock-buffer = "=0.10.4"\ndigest = "=0.10.7"' "$prog_toml"
  else
    printf '\n# BPF compat: Rust 1.75 cannot compile edition2024 crates\n[dependencies]\nblock-buffer = "=0.10.4"\ndigest = "=0.10.7"\n' >> "$prog_toml"
  fi
  echo -e "  ${GREEN}✓ Version pins added to $(basename "$prog_toml")${NC}"
}

# ─── surgically remove edition2024 crates from Cargo.lock ────────────────────
# When `cargo update --precise` can't downgrade across semver boundaries
# (because some crate requires "digest = 0.11" explicitly), we edit the
# lockfile directly: remove the incompatible [[package]] entries and rewrite
# any dependency references to point to the compatible versions instead.
# The BPF toolchain will then compile the compatible versions only.
lockfile_surgery() {
  if [ ! -f "Cargo.lock" ]; then
    echo -e "  ${YELLOW}No Cargo.lock to patch${NC}"
    return 1
  fi

  echo -e "  ${YELLOW}Performing Cargo.lock surgery to remove edition2024 crates...${NC}"

  python3 << 'PYEOF'
import re, sys

with open("Cargo.lock") as f:
    content = f.read()

original = content

# Split on package boundaries
# Each [[package]] entry ends just before the next [[package]] or EOF
parts = re.split(r'(?=^\[\[package\]\])', content, flags=re.MULTILINE)
header = parts[0]
packages = parts[1:]

def is_incompatible(pkg):
    """Return True for block-buffer >=0.11 and digest >=0.11 packages."""
    if re.search(r'name\s*=\s*"block-buffer"', pkg):
        m = re.search(r'version\s*=\s*"(\d+)\.(\d+)', pkg)
        if m and (int(m.group(1)) > 0 or int(m.group(2)) >= 11):
            return True
    if re.search(r'name\s*=\s*"digest"', pkg):
        m = re.search(r'version\s*=\s*"(\d+)\.(\d+)', pkg)
        if m and (int(m.group(1)) > 0 or int(m.group(2)) >= 11):
            return True
    return False

removed = [p for p in packages if is_incompatible(p)]
kept    = [p for p in packages if not is_incompatible(p)]

if not removed:
    print("  Nothing to remove — no incompatible packages found")
    sys.exit(0)

for r in removed:
    m = re.search(r'name\s*=\s*"([^"]+)".*?version\s*=\s*"([^"]+)"', r, re.DOTALL)
    if m:
        print(f"  Removing: {m.group(1)} v{m.group(2)}")

# Rebuild lockfile without incompatible packages
result = header + "".join(kept)

# Rewrite dependency references that pointed to the removed versions:
# "block-buffer 0.12.x ..." → "block-buffer 0.10.4 ..."
# "digest 0.11.x ..."       → "digest 0.10.7 ..."
result = re.sub(r'"block-buffer 0\.1[1-9][^"]*"', '"block-buffer 0.10.4"', result)
result = re.sub(r'"digest 0\.1[1-9][^"]*"',       '"digest 0.10.7"',       result)

with open("Cargo.lock", "w") as f:
    f.write(result)

changed = result != original
print(f"  Cargo.lock patched ({'changed' if changed else 'no changes needed'})")
PYEOF
}

# ─── prepare a BPF-compatible Cargo.lock ──────────────────────────────────────
prepare_lockfile() {
  echo "  Using existing Cargo.lock with manual pins..."
  downgrade_lockfile

  # Try pinning each incompatible version using the @version syntax
  # (requires Cargo ≥1.78 — we have 1.95)
  local pinned=0
  echo "  Pinning block-buffer@0.12.x → 0.10.4..."
  if cargo update "block-buffer@0.12.0" --precise 0.10.4 2>&1; then
    echo -e "  ${GREEN}✓ block-buffer pinned${NC}"; pinned=1
  else
    echo -e "  ${YELLOW}  cargo update failed (semver conflict) — will use lockfile surgery${NC}"
  fi

  echo "  Pinning digest@0.11.x → 0.10.7..."
  if cargo update "digest@0.11.2" --precise 0.10.7 2>&1; then
    echo -e "  ${GREEN}✓ digest pinned${NC}"; pinned=1
  else
    echo -e "  ${YELLOW}  cargo update failed (semver conflict) — will use lockfile surgery${NC}"
  fi

  # If cargo update couldn't pin everything, fall back to direct lockfile editing
  if cargo tree 2>/dev/null | grep -qE 'block-buffer v0\.1[1-9]|digest v0\.1[1-9]'; then
    echo "  Incompatible crates still present — applying lockfile surgery..."
    lockfile_surgery
  fi

  downgrade_lockfile
  echo -e "  ${GREEN}✓ Cargo.lock prepared${NC}"
}

# ─── anchor build with lockfile fix on retry ──────────────────────────────────
try_anchor_build() {
  echo "  Running: anchor build (with lockfile fix and temp target)"
  sed -i 's/version = 4/version = 3/' Cargo.lock
  if CARGO_TARGET_DIR=/tmp/target anchor build 2>&1; then
    mkdir -p target/deploy target/idl
    cp /tmp/target/deploy/*.so target/deploy/ 2>/dev/null || true
    cp /tmp/target/deploy/*.json target/deploy/ 2>/dev/null || true
    cp /tmp/target/idl/*.json target/idl/ 2>/dev/null || true
    return 0
  fi
  return 1
}

# ─── cargo-build-sbf fallback ─────────────────────────────────────────────────
try_cargo_sbf() {
  echo -e "  ${YELLOW}anchor build failed — falling back to cargo-build-sbf...${NC}"
  downgrade_lockfile
  pushd programs/bags-creator-fund > /dev/null
  if cargo-build-sbf 2>&1; then
    popd > /dev/null; return 0
  fi
  popd > /dev/null
  return 1
}

# ══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[1/6] Checking tools...${NC}"
if ! command -v solana &>/dev/null; then
  echo -e "${RED}✗ solana CLI not found${NC}"
  echo "  Install: sh -c \"\$(wget -qO- https://release.solana.com/v1.18.26/install)\""
  exit 1
fi
if ! command -v anchor &>/dev/null; then
  echo -e "${RED}✗ anchor not found${NC}"
  echo "  cargo install --git https://github.com/coral-xyz/anchor avm --locked --force"
  echo "  avm install 0.29.0 && avm use 0.29.0"
  exit 1
fi
echo -e "${GREEN}✓ $(solana --version | head -n1)${NC}"
echo -e "${GREEN}✓ $(anchor --version)${NC}"

echo ""
echo -e "${YELLOW}[2/6] Configuring Solana for DevNet...${NC}"
solana config set --url devnet --commitment confirmed
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  solana-keygen new --no-passphrase --outfile "$HOME/.config/solana/id.json"
  echo -e "${YELLOW}⚠ Save your seed phrase!${NC}"
fi
WALLET=$(solana address)
echo -e "${GREEN}✓ Wallet: $WALLET${NC}"

echo ""
echo -e "${YELLOW}[3/6] Checking SOL balance...${NC}"
BALANCE_SOL=$(solana balance 2>/dev/null | awk '{print $1}')
echo "Current balance: ${BALANCE_SOL} SOL"
NEEDS_AIRDROP=$(python3 -c "print('yes' if float('${BALANCE_SOL:-0}') < 3.0 else 'no')" 2>/dev/null || echo "yes")
if [ "$NEEDS_AIRDROP" = "yes" ]; then
  solana airdrop 2 && sleep 2
  solana airdrop 2 && sleep 2
fi
echo -e "${GREEN}✓ Balance: $(solana balance 2>/dev/null)${NC}"
echo ""

echo -e "${GREEN}✓ Balance: $(solana balance 2>/dev/null)${NC}"

echo ""
echo -e "${YELLOW}[4/6] Building Anchor program...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANCHOR_DIR="$PROJECT_ROOT/anchor"
cd "$ANCHOR_DIR"
echo "Working directory: $(pwd)"

if grep -q 'members = \["programs/\*"\]' Anchor.toml 2>/dev/null; then
  echo "  Fixing Anchor.toml workspace members path..."
  sed -i 's|members = \["programs/\*"\]|members = \["programs/bags-creator-fund"\]|' Anchor.toml
fi

echo "  Manual BPF stabilization already applied. Skipping cleanup."
# remove_patch_block "Cargo.toml"
# remove_patch_block "programs/bags-creator-fund/Cargo.toml"

echo "  Checking crate version pins..."
pin_crates_as_deps

echo "  Cleaning target/ and Cargo.lock..."
rm -rf target
# rm -f Cargo.lock

echo ""
echo "  Using manually stabilized Cargo.lock..."
# prepare_lockfile

echo ""
echo "Building Anchor program (this may take 2–3 minutes)..."
if ! try_anchor_build; then
  if ! try_cargo_sbf; then
    echo -e "${RED}✗ All build attempts failed.${NC}"
    echo ""
    echo -e "${YELLOW}Diagnostics — crates requiring incompatible versions:${NC}"
    cargo tree -i "block-buffer@0.12.0" 2>/dev/null | head -20 || true
    cargo tree -i "digest@0.11.2" 2>/dev/null | head -20 || true
    exit 1
  fi
fi
echo -e "${GREEN}✓ Build complete${NC}"

echo ""
echo -e "${YELLOW}[5/6] Getting Program ID...${NC}"
KEYPAIR_FILE="$ANCHOR_DIR/target/deploy/bags_creator_fund-keypair.json"
if [ ! -f "$KEYPAIR_FILE" ]; then
  echo -e "${RED}✗ Keypair not found: $KEYPAIR_FILE${NC}"; exit 1
fi
PROGRAM_ID=$(python3 << 'PYEOF'
import json
with open("target/deploy/bags_creator_fund-keypair.json") as f:
    b = bytes(json.load(f))
pub = b[32:]
a = b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n = int.from_bytes(pub, 'big')
r = []
while n: n, x = divmod(n, 58); r.append(a[x:x+1])
for c in pub:
    if c == 0: r.append(a[0:1])
    else: break
print(b''.join(reversed(r)).decode())
PYEOF
)
if [ -z "$PROGRAM_ID" ]; then
  PROGRAM_ID=$(anchor keys list 2>/dev/null | grep "bags_creator_fund" | awk '{print $NF}')
fi
if [ -z "$PROGRAM_ID" ]; then
  echo -e "${RED}✗ Could not determine Program ID. Run: anchor keys list${NC}"; exit 1
fi
echo -e "${GREEN}✓ Program ID: $PROGRAM_ID${NC}"

sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" \
  "$ANCHOR_DIR/programs/bags-creator-fund/src/lib.rs"
sed -i "s/bags-creator-fund = \"[^\"]*\"/bags-creator-fund = \"$PROGRAM_ID\"/" \
  "$ANCHOR_DIR/Anchor.toml"
sed -i "s/new PublicKey('[^']*')/new PublicKey('$PROGRAM_ID')/" \
  "$PROJECT_ROOT/src/lib/programClient.js"
cp "$ANCHOR_DIR/target/idl/bags_creator_fund.json" "$PROJECT_ROOT/src/lib/idl.json"
python3 << PYEOF
import json, os
path = '$PROJECT_ROOT/src/lib/idl.json'
if os.path.exists(path):
    with open(path, 'r') as f:
        idl = json.load(f)
    idl['metadata'] = idl.get('metadata', {})
    idl['metadata']['address'] = '$PROGRAM_ID'
    with open(path, 'w') as f:
        json.dump(idl, f, indent=2)
    print('  idl.json updated and synchronized ✓')
else:
    print('  idl.json not found, skipping...')
PYEOF

echo "  Final rebuild with embedded Program ID..."
if ! try_anchor_build; then
  echo -e "${RED}✗ Final rebuild failed.${NC}"; exit 1
fi
echo -e "${GREEN}✓ All files patched and rebuilt${NC}"

echo ""
echo -e "${YELLOW}[6/6] Deploying to Solana DevNet...${NC}"
echo "  Deploying with priority fees to bypass congestion..."
# Use priority fees and multiple attempts
MAX_RETRIES=5
for i in $(seq 1 $MAX_RETRIES); do
  echo "  Attempt $i of $MAX_RETRIES..."
  
  # Ensure we have a clean slate for each attempt (recovers SOL from failed attempts)
  solana program close --buffers --quiet 2>/dev/null || true
  
  if solana program deploy \
    --program-id "$PROGRAM_ID" \
    --keypair "$HOME/.config/solana/id.json" \
    --commitment confirmed \
    --with-compute-unit-price 50000 \
    "target/deploy/bags_creator_fund.so"; then
    echo -e "${GREEN}✓ Deployment successful!${NC}"
    break
  else
    if [ $i -eq $MAX_RETRIES ]; then
      echo -e "${RED}✗ Deployment failed after $MAX_RETRIES attempts.${NC}"
      echo -e "${YELLOW}Tip: You can manually resume with: solana program deploy --buffer <BUFFER> --program-id $PROGRAM_ID${NC}"
      exit 1
    fi
    echo -e "${YELLOW}  Deployment interrupted (congested). Retrying in 5s...${NC}"
    sleep 5
  fi
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              DEPLOYMENT COMPLETE ✓                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Program ID : ${CYAN}$PROGRAM_ID${NC}"
echo -e "  Explorer   : ${CYAN}https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  The script will now attempt to install dependencies and launch the frontend..."
echo ""

# Go back to project root and launch
cd "$PROJECT_ROOT"
if npm install; then
  echo -e "${GREEN}✓ Dependencies installed${NC}"
  echo -e "${CYAN}Launching frontend (npm run dev)...${NC}"
  npm run dev
else
  echo -e "${RED}✗ npm install failed. Please run 'npm install && npm run dev' manually in Windows or WSL.${NC}"
fi

echo ""