# PTCG-tw-sim Iron Rules（鐵律）

> 最後更新：v5.103（2026-05-25）— Rule 1 audit regex 強化（v5.098~v5.102 連續 4 次同類事故）
> 同步自：`/sessions/.../mnt/outputs/ptcg-push/SKILL.md`

這份文件記錄 ptcg-tw-sim 專案中經過慘痛教訓得到的鐵律。每條都對應一個或多個過去
push 失敗的 incident。違反任何一條都會讓推上去的版本崩潰、頁面 500、或 silently
吃掉程式碼。

如果你是新進的 AI agent，**修任何 effects.ts / engine.ts / +page.svelte 之前，
先讀完這份文件**。如果你只是要修小卡片邏輯，至少看 Rule 11 + Rule 12。

---

## CRITICAL iron rules — these have ALL been violated in past pushes

### Rule 1: Svelte template special characters MUST be HTML-entity escaped

Inside any `<script>`-less area of `src/routes/**/*.svelte` (the rendered template), these characters trigger Svelte parser errors:

- `{` and `}` — Svelte interprets `{...}` as a JavaScript expression. Writing `{seatIdx}` in changelog text crashes the build with `Expected token }`.
- `<` and `>` — `<` followed by space-then-letter (or any non-`!`/`/`/letter) might still be parsed as a tag start in strict modes. Even `若 incoming < local 即拒收` has caused a build failure.

**Always write these in changelog/help text:**

| Want to display | Write |
|---|---|
| `{` | `&#123;` |
| `}` | `&#125;` |
| `<` | `&lt;` |
| `>` | `&gt;` |

Or use full-width CJK forms: `｛｝＜＞`. Either works.

This rule has been violated in v2.461, v2.733, v2.82, **v5.043 / v5.045 / v5.087 / v5.098 / v5.100 / v5.101** (every push that touches changelog needs a follow-up patch). When writing a changelog with code-like fragments — generics, type signatures, comparison operators, object literals — assume the parser will choke and escape proactively.

**v5.098~v5.102 4 次連續事故 — 教訓**：

v5.098 changelog 我寫了 `<code>top:{(i+1) * _stepOB}px</code>` —
- esbuild build pass、tsc pass、Iron Rules Audit pass、Deploy pass ✓
- 但 runtime evaluate `{(i+1) * _stepOB}` 當 expression，`i` / `_stepOB` 在 +page.svelte scope 不存在 → ReferenceError 白畫面

v5.100 hotfix 用 regex auto-escape，**保留 backtick `` ` ` `` 內 `{}`** — 結果 Svelte 不認 backtick 為 escape，build fail。

v5.101 拿掉 backtick protection 全 escape — 但 regex 觸碰到別處結構，build fail。

v5.102 直接 `git cat-file -p` 拿 v5.095 commit byte-identical 覆蓋整個 +page.svelte → 才救活。

**根本原因**：舊 Rule 1 audit regex `\{\s*([a-zA-Z]\w*)\s*\}` 只抓 simple identifier `{foo}`，沒抓 expression `{(i+1) * step}` / `{obj.prop}` / `{fn(x)}` 等。**任何 `<code>...</code>` 內含 raw `{` 都該 flag**，不論內部是 identifier 還是 expression。

**REVISED audit regex（v5.103 加強）**：

```python
import re
with open('src/routes/+page.svelte', encoding='utf-8') as f:
    content = f.read()

# 抓 changelog-list 區段
match = re.search(r'<div class="changelog-list">(.*?)</div>\s*</details>\s*</section>',
                  content, flags=re.DOTALL)
if not match:
    raise SystemExit('changelog-list section not found — abort')
section = match.group(1)

# 保留合法 svelte syntax + 既有 HTML entity，剩餘 raw {} 全 flag
PROTECTED = [
    r'\{#(?:if|each|key|await)\s[^}]*\}',  # {#if} {#each} {#key} {#await}
    r'\{/(?:if|each|key|await)\}',          # {/if} {/each} ...
    r'\{:else(?:\s[^}]*)?\}',               # {:else} {:else if ...}
    r'\{:catch[^}]*\}',                     # {:catch}
    r'\{:then[^}]*\}',                      # {:then}
    r'\{@const\s[^}]*\}',                   # {@const ...}
    r'\{@html\s[^}]*\}',                    # {@html ...}
    r'&#123;|&#125;',                       # 既有 entity
]
cleaned = section
for pat in PROTECTED:
    cleaned = re.sub(pat, '', cleaned)
# 剩餘 raw { } 全是 Rule 1 違規
raw_open = cleaned.count('{')
raw_close = cleaned.count('}')
if raw_open or raw_close:
    print(f'❌ Rule 1 violation: raw {{ = {raw_open}, }} = {raw_close}')
    # show context (first 200 chars of cleaned that has {)
    idx = cleaned.find('{') if '{' in cleaned else cleaned.find('}')
    print(f'context: ...{cleaned[max(0,idx-80):idx+120]}...')
    raise SystemExit('Rule 1 violation — escape all raw { } before push')
print(f'✓ Rule 1 audit pass — no raw {{ or }} in changelog section')
```

**強制 pre-push 跑此 audit**（與 tsc 同等優先級）。**注意：禁用 backtick `` ` ` `` 包覆 raw `{}`** — Svelte template parser 不認 backtick 為 escape，必須直接用 `&#123;` / `&#125;` HTML entity。

**lazy chunk fetch audit**（已 push 後額外保險）：

```bash
# 找 routes chunk 跟首頁 lazy node（含 changelog 渲染）
NODES=$(curl -sS "https://www.ptcgtw-sim.com/" | grep -oE 'nodes/[0-9]+\.[A-Za-z0-9_-]+\.js')
for n in $NODES; do
  # fetch 線上 chunk，grep 危險 pattern：raw ${identifier} 或 raw {identifier} 在 minified output
  COUNT=$(curl -sS "https://www.ptcgtw-sim.com/_app/immutable/$n" 2>/dev/null | grep -cE '\$\{[a-z_]')
  [ "$COUNT" -gt 0 ] && echo "⚠️ $n: $COUNT suspicious \${identifier}"
done
```

**v5.045 教訓 — audit 範圍必須擴大**：

之前 Rule 1 audit 只抓 `<code>` 開頭含 `{` 的 pattern（regex `<code>\{`），漏掉「`<code>` 內部中間含 `{ identifier }`」的情況。v5.043 changelog 寫了 `<code>import { getBenchLimit } from '../../engine'</code>`，Svelte template parser 把 `<code>` 內 `{ getBenchLimit }` 當 simple expression evaluate → runtime ReferenceError → 整個首頁空白。tsc / esbuild / GitHub Actions Iron Rules Audit / Deploy 全部 success — 但 runtime 炸。

**強化 audit regex（pre-push 必跑）**：

