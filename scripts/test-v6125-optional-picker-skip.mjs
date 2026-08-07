// v6.125 守衛：卡面「若希望／任意數量／以任意方式／任意選擇」的 picker 必須真的能選 0 張。
//
// 玩家回報：胖嘟嘟｜深海抽出(J)「然後，**若希望**，選擇1張自己的手牌，放回牌庫下方」
//   —— 實際上被**強制**放回 1 張。
//
// 根因不在引擎（minCount 本來就是 0），在 UI 的 `selectionAllowsSkip()`：
//   站規是「已知資訊（棄牌區／我方手牌／場上）預設不給【不選】」，只有 effectKey
//   在 `OPTIONAL_SELECTION_EFFECT_KEYS` 白名單才放行 —— 胖嘟嘟的 key 漏加了。
//
// ⚠⚠ 為什麼不是「再加一個白名單條目」就好：
//   白名單的粒度是 **effectKey**，但站內大量 resolver 是**多張卡共用**的中央管線：
//     ・`discard-to-hand`  ← 長毛狗｜氣味偵測「**任意選擇**」(可 0) + 奇跡耳麥／釣竿MAX／
//                             水蓮的照顧／能量回收「最多N張」(站規必選)
//     ・`v158-energy-chain-start` ← 艾姆利多／椰蛋樹ex「以任意方式／任意數量」(可 0)
//                             + **吉利蛋｜幸運貼附「選擇1張」(必選)**
//   整個 key 放進白名單 ＝ 讓吉利蛋可以跳過必付的代價（公平性漏洞）；不放又違反卡面。
//   ⇒ v6.125 改用 `params.allowSkipZero`，由 **withPending 的呼叫端**逐卡宣告
//     （那裡才知道現在是哪一張卡）。
//
// 本守衛鎖三件事：
//   ① 行為端：受影響的卡跑真流程後，`selectionAllowsSkip()` 必須回 true
//   ② 反向：卡面必選的卡（吉利蛋）不得因此被放行
//   ③ **枚舉守衛（一勞永逸）**：任何 minCount 可為 0 的 withPending 都必須「顯式表態」——
//      新卡漏表態就 CI 紅，不會再靜默沿用「不給不選」
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x125-s.js'), E = join(ROOT, '.x125-e.ts'), O = join(ROOT, '.x125-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { selectionAllowsSkip, selectionConfirmFloor, OPTIONAL_SELECTION_EFFECT_KEYS }\n"
  + "  from './src/lib/game/selection-ui';\n"
  + "export { TRAINER_EFFECTS, RESOLVERS, ATTACK_POST, ABILITY_EFFECTS, ABILITY_EFFECTS_BY_NAME }\n"
  + "  from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const cardText = new Map();   // 'name|effectName' → 卡面原文（HIJ live，多印刷取聯集）
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of [...(c.attacks || []), ...(c.abilities || [])]) {
      const k = c.name + '|' + a.name;
      cardText.set(k, (cardText.get(k) || '') + '\n' + (a.effect || ''));
    }
  }
}

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** UI 端的實際判定：把 pendingSelection 餵進中央述詞（跟 +page.svelte 同一組欄位）。 */
const uiAllowsSkip = (ps) => mod.selectionAllowsSkip({
  type: ps.type, actorIdx: ps.actorIdx, sourcePlayerIdx: ps.sourcePlayerIdx,
  effectKey: ps.effectKey, minCount: ps.minCount,
  allowSkipZero: ps.params?.allowSkipZero === true,
});

let FILLER = null;
for (const [id, c] of pool) { if (c.supertype === 'Trainer') { FILLER = id; break; } }
const inst = (iid, cardId = FILLER) => ({ iid, cardId, damage: 0, energyAttached: [], evolvedFromStack: [] });
function mkState(deckLen = 20, handLen = 5, discardLen = 6) {
  const mk = (pfx) => ({
    name: pfx, active: inst(pfx + 'act'), bench: [], prizes: [],
    hand: Array.from({ length: handLen }, (_, i) => inst(pfx + 'h' + i)),
    deck: Array.from({ length: deckLen }, (_, i) => inst(pfx + 'd' + i)),
    discard: Array.from({ length: discardLen }, (_, i) => inst(pfx + 'x' + i)),
  });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, pendingChainQueue: [],
    setupDone: [true, true], pendingPrizes: [0, 0], players: [mk('p'), mk('q')],
  };
}

