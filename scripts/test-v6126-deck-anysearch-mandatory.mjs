// v6.126 守衛：牌庫搜尋可否選 0，判準是「搜尋對象**帶不帶條件**」，不是「是不是從牌庫」。
//
// 站長原本的裁定是「凡是從牌庫搜尋的，因為牌庫是未知內容，都應該可以不選」。
// 查證官方規則後**必須收窄**——`PTCG RULES/PTCG_RULES.md` 有四條明文反例：
//   L1454 親送無人機　　　　「不可以。這個情況下，必須選擇1張卡。」
//   L1708 仙后　　　　　　　「不可以。必須選擇1張以上的卡加入手牌中。」
//   L2333 君主蛇ex｜青草命令「不可以。必須選擇1張以上的卡牌加入手牌。」
//   L1373 呆呆王ex｜才智頭擊「不可以。**若查看牌庫，必須選擇1張以上**的卡加入手牌。」
//
// ⚠⚠ 最關鍵的是君主蛇ex：它卡面寫「**若希望**，從自己的牌庫**任意選擇**最多3張卡加入手牌」，
//   官方卻裁定**不可以選 0**。⇒ **卡面有「若希望」不等於可以選 0**（這推翻了 v6.125 的直覺判準）。
//
// 官方真正的判準：
//   ・**帶條件**的搜尋（找寶可夢卡／能量卡／特定名稱…）→ 可宣告「找不到」而選 0（fail-to-find）
//   ・**無條件「任意選擇」**（任何卡都行）→ 牌庫非空就一定找得到 ⇒ **必須選 1 張以上**
//
// 站長裁定的兩個例外（2026-08-07）：
//   ① 完全體攪拌器(H)「任意選擇最多5張卡，將其**丟棄**」——官方四條判例都是「加入手牌」（拿利益），
//      丟棄型是**代價**，不類推，保持可選 0。
//   ② 賽富豪｜抓到飽(I)「擲硬幣直到反面…最多與正面次數相同數量」——擲 0 個正面時可選張數是 0，
//      寫成 `Math.min(1, maxCount)` 自然不會卡死 picker。
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x126-s.js'), E = join(ROOT, '.x126-e.ts'), O = join(ROOT, '.x126-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_EFFECTS, ATTACK_POST, RESOLVERS } from './src/lib/game/effects';\n"
  + "export { ABILITY_EFFECTS, ABILITY_EFFECTS_BY_NAME } from './src/lib/game/effects/_shared';\n"
  + "export { selectionAllowsSkip, OPTIONAL_SELECTION_EFFECT_KEYS } from './src/lib/game/selection-ui';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const anySearchCards = new Map();   // 卡名 → 效果原文（HIJ live，卡面有「從牌庫任意選擇」）
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    const rows = [['', c.rulesText || '']];
    for (const a of [...(c.attacks || []), ...(c.abilities || [])]) rows.push([a.name, a.effect || '']);
    for (const [n, t] of rows) {
      if (t && /從(自己的)?牌庫任意選擇/.test(t)) {
        anySearchCards.set(c.name + (n ? '|' + n : ''), t);
      }
    }
  }
}

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

let FILLER = null;
for (const [id, c] of pool) { if (c.supertype === 'Trainer') { FILLER = id; break; } }
const inst = (iid, cardId = FILLER) => ({ iid, cardId, damage: 0, energyAttached: [], evolvedFromStack: [] });
const mkState = () => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, pendingChainQueue: [],
  setupDone: [true, true], pendingPrizes: [0, 0],
  players: [0, 1].map((i) => ({
    name: 'p' + i, active: inst('a' + i), bench: [], prizes: [],
    hand: Array.from({ length: 4 }, (_, k) => inst(`h${i}${k}`)),
    deck: Array.from({ length: 20 }, (_, k) => inst(`d${i}${k}`)),
    discard: Array.from({ length: 5 }, (_, k) => inst(`x${i}${k}`)),
  })),
});
const uiSkip = (ps) => mod.selectionAllowsSkip({
  type: ps.type, actorIdx: ps.actorIdx, sourcePlayerIdx: ps.sourcePlayerIdx,
  effectKey: ps.effectKey, minCount: ps.minCount,
  allowSkipZero: ps.params?.allowSkipZero === true,
});
/** 盡力驅動一張卡開 picker（招式／特性／訓練家三種）。驅不動回 null，不當失敗。 */
function open(key) {
  const st = mkState();
  const post = mod.ATTACK_POST.get(key);
  if (post) { try { return post(st, 0, pool, {}).pendingSelection; } catch { return null; } }
  const nm = key.split('|')[0];
  const ab = mod.ABILITY_EFFECTS_BY_NAME.get(key) ?? mod.ABILITY_EFFECTS.get(nm + '|0');
  if (ab) {
    const card = [...pool.values()].find((c) => c.name === nm);
    st.players[0].active = inst('SELF', String(card?.id ?? FILLER));
    try { return ab(st, 0, pool, st.players[0].active).pendingSelection; } catch { return null; }
  }
  const tr = mod.TRAINER_EFFECTS.get(key);
  if (tr) {
    if (key === '仙后') st.players[0].hand = [inst('only')];
    try { return tr(st, 0, pool).pendingSelection; } catch { return null; }
  }
  return null;
}