```python
# 抓 <code>...</code> 內部含 simple identifier 包在 { } 的 pattern
import re
with open('src/routes/+page.svelte', encoding='utf-8') as f:
    content = f.read()
violations = []
for m in re.finditer(r'<code>([^<]*?)</code>', content):
    inner = m.group(1)
    if '`' in inner: continue  # template literal 內合法
    for cm in re.finditer(r'\{\s*([a-zA-Z]\w*)\s*\}', inner):
        line_no = content[:m.start() + cm.start()].count('\n') + 1
        violations.append((line_no, cm.group(1), inner[:80]))
if violations:
    for v in violations: print(f'L{v[0]} {{ {v[1]} }} in: {v[2]}')
    raise SystemExit('Rule 1 violation')
```

**驗證層次（v5.045 學到）**：
1. **esbuild build success** ≠ runtime success — esbuild 只做 syntax check
2. **tsc no errors** ≠ runtime success — tsc 不檢查 .svelte template expression scope
3. **GitHub Actions Iron Rules Audit success** ≠ runtime success — 只跑 grep
4. **GitHub Actions Deploy success** ≠ runtime success — build 通過但 hydrate 仍可能炸
5. **真正驗證**：fetch GitHub Pages 真實 bundle（含 lazy node chunks）grep 危險 pattern `\$\{identifier`

**lazy chunks audit**（push 完必做）：

```bash
# 找 app entry，挖出 nodes/N.HASH.js（route 編譯 chunk）
APP=$(curl -sS "https://suenz001.github.io/ptcg-tw-sim/" | grep -oE "_app/immutable/entry/app\.[a-zA-Z0-9_-]+\.js" | head -1)
NODES=$(curl -sS "https://suenz001.github.io/ptcg-tw-sim/$APP" | grep -oE 'nodes/[0-9]+\.[a-zA-Z0-9_-]+\.js')
for n in $NODES; do
  COUNT=$(curl -sS "https://suenz001.github.io/ptcg-tw-sim/_app/immutable/$n" | grep -c '\${[a-zA-Z]')
  echo "$n: $COUNT dangerous \${identifier} patterns"
done
```

任何 `$\{identifier}` 出現 = 潛在 ReferenceError（除非 identifier 真實存在 scope 內）。

### Rule 2: Don't run `git status`, `git add`, or `git commit` directly

The mounted `.git/index` returns `fatal: unknown index entry format` for these. Always use the **Python plumbing pipeline below**, which writes a fresh temp index file via `GIT_INDEX_FILE` and bypasses the broken index.

`git cat-file`, `git hash-object`, `git read-tree`, `git update-index`, `git write-tree`, `git commit-tree`, `git push` — these all work. The pipeline composes them.

### Rule 3: For large files, edit via HEAD blob in memory — don't read from disk after editing

`src/lib/game/effects.ts`, `src/routes/+page.svelte`, and `src/routes/game/+page.svelte` are 100KB+. Reading them from the mounted disk has historically truncated mid-multibyte-UTF-8 character (the mount layer caps at some byte count and slices through a 3-byte char), producing files that crash svelte-check / vite build with garbled syntax errors.

Always:
1. Read content with `git cat-file -p HEAD:<path>` (full blob, no truncation)
2. Apply edits in Python memory
3. Hash the new bytes with `git hash-object -w --stdin` (in-memory)
4. Write to disk with `os.O_WRONLY | os.O_TRUNC | os.O_CREAT` + `os.fsync` (so subsequent reads get full file)
5. **Never re-read the file from disk** to compute the blob hash — use the in-memory bytes you just wrote

### Rule 4: ALWAYS verify before pushing

Run one of:

```bash
npx tsc --noEmit -p . 2>&1 | grep -E "<file you touched>" | head -10
```

or for Svelte-specific issues:

```bash
timeout 35 npx svelte-check --threshold error --output human 2>&1 | grep -A 2 "<file you touched>" | head -10
```

The build (`npm run build` = `vite build`) catches Svelte template errors that `tsc --noEmit` misses. If you're touching a `.svelte` file and tsc passes, also try a quick Svelte-side check by glancing at what you wrote — particularly any changelog `<li>` blocks for special chars.

If you skipped this and the GitHub Actions build fails, the symptom is a red X on the workflow run. **Do not guess**. Open the run, expand the failed step, find the actual error line. The error always points to a specific file:line:col with a useful message.

### Rule 5: After a failed push, fix it in a NEW commit (don't force-push)

When the user says "push 失敗", that means GitHub Actions failed. The commit IS on `main` already; only the deploy job failed. To fix, edit + commit + push a new commit that overrides the broken state.

Use the next patch version (v2.73 → v2.731, v2.731 → v2.732, etc.). Don't try to amend or force-push — the user has been seeing the broken version of the version badge propagate via GitHub Pages cache.

### Rule 6: ABILITY_EFFECTS key 必須是 `'卡名|abilityIndex'`，永遠用 `regA(name, idx, fn)` helper

引擎查表用 `${cardName}|${action.abilityIndex}` 而 abilityIndex 是**數字**，不是特性名。

- `ABILITY_EFFECTS.set('卡名|特性名', fn)` 是 **silent fail**：按鈕不出現、效果不觸發、無錯誤 log
- 正確寫法：`regA('卡名', 0, fn)` （abilityIndex 通常是 0）
- v2306_meta_pokemon.ts 曾犯此錯誤導致 21 個特性註冊全部 dead，於 v2.94 修正

**禁止**：直接寫 `ABILITY_EFFECTS.set('卡名|特性名', fn)`。

**Audit 工具**：
```bash
grep -rn "ABILITY_EFFECTS\.set\('[^|]\+|[^0-9]" src/lib/game/effects/
```
應該無 match。若有 match，那條註冊是 dead code。

### Rule 7: 嚴禁簡化實裝

嚴禁「假裝實裝」的簡化做法。每張卡必須**嚴格按官方卡面文字實裝**。

常見違規模式：
- 卡面要求「附於這隻寶可夢身上」絕對不能寫成「加到手牌」
- 卡面要求「擲幣決定」絕對不能寫成「50% 機率」隨機判定
- 卡面要求「玩家選擇」絕對不能寫成「自動選 HP 最低」
- 卡面要求「自由分配」絕對不能寫成「全部附給戰鬥場」

遇到引擎不支援的機制：
- 標記 `// [deferred] <reason>` 並在 commit msg 回報
- **絕不能用「看起來像有實裝」的方式糊弄玩家**

**Audit 工具**：
```bash
grep -rn "// .*\(簡化\|stub\|TODO\|未實裝\)" src/lib/game/effects/
```
找到的每一筆都需逐一審查；若是真正簡化、需重新實裝為完整版，並從註解移除「簡化」字樣。

### Rule 7b: G 標卡一律跳過，不實裝（audit script 預設排除）

`docs/AI_GENERIC_HANDOFF.md` §2 已記載，但 v3.70 audit 沒搜到 docs/ 子目錄、誤把 G 納入而花一整批工實裝 22 張 G 卡（壞處：浪費版本；好處：對 H/I/J 標環境玩家無實質影響、不會 break 任何東西）。

**規則**：
- 凡 `card.regulationMark === 'G'` → audit / 實裝 / 牌組驗證一律當「不在合法範圍」。
- 牌組構築 gate 已有處理（`STANDARD_REPRINT_LEGAL_NAMES` 例外清單 + 同名跨版本檢查）。
- 例外：G 標基本能量 + 神奇糖果等 `STANDARD_REPRINT_LEGAL_NAMES` 內的卡（v3.61–v3.63 處理過）。

**Audit script 模板**：

```python
# 標準環境 = H + I + J（G 已輪出）
STD_MARKS = {"H", "I", "J"}  # ← 不要把 G 加進來
```

v3.70 已用同個 script 順手清掉幾個 print-variant string-match bug，那部分保留有效。

### Rule 7c: 規則解讀 / 卡面討論前必須查 static/cards 原文，禁止憑記憶或腦補

每張卡的原文文字（rulesText / abilities.text / attacks.effect）都在 `static/cards/*.json`。**任何「這張卡是怎麼運作的」「這個機制應該怎麼修」「這條規則該怎麼解讀」的判斷之前，必須先 grep / read JSON 拿到完整原文**，再做判斷。

`docs/AI_GENERIC_HANDOFF.md` §1 已寫過「實作卡片前必須查 JSON」，但歷史上多次失誤集中在「audit / 規則解讀 / AI 決策邏輯」場景 — 那些情境沒新增卡片，只是改邏輯，agent 容易跳過查證步驟憑記憶說話。

**現實災難案例**：

| 版本 | 幻覺 | 真相（卡面） | 後果 |
|---|---|---|---|
| v3.71 audit | 「極限腰帶 = HP +50（如同 ex 戴護身符）」 | 極限腰帶 = 攻擊 +50 點傷害 對對手戰鬥場 ex（**進攻** buff） | 整個 P0 修法方向誤判 |
| v3.71 audit | 「豪華斗篷 = HP +90 對非 rule-box」 | 豪華斗篷是 **G 標**（已輪出，依 Rule 7b 跳過） | 拿輪出卡當佐證 |
| v3.71 audit | 「龍屬性有弱抗倍率」 | 龍屬性無弱點也無抵抗力 | 多算了一條不存在的邏輯路徑 |
| v3.14 → v3.711 | 「願增猿｜腎上腺腦力 卡面『最多 3 個』= 玩家選 1~3」 | 「最多 3 個」是上限（cap），實際 amount = min(source.damage, 30) 全搬，無 picker | 加了錯的 modal-choice picker；v3.71 又在錯的 picker 上做最佳化；v3.711 兩個都 revert |

**強制流程**：

凡是要動以下任一類程式碼**之前**，先 grep / Read `static/cards/*.json`：
- 卡片實裝 / regA / regPre / regPost / reg / regR
- AI 決策邏輯（要參考某張卡的招式 / 特性 / cost / damage）
- audit script（要過濾或對比某類卡面文字語意）
- 規則解讀討論（用戶問「這張卡這樣做對嗎」）
- 修 bug 時要確認「卡面到底寫什麼」

**特別注意語意關鍵詞**（PTCG 規則文字常見誤譯）：

| 文字 | 常見錯讀 | 正確語意 |
|---|---|---|
| **最多 N 個** | 玩家選 1~N | 上限 N，全搬 min(實際, N) |
| **若希望** | 一律觸發 | yes/no binary，由 actor 決定要不要做 |
| **直到出現反面** | 固定擲幣 N 次 | 反覆擲到反面為止（可能擲 0~∞ 次） |
| **選擇 1 張** | 自動隨機 1 張 | actor 必須選擇（picker） |
| **將 X 改放於 Y** | 玩家可以選量 | 一次性整批轉移 |
| **每 1 個 +N** | 直接加 N | 依數量乘倍率（damage += count × N） |
| **不會放置傷害指示物** | 不會受招式傷害 | 招式傷害正常 +0，但傷害指示物 placement 機制（如 咒詛炸彈）被擋 |
| **附加效果** | 任何效果 | 特定指 defender 身上由特性 / 道具 / 上回合招式留下的減傷 / 反傷 flag |

**Audit 工具**：

```bash
# 查單張卡的所有 prints + 完整原文
grep -A 60 '"name": "願增猿"' static/cards/*.json
# 或用 Python helper（讀 JSON 結構化輸出）
python3 -c "
import json, glob
for f in sorted(glob.glob('static/cards/*.json')):
    for c in json.load(open(f, encoding='utf-8')):
        if c.get('name') == '願增猿':
            print(c.get('setCode'), c.get('regulationMark'), c.get('abilities'))
"
```

凡是違反此規則的失誤都應該回過頭來把這條 audit 個案補成新的「現實災難案例」。

### Rule 8: 揭示資訊（addLog vs addPrivateLog）必須嚴格按卡面文字

PTCG 規則：實體桌上「給對手看過」是防作弊驗證機制——對手要確認搜出來的卡符合 filter 限制（『寶可夢』『支援者』『基本能量』『進化寶可夢』等）。線上對戰用 log 取代這個機制，所以**揭示資訊規則直接決定 log 該用 addLog 還是 addPrivateLog**。

| 卡面文字 | log 寫法 | 對手看到 |
|---|---|---|
| 含「給對手看過」/「在給對手看過後」/「給對手確認後」 | `addLog(state, '搜到：A、B 加入手牌', idx)` | 完整卡名 |
| 不含上述任何字樣（如親送無人機任拿型） | `addPrivateLog(state, privateMsg, publicMsg, idx)` | 只看到 N 張卡的張數 |

**違反此規則 = PTCG 規則 bug**，因為線上版透過 log 取代實體驗證機制。對手看不到具體卡名 = 等於玩家可以在實體桌上「不給對手看就直接抓進手牌」，違反基本公平性。

需揭示的卡（不完全清單）：高級球 / 黑暗球 / 甜蜜球 / 超級信號 / 大師球 / 訂購盒 / 幫忙鈴 / 勝利之證 / 招式學習器機 / 派帕 / 杜若 / 正輝的輸送 / 吹火人 / 火箭隊的超級球 / 沙儷 / 卡娜莉 / 風扇呼喚 / 小剛的發掘 / 振翅高飛 / 集客 / 殺手鐧捕捉 / 百花齊放 / 搜尋寶石 / 王者呼聲 / 金屬信號 / 進化指引 / 收集香氣 / 毛象搬運 / 四季變換 / 旅途牽絆 / 貪慾點餐 / 夜光標誌 / 臨場選擇 / 能量輸送 / 能量回收 / 能量回收器 / 能量輸送PRO 等。

不揭示的卡（卡面真的沒有「給對手看過」字樣）：親送無人機（任拿 1 張）。

**Audit 工具**：
```bash
# 1. JSON 找有「給對手看過」的卡名清單
python3 -c "import json,glob
for fp in glob.glob('static/cards/*.json'):
    data=json.load(open(fp,encoding='utf-8'))
    if not isinstance(data,list): continue
    for c in data:
        for kind in ('abilities','attacks'):
            for ab in (c.get(kind) or []):
                if '給對手看過' in (ab.get('effect') or ''):
                    print(c.get('name'),'|',ab.get('name'))"

# 2. ts code 找用 addPrivateLog 的所有位置
grep -rn "addPrivateLog" src/lib/game/effects/

# 3. 交叉比對：在 1. 但用 addPrivateLog → 違規；不在 1. 但用 addLog 公開卡名 → 違規
```

新實裝有「搜牌加手」的卡時：先檢查 JSON 是否含「給對手看過」，再決定 log 工具。

### Rule 9: 特性按鈕 gate — 條件未滿足時 UI 不能顯示按鈕

卡面有觸發條件的特性，**必須在 `getUsableAbilities()` 加 gate**，不滿足時不回傳此 ability，UI 才不會顯示按鈕。

不能依賴 fn 內部的 `if (!條件) return addLog(state, '無法使用', idx)` — 那會讓玩家點完按鈕才看到「無法使用」訊息，且按下若觸發 supporter / item 消耗已不能取消（玩家流失資源），這是無法接受的壞 UX。

**常見觸發條件 → gate pattern**：

| 卡面文字 | gate 寫法 |
|---|---|
| 「從備戰區放置於戰鬥場時」/「移到戰鬥場時」 | `if (player.active?.iid !== pk.iid \|\| !player.active.movedToActiveThisTurn) return;` |
| 「從手牌使出這張卡並完成進化時」 | 加進 `ON_EVOLVE_FROM_HAND_ABILITIES` 自動觸發；或 `if (!pk.evolvedThisTurn \|\| !pk.playedFromHand) return;` |
| 「進化（成這張卡）時」 | `if (!pk.evolvedThisTurn) return;` |
| 「從手牌將這張卡放置於備戰區時」 | 加進 `ON_PLAY_FROM_HAND_ABILITIES` 自動觸發；或 `if (!pk.playedFromHand) return;` |
| 「若這隻寶可夢在戰鬥場」 | `if (player.active?.iid !== pk.iid) return;` |
| 「身上附有 X 能量時」 | `if ((countEnergy(pk, pool).get('X') ?? 0) < 1) return;` |
| 「HP 全滿時」 | `if (pk.damage > 0) return;` |
| 「HP 為 X 以下時」 | `if (pk.damage < HP - X) return;` |
| 「對手場上有 X 時」 | `if (!opponent.active && opponent.bench.length === 0) return;` |
| 「牌庫上方 N 張」/「牌庫不為空」 | `if (player.deck.length < N) return;` |
| 「手牌至少 1 張 X」 | `if (!player.hand.some(c => /* X */)) return;` |
| 「只有在自己的最初回合」 | `if (state.turn > 2) return;`（先攻 turn 1 / 後攻 turn 2 都算最初回合） |

**範例 pattern（仿 v2.93b 潔淨支援 / v2.96 振翅高飛）**：
```ts
if (ab.name === '振翅高飛') {
  if (player.active?.iid !== pk.iid) return;
  if (!player.active.movedToActiveThisTurn) return;
  if (player.deck.length === 0) return;
}
```

**Audit 工具**：
```bash
# 1. JSON 找有觸發條件的特性
python3 -c "import json,glob
P=['若這隻寶可夢在戰鬥場','從備戰區放置於戰鬥場時','移到戰鬥場時',
   '從手牌使出這張卡並完成進化時','從手牌將這張卡放置於備戰區時',
   '若這隻寶可夢身上附有','HP 全滿','HP為','只有在自己的最初回合']
seen=set()
for fp in glob.glob('static/cards/*.json'):
    data=json.load(open(fp,encoding='utf-8'))
    if not isinstance(data,list): continue
    for c in data:
        for ab in (c.get('abilities') or []):
            t=ab.get('effect') or ''
            if any(p in t for p in P):
                k=ab.get('name')
                if k in seen: continue
                seen.add(k); print(c.get('name'),'|',k)"

# 2. engine.ts 已 gate 的特性集合
grep -oE "ab\.name === '[^']+'" src/lib/game/engine.ts | sort -u

# 3. 在 1. 但不在 2. → 缺 gate
```

修補後玩家不滿足條件時看不到按鈕，乾淨；點擊不會浪費資源。



### Rule 10: pendingPrizes 必須走 addPendingPrize() helper

v2.98 重構：`pendingPrizes` 從 `number` 改為「兩個 number 的 tuple」 [P1 owed, P2 owed]。

**所有「KO 後累計獎賞」**必須走 `addPendingPrize(state, ownerIdx, n)` helper，禁止：
- 直接 `prizes.slice(0, n)` + `hand: [...prev, ...taken]` 自動派發到手牌
- 直接 spread `{ ...s, pendingPrizes: ... }` 寫入欄位

**唯一例外**：`engine.ts` 的 `TAKE_PRIZES` action handler — 那裡才能直接讀寫 tuple。

**為什麼**：v2.98 之前，5 處（自爆 KO / 反彈 KO / 冰冷之帳 / 棄世猴同命戰鬥 / 瘋癲攻擊自殺）
直接派發給對手寶可夢（prizes.slice + hand 拼裝），無視「對手必須 click 取獎」的玩家驗證。
tuple 化後雙方各自待領，UI 都顯示按鈕，符合實體 PTCG「贏家自己抽」流程。

**Audit 工具**：
```bash
grep -rn "pendingPrizes:" src/lib/game/effects.ts src/lib/game/effects/ src/lib/game/engine.ts \
  | grep -v "addPendingPrize\|getPendingPrize\|hasAnyPendingPrize" \
  | grep -v "TAKE_PRIZES handler"
```
應該無 match（除引擎 createGame 初始化與 TAKE_PRIZES handler）。



### Rule 11: ANY 既有檔案改用 Edit 工具都可能被 mount-truncated（不只是大檔案）

**閾值不可預測** — v2.993 的 effects.ts (680KB)、+page.svelte (140KB) 全被截，
v2.994 的 mega_decks.ts (**只有 36KB**) 和 v2500_i_wave3b_discard.ts (**只有 12KB**)
也都被截斷。**結論：無論檔案多小，任何 Edit/Write 工具對既有檔案的修改都可能 silently
truncate 至 HEAD 大小，超出部分被裁掉。**

**症狀**：用 Edit 工具修改後，`wc -c` 顯示與 HEAD blob 完全一致（同樣 size），
但內容卻不同 — 因為 mount layer 把 Write 出來的位元組裁掉到 HEAD 大小，
任何超出 HEAD 大小的新增內容會被切掉，等於 silently 丟失程式碼。

**v2.993 / v2.994 踩坑紀錄**：
- v2.993: Edit 工具改了 effects.ts、items_misc.ts、+page.svelte、pokemon_search.ts、v172_hij_batch.ts、lopunny_*.ts 等 6 個檔案後，全部被截斷至 HEAD 大小
- v2.994: Edit 工具改了 mega_decks.ts (36KB) — 也被截斷，導致 tsc 報「) expected」（因檔尾切掉了），最後用 Python pipeline 才修好