console.log('① 行為端：卡面允許選 0 的 picker 必須真的給【不選】');

T('⭐⭐⭐ 胖嘟嘟｜深海抽出（玩家回報）：卡面「若希望」→ 必須能不放回', () => {
  const t = cardText.get('胖嘟嘟|深海抽出');
  ok(t && /若希望/.test(t), '前提破了：卡面已經沒有「若希望」，請重新檢視本守衛');
  const fn = mod.ABILITY_EFFECTS.get('胖嘟嘟|0') ?? mod.ABILITY_EFFECTS_BY_NAME.get('胖嘟嘟|深海抽出');
  ok(fn, '找不到胖嘟嘟｜深海抽出');
  // ⚠ 必須用**真的胖嘟嘟卡**當持有者：特性內部會查 abilities.some(a => a.name === '深海抽出')，
  //   用泛用填充物當 active 會直接落到「找不到持有此特性的寶可夢」而不開 picker。
  const wailord = [...pool.values()].find((c) => c.name === '胖嘟嘟'
    && (c.abilities || []).some((a) => a.name === '深海抽出'));
  ok(wailord, '卡池找不到帶「深海抽出」的胖嘟嘟');
  const s0 = mkState();
  s0.players[0].active = inst('WAILORD', String(wailord.id));
  const s = fn(s0, 0, pool, s0.players[0].active);
  ok(s.pendingSelection, '沒開 picker');
  ok(s.pendingSelection.minCount === 0, '引擎端 minCount 應為 0，實得 ' + s.pendingSelection.minCount);
  ok(uiAllowsSkip(s.pendingSelection),
    'UI 不給【不選】鈕 —— 卡面寫「若希望」，玩家卻被迫放回 1 張手牌。\n'
    + '      （自己的手牌屬「已知資訊」，站規預設不給【不選】，必須逐卡宣告 params.allowSkipZero）');
});

T('⭐⭐ 長毛狗｜氣味偵測：卡面「任意選擇」→ 必須能不拿（v5.881 換 key 時掉的回歸）', () => {
  const t = cardText.get('長毛狗|氣味偵測');
  ok(t && /任意選擇/.test(t), '前提破了：卡面已經沒有「任意選擇」');
  const post = mod.ATTACK_POST.get('長毛狗|氣味偵測');
  ok(post, '找不到長毛狗｜氣味偵測');
  // 擲幣：固定正面（Math.random < 0.5 = 正面）
  const orig = Math.random; Math.random = () => 0.1;
  try {
    const s = post(mkState(), 0, pool, {});
    ok(s.pendingSelection, '沒開 picker（擲幣全正面時應該有得選）');
    ok(uiAllowsSkip(s.pendingSelection), 'UI 不給【不選】鈕 —— 卡面是「任意選擇」');
  } finally { Math.random = orig; }
});

T('⭐⭐ 優雅貓｜能量攪拌：卡面「任意數量／任意方式」→ 必須能不移動', () => {
  const t = cardText.get('優雅貓|能量攪拌');
  ok(t && /任意數量/.test(t) && /任意方式/.test(t), '前提破了');
  const post = mod.ATTACK_POST.get('優雅貓|能量攪拌');
  ok(post, '找不到優雅貓｜能量攪拌');
  const s0 = mkState();
  s0.players[0].active.energyAttached = [inst('e1'), inst('e2')];
  const s = post(s0, 0, pool, {});
  ok(s.pendingSelection, '沒開 picker');
  ok(uiAllowsSkip(s.pendingSelection), 'UI 不給【不選】鈕');
});

T('⭐⭐ 胡地｜奇異駭入：卡面「任意數量／任意方式」→ 必須能不移動指示物', () => {
  const t = cardText.get('胡地|奇異駭入');
  ok(t && /任意數量/.test(t), '前提破了');
  const post = mod.ATTACK_POST.get('胡地|奇異駭入');
  ok(post, '找不到胡地｜奇異駭入');
  const s0 = mkState();
  s0.players[1].active.damage = 30;
  const s = post(s0, 0, pool, {});
  ok(s.pendingSelection, '沒開 picker');
  ok(uiAllowsSkip(s.pendingSelection), 'UI 不給【不選】鈕');
});

console.log('② 反向：卡面必選的卡不得被連帶放行（共用 resolver 的公平性）');

