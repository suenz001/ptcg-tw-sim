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
for f in $(git ls-tree -r HEAD --name-only | grep -E '\.(ts|svelte|md|json|js|mjs|css|html|sh|yml|yaml)$' 2>/dev/null); do
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

# ── Rule 14: 「搜尋整副牌庫」型 picker 的 minCount 必須永遠 0 ─────────────
# v4.942 把 13 處 `minCount: hasX ? 1 : 0` 修為 0。
#
# ⭐ v6.102（Wilson 裁定）判準由「寫法」改為「情境」——原本純字串 grep 會誤報。
#
# 為什麼「搜尋整副牌庫」不可以動態 minCount：
#   ① 牌庫是**隱藏資訊**。若「有沒有被強迫選」隨牌庫內容改變，玩家可以從自己被迫與否
#      反推「牌庫裡還有沒有那類卡」——這是資訊洩漏。
#   ② 官方規則允許「搜尋可以找不到」（fail-to-find），玩家有權不拿（站規 v2.321）。
#
# 為什麼「查看牌庫上方 N 張」是**例外**（豁免）：
#   那 N 張已經攤開在玩家眼前 ＝ **已知資訊**，不存在①的反推、也沒有②的「找不到」問題；
#   卡面若寫「從其中選擇 1 張…」（沒有「可以」）就是強制，此時 minCount 必須隨候選存在與否
#   動態決定 —— 沒有候選時給 0，否則玩家會沒東西可選又沒有【不選】鈕而卡死。
#   例：女服務生「查看自己的牌庫上方6張卡，從其中選擇1張基本能量卡…」。
#   同型的偵查指令／探險家的嚮導／辛俐 走的是 selection-ui.ts 的
#   MANDATORY_TOP_PICK_EFFECT_KEYS 白名單（那份白名單是無條件強制，不看候選數）。
#
# 豁免判準：命中行附近（±12 行，即同一個 withPending 區塊內）出現 TOP_N 或 topIids
#   ＝ 已經把候選限縮到「玩家看過的那 N 張」→ 放行。
echo "── Rule 14: 搜尋整副牌庫的 minCount 必須永遠 0（看頂 N 張的已知資訊型除外）"
# ⭐ v6.104：主 grep 從只認 `hasX ? 1 : 0` 擴到**等價拼法** `xxx.length > 0 ? 1 : 0`
#   —— 當年 v4.942 按字面修 13 處，等價拼法整批倖存（火箭隊的超級球／賽吉，已於本版改為 0）。
#   同時排除 G 標卡檔（v29xx_g4_*）：站規只維護 H/I/J，G 標一律不處理，掃了只會製造永久噪音。
raw=$(grep -rnE 'minCount:\s*(has\w+|\w+\.length\s*>\s*0)\s*\?\s*1\s*:\s*0' src/lib/game/ 2>/dev/null \
      | grep -vE '/v[0-9]+_g[0-9]+_' || true)
matches=""
if [ -n "$raw" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    f="${line%%:*}"
    rest="${line#*:}"
    n="${rest%%:*}"
    lo=$(( n > 12 ? n - 12 : 1 )); hi=$(( n + 12 ))
    ctx=$(sed -n "${lo},${hi}p" "$f" 2>/dev/null || true)
    # 已知資訊型（看過的固定 N 張）→ 豁免
    # 豁免 token 要涵蓋各種「看頂 N 張」的寫法：filter 'TOP_N' / 'TOP4'、params topIids / top4Iids
    if echo "$ctx" | grep -qE 'TOP_?[0-9]|TOP_N|top[0-9]*Iids'; then
      continue
    fi
    matches="${matches}${line}"$'\n'
  done <<< "$raw"
fi
matches=$(printf '%s' "$matches")
if [ -n "$matches" ]; then
  print_violation "14" "搜尋整副牌庫卻用 minCount: hasX ? 1 : 0（會洩漏牌庫是否還有該類卡，且剝奪官方允許的「找不到」）" "$matches"
else
  echo -e "${GREEN}✓ Rule 14 clean${NC}"
fi
echo ""

# ── Rule 20: 「後攻最初回合」gate 不要用 !isFirstTurn ──────────────────────
# v4.940 修幫忙鈴/悠哉尾草棒。!isFirstTurn 是「先攻方第 1 動作回合外」的意思，
# 對「後攻方第 1 動作回合」永遠 fail。Warn-only：有些卡可能合法使用 isFirstTurn
# 但不是「後攻最初回合」（例 v169_supporters.ts:275 「先攻第 1 回合不能用」），
# 全 ban 會誤觸。列出供人工 review。
#
# ⭐ v6.103：**先剝註解再掃**。原本純 grep 會抓到「描述當年怎麼修的註解文字」
#   （items_misc.ts 的 `原 \`!st.isFirstTurn\` 是錯的，改 \`st.turn !== 1\``），
#   於是這條 rule **每一版都亮黃燈** → 變成狼來了，真的有人寫錯時看不出來。
#   剝法：先去掉行內 `//` 之後的部分，再判斷是否仍命中。
#   ⚠ 已知限制（刻意不做狀態機，避免 CI script 過度複雜）：
#     ① 跨行 /* … */ 區塊註解**不會**被剝掉 → 會**多報**（就是本規則原本的狼來了病因，
#        只是目前 effects/ 內沒有這種寫法）；② 字串字面量裡的 `//`（例如網址）會被誤剝 → **少報**。
#     兩個方向相反，別記反了。真要嚴謹就改用 node（CI runner 內建）剝註解。
#
# ⭐ v6.103 掃描範圍從 `src/lib/game/effects/` 擴到 `src/lib/game/`（含 engine.ts）——
#   原本的窄範圍正好漏掉 engine.ts 兩處**真的死招**（吼叫尾ex｜絕叫、甜甜螢｜慢芬香
#   判 `!state.isFirstTurn || !isSecondPlayer`，該組合永遠不成立 → 兩張卡完全打不出來），
#   而那正是這條規則設計來抓的 bug 類型。同版已修，修完擴範圍是零常態噪音。
echo "── Rule 20（warn）: !st.isFirstTurn / !state.isFirstTurn 用法請人工 review"
raw=$(grep -rnE '!\s*st\.isFirstTurn|!\s*state\.isFirstTurn' src/lib/game/ 2>/dev/null || true)
matches=""
if [ -n "$raw" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # 去掉 "檔:行號:" 前綴後剝行內註解，再確認 code 部分是否仍命中
    code=$(printf '%s' "$line" | sed -E 's|^[^:]+:[0-9]+:||' | sed -E 's|//.*$||')
    if printf '%s' "$code" | grep -qE '!\s*st\.isFirstTurn|!\s*state\.isFirstTurn'; then
      matches="${matches}${line}"$'\n'
    fi
  done <<< "$raw"
fi
matches=$(printf '%s' "$matches")
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