**檢測方式（push 前驗證）**：
```bash
python3 -c "
import os, subprocess
files = ['src/lib/game/effects.ts', 'src/routes/+page.svelte', ...]
for p in files:
    head = subprocess.run(['git','cat-file','-p',f'HEAD:{p}'], capture_output=True).stdout
    disk = open(p,'rb').read()
    head_v = head.count(b'<NEW_VERSION_TAG>')
    disk_v = disk.count(b'<NEW_VERSION_TAG>')
    truncated = len(disk) <= len(head) and disk_v > 0
    print(f'{p}: HEAD={len(head)} disk={len(disk)} new_marker={disk_v} truncated={truncated}')
"
```
（替換 `<NEW_VERSION_TAG>` 為這次新增的標記，例如 `v2.993`）。
若有 `truncated=True` 出現，**必須**用 Python pipeline 從 HEAD blob 重建。

**正確 workflow**：
1. **任何既有檔案的修改 → 一律走 Python pipeline**（不論大小）— 用 `head_blob()` + `str.replace` + `safe_write`
2. **創建全新檔案 → Write 工具 OK**（沒有 HEAD 可以參考截斷）
3. push 前一律透過 `git cat-file -p HEAD` 驗證內容（不是用 disk read）

**例外**：版本字串改變（如 `2.996` → `2.997`）byte 數一樣時 disk size = HEAD size 是
正常的，不是截斷。truncated 判斷需配合「應該新增的 marker 是否存在」。