T('⭐⭐⭐ 吉利蛋｜幸運貼附：卡面「選擇1張」無「最多」→ 必選，且不得可跳過', () => {
  const t = cardText.get('吉利蛋|幸運貼附');
  ok(t, '找不到吉利蛋｜幸運貼附的卡面');
  ok(!/最多|任意數量|任意方式|若希望/.test(t),
    '卡面已經變成可選 0 的措辭了，請重新檢視本守衛：' + t.trim());
  const post = mod.ATTACK_POST.get('吉利蛋|幸運貼附');
  ok(post, '找不到吉利蛋｜幸運貼附');
  const s0 = mkState();
  s0.players[0].hand = [inst('E1', String([...pool.values()].find(
    (c) => c.supertype === 'Energy' && c.subtype === 'Basic').id))];
  const s = post(s0, 0, pool, {});
  if (!s.pendingSelection) return;   // 手上沒有基本能量時不開 picker，合理
  ok(s.pendingSelection.minCount >= 1,
    '吉利蛋的 minCount 應為 1（卡面「選擇1張」）—— 靠「不在白名單」間接擋是脆弱的巧合');
  ok(!uiAllowsSkip(s.pendingSelection),
    '吉利蛋竟然可以跳過必付的附能代價（共用 v158-energy-chain-start 的放行外溢）');
});

T('⭐⭐ 艾姆利多｜滿載心田（同 key 的可選 0 者）仍然可以不附 —— 證明分流有效', () => {
  const t = cardText.get('艾姆利多|滿載心田');
  ok(t && /任意方式/.test(t), '前提破了');
  const post = mod.ATTACK_POST.get('艾姆利多|滿載心田');
  ok(post, '找不到艾姆利多｜滿載心田');
  const s0 = mkState();
  const psy = [...pool.values()].find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
    && /【超】/.test(c.name));
  ok(psy, '卡池找不到基本【超】能量');
  s0.players[0].hand = [inst('E1', String(psy.id)), inst('E2', String(psy.id))];
  const s = post(s0, 0, pool, {});
  ok(s.pendingSelection, '沒開 picker');
  ok(uiAllowsSkip(s.pendingSelection),
    '艾姆利多不能不附 —— 但它跟吉利蛋共用同一個 effectKey，'
    + '兩者必須分流（這就是 params.allowSkipZero 存在的理由）');
});

console.log('③ ⭐⭐⭐ 枚舉守衛：任何 minCount 可為 0 的 picker 都必須「顯式表態」');

/**
 * 站規：已知資訊（棄牌區／我方手牌／我方場上）預設**必選至少 1**。
 * 這份清單是「站長裁定維持必選」的 minCount:0 picker —— 它們的 minCount 是**技術性**設定
 * （候選可能為空時避免 picker 卡死），不是「卡面允許選 0」。
 *
 * ⚠ 2026-08-07 站長裁定：卡面純「最多N張」（**沒有**「任意數量／若希望／任意方式／任意選擇」）
 *   的已知資訊 picker，維持必選 ≥1，站長會再逐張複核。在複核前，新增同型卡請放進這裡。
 *   既有先例：v5.964 N的謀劃「最多2個」維持強制 ≥1；豐收漁網註解「發動後必選」。
 */