console.log('① 官方裁定：從牌庫「任意選擇」（無條件）必須選 1 張以上');

/** 站長裁定的例外：卡面是「任意選擇…**丟棄**」＝付代價，不套官方「加入手牌」的判例。 */
const DISCARD_TYPE_EXEMPT = new Set(['完全體攪拌器']);

T('⭐⭐⭐ 逐卡行為端：卡面「從牌庫任意選擇」的 HIJ 卡都不得可跳過', () => {
  const bad = [], undriven = [];
  for (const [key, text] of anySearchCards) {
    const name = key.split('|')[0];
    if (DISCARD_TYPE_EXEMPT.has(name)) continue;
    const ps = open(key);
    if (!ps) { undriven.push(key); continue; }
    if (uiSkip(ps)) bad.push(`${key}（min=${ps.minCount}）`);
  }
  ok(bad.length === 0,
    '這些卡可以「1 張都不選」，違反官方裁定（PTCG_RULES.md L1454/L1708/L2333/L1373）：\n      '
    + bad.join('\n      ')
    + '\n      → minCount 應為 Math.min(1, maxCount)（maxCount 可能因擲幣為 0）');
  // 驅不動的卡不算失敗，但要有數量下限，確保這條測試真的有在跑
  ok(anySearchCards.size - undriven.length >= 8,
    '只驅動到 ' + (anySearchCards.size - undriven.length) + ' 張，測試涵蓋不足（驅不動：' + undriven.join('、') + '）');
});

T('⭐⭐ 站長裁定例外：完全體攪拌器（丟棄型）維持可選 0', () => {
  ok(anySearchCards.has('完全體攪拌器'), '前提破了：完全體攪拌器不再是「任意選擇」型');
  ok(/丟棄/.test(anySearchCards.get('完全體攪拌器')), '前提破了：它不再是丟棄型');
  const ps = open('完全體攪拌器');
  ok(ps, '沒開 picker');
  ok(uiSkip(ps),
    '完全體攪拌器被改成必選了 —— 站長裁定：官方四條判例都是「加入手牌」（拿利益），\n'
    + '      丟棄自己的牌是**代價**，不類推，維持可選 0。');
});

T('⭐ 對照組：**帶條件**的牌庫搜尋仍然可以選 0（官方 fail-to-find，站長直覺在這裡成立）', () => {
  // 用中央 resolver 的一般搜尋契約驗證：deck-search + minCount 0 → 可跳過
  ok(mod.selectionAllowsSkip({ type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0,
    effectKey: 'search-to-hand-reshuffle', minCount: 0 }),
    '帶條件的牌庫搜尋被誤擋了 —— 官方 L832「可以1張卡牌都不選擇…也需要重洗牌庫」');
});

console.log('② 「程式自己承諾可跳過」與 UI 不得自相矛盾');

/**
 * 判準：resolver 的 0-branch／titleOverride／log 只要寫了「可跳過／可不選／或跳過」，
 * UI 就必須真的給【不選】鈕。完全不需猜卡面 —— 程式自己宣告了。
 * （v6.126 用這條抓到 雙卵細胞球｜細胞進化、火箭隊的尼多娜｜惡之覺醒、密勒頓｜光子纜線 phase 1。）
 */