### Rule 11b: Edit 工具縮短字串時可能留 NUL byte padding（v3.721 災難）

不僅 mount-truncate 那種大檔截斷問題（Rule 11）— 連把短字串改成更短的字串時也可能踩。v3.72 把 `VERSION = '3.712'` 改成 `VERSION = '3.72'`（少 1 byte），Edit 工具沒做正確 file size shrink，檔尾留下 1 個 `\x00` NUL byte。

**症狀**：
- `tsc --noEmit` 通過（lexer 把 NUL 當 EOF）
- `svelte/compiler.compile` 通過（同上）
- `vite build` → `svelte-check` → svelte preprocessor 走 TS lexer 時報 `Invalid character`，build 失敗
- GitHub Actions 顯示 `Process completed with exit code 1`

**修法**：Python `content.rstrip(b'\x00').rstrip(b'\n') + b'\n'` + safe_write。

**Pre-push 驗證必加項**：

```bash
# 對所有改過的 .ts / .svelte / .js 確認無 NUL byte
for f in $(git diff --name-only HEAD); do
  if grep -q $'\x00' "$f"; then
    echo "X $f contains NUL byte!"
  fi
done
```

或 Python:

```python
for path in changed_files:
    with open(path, 'rb') as f:
        assert b'\x00' not in f.read(), f"{path} has NUL byte"
```