const MANDATORY_BY_SITE_RULE = new Set([
  'friend-book-return',          // 朋友手冊(G)：最多2張支援者回牌庫
  'energy-sticker-pick',         // 能量貼紙(G)：擲正面後「選擇1張」＝必選
  'restart-box-attach',          // 重新啟動箱(H)：「所有『未來』寶可夢各1張」無數量自由
  'fishnet-unified',             // 豐收漁網(J)：最多各3張（既有註解已裁定必選）
  'gypso-pick-energies',         // 吉普索(J)：最多2張
  'taragun-to-hand',             // 塔拉剛(J)：合計最多4張
  'glass-trumpet-start',         // 玻璃喇叭(H)：最多2隻
  'bench-from-discard-samename', // 鳳王｜復生火焰(J)／夜巡靈｜前往渡魂(H)／刺龍王ex｜王之號召(H)：最多3張
  'regi-charge',                 // 雷吉艾斯ex／雷吉斯奇魯ex｜雷吉充能(J)：最多2張
  'discard-to-hand',             // 奇跡耳麥(H)／釣竿MAX(H)／水蓮的照顧(H)／能量回收(I)：最多N張
                                 //   ⚠ 同 key 的長毛狗｜氣味偵測是「任意選擇」→ 走 params 旗標分流
  'piper-greedy-pick-sandwich',  // 派帕的藏飽栗鼠｜貪慾點餐(I)：最多2張
  'sacred-ash-discard-to-deck',  // 聖灰(I)：最多5張
  'sari-return-then-search',     // 沙儷(H)：最多2張
  'gold-flame-pick-energy',      // 阿響的鳳王ex｜金色火焰(I)：最多2張
  'n-plot-energy-move',          // N的謀劃(I)：最多2個 —— v5.964 站長已裁定維持必選
  'twin-cell-evolve-pick-base',  // 雙卵細胞球｜細胞進化(I)：卡面「選擇1張」＝必選
  'evil-awakening-pick-base',    // 火箭隊的尼多娜｜惡之覺醒(I)：最多2隻
  'h-wave2-attach-from-hand',    // 大電海燕ex｜迴旋充能(H)：最多2張
  'clamperl-bombard-attach',     // 鋼炮臂蝦｜返回重載(I)：最多2張
  'v158-energy-chain-start',     // 吉利蛋｜幸運貼附(H)「選擇1張」＝必選（同 key 的可選 0 者走 params 旗標）
  'h-wave2-pickup-energy-to-bench-stage1',  // 花舞鳥｜能量支援(H)「附於1隻」＝必選
                                 //   ⚠ 同 factory 的渦輪刀鋒／啪滋啪滋充電／能量寫生「以任意方式」→ 走 params 旗標
  'h-wave2-discard-back-to-deck',// 烏波｜打水(H)：最多3張，無「任意」字樣
  'm5-mirieton-photon-code',     // 密勒頓｜光子纜線(J)：最多2張，無「任意」字樣
  'lighting-city-pick',          // 釀光市(I)：最多2張，無「任意」字樣
  'v310-discard-pickup-energy-to-any-stage1',  // ⚠ 死碼：discardSearchAttachToAnyPost 零呼叫者
  'h-wave2-pickup-energy-to-hand',             // ⚠ 死碼：discardSearchBasicEnergiesPost 零呼叫者
                                 //   （v3.09/v3.10 已把渦輪刀鋒等改成「附於備戰」，這個 factory 就沒人用了）
  'brailliant-attach',           // 力之沙漏(H)：回合結束「可」從棄牌區附基本能量（在 legacy 白名單裡）
  'photon-code-pick-energy',     // 密勒頓｜光子纜線(J) 第一段選能量：最多2張
]);

/**
 * 掃 src/lib/game 下**所有** pendingSelection 物件字面量。
 *
 * ⚠ 不能只掃 `withPending(` 之後的第一個 `{` —— 兩個實測踩到的盲點：
 *   ① `withPending(addLog(st, \`…${x}…\`, i), { … })` —— template literal 的 `${` 會讓
 *      「往後找第一個 {」抓到字串內部，整個括號配對錯位（光子纜線就是這樣被漏掉）。
 *   ② engine.ts 有直接寫 `return { …, pendingSelection: { … } }` 的地方，根本沒有 withPending
 *      （力之沙漏 brailliant-attach）。
 * ⇒ 改以 `effectKey: '…'` 為錨點，**往回**配對出包住它的那個 `{`，再往後配對到 `}`。
 *   template literal 的 `${…}` 本身是成對的，不影響回推。
 */
function scanPendings() {
  const out = [];
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === 'node_modules' || f.startsWith('.')) continue;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.ts$/.test(f)) files.push(p);
    }
  })(join(ROOT, 'src/lib/game'));

  for (const p of files) {
    const s = readFileSync(p, 'utf8');
    const re = /effectKey:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(s))) {
      // 往回配對：找到包住這個 effectKey 的物件字面量開頭
      let depth = 0, open = -1;
      for (let k = m.index; k >= 0; k--) {
        const ch = s[k];
        if (ch === '}') depth++;
        else if (ch === '{') { if (depth === 0) { open = k; break; } depth--; }
      }
      if (open < 0) continue;
      // 往後配對到結尾
      let d2 = 0, close = -1;
      for (let k = open; k < s.length; k++) {
        if (s[k] === '{') d2++;
        else if (s[k] === '}') { d2--; if (d2 === 0) { close = k; break; } }
      }
      if (close < 0) continue;
      const body = s.slice(open, close + 1);
      const g = (r) => { const mm = r.exec(body); return mm ? mm[1].trim() : null; };
      const type = g(/type:\s*'([^']+)'/);
      if (!type) continue;   // 不是 pendingSelection（例如 RESOLVERS.set 的參數）
      const minRaw = g(/minCount:\s*([^,\n]+)/);
      const srcIdx = g(/sourcePlayerIdx:\s*([^,\n]+)/);
      const actIdx = g(/actorIdx:\s*([^,\n]+)/);
      const skipRaw = g(/allowSkipZero:\s*([^,\n}]+)/);
      out.push({
        file: p.slice(ROOT.length), type, eff: m[1], minRaw, skipRaw,
        canBeZero: minRaw !== null && (minRaw === '0' || /(\?|:)\s*0\b/.test(minRaw)),
        sameSide: srcIdx !== null && actIdx !== null
          && srcIdx.replace(/\s/g, '') === actIdx.replace(/\s/g, ''),
      });
    }
  }
  return out;
}

