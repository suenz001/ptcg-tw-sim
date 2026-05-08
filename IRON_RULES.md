# PTCG-tw-sim Iron Rules（鐵律）

> 最後更新：v2.9992（2026-05-08）
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

This rule has been violated in v2.461, v2.733, and v2.82 (each of which required a follow-up patch). When writing a changelog with code-like fragments — generics, type signatures, comparison operators, object literals — assume the parser will choke and escape proactively.

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

## 完整版

完整 SKILL.md（含 Python git plumbing pipeline 範本、pre-flight checklist、
common failure patterns）放在 `outputs/ptcg-push/SKILL.md`。本檔僅同步 Iron Rules
section。