**為什麼這條值得獨立成鐵律**：tsc / svelte-parse 都不抓，過了所有「本地驗證」但 GitHub Actions 必炸。這個 silent 漏網是最危險的失敗模式 — 改一行小字串應該萬無一失，卻能把整個 deploy 炸掉。

### Rule 11c: Edit/Write 對既有檔的「中段截斷」失敗模式（v5.008 災難）

Rule 11 把 Edit/Write 截斷描述成「truncate 至 HEAD size」— v5.008 揭露了更陰險的另一種模式：
**中段截斷（mid-stream truncation）** — 檔案 size 看起來正常甚至略大，但 Edit point 之後的內
容被 silently 丟掉。

**v5.008 事故全紀錄**：
- 用 Edit 工具把 `src/routes/game/+page.svelte` 的 `.manual-code` CSS 區塊改寫，加 v5.008
  新樣式 ~40 行
- Edit 報告「success」，`tsc --noEmit` 通過 exit=0
- push 後 GitHub Pages build 失敗
- 比對 git diff 才發現：從 `.pv-overlay` 開始的 130 行 CSS（含 `.pv-close` / `.auth-modal`
  / `.auth-tabs` 等）全部消失，檔尾停在 `z-index: 100;` 沒有 `}`、沒有 `</style>`
- 檔案 size：HEAD 549,151 bytes → Edit 後 549,152 bytes（差 1 byte，**沒被截到 HEAD size**，
  Rule 11 audit 抓不到）
- vite-plugin-svelte 找不到 `</style>` → fatal build error

**為什麼 tsc 沒抓**：`tsc --noEmit` 只 type-check `.ts` / `.svelte` 的 `<script>` 區塊，不
解析 `<style>` 區塊的 CSS。`<style>` 缺 `</style>` tsc 完全看不到。

**為什麼 svelte-check 沒抓**：本地沙箱有 binary 相容問題跑不起來；正常環境會抓但很慢。

**為什麼比例高發於 game/+page.svelte**：該檔 549KB，是 repo 最大的單一 source file。任何
對它的 Edit 都應該優先用 Python pipeline。

**檢測方式（push 前必跑）— 適用於 .svelte / .html 含 `<style>` 或 `<script>` tag 的檔案**：

```python
# 對所有改過的 .svelte / .html 確認標籤對稱
for path in changed_svelte_html_files:
    with open(path, 'rb') as f:
        content = f.read()
    # <style>...</style> 對稱
    style_open = content.count(b'<style')
    style_close = content.count(b'</style>')
    assert style_open == style_close, f'{path}: <style>={style_open} </style>={style_close}'
    # <script>...</script> 對稱（不含 <script src=...> module link）
    # 略 — Svelte file 通常正好 1 對
```

**更可靠的 tail anchor check**：

```python
# 對 game/+page.svelte 這種大檔，確認結尾有 expected sentinel
TAIL_ANCHORS = {
    'src/routes/game/+page.svelte': b'</style>',  # 最末必須是 </style>
    'src/routes/+page.svelte': b'</style>',
    'oracle-admin/admin.html': b'</html>',
    'oracle-admin/server_admin_patch.js': b'// === ORACLE ADMIN PATCH END ===',
}
for path, anchor in TAIL_ANCHORS.items():
    if not os.path.exists(path): continue
    with open(path, 'rb') as f:
        tail = f.read()[-2000:]  # 最後 2KB
    assert anchor in tail, f'{path} tail missing {anchor!r} — file truncated?'
```

**正確 workflow**（重申 Rule 11）：
1. **任何 .svelte / .ts / .html / .sh 既有檔的修改 → 一律走 Python pipeline**（用 git HEAD blob
   + `str.replace` + `safe_write`）— 不用 Edit/Write
2. **跑 tsc 還不夠** — 大檔的 `<style>` 區塊 tsc 不檢查
3. **必跑 tail anchor check** + `<style>` 對稱 check（grep -c）
4. **理想 workflow**：寫一個 `scripts/pre-push-audit.py` 含上述所有 check，每次 push 前 run