T('⭐⭐⭐ 每個 minCount 可為 0 的 picker 都必須顯式表態（新卡漏表態就會紅）', () => {
  const all = scanPendings();
  ok(all.length > 400, '掃描器壞了？只掃到 ' + all.length + ' 個 pendingSelection');
  const unspoken = [];
  for (const x of all) {
    if (!x.canBeZero) continue;
    // 表態方式 1：params.allowSkipZero（字面 true 或 factory 傳進來的變數）
    if (x.skipRaw !== null) continue;
    // 表態方式 2：未知資訊 picker（牌庫／牌庫頂排序／對手手牌）— 站規本來就給【不選】
    if (x.type === 'deck-search' || x.type === 'reorder-deck-top') continue;
    if ((x.type === 'hand-discard' || x.type === 'hand-choose') && !x.sameSide) continue;
    // 表態方式 3：既有 effectKey 白名單（legacy，不再擴充）
    if (mod.OPTIONAL_SELECTION_EFFECT_KEYS.has(x.eff)) continue;
    // 表態方式 4：站規維持必選的具名豁免清單
    if (MANDATORY_BY_SITE_RULE.has(x.eff)) continue;
    unspoken.push(`${x.type} | ${x.eff} | ${x.file}`);
  }
  ok(unspoken.length === 0,
    '這些 picker 的 minCount 可以是 0，卻沒有表明「卡面到底允不允許選 0」：\n      '
    + [...new Set(unspoken)].join('\n      ')
    + '\n      → 請讀卡面後二選一：\n'
    + '        ・卡面有「若希望／任意數量／以任意方式／任意選擇」→ params 加 `allowSkipZero: true`\n'
    + '        ・卡面是「最多N張」或必選 → 加進本檔的 MANDATORY_BY_SITE_RULE（附卡名與卡面原文）');
});

T('⭐ 正對照：把一個「沒表態」的假 pending 餵進同一判準，必須被抓到', () => {
  const probe = { type: 'hand-discard', eff: 'brand-new-card-someone-forgot',
    canBeZero: true, skipRaw: null, sameSide: true, file: 'probe.ts' };
  const caught = !(probe.type === 'deck-search' || probe.type === 'reorder-deck-top')
    && !(( probe.type === 'hand-discard' || probe.type === 'hand-choose') && !probe.sameSide)
    && !mod.OPTIONAL_SELECTION_EFFECT_KEYS.has(probe.eff)
    && !MANDATORY_BY_SITE_RULE.has(probe.eff) && probe.skipRaw === null;
  ok(caught, '正對照失效 —— 新卡漏表態不會被抓到');
});

console.log('④ 白名單衛生');

T('⭐ OPTIONAL_SELECTION_EFFECT_KEYS 不得留下沒有任何 withPending 在用的死條目', () => {
  const live2 = new Set(scanPendings().map((x) => x.eff));
  const dead = [...mod.OPTIONAL_SELECTION_EFFECT_KEYS].filter((k) => !live2.has(k));
  ok(dead.length === 0,
    '白名單有死條目（沒有任何 withPending 用這個 effectKey）：' + dead.join('、')
    + '\n      → 死條目會讓人誤以為那張卡「已經處理過了」。'
    + '\n      （事故：長毛狗｜氣味偵測的 wave17-pickup-energy-to-hand 在 v5.881 換 key 後成為死碼，'
    + '\n        它的【不選】鈕就這樣無聲消失了。）');
});

console.log('\n=== v6.125「若希望」可選 0 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