const PROMISE = /可跳過|可不選|或跳過|可以不選/;
function scanPromised() {
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
      let d = 0, open2 = -1;
      for (let k = m.index; k >= 0; k--) {
        const ch = s[k];
        if (ch === '}') d++; else if (ch === '{') { if (d === 0) { open2 = k; break; } d--; }
      }
      if (open2 < 0) continue;
      let d2 = 0, close = -1;
      for (let k = open2; k < s.length; k++) {
        if (s[k] === '{') d2++; else if (s[k] === '}') { d2--; if (d2 === 0) { close = k; break; } }
      }
      if (close < 0) continue;
      const body = s.slice(open2, close + 1);
      const g = (r) => { const x = r.exec(body); return x ? x[1].trim() : null; };
      const type = g(/type:\s*'([^']+)'/); if (!type) continue;
      const minRaw = g(/minCount:\s*([^,\n]+)/);
      if (!(minRaw !== null && (minRaw === '0' || /(\?|:)\s*0\b/.test(minRaw)))) continue;
      const ctx = s.slice(Math.max(0, open2 - 400), close + 1);
      if (!PROMISE.test(ctx)) continue;
      const srcIdx = g(/sourcePlayerIdx:\s*([^,\n]+)/), actIdx = g(/actorIdx:\s*([^,\n]+)/);
      out.push({
        eff: m[1], type, file: p.slice(ROOT.length),
        allowSkip: g(/allowSkipZero:\s*([^,\n}]+)/) !== null,
        same: srcIdx !== null && actIdx !== null && srcIdx.replace(/\s/g, '') === actIdx.replace(/\s/g, ''),
        promise: (PROMISE.exec(ctx) || [])[0],
      });
    }
  }
  return out;
}

T('⭐⭐⭐ 程式寫「可跳過／可不選」的 picker，UI 必須真的給【不選】鈕', () => {
  const bad = [];
  for (const x of scanPromised()) {
    const skip = mod.selectionAllowsSkip({
      type: x.type, actorIdx: 0, sourcePlayerIdx: x.same ? 0 : 1,
      effectKey: x.eff, minCount: 0, allowSkipZero: x.allowSkip,
    });
    if (!skip) bad.push(`${x.type} | ${x.eff}（承諾「${x.promise}」）${x.file}`);
  }
  ok(bad.length === 0,
    '程式自己承諾可跳過，UI 卻不給【不選】鈕（自打嘴巴，resolver 的 0-branch 成死碼）：\n      '
    + [...new Set(bad)].join('\n      ')
    + '\n      → params 加 `allowSkipZero: true`，或把那句承諾文字改掉。');
});

T('⭐ 正對照：把一個「承諾可跳過但沒宣告旗標」的假 pending 餵進同一判準，必須被抓到', () => {
  ok(!mod.selectionAllowsSkip({ type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0,
    effectKey: 'some-new-card-that-promises-skip', minCount: 0, allowSkipZero: false }),
    '正對照失效 —— 已知資訊 picker 未宣告旗標時應該回 false');
});

console.log('③ 白名單／豁免清單不得互相矛盾');

T('⭐ MANDATORY 清單與 OPTIONAL 白名單不得同時收錄同一個 key（講反話的死註解）', () => {
  const guardSrc = readFileSync(join(ROOT, 'scripts/test-v6125-optional-picker-skip.mjs'), 'utf8');
  const m = /const MANDATORY_BY_SITE_RULE = new Set\(\[([\s\S]*?)\]\);/.exec(guardSrc);
  ok(m, '找不到 v6125 守衛的 MANDATORY_BY_SITE_RULE');
  // ⚠ 抽 key 前要先剝掉註解 —— 註解裡也會出現 '…' 的 key 名（例如「移除 'brailliant-attach'」），
  //   不剝就會把已經移除的條目又算成「還在清單裡」（第一版守衛就是這樣誤報的）。
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const keys = [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const clash = keys.filter((k) => mod.OPTIONAL_SELECTION_EFFECT_KEYS.has(k));
  ok(clash.length === 0,
    '這些 key 同時被列為「站規必選」與「OPTIONAL 白名單放行」：' + clash.join('、')
    + '\n      → 兩份清單講反話，其中一份是死註解，會誤導日後的判斷。');
});

console.log('\n=== v6.126 牌庫「任意選擇」必選 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