**Rule 11 vs Rule 11c 差別**：
- Rule 11: 「Edit 後 disk size <= HEAD size 且有新內容」→ 整尾截斷至 HEAD size
- Rule 11c: 「Edit 後 disk size 接近正常」但**中段內容遺失** → 不靠 size 抓，要靠標籤對稱 / tail anchor


### Rule 11d: JSON 檔（含 static/cards/*.json）改中文字串也會中段截斷（v5.022 災難）

**症狀**：玩家點「開始演練」→ 卡在「載入卡池中...」永遠轉圈，網頁 console 看不到明顯錯誤，伺服器 log 完全正常（PM2 online、mongo connected、match-record 持續寫入）。**這個錯誤模式最危險，因為「伺服器看起來健康，但所有玩家都用不了客戶端」**。

**v5.022 事故全紀錄**（2026-05-22 13:35 部署 → 玩家 1 小時後爆量回報「卡住」）：

1. 用 Edit 工具改 `static/cards/M5.json` 的兩個小字串：
   - 卡片 effect 文字內把「閃電能量」改成「閃電【雷】能量」（line 1025）
   - 另一張卡 effect 文字內把「暗影惡能量」改成「暗影【惡】能量」（line 2305）
2. 兩個 Edit 都報告「success」、Read 回去看內容也正確
3. `python3 -c "import json; json.load(open('M5.json'))"` 此時跑會通過（檔案 size 還未 truncated）
4. 後續再跑一段 Python pipeline + 一段 finish_v5022.py：
   - `safe_write` → 不關 Edit 的事
   - `git hash-object -w static/cards/M5.json` → 把當下 disk 內容算 hash 寫進 git object store
5. **但中間某個時間點**（很可能是 Edit 工具最後的 sync 步驟落後 / mount layer 觸發 truncate），disk 上的 M5.json 在 `"regulationMa` 後面就被切掉了 — JSON 解析失敗
6. 後續 finish_v5022.py 的 `git hash-object` 把**已破損的 disk 檔**算 hash → commit 進去 → **git 端也記載破損版本**（rollback 拿回來的也是壞的）
7. CI build 完 → CDN 收到壞 JSON → 任何玩家點開始演練都卡死

**為什麼這條值得獨立成鐵律**：
- Rule 11c 講的是 `.svelte` `.ts` `.html` 大檔的中段截斷，預設用「tail anchor + `<style>` 對稱」抓。
- JSON 沒有 `</style>` 或 `</html>` 這種 obvious tail anchor，但有 `]` 或 `}` 結尾。
- Rule 11/11c 的「優先用 Python pipeline」是針對「大檔」的建議，玩家很容易誤判「JSON 改個小字串應該安全」就用 Edit — 結果還是炸了。
- **截斷的破壞範圍是 100% 玩家** — JSON parse 失敗，整個卡池載入失敗，全站停擺。Server 完全沒事讓 ops debug 走錯方向。
- **git 也會被污染** — 壞檔被 commit 進 history，看起來像「我推上去的版本」實際是壞檔。

**強制流程**：

任何對 `static/cards/*.json` 的改動（含中文字串、英文字串、欄位增減、卡片新增），**一律走 Python pipeline**，不再用 Edit 工具：

```python
# 從 git HEAD blob 取乾淨原始檔（避免 mount stale）
import subprocess, json, os
orig = subprocess.run(['git', 'show', 'HEAD:static/cards/M5.json'],
                     capture_output=True, check=True).stdout
text = orig.decode('utf-8')

# 純 str.replace 套修改
text = text.replace('"name": "閃電能量",', '"name": "閃電【雷】能量",', 1)
text = text.replace('附有「閃電能量」', '附有「閃電【雷】能量」', 1)

# parse 驗 JSON 合法（在記憶體內！別寫到 disk 再讀）
data = json.loads(text)
assert isinstance(data, list) and len(data) > 0, 'M5.json shape broken'

# safe_write
new_bytes = text.encode('utf-8')
fd = os.open('static/cards/M5.json', os.O_WRONLY | os.O_TRUNC | os.O_CREAT, 0o644)
os.write(fd, new_bytes); os.fsync(fd); os.close(fd)

# 再從 disk 驗一次（確認沒被 mount layer 截斷）
with open('static/cards/M5.json', 'rb') as f:
    disk = f.read()
disk_data = json.loads(disk.decode('utf-8'))
assert len(disk_data) == len(data), f'disk truncated: orig {len(data)} vs disk {len(disk_data)}'
```

**Pre-push 必跑 audit**（pre-push-audit.py 標準項目）：

```python
import json, glob, sys
fails = []
for fp in glob.glob('static/cards/*.json'):
    try:
        with open(fp, 'rb') as f:
            data = json.load(f)
        if not isinstance(data, list):
            fails.append(f'{fp}: not a list')
        elif len(data) == 0:
            fails.append(f'{fp}: empty list')
    except json.JSONDecodeError as e:
        fails.append(f'{fp}: parse error at {e.lineno}:{e.colno}: {e.msg}')
if fails:
    print('\n'.join(fails)); sys.exit(1)
print(f'All {len(glob.glob("static/cards/*.json"))} JSON files OK')
```

這個 check 5 秒內可跑完，**任何 push 前必跑**。M5.json 改完跑這段就會立刻 catch 截斷，不會推上去。

**Rule 11 / 11c / 11d 差別整理**：

| Rule | 檔案類型 | 截斷模式 | 偵測方式 |
|---|---|---|---|
| 11 | 大檔（>100KB） | 全尾截斷至 HEAD size | size 比對 + 新 marker 缺失 |
| 11b | 任何檔（縮短字串） | 檔尾 NUL byte padding | `b'\x00' in content` 檢查 |
| 11c | `.svelte` / `.ts` / `.html` | 中段截斷（標籤遺失） | tail anchor + `<style>` 對稱 |
| 11d | `.json`（特別是 static/cards/） | 中段截斷（檔尾 cut off） | `json.load()` parse |
| 11e | **Push script 自身** (patch_v*.py / push_v*.py) | Edit 增量改 script 自身會被截斷 | 一次性 heredoc 完整寫入，禁止 Edit 增量 |

**關鍵教訓**：

> Edit 工具改任何「資料檔」（JSON、YAML、CSV、SQL dump 等）都當作「可能截斷」處理。Python pipeline 是唯一安全路徑。改完 disk 後 **必須再 `json.load()` 從 disk 讀回來驗一次** — 不能信「Edit 報告 success」、不能信「剛在記憶體 parse 過的 text」。

---

### Rule 11e: Push script 自身寫法 — 一次性 heredoc，不用 Edit 增量改

v5.022 自食其果案例：用 Edit 增量改自己的 push_v5022.py 加新 replace 段時尾巴被截斷（Rule 11c 套到 script 自身上）。整段 push 流程崩潰。本 session（v5.029~v5.052）全程遵守此規則沒踩到。

