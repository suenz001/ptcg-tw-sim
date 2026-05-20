#!/bin/bash
# scripts/iron-rules-audit.sh
#
# 跑所有可自動化的鐵律 grep audit。任一條違規 → exit 1。
# 本機跑：bash scripts/iron-rules-audit.sh
# CI 自動跑：.github/workflows/iron-rules-audit.yml
#
# v4.944 starter set:
#   Rule 1 / Rule 6 / Rule 11b / Rule 14 / Rule 20（列出供 review）
#
# 新增鐵律時請同步加 grep check 到本檔（per IRON_RULES.md meta-rule）。

set -uo pipefail

# 顏色（CI 環境會自動忽略 ANSI escape）
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

errors=0
warnings=0

print_violation() {
  local rule="$1"
  local desc="$2"
  local matches="$3"
  echo -e "${RED}❌ Rule ${rule}: ${desc}${NC}"
  echo "$matches" | sed 's/^/   /'
  errors=$((errors + 1))
}

print_warning() {
  local rule="$1"
  local desc="$2"
  local matches="$3"
  echo -e "${YELLOW}⚠️  Rule ${rule}: ${desc}${NC}"
  echo "$matches" | sed 's/^/   /'
  warnings=$((warnings + 1))
}

echo "======================================================================"
echo "Iron Rules Audit — Phase A (warn-only / 試運行)"
echo "======================================================================"
echo ""

# ── Rule 1: changelog <code> 內 raw { } 未 escape ──────────────────────────
# 卡面：v3.899 等多版 push 失敗都是因為這條
# regex：<code> 內含 literal { 或 } 且不是 &#123;/&#125;
echo "── Rule 1: changelog <code> 內 raw { } 應 escape 為 &#123; / &#125;"
matches=$(grep -nE '<code>[^<]*[{}][^<]*</code>' src/routes/+page.svelte 2>/dev/null || true)
if [ -n "$matches" ]; then
  print_violation "1" "<code>...</code> 內出現未 escape 的 { 或 }" "$matches"
else
  echo -e "${GREEN}✓ Rule 1 clean${NC}"
fi
echo ""

# ── Rule 6: ABILITY_EFFECTS.set('卡名|非數字') ─────────────────────────────
# v2.94 修了 21 處此類 bug 後加的鐵律
echo "── Rule 6: ABILITY_EFFECTS.set('卡名|abilityIndex')，abilityIndex 必須是數字"
matches=$(grep -rn "ABILITY_EFFECTS\.set('[^|]\+|[^0-9]" src/lib/game/effects/ 2>/dev/null || true)
if [ -n "$matches" ]; then
  print_violation "6" "ABILITY_EFFECTS.set 的 key 第二段不是數字 → 註冊 dead" "$matches"
else
  echo -e "${GREEN}✓ Rule 6 clean${NC}"
fi
echo ""

# ── Rule 11b: 文字檔含 NUL byte ────────────────────────────────────────────
# v3.721 災難：Edit 工具縮短字串時留下 \x00
# v4.945 修：原 `grep -q $'\x00'` 因 bash 變數展開 NUL 截斷導致 pattern 空 → 100% 誤觸。
#   改用 `grep -Pq '\x00'`（Perl regex 模式直接讀 \x00 字面）。
echo "── Rule 11b: 文字檔（.ts / .svelte / .md / .json）不該含 NUL byte"
nul_files=""
for f in $(git ls-files | grep -E '\.(ts|svelte|md|json|js|mjs|css|html|sh|yml|yaml)$' 2>/dev/null); do
  if [ -f "$f" ] && grep -Pq '\x00' "$f" 2>/dev/null; then
    nul_files="$nul_files
$f"
  fi
done
if [ -n "$nul_files" ]; then
  print_violation "11b" "下列文字檔含 NUL byte（可能 Edit 工具截斷）" "$nul_files"
else
  echo -e "${GREEN}✓ Rule 11b clean${NC}"
fi
echo ""

# ── Rule 14: minCount: hasX ? 1 : 0（強迫玩家在牌庫有候選時選 1 張）────────
# v4.942 把 13 處修為 minCount: 0
echo "── Rule 14: deck-search 的 minCount 必須永遠 0，禁用 hasX ? 1 : 0"
matches=$(grep -rnE 'minCount:\s*has\w+\s*\?\s*1\s*:\s*0' src/lib/game/ 2>/dev/null || true)
if [ -n "$matches" ]; then
  print_violation "14" "minCount 寫成 hasX ? 1 : 0（牌庫有候選時強迫選 1 張）" "$matches"
else
  echo -e "${GREEN}✓ Rule 14 clean${NC}"
fi
echo ""

# ── Rule 20: 「後攻最初回合」gate 不要用 !isFirstTurn ──────────────────────
# v4.940 修幫忙鈴/悠哉尾草棒。!isFirstTurn 是「先攻方第 1 動作回合外」的意思，
# 對「後攻方第 1 動作回合」永遠 fail。Warn-only：有些卡可能合法使用 isFirstTurn
# 但不是「後攻最初回合」（例 v169_supporters.ts:275 「先攻第 1 回合不能用」），
# 全 ban 會誤觸。列出供人工 review。
echo "── Rule 20（warn）: !st.isFirstTurn / !state.isFirstTurn 用法請人工 review"
matches=$(grep -rnE '!\s*st\.isFirstTurn|!\s*state\.isFirstTurn' src/lib/game/effects/ 2>/dev/null || true)
if [ -n "$matches" ]; then
  print_warning "20" "找到 !isFirstTurn 用法 — 若卡片寫「後攻最初回合」應改 state.turn !== 1" "$matches"
else
  echo -e "${GREEN}✓ Rule 20 — 無 !isFirstTurn 用法${NC}"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────
echo "======================================================================"
if [ "$errors" -gt 0 ]; then
  echo -e "${RED}❌ Audit failed: $errors error(s), $warnings warning(s)${NC}"
  # Phase A: 不 exit 1（workflow 用 continue-on-error: true，但留訊息提示）
  echo -e "${YELLOW}（Phase A 試運行：先觀察、不擋 deploy；Phase B 才會真正擋下來）${NC}"
  exit 1
elif [ "$warnings" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Audit passed with $warnings warning(s) — 請人工 review${NC}"
  exit 0
else
  echo -e "${GREEN}✅ All iron rules audit passed${NC}"
  exit 0
fi
