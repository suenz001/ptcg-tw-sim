/**
 * v6.181 守衛 —— 兩個 bug 家族，一支測試。
 *
 * 玩家回報（戰槌龍ex｜破壞頭錘）：
 *   卡面「若這隻寶可夢**在戰鬥場上**，則在自己的回合時可使用1次。」
 *   (a) 在備戰區時 UI 仍給特性按鈕；
 *   (b) 按下去跳「必須在戰鬥場才能使用」，**但本回合的特性權已經被吃掉**
 *       ⇒ 同回合移到戰鬥場也不能再用。
 *
 * 真因兩層：
 *   維度 A：可用性判定有**兩份**——UI 讀 engine.getUsableAbilities，引擎的 USE_ABILITY
 *           另外走自己那串 if；卡面的位置限制只寫在該卡 regA 內部的 early-return。
 *   維度 B：USE_ABILITY 是「**先標記** abilityUsedThisTurn、**再執行**特性函式」
 *           ⇒ 特性函式 early-return 一行 log 時，特性權已經沒了（拒絕留下副作用）。
 *
 * 中央收斂：
 *   1) 引擎的 USE_ABILITY 直接以 getUsableAbilities 為唯一述詞（不在清單裡 = 完全不執行）。
 *   2) `rejectAbilityUse()` + applyAction 的單一出口：拒絕 ⇒ 原樣回傳動作前的 state。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6181-s.js'), E = join(ROOT, '.v6181-e.ts'), O = join(ROOT, '.v6181-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n" +
  "export { ABILITY_EFFECTS_BY_NAME, rejectAbilityUse } from './src/lib/game/effects/_shared';\n" +
  "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (c.regulationMark && 'HIJ'.includes(c.regulationMark) && !byName.has(c.name)) byName.set(c.name, c);
  }
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m); } };
const idOf = (n) => { const c = byName.get(n); if (!c) throw new Error('卡不在 live HIJ 卡池：' + n); return String(c.id); };

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolsAttached: [],
  status: null, secondaryStatus: null, tertiaryStatus: null, abilityUsedThisTurn: false,
  evolvedThisTurn: false, playedFromHand: false, justPlaced: false, movedToActiveThisTurn: false,
  evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [],
  prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mkState = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [P(p0), P(p1)],
});
const listed = (st, ab) => mod.getUsableAbilities(st, pool).some(u => u.abilityName === ab);
const FILLER = idOf('皮卡丘');
const GRASS = idOf('基本【草】能量');
const FIRE = idOf('基本【火】能量');
const LTNG = idOf('基本【雷】能量');

// ══ 1. 戰槌龍ex｜破壞頭錘 — 卡面「若這隻寶可夢在戰鬥場上…」 ═══════════════
const WAR = idOf('戰槌龍ex');
{
  const w = inst(WAR);
  const st = mkState({ active: inst(FILLER), bench: [w] },
                     { active: inst(FILLER, { energyAttached: [inst(GRASS)] }) });
  ok(!listed(st, '破壞頭錘'), '(A) 戰槌龍ex 在備戰區 → 不該出現在可用特性清單');
  const noE = mkState({ active: inst(FILLER), bench: [inst(WAR)] }, { active: inst(FILLER) });
  ok(!listed(noE, '破壞頭錘'),
     '(A2) 對手戰鬥位沒有能量 → 不該列出（與逐字同構的 毒粉蛾｜微風吹拂 同一判準）');
  const after = mod.applyAction(st, { type: 'USE_ABILITY', iid: w.iid, abilityIndex: 0 }, pool);
  ok(after.players[0].bench[0].abilityUsedThisTurn === false,
     '(B) 備戰時按特性 → 不得消耗「本回合已使用特性」（拒絕必須是完全 no-op）');
  ok(after.log.length === st.log.length, '(B2) 被拒絕的動作不該留下任何 log/副作用');
}
{
  // 正對照：在戰鬥場就必須能用（別把 gate 寫成永遠擋住）
  const w = inst(WAR);
  const st = mkState({ active: w, bench: [] },
                     { active: inst(FILLER, { energyAttached: [inst(GRASS)] }) });
  ok(listed(st, '破壞頭錘'), '(C) 戰槌龍ex 在戰鬥場 → 必須出現在可用清單');
  const after = mod.applyAction(st, { type: 'USE_ABILITY', iid: w.iid, abilityIndex: 0 }, pool);
  ok(after.players[0].active.abilityUsedThisTurn === true, '(C2) 正常使用時仍要消耗特性權');
}

// ══ 2. 弱丁魚ex｜大洋增輝 — 同型（位置 + 已滿血無事可做）════════════════════
const WEAK = idOf('弱丁魚ex');
{
  const k = inst(WEAK, { damage: 50 });
  const st = mkState({ active: inst(FILLER), bench: [k] }, { active: inst(FILLER) });
  ok(!listed(st, '大洋增輝'), '(D) 弱丁魚ex 在備戰區 → 不該列出');
  const after = mod.applyAction(st, { type: 'USE_ABILITY', iid: k.iid, abilityIndex: 0 }, pool);
  ok(after.players[0].bench[0].abilityUsedThisTurn === false, '(D2) 備戰時按下 → 不得消耗特性權');

  const full = inst(WEAK, { damage: 0 });
  const st2 = mkState({ active: full, bench: [] }, { active: inst(FILLER) });
  ok(!listed(st2, '大洋增輝'), '(E) 戰鬥場但 HP 全滿 → 不該列出（恢復 50 HP 無事可做）');

  const hurt = inst(WEAK, { damage: 50 });
  const st3 = mkState({ active: hurt, bench: [] }, { active: inst(FILLER) });
  ok(listed(st3, '大洋增輝'), '(E2) 戰鬥場且受傷 → 必須列出');
  const a3 = mod.applyAction(st3, { type: 'USE_ABILITY', iid: hurt.iid, abilityIndex: 0 }, pool);
  ok(a3.players[0].active.damage === 0, '(E3) 正常使用要真的恢復 50 HP');
}

// ══ 3. 「擲幣 → 對手備戰互換」家族：對手備戰為空 ════════════════════════════
for (const [card, ab] of [['尼多后', '母親的誘引'], ['花潔夫人', '媚惑引誘']]) {
  const h = inst(idOf(card));
  const empty = mkState({ active: h, bench: [] }, { active: inst(FILLER), bench: [] });
  ok(!listed(empty, ab), `(F) ${card}｜${ab}：對手備戰區為空 → 不該列出`);
  const withBench = mkState({ active: h, bench: [] }, { active: inst(FILLER), bench: [inst(FILLER)] });
  ok(listed(withBench, ab), `(F2) ${card}｜${ab}：對手備戰有寶可夢 → 必須列出`);
}

// ══ 4. 已知區資源 gate（卡面逐字 / 公開張數）════════════════════════════════
{
  const e = inst(idOf('鴨嘴炎獸'));
  const noRes = mkState({ active: e, bench: [] }, { active: inst(FILLER) });
  ok(!listed(noRes, '拍檔提升'), '(G) 拍檔提升：手牌無【火】/【雷】基本能量 → 不該列出');
  const yes = mkState({ active: e, bench: [], hand: [inst(FIRE)] }, { active: inst(FILLER) });
  ok(listed(yes, '拍檔提升'), '(G2) 拍檔提升：手牌有基本【火】能量且場上有鴨嘴炎獸 → 必須列出');
  const onlyLtng = mkState({ active: inst(FILLER), bench: [e], hand: [inst(LTNG)] }, { active: inst(FILLER) });
  ok(listed(onlyLtng, '拍檔提升'), '(G3) 拍檔提升：卡面沒有位置限制，備戰也能用');
}
{
  const d = inst(idOf('杖尾鱗甲龍'));
  const noDeck = mkState({ active: d, bench: [], deck: [] }, { active: inst(FILLER) });
  ok(!listed(noDeck, '鱗片律動'), '(H) 鱗片律動：牌庫 0 張 → 不該列出');
  const yes = mkState({ active: d, bench: [], deck: [inst(GRASS)] }, { active: inst(FILLER) });
  ok(listed(yes, '鱗片律動'), '(H2) 鱗片律動：牌庫非空且自己是【龍】 → 必須列出');
}
{
  const g = inst(idOf('銀伴戰獸'));
  const hasHand = mkState({ active: g, bench: [], hand: [inst(GRASS)], deck: [inst(GRASS)] }, { active: inst(FILLER) });
  ok(!listed(hasHand, '拍檔呼喚'), '(I) 拍檔呼喚：卡面「若自己1張手牌都沒有」→ 有手牌時不該列出');
  const empty = mkState({ active: g, bench: [], hand: [], deck: [inst(GRASS)] }, { active: inst(FILLER) });
  ok(listed(empty, '拍檔呼喚'), '(I2) 拍檔呼喚：手牌 0 張且牌庫非空 → 必須列出');
}
for (const [card, ab] of [['竹蘭的尖牙陸鯊', '王者呼聲'], ['蓋諾賽克特ex', '金屬信號'], ['銃嘴大鳥', '天空抽出']]) {
  const h = inst(idOf(card));
  const st = mkState({ active: h, bench: [], deck: [] }, { active: inst(FILLER) });
  ok(!listed(st, ab), `(J) ${card}｜${ab}：牌庫 0 張 → 不該列出`);
  const st2 = mkState({ active: h, bench: [], deck: [inst(GRASS)] }, { active: inst(FILLER) });
  ok(listed(st2, ab), `(J2) ${card}｜${ab}：牌庫非空 → 必須列出（不得拿牌庫「內容」當 gate）`);
}

// ══ 5. 中央機制正對照：rejectAbilityUse ⇒ applyAction 必須完全 no-op ════════
{
  const key = '弱丁魚ex|大洋增輝';
  const orig = mod.ABILITY_EFFECTS_BY_NAME.get(key);
  const hurt = inst(WEAK, { damage: 50 });
  const st = mkState({ active: hurt, bench: [] }, { active: inst(FILLER) });
  ok(listed(st, '大洋增輝'), '(K0) 前置：這個盤面 gate 是放行的');
  mod.ABILITY_EFFECTS_BY_NAME.set(key, (s, i) => mod.rejectAbilityUse(s, '單元測試：故意拒絕', i));
  const after = mod.applyAction(st, { type: 'USE_ABILITY', iid: hurt.iid, abilityIndex: 0 }, pool);
  if (orig) mod.ABILITY_EFFECTS_BY_NAME.set(key, orig); else mod.ABILITY_EFFECTS_BY_NAME.delete(key);
  ok(after.players[0].active.abilityUsedThisTurn === false,
     '(K) rejectAbilityUse ⇒ 不得消耗「本回合已使用特性」');
  ok(after.players[0].active.damage === 50, '(K2) rejectAbilityUse ⇒ 盤面必須與動作前完全相同');
  ok(after.log.some(l => l.message === '單元測試：故意拒絕'), '(K3) 仍要留下一行拒絕原因給玩家看');
  ok(after.log.length === st.log.length + 1, '(K4) 只留那一行，不得有「使用了特性」的 log');
  ok(after._abilityUseRejected === undefined, '(K5) transient 旗標不得外洩（Firestore 會落地）');
}

// ══ 6. 中央收斂：USE_ABILITY 不得執行「不在 getUsableAbilities 清單裡」的特性 ══
{
  const used = inst(WEAK, { damage: 50, abilityUsedThisTurn: true });
  const st = mkState({ active: used, bench: [] }, { active: inst(FILLER) });
  const after = mod.applyAction(st, { type: 'USE_ABILITY', iid: used.iid, abilityIndex: 0 }, pool);
  ok(after.players[0].active.damage === 50, '(L) 本回合已用過 → USE_ABILITY 必須完全 no-op');
}

// ══ 7. 結構守衛：regA 內不得再有「未走 rejectAbilityUse 的早退拒絕」════════
{
  const REJECT = /無法使用|不能使用|必須|沒有|無效果|不符|不在|已滿|全滿|失敗|無可|無對象|無目標|不可|為空|已空|不足|須為|找不到|無寶可夢/;
  const EXCLUDE = ['自方所有寶可夢都已滿血，效果無實際變化', '對手手牌沒有【基礎】寶可夢，效果結束'];
  // 逐字元標記「這個位置是不是程式碼（不是註解/字串內部）」——註解裡的 return addLog 不算。
  const mark = (s) => {
    const m = new Uint8Array(s.length); let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
      if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) { i++; break; } i++; }
        continue;
      }
      m[i] = 1; i++;
    }
    return m;
  };
  const scanOne = (src) => {          // 回傳「違規」的訊息陣列
    const m = mark(src); const bad = []; let regs = 0;
    for (const g of src.matchAll(/\breg(?:A|AByName)\s*\(/g)) {
      if (!m[g.index]) continue;
      regs++;
      let d = 0, i = g.index + g[0].length - 1;
      for (; i < src.length; i++) {
        if (!m[i]) continue;
        if (src[i] === '(') d++;
        else if (src[i] === ')') { d--; if (d === 0) break; }
      }
      const seg = src.slice(g.index + g[0].length - 1, i);
      const sig = seg.match(/\(\s*([A-Za-z_$][\w$]*)\s*(?:,[^)]*)?\)\s*(?::[^=]*)?=>/);
      if (!sig) continue;
      const st = sig[1], bodyAt = sig.index + sig[0].length;
      let lastRet = 0;
      for (const r of seg.matchAll(/\breturn\b/g)) lastRet = Math.max(lastRet, r.index);
      const re = new RegExp('return\\s+addLog\\s*\\(\\s*' + st + '\\s*,', 'g');
      for (const r of seg.matchAll(re)) {
        if (r.index >= lastRet || r.index < bodyAt) continue;
        if (new RegExp('(?<![=!<>])\\b' + st + '\\s*=(?!=)').test(seg.slice(bodyAt, r.index))) continue;
        const msg = (seg.slice(r.index + r[0].length, r.index + r[0].length + 300)
          .match(/['"`]([^'"`]{2,120})/) || [])[1] || '';
        if (!REJECT.test(msg)) continue;
        if (EXCLUDE.some(x => msg.includes(x))) continue;
        bad.push(msg);
      }
    }
    return { bad, regs };
  };
  // 正對照：掃描器自己先證明「抓得到」，否則永遠 PASS 跟乾淨長得一樣
  const sample = "regA('測試卡', 0, (st, idx) => {\n  if (!st) return addLog(st, '測試：場上沒有寶可夢', idx);\n  return st;\n});\n";
  ok(scanOne(sample).bad.length === 1, '(M0) 掃描器正對照：故意的違規樣本必須被抓到');
  const sampleOk = "regA('測試卡', 0, (st, idx) => {\n  if (!st) return rejectAbilityUse(st, '測試：場上沒有寶可夢', idx);\n  return st;\n});\n";
  ok(scanOne(sampleOk).bad.length === 0, '(M1) 掃描器反對照：已改用 rejectAbilityUse 不該被抓');

  const files = ['src/lib/game/effects.ts'];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (f.isDirectory()) walk(d + '/' + f.name); else if (f.name.endsWith('.ts')) files.push(d + '/' + f.name); } };
  walk('src/lib/game/effects');
  let regs = 0; const offenders = [];
  for (const f of files) {
    const r = scanOne(readFileSync(join(ROOT, f), 'utf8'));
    regs += r.regs;
    for (const b of r.bad) offenders.push(f + ' :: ' + b);
  }
  ok(regs > 100, `(M2) 只掃到 ${regs} 個 regA 註冊 → 掃描器壞了，不是「乾淨」`);
  ok(offenders.length === 0,
     `(M3) 這些「條件不符」的早退還在用 addLog（會吃掉特性權），請改 rejectAbilityUse：\n     ${offenders.join('\n     ')}`);
}

// ══ 8. 回捲的前提：regA 不得在 rejectAbilityUse **之前**就地變異盤面 ═════════
//    applyAction 的回捲是「回傳動作前的 state 物件」——只要有人在 reject 之前
//    直接改了共享子物件（例：`p.active.abilityUsedThisTurn = true`，
//    v2306_meta_pokemon.ts 遠古巨蜓ex 就是這種寫法，目前寫在 reject 之後才安全），
//    「動作前的 state」也會被改到，回捲就失效。這條把順序釘死。
{
  const files = ['src/lib/game/effects.ts'];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (f.isDirectory()) walk(d + '/' + f.name); else if (f.name.endsWith('.ts')) files.push(d + '/' + f.name); } };
  walk('src/lib/game/effects');
  const offenders = [];
  let bodies = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const g of src.matchAll(/\breg(?:A|AByName)\s*\(/g)) {
      let d = 0, i = g.index + g[0].length - 1;
      for (; i < src.length; i++) { if (src[i] === '(') d++; else if (src[i] === ')') { d--; if (d === 0) break; } }
      const seg = src.slice(g.index, i);
      bodies++;
      const rejects = [...seg.matchAll(/rejectAbilityUse\s*\(/g)].map(m => m.index);
      if (rejects.length === 0) continue;
      const lastReject = Math.max(...rejects);
      for (const m of seg.matchAll(/(?<![=!<>])\.(abilityUsedThisTurn|damage|energyAttached)\s*=(?!=)/g)) {
        if (m.index < lastReject) offenders.push(f + ' :: ' + seg.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, ' '));
      }
    }
  }
  ok(bodies > 100, `(N0) 只掃到 ${bodies} 個 regA body → 掃描器壞了`);
  ok(offenders.length === 0,
     `(N) 這些 regA 在 rejectAbilityUse 之前就地變異了盤面，會讓「拒絕 = no-op」的回捲失效：\n     ${offenders.join('\n     ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