**正確寫法**（heredoc marker 用獨特字串）：

```
cat > /tmp/patch_NNN.py << 'MY_UNIQUE_MARKER'
... 整段 Python script 一次寫完 ...
MY_UNIQUE_MARKER
python3 /tmp/patch_NNN.py
```

每次 push 都重寫整段 script — heredoc 是一次性寫入，繞過 Edit 截斷風險。

**禁止寫法**：
- 已存在的 patch_NNN.py 用 Edit 增量加 replace 段
- Write tool 覆寫某段（可能截斷）

**heredoc marker 衝突 trap (v5.052 踩到)**：bash heredoc end marker 比對寬鬆 — script 內含的字面字串只要等於 marker 就會被誤判 end。例：marker 用 PYEOF 但 docstring 內也寫 PYEOF → 提早結束 heredoc，後面 Python code 被當 shell command 執行 syntax error。**對策：用獨特 marker（如 MY_UNIQUE_MARKER），或改用 Write tool 直接寫檔避開 bash 解析**。

**驗證**：script 寫完後 `wc -l /tmp/patch_NNN.py` 或 `tail -3` 確認 EOF 完整。

---

### Rule 12: Wave/cards 子檔案禁止 module top-level 對 effects.ts 內 Map 做 .set()

**症狀**: 瀏覽器 console 報 `ReferenceError: Cannot access 'go' before initialization`
（minified 變數名），整個 game 頁載入時 500，使用者進不去對戰演練。

**根因**: 子檔案（如 `cards/v2999_g3_wave1.ts`）想對 effects.ts 內的 `PASSIVE_ATTACK_BONUS`
等 Map 做 `.set()` 註冊。子檔案的 import + effects.ts 的 import 形成**循環依賴**:
- engine.ts → effects.ts → v2999 → effects.ts (PASSIVE_ATTACK_BONUS)

ESM 評估順序: engine.ts 載入 → effects.ts 開始評估 → effects.ts top imports 讓 v2999
模組先載入 → v2999 module body 執行（包含 .set() 呼叫）→ 但此時 effects.ts body 還沒
跑到 `export const PASSIVE_ATTACK_BONUS = new Map(...)` 那行，所以 PASSIVE_ATTACK_BONUS
是 TDZ（temporal dead zone）→ `.set is not a function` TypeError → effects.ts 整個
模組 init 失敗 → 任何依賴 effects.ts 的檔案都崩潰。

**v2.999 / v2.9991 / v2.9992 踩坑紀錄**:
- v2.999 直接寫 `PASSIVE_ATTACK_BONUS.set(...)` 在 v2999 module top-level → 推上去整個
  game 頁 500
- v2.9991 把 effects.ts 內 v2999 的 `import` 從 L362 移到 L13867（檔案末尾）→ **沒解決**
  因為 ESM imports 會 hoisted，無論 source 寫第幾行都是先評估
- v2.9992 真正修法: 把 v2999 內 3 個 `.set()` 包進 `export function registerV2999G3W1Passives()`，
  effects.ts 在自己 body 末端（Map 已初始化後）呼叫此函式 → 正常運作

**禁止寫法**:
```ts
// ❌ v2999_g3_wave1.ts (子檔案)
import { PASSIVE_ATTACK_BONUS } from '../../effects';

PASSIVE_ATTACK_BONUS.set('憤怒穴', ...);  // ← 在 module top-level 直接呼叫
```

**正確寫法（register pattern）**:
```ts
// ✅ v2999_g3_wave1.ts
import { PASSIVE_ATTACK_BONUS } from '../../effects';

let _registered = false;
export function registerV2999G3W1Passives(): void {
  if (_registered) return; // idempotent
  _registered = true;
  PASSIVE_ATTACK_BONUS.set('憤怒穴', ...);
  PASSIVE_ATTACK_BONUS.set('原始心得', ...);
  PASSIVE_ATTACK_BONUS.set('大晴天', ...);
}
```

```ts
// ✅ effects.ts (在自己 body 末端呼叫)
import { registerV2999G3W1Passives } from './effects/cards/v2999_g3_wave1';
// ... lots of code including export const PASSIVE_ATTACK_BONUS = new Map(...) ...
// 在檔案末尾:
registerV2999G3W1Passives();
```

**為什麼這樣可行**:
1. ESM hoist v2999 import → v2999 module body 執行（只宣告函式，沒呼叫 .set()）✓
2. effects.ts body 跑到 `PASSIVE_ATTACK_BONUS = new Map(...)` → Map 初始化 ✓
3. effects.ts body 末端呼叫 `registerV2999G3W1Passives()` → 此時 Map 已是真物件，`.set()` 成功 ✓

**適用範圍**: 任何 `cards/*.ts` 子檔對 `PASSIVE_xxx`、`ABILITY_EFFECTS`、`TRAINER_EFFECTS`、
`STADIUM_EFFECTS`、`ON_PLAY_FROM_HAND_ABILITIES`、`ON_EVOLVE_FROM_HAND_ABILITIES`、
`PASSIVE_DAMAGE_REDUCE_COND`、`PASSIVE_COIN_AVOID`、`PASSIVE_KO_RETALIATION`、
`PASSIVE_ON_KO`、`PASSIVE_ON_DAMAGED`、`PASSIVE_PREVENT_PRIZE`、`PASSIVE_ATTACKER_BUFF`、
任何 effects.ts 內的 Map / Set 結構做 `.set()` / `.add()` 呼叫，**一律包進 register
function lazy 註冊**。

**例外**: 用 `regA(name, idx, fn)` / `regPre(...)` / `regPost(...)` / `reg(...)` /
`regG(...)` / `regR(...)` 這些 helper 註冊**沒問題**（即使在 module top-level 呼叫），
因為這些 helper 內部存的 Map（ABILITY_EFFECTS / ATTACK_PRE / ATTACK_POST / TRAINER_EFFECTS
/ TRAINER_GUARDS / RESOLVERS）都在 `_shared.ts` 而非 effects.ts，`_shared.ts` 是純 leaf
module 沒循環依賴，TDZ 不會發生。

---

### Rule 13: GameState 欄位禁用 nested array — Firestore 序列化會失敗

**症狀**: 連線對戰開局後出現「等待對手重抽」畫面 → 又重新丟一次硬幣 → 無限循環，
雙端無法進入 playing 階段。Console 可能看到 `FirebaseError: Function setDoc() called
with invalid data. Nested arrays are not supported`。

**根因**: Firestore 規則「array 元素不能是 array」。任何要寫進 `roomData.gameState`
（即整顆 GameState）的欄位都受此限。常見違規類型：

| 違規 type | 例 | 為什麼炸 |
|---|---|---|
| `[T[], T[]]` | `mulliganRevealedHands: [string[][], string[][]]` | 外層 tuple 是 array，內層 `string[][]` 也是 array → array of array |
| `T[][]` | `damageHistory: number[][]` | array of array，最直接的違規 |
| `[[K, V], ...]` | `Map.entries()` 直接 push | 內層 `[K, V]` 是 array |

