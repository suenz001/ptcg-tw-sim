// ⭐⭐⭐ v6.210 斯魔茶｜藏隱 ／ 小霞的鯉魚王｜深度下潛 — 特性消除閘（比照 v6.209 岩石宮殿收尾）
//
// 卡面（`abilities[].effect` 逐字，static/cards 台灣官方）：
//   「只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。」
//   斯魔茶       SV5a 10255/10701、SV8a 11542/12332（H，Grass / Basic / hp30 / 無 tags）
//   小霞的鯉魚王 MC 16628、SV9a 12683（I，Water / Basic / hp30 / tags=['訓練家冠名']）
//   ⇒ 兩張都是**非規則的【基礎】寶可夢**，且卡面把持有者鎖在「備戰區」。
//
// 本測試分五段：
//   A) 現行**七種**特性消除來源逐一行為端實跑（完整 ATTACK → RESOLVE_SELECTION），
//      確認一個都打不到藏隱／深度下潛；每一項附**正對照**（同盤面下該來源真的消得掉別的卡）。
//   B) ★絆線／HEAD-FAIL：合成持有者（把斯魔茶改成【無】／2 階／規則寶可夢）＋ 對應來源
//      → 免疫必須破功（挨得到傷害）。HEAD（沒接閘）時 B 段全紅。
//   C) 反安慰劑：同樣的合成持有者、**不放**來源 → 必須仍免疫（排除「合成卡本身壞掉」的假紅）。
//   D) 基準 ＋ 三條招式型態（狙擊 1 隻 / 全體備戰 / 放置指示物）。
//      ⚠⚠ **誠實標註**：這三條**都**落在 `resolveBenchGuard` 這一個消費點
//      （雷吉艾斯｜暴風雪 走 v2750 `allOppBenchAddDamagePost → dealAttackDamageToTarget`，
//       並不經過 `hitBenchAll`）。第二輪 opus 破壞測試證實：把 `hitBenchAll` 裡那段
//       inline 閘整個刪掉，本檔仍 99 PASS —— 因為 v6.141 的中央 guard 在同一輪迴圈稍後
//       會擋同一件事。⇒ 那一段是**行為上不可觀測**的縱深防禦，只能用 F 段的靜態接線斷言釘住。
//   E) 枚舉守衛：兩張卡的六個印刷都必須被同一份判準涵蓋（新印刷漏收會紅）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.bi-e.ts'), O = join(ROOT, '.bi-o.mjs'), S = join(ROOT, '.bi-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction, isSelfKOEffectBlocked } from './src/lib/game/engine';\n`
  + `export { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';\n`
  + `export { getBenchImmunityAbilityName } from './src/lib/game/effects/cards/v3060_deferred_wave_b';\n`
  + `import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, isAbilityHolderEffective, isSelfKOEffectBlocked, getBenchImmunityAbilityName }
  = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const basePool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) basePool.set(String(c.id), c); }

const WATER = '18519', LIGHT = '18520';
const TEA   = '10255';  // 斯魔茶｜藏隱（Grass / Basic / hp30）
const KARP  = '16628';  // 小霞的鯉魚王｜深度下潛（Water / Basic / hp30）
const CTRL  = '16965';  // 大吾的盔甲鳥（Metal / Basic / hp120 / 無特性）＝備戰對照組
const IRONW = '10083';  // 鐵武者｜雙生鐳射（[C] 20＋對手1隻備戰 20）→ resolveBenchGuard
const REGI  = '16662';  // 雷吉艾斯｜暴風雪（[W][C][C] 90＋對手全備戰各 10）→ hitBenchAll
const MOON  = '16826';  // 振翼髮｜暗夜羽擊(passive)｜飛來橫禍（對手備戰放 2 個指示物）→ attack-effect
const IRONT = '16753';  // 鐵荊棘ex｜初始化
const SEA   = '11246';  // 海兔獸｜黏著束縛
const TOWER = '14849';  // 火箭隊的監視塔
const CAVE  = '19623';  // 傳說的熔岩洞
const DUCK  = '14692';  // 可達鴨｜濕氣（第七種，ability-scoped）
const DEDEN = '19627';  // 探探鼠（Colorless / Basic / 有特性）— 監視塔・暗夜羽擊 正對照
const GALAR = '17971';  // 大竺葵（Stage2 / 有特性）— 熔岩洞・黏著束縛 正對照
const GRENI = '18516';  // 超級甲賀忍蛙ex（規則寶可夢 / 有特性）— 初始化 正對照
const CURSE_HOLDER = (() => { // 咒詛炸彈（「將自己昏厥」類）— 濕氣 正對照
  for (const [id, c] of basePool) if (c.abilities?.some(a => a.name === '咒詛炸彈')) return id;
  return null;
})();

let pass = 0, fail = 0;
const ck = (l, c, e) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l, e ?? ''); } };

console.log('0) fixture 下限斷言（抓不到＝安慰劑綠燈）');
for (const [id, nm] of [[TEA, '斯魔茶'], [KARP, '小霞的鯉魚王'], [CTRL, '大吾的盔甲鳥'], [IRONW, '鐵武者'],
                        [REGI, '雷吉艾斯'], [MOON, '振翼髮'], [IRONT, '鐵荊棘ex'], [SEA, '海兔獸'],
                        [TOWER, '火箭隊的監視塔'], [CAVE, '傳說的熔岩洞'], [DUCK, '可達鴨'],
                        [DEDEN, '探探鼠'], [GALAR, '大竺葵'], [GRENI, '超級甲賀忍蛙ex']]) {
  ck(`fixture ${nm} 在現役卡池`, basePool.get(id)?.name === nm, '實際=' + basePool.get(id)?.name);
}
ck('fixture 咒詛炸彈持有者存在（濕氣正對照用）', !!CURSE_HOLDER);
for (const [id, ab] of [[TEA, '藏隱'], [KARP, '深度下潛']]) {
  const c = basePool.get(id);
  ck(`${c.name}｜${ab} 卡面仍寫「在備戰區」＋「傷害與效果」`,
    (c.abilities ?? []).some(a => a.name === ab && a.effect.includes('在備戰區')
      && a.effect.includes('不會受到對手的寶可夢招式的傷害與效果的影響')),
    JSON.stringify(c.abilities));
  ck(`${c.name} 仍是非規則的【基礎】寶可夢（本輪定論的前提）`,
    (c.stage ?? c.subtype) === 'Basic' && c.pokemonType !== 'Colorless'
    && !(c.name.endsWith('ex') || c.name.endsWith('EX')), JSON.stringify([c.stage, c.subtype, c.pokemonType]));
}

let n = 0;
const I = (cid, e = 0, ec = WATER, x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0,
  energyAttached: Array.from({ length: e }, () => ({ iid: 'e' + (++n), cardId: ec, damage: 0, energyAttached: [] })), ...x });
const D = () => ({ iid: 'd' + (++n), cardId: WATER, damage: 0, energyAttached: [] });
function mk({ att, attE = 4, attEc = WATER, attBench = [], stadium = null, defActive = CTRL, defBench = [] }) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, setupDone: [true, true],
    stadiumUsedThisTurn: [true, true],
    activeStadium: stadium ? { iid: 'st', cardId: stadium } : null,
    players: [
      { name: 'A', active: I(att, attE, attEc), bench: attBench, hand: [], deck: Array.from({ length: 12 }, D), discard: [], prizes: Array.from({ length: 6 }, D) },
      { name: 'D', active: I(defActive, 0), bench: defBench, hand: [], deck: Array.from({ length: 12 }, D), discard: [], prizes: Array.from({ length: 6 }, D) },
    ] };
}

/**
 * 三條消費路徑：holderInst 放在**防守方備戰**，回傳它最後身上的傷害（'KO'/'GONE' 代表被打掉）。
 *   'snipe'    鐵武者｜雙生鐳射 → resolveBenchGuard('attack-damage')
 *   'benchAll' 雷吉艾斯｜暴風雪 → hitBenchAll inline guard
 *   'counter'  振翼髮｜飛來橫禍 → 對手備戰放指示物（attack-effect）
 */
function runPath(path, holderInst, opts = {}, P = basePool) {
  const holder = holderInst;
  const filler = I(CTRL);
  const att = path === 'snipe' ? IRONW : path === 'benchAll' ? REGI : MOON;
  const ai = path === 'benchAll' ? 1 : 0;
  let s = mk({ ...opts, att, defBench: [...(opts.defBench ?? []), holder, filler] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: ai }, P);
  let guard = 0;
  while (s.pendingSelection && guard++ < 6) {
    const prev = s.pendingSelection;
    // 狙擊選 1 隻＝持有者；放指示物型（飛來橫禍 2 個）依 pending 的 minCount/maxCount 決定送幾個
    //   ⚠ v6.210 第二輪審查：原本寫 `prev.count`，但 pendingSelection **沒有** `count` 欄位
    //     （實際欄位：type/actorIdx/sourcePlayerIdx/minCount/maxCount/effectKey/params/token）
    //     ⇒ 那是永遠走 1-iid 分支的死表達式。改讀真的存在的欄位。
    const need = Math.max(1, Number(prev.minCount ?? prev.maxCount ?? 1) || 1);
    const sel = Array.from({ length: need }, () => holder.iid);
    s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: sel }, P);
    if (s.pendingSelection === prev) break;
  }
  const v = s.players[1].bench.find(c => c.iid === holder.iid);
  return { dmg: v ? v.damage : 'GONE', log: s.log.map(l => l.message).join('\n') };
}
/** 對照組：同一條路徑打「沒有免疫特性」的大吾的盔甲鳥，證明這條路徑真的會造成傷害 */
function controlDamage(path, opts = {}, P = basePool) { return runPath(path, I(CTRL), opts, P).dmg; }

console.log('\nD0) 三條消費路徑的正對照（沒有這個，A 段的「0 傷害」可能只是招式根本沒打到）');
for (const path of ['snipe', 'benchAll', 'counter']) {
  const d = controlDamage(path);
  ck(`D0 ${path}：無免疫的備戰對照組確實挨打（damage>0）`, typeof d === 'number' && d > 0, 'dmg=' + d);
}
console.log('\nD1) 基準：藏隱／深度下潛 在三條路徑上都免疫（0 傷害）');
for (const path of ['snipe', 'benchAll', 'counter']) {
  for (const [cid, nm] of [[TEA, '斯魔茶｜藏隱'], [KARP, '小霞的鯉魚王｜深度下潛']]) {
    const r = runPath(path, I(cid));
    ck(`D1 ${path} × ${nm} → 0 傷害`, r.dmg === 0, 'dmg=' + r.dmg);
  }
}

console.log('\nA) 七種特性消除來源逐一行為端驗證（每項附正對照）');
/** 正對照：同一盤面下該來源**打得到**的真卡，中央閘必須回 false */
function control(opts, probeCid, loc, P = basePool) {
  const s = mk({ ...opts, att: IRONW, defBench: [...(opts.defBench ?? []), I(TEA), I(CTRL)] });
  const pc = P.get(probeCid);
  const holder = loc === 'active' ? s.players[1].active : s.players[1].bench[0];
  return isAbilityHolderEffective(s, { ...holder, cardId: probeCid }, pc, 1, pc.abilities[0].name, loc, P);
}
const SRC = [
  ['① 鐵荊棘ex｜初始化（只消規則寶可夢）', { defActive: IRONT }, ['snipe', 'benchAll'], GRENI, 'bench', {}],
  ['② 火箭隊的監視塔（只消【無】）',        { stadium: TOWER },   ['snipe', 'benchAll'], DEDEN, 'bench', {}],
  ['③ 傳說的熔岩洞（只消進化）',            { stadium: CAVE },    ['snipe', 'benchAll'], GALAR, 'bench', {}],
  ['④ 招式版暗夜羽擊（旗標限 active）',     {},                   ['snipe', 'benchAll'], null,  null,   { abilityNullifiedThisTurn: true }],
  ['⑤ passive 振翼髮｜暗夜羽擊（限對手戰鬥場）', {},               ['counter'],           DEDEN, 'active', {}],
  ['⑥ 海兔獸｜黏著束縛（只消備戰2階）',    { defBench: [I(SEA)] }, ['snipe', 'benchAll'], GALAR, 'bench', {}],
  ['⑦ 可達鴨｜濕氣（ability-scoped，不在中央閘）', { defBench: [I(DUCK)] }, ['snipe', 'benchAll'], 'DAMP', null, {}],
];
for (const [label, opts, paths, probe, loc, holderX] of SRC) {
  for (const path of paths) {
    for (const [cid, nm] of [[TEA, '藏隱'], [KARP, '深度下潛']]) {
      const r = runPath(path, I(cid, 0, WATER, holderX), opts);
      ck(`${label} × ${path} × ${nm} → 仍免疫（0 傷害）`, r.dmg === 0, 'dmg=' + r.dmg);
    }
    // ⚠ 反安慰劑：同盤面下沒有免疫特性的對照組必須照樣挨打（排除「來源把整個招式弄掉了」）
    const cd = controlDamage(path, opts);
    ck(`${label} × ${path} 反安慰劑：對照組仍挨打`, typeof cd === 'number' && cd > 0, 'dmg=' + cd);
  }
  if (probe === 'DAMP') {
    const withDuck = mk({ att: IRONW, defBench: [I(DUCK), I(TEA)] });
    const noDuck   = mk({ att: IRONW, defBench: [I(CTRL), I(TEA)] });
    ck(`${label} 正對照：場上有可達鴨 ⇒ 「將自己昏厥」類特性確實被消除`,
      isSelfKOEffectBlocked(withDuck, basePool) === true && isSelfKOEffectBlocked(noDuck, basePool) === false,
      `with=${isSelfKOEffectBlocked(withDuck, basePool)} without=${isSelfKOEffectBlocked(noDuck, basePool)}`);
    ck(`${label} 正對照2：藏隱**不是**「將自己昏厥」類（卡面查證，故濕氣不適用）`,
      !basePool.get(TEA).abilities.some(a => /昏厥/.test(a.effect)) && !!CURSE_HOLDER
      && basePool.get(CURSE_HOLDER).abilities.some(a => /昏厥/.test(a.effect)));
  } else if (probe) {
    const o = probe === DEDEN && loc === 'active' ? { att: MOON } : opts;
    const eff = probe === DEDEN && loc === 'active'
      ? (() => { const s = mk({ att: MOON, defBench: [I(TEA), I(CTRL)] });
                 const a = { ...s.players[1].active, cardId: DEDEN };
                 return isAbilityHolderEffective(s, a, basePool.get(DEDEN), 1, '監視之眼', 'active', basePool); })()
      : control(o, probe, loc);
    ck(`${label} 正對照：該來源在同盤面確實會消除它打得到的卡`, eff === false, 'effective=' + eff);
  } else {
    const s = mk({ att: IRONW, defBench: [I(TEA), I(CTRL)] });
    const a = { ...s.players[1].active, cardId: DEDEN, abilityNullifiedThisTurn: true };
    ck(`${label} 正對照：active 帶 abilityNullifiedThisTurn 的卡確實被消除`,
      isAbilityHolderEffective(s, a, basePool.get(DEDEN), 1, '監視之眼', 'active', basePool) === false);
  }
}

console.log('\nB) ★絆線／HEAD-FAIL：合成持有者證明新加的中央閘真的會擋（HEAD 沒接閘 → B 段全紅）');
const tea = basePool.get(TEA);
// ⚠ isStage2 的判準是「evolvesFrom 指向的卡自己也有 evolvesFrom」，合成 2 階必須指向真的 Stage1。
const STAGE1_WITH_PARENT = (() => {
  for (const [, c] of basePool) if (c.supertype === 'Pokemon' && (c.stage ?? c.subtype) === 'Stage1' && c.evolvesFrom) return c.name;
  return null;
})();
ck('fixture 找得到「有 evolvesFrom 的 Stage1」（合成2階的前提）', !!STAGE1_WITH_PARENT, String(STAGE1_WITH_PARENT));
const SYN = {
  colorless: { ...tea, id: '9810001', pokemonType: 'Colorless' },
  stage2:    { ...tea, id: '9810002', stage: 'Stage2', subtype: 'Stage2', evolvesFrom: STAGE1_WITH_PARENT },
  rulebox:   { ...tea, id: '9810003', subtype: 'ex' },
};
const P2 = new Map(basePool);
for (const k of Object.keys(SYN)) P2.set(SYN[k].id, SYN[k]);
const TRIP = [
  ['B1 合成【無】斯魔茶 + 火箭隊的監視塔', { stadium: TOWER },     SYN.colorless.id],
  ['B2 合成2階斯魔茶 + 傳說的熔岩洞',      { stadium: CAVE },      SYN.stage2.id],
  ['B3 合成2階斯魔茶 + 海兔獸黏著束縛',    { defBench: [I(SEA)] }, SYN.stage2.id],
  ['B4 合成規則斯魔茶 + 鐵荊棘ex初始化',   { defActive: IRONT },   SYN.rulebox.id],
];
for (const [label, opts, cid] of TRIP) {
  for (const path of ['snipe', 'benchAll']) {
    const r = runPath(path, I(cid), opts, P2);
    const ctrl = controlDamage(path, opts, P2);
    // hp30 的斯魔茶被 snipe 20 → damage=20（不會 KO）；benchAll 10 → damage=10
    ck(`${label} × ${path} → 特性被消除，免疫破功（挨到與對照組同一條路徑的傷害）`,
      typeof r.dmg === 'number' && r.dmg > 0, `holder=${r.dmg} ctrl=${ctrl}`);
  }
}

console.log('\nC) 反安慰劑：同樣的合成持有者、不放消除來源 → 必須仍免疫（排除合成卡本身壞掉）');
for (const [label, cid] of [['C1 合成【無】', SYN.colorless.id], ['C2 合成2階', SYN.stage2.id], ['C3 合成規則', SYN.rulebox.id]]) {
  for (const path of ['snipe', 'benchAll']) {
    const r = runPath(path, I(cid), {}, P2);
    ck(`${label} × ${path} 無消除來源 → 仍 0 傷害`, r.dmg === 0, 'dmg=' + r.dmg);
  }
}

console.log('\nE) 枚舉守衛：兩張卡的所有現役印刷都被同一份判準涵蓋（新印刷漏收會紅）');
{
  const prints = [...basePool.values()].filter(c => c.abilities?.some(a => a.name === '藏隱' || a.name === '深度下潛'));
  ck('E0 掃描器下限：現役印刷 ≥6 個（掃不到＝掃描器壞了）', prints.length >= 6, '只掃到 ' + prints.length);
  const s = mk({ att: IRONW, defBench: [] });
  for (const c of prints) {
    const inst = I(c.id);
    ck(`E1 ${c.name}(${c.id}/${c.regulationMark}) 被 getBenchImmunityAbilityName 認得`,
      getBenchImmunityAbilityName(s, 1, inst, c, basePool) != null);
  }
  // 反向：沒有這兩個特性的卡不得被誤認
  ck('E2 正對照：大吾的盔甲鳥（無此特性）不得被認成備戰免疫',
    getBenchImmunityAbilityName(s, 1, I(CTRL), basePool.get(CTRL), basePool) === null);
  // 缺場上脈絡時 fail-open（維持舊行為）
  ck('E3 缺 state/inst/pool ⇒ fail-open 仍回特性名（與 hasAnyEffectiveAbility 同約定）',
    getBenchImmunityAbilityName(undefined, undefined, undefined, basePool.get(TEA), undefined) === '藏隱');
}

// ══════════════ F) hitBenchAll 那段 inline 閘的**靜態接線斷言** ══════════════
//   ⚠ 誠實：這是靜態的。「有呼叫某函式」≠「那件事發生了」—— 但這一段在行為上被 v6.141 的
//     中央 guard 完全遮蔽（上面已實測），靜態接線是能做到的最強斷言。配正對照自我驗證。
console.log('\nF) hitBenchAll inline 閘的靜態接線（行為上被遮蔽，只能靜態釘）');
{
  const src = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  const i = src.indexOf('function hitBenchAll(');
  ck('F0 anchor：找得到 hitBenchAll 定義', i > 0);
  const blk = src.slice(i, i + 6000);
  ck('F1 anchor 沒失效（切出來的區塊 <6000 字元且含 teraImmunNames 迴圈）',
    blk.length < 6000 + 1 && /teraImmunNames/.test(blk));
  const m = blk.match(/_v3060GetBenchImmName\s*\(([^)]*)\)/);
  ck('F2 hitBenchAll 內仍呼叫 getBenchImmunityAbilityName（別被改回無閘版）', !!m, blk.slice(0, 120));
  const args = (m?.[1] ?? '').split(',').map(x => x.trim());
  ck('F3 ★它必須把「場上脈絡」四件事都傳進去（state / ownerIdx / inst / card / pool）——'
     + ' 少傳任何一個都會 fail-open 成無閘版',
    args.length === 5 && args[0] === 'state' && args[1] === 'targetIdx' && args[4] === 'pool',
    JSON.stringify(args));
  ck('F4 正對照：判準抓得到「只傳 card」的無閘寫法（HEAD 就是那樣）', (() => {
    const bad = 'const x = _v3060GetBenchImmName(card);';
    const mm = bad.match(/_v3060GetBenchImmName\s*\(([^)]*)\)/);
    return (mm[1].split(',').length !== 5);
  })());
  ck('F5 正對照：判準抓得到「整段被刪掉」（呼叫不見了）', (() => {
    const bad = 'const x = 1;';
    return !/_v3060GetBenchImmName\s*\(/.test(bad);
  })());
}

console.log('\n藏隱／深度下潛特性消除閘 PASS ' + pass + ' / FAIL ' + fail);
console.log('SCRIPT_END_MARKER test-v6210-bench-immunity-ability-nullify-gate');
process.exitCode = fail ? 1 : 0;