**v3.741 / v2.84 兩次踩坑紀錄**:
- v2.84：`supporterTagsUsedThisTurn: [string[], string[]]` → push 失敗 → 修成
  `{ p1: string[]; p2: string[] }` 解決
- v3.741：`mulliganRevealedHands: [string[][], string[][]]` → 完全相同的錯
  **同類問題第二次出現**，修法相同（object 包 flat array）

**禁止寫法**:
```ts
// ❌ tuple of array
mulliganRevealedHands: [string[][], string[][]];

// ❌ direct array of array
boardHistory: CardInstance[][];

// ❌ Map entries
auraEffects: [string, number][];
```

**正確寫法（pattern A：per-player object）**:
```ts
// ✅ object 包兩個 flat array
supporterTagsUsedThisTurn?: { p1: string[]; p2: string[] };
```

**正確寫法（pattern B：joined string + parse 時 split）**:
```ts
// ✅ 內層 array 用 delimiter join 成單一 string
mulliganRevealedHands?: { p1: string[]; p2: string[] };
//   每元素例：'cardA|cardB|cardC|cardD|cardE|cardF|cardG'
//   parse 時：hands.map(s => s.split('|'))
```

**正確寫法（pattern C：indexed object）**:
```ts
// ✅ 多層用 object 取代陣列
playerHistory: { p1: Record<string, string[]>; p2: Record<string, string[]> };
```

**Audit 方法 — 新增 GameState 欄位前自我檢查**:

```bash
# 1. 看 types.ts 是否有可疑類型
grep -nE ':\s*\[.*\[\]|:\s*\w+\[\]\[\]' src/lib/game/types.ts

# 2. 任何 [X[], Y[]] / X[][] / [[K,V]] 都是高風險，需要包成 object 結構
```

**為什麼這條容易被忘**:
- 本地測試（無 Firestore）完全沒事 → tsc / svelte-check / npm run build 都過 → 看不出問題
- 只有實際連線對戰時才會炸 → 容易在開發階段漏掉
- 錯誤訊息只在 console / Firestore SDK 內部，玩家看到的是「卡住、無限循環」這種模糊症狀

**檢查清單 — 任何 GameState type 改動都跑一遍**:
- [ ] 新增的欄位 type 是否含 `[][]` 或 tuple 內含 array？→ 改 object pattern
- [ ] 是否 push 到 Fir

---

## Rule 18: 讀對手寶可夢特性必須用 hasActiveAbility helper

**強制要求**：所有「對手戰鬥位是否擁有指定 ability」邏輯都要用 `hasAbilityOnActive(state, oppIdx, pool, '特性名')` helper（在 `v3001_g3_wave3.ts` 內 export）。**禁止 inline check**：

```ts
// ❌ 禁止 — inline check，未來「對手特性消除」機制新增時容易漏改
if (oppAct && !oppAct.abilityNullifiedThisTurn) {
  const card = pool.get(oppAct.cardId);
  if (card?.abilities?.some(a => a.name === 'X')) { ... }
}

// ✅ 正確 — 走 helper，未來新增 nullification 邏輯只改 helper 1 處
if (hasAbilityOnActive(state, oppIdx, pool, 'X')) { ... }
```

**為什麼**：對手戰鬥位特性會被多個機制壓制（招式版暗夜羽擊、passive 振翼髮、火箭隊監視塔、未來會加的 X）。inline check 每次都得手動覆蓋所有 nullification 機制，每加一個新機制就要全 codebase audit。helper 內部統一處理，零維護成本。

**起源**：v5.220 修了濕氣，但漏修同樣被暗夜羽擊壓制的爆大身軀/瞪眼效用/海之詛咒/威迫目光 → v5.221 補修 → v5.222 refactor 改用 helper 統一處理。

**v5.224 擴充**：不只「對手戰鬥位是否擁有某特性」要走 helper，**任何「對手場上特性 holder 提供保護」的 iterate 邏輯**（field-ability 類如花之帷幔/抵抗之幕/球形盾牌/廣域堡壘；self-ability 類如化隱/全能硬殼/緊張感/融合為雪）每一筆 holder 都要透過 `isAbilityHolderEffective(state, inst, card, ownerIdx, abilityName, location, pool)` 過濾。helper 統一處理招式版+passive 暗夜羽擊+海兔獸黏著束縛+abilityNullifiedThisTurn 等所有「特性消除」機制。

```ts
// ❌ 禁止 — iterate 沒檢查 holder 是否被壓制
const hasField = [active, ...bench].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === 'X'));

// ✅ 正確 — 每筆 holder 都過 isAbilityHolderEffective
const hasField = allHolders.some(({ inst, loc }) => {
  const card = pool.get(inst.cardId);
  if (!card?.abilities?.some(a => a.name === 'X')) return false;
  return isAbilityHolderEffective(state, inst, card, ownerIdx, 'X', loc, pool);
});
```

**Audit pattern**:
```bash
# 找所有 inline check 嫌疑（應該 = 0）
grep -rE "abilityNullifiedThisTurn[^|]*abilities\?\.some" src/
```

---

## Rule 19: 首頁 changelog 給玩家看，禁止寫程式碼/檔名/行號/Iron Rules 編號

`src/routes/+page.svelte` 內 `<section class="changelog-section">` 區塊是**公開給玩家看**的版本記錄。內容必須：

**禁止**:
- `<pre>` 程式碼區塊
- `<code>FunctionName</code>` 等英文 identifier（程式名）
- 「`effects.ts L1234`」「`engine.ts L7717`」等檔名 + 行號
- 「Iron Rules: 11/11c/14/15/...」開發者 metadata
- 變數名、API 名、commit SHA、git 指令

**允許**:
- 卡牌名（中文）、招式名、特性名
- 玩家視角的 bug 描述（「XX 招式打不出來」「YY 特性沒生效」）
- 修補影響範圍（「現在可以正常使用」「不會再卡住」）
- 版本號（v5.XXX）+ 簡短說明

**為什麼**:
1. **資安**：程式碼 / 檔案結構 / 內部 API 名稱外洩給玩家或被爬取後可能被 reverse engineering。
2. **可讀性**：玩家不在乎 helper 名稱、行號，只在乎「我之前不能用的招式現在能用了沒」。
3. **專業形象**：commercial-grade 產品的 changelog 都是玩家視角，不是 developer notes。

**開發者 metadata（Iron Rules / 檔名 / 修法細節）寫在哪**：
- commit message
- 本檔案（IRON_RULES.md）
- 長期記憶（spaces/.../memory/）
- 內部文件 / 註解（程式碼 inline comment OK）

**起源**：v5.222 — Wilson 看到 changelog 內 `<code>hasPsyduckDamp</code>` / `engine.ts L2328` 等，要求全面清理 + 訂規。
