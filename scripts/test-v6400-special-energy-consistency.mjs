#!/usr/bin/env node
/**
 * v6.400 守衛：特殊能量「視為提供什麼」在 engine 各入口的**一致性列管**。
 *
 * 【背景】engine 裡「某張能量在這個 host 身上視為提供哪些屬性、幾個單位」這件事，
 * 目前**分散在五個地方各寫一次**：
 *   ① countEnergy（host-aware，稜鏡／新衝天／燃火 inline ＋ getEnergyProvided）
 *   ② getEnergyUnits（無 host，火箭隊／古舊 inline ＋ SPECIAL_ENERGY_TYPES 表）
 *   ③ totalEnergyUnits（撤退，燃火／新衝天／繁茂 inline）
 *   ④ energyTypeUnitsHostAware（篩選／計數，六張 inline）
 *   ⑤ canAffordAttack（付費，燃火／稜鏡／新衝天／繁茂 inline ＋ getEnergyUnits）
 * 五份判準彼此有**真實的分歧**（下方 A 組白名單逐條列出）。全部收斂成一份要動到付費核心，
 * 每一條分歧「哪一份才對」也需要站長依卡面裁示 ⇒ **本版不收斂，先把分歧列管起來**：
 * 新增一張特殊能量卻只加進其中一份、或改動任何一份造成新分歧，這支守衛就會翻紅。
 *
 * 【本版唯一的行為修正】④ 對「卡面只寫『視為提供1個【無】能量』、卡名裡沒有【無】兩個字」的
 * 七張特殊能量（扣殺／回力鏢／富裕／薄霧／噴射／反轉／治療）一律答 0 ——
 * 而 ①②⑤ 都答 1。本版把 ④ 的一般分支改走 getEnergyProvided（＝②⑤ 用的同一份表）。
 * ⚠ 玩家可見行為零變化：H/I/J 沒有任何卡面在篩「附加的【無】能量卡」（v6.398 已逐卡查證），
 *   而付費／撤退／countEnergy 三條路徑的輸出**逐格完全相同**（收斂前後的 87×7 矩陣比對）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-400g-s.js'), E = join(ROOT, '.x-400g-e.ts'), O = join(ROOT, '.x-400g-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { getEnergyProvided, getEnergyUnits, totalEnergyUnits, countEnergy, canAffordAttack,\n"
  + "  energyTypeUnitsHostAware, energyProvidesType } from './src/lib/game/engine';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { getEnergyProvided, getEnergyUnits, totalEnergyUnits, countEnergy, canAffordAttack, energyTypeUnitsHostAware } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'];
const ZH = { '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning', '超': 'Psychic',
  '鬥': 'Fighting', '惡': 'Darkness', '鋼': 'Metal', '龍': 'Dragon', '無': 'Colorless', '妖': 'Fairy' };

// live 能量（依卡名去重）
const energies = [];
const seen = new Set();
for (const [id, c] of pool) {
  if (c?.supertype !== 'Energy' || seen.has(c.name)) continue;
  seen.add(c.name);
  energies.push({ id: String(id), name: c.name, sub: c.subtype, card: c });
}
energies.sort((a, b) => a.name.localeCompare(b.name));
// host：各 stage 一隻（無特性，避免被動干擾）
const hosts = [];
for (const want of ['Basic', 'Stage1', 'Stage2']) {
  for (const [id, c] of pool) {
    if (c?.supertype !== 'Pokemon' || c.stage !== want || (c.abilities ?? []).length) continue;
    hosts.push({ id: String(id), name: c.name, stage: want }); break;
  }
}
let nn = 0;
const mkE = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkHost = (h, e) => ({ iid: 'h' + (++nn), cardId: h.id, damage: 0, energyAttached: [e] });

/**
 * ⚠⚠ 白名單＝**已知的、尚未裁示的**分歧。每一條都必須寫清楚：卡面怎麼寫、哪一份看起來是對的、
 *   為什麼現在還沒有玩家可見影響。新的分歧一律翻紅（不准默默加進來）。
 */
/**
 * ⚠⚠ 白名單＝**已知的、尚未裁示的**分歧。新的分歧一律翻紅（不准默默加進來）。
 *
 * ⭐v6.401 起這裡是**空的**：站長裁示後，engine 的五份判準已經全部委派給中央
 *   energyUnitsOnHost（見 test-v6401），所以 ① countEnergy 與 ④ energyTypeUnitsHostAware
 *   不可能再有分歧。原本列管的兩條都已消除：
 *     ・火箭隊能量（① 算 1、④ 算 2）⇒ 照卡面「視為提供2個【超】【惡】2種屬性的能量」統一成 2。
 *     ・夜光能量（G 標；④ 全屬性、①⑤ 只當【無】）⇒ 照卡面第一段統一成全屬性
 *       （第二段「身上有其他特殊能量時降級成【無】」仍未實作，見 energyUnitsOnHost 的註解）。
 *   ⚠ 空白名單不是安慰劑：A1 仍然逐格比對 870 格，任何一格不一致就紅；
 *     A1b 的死條目檢查在清單為空時自動通過（它守的是「白名單不得留著已修好的條目」）。
 */
const KNOWN_CD_DIFF = [];
function isKnownDiff(name, type, c, d) {
  return KNOWN_CD_DIFF.some((k) => k.name === name && k.types.includes(type)
    && k.countEnergy === c && k.hostAware === d);
}

console.log('【0】前提哨兵');
T('F0 ★ 能量樣本與 host 樣本都抓得到（卡池換代不可以靜默 SKIP）', () => {
  assert.ok(energies.length >= 25, '只抓到 ' + energies.length + ' 種能量（應 >= 25）');
  assert.strictEqual(hosts.length, 3, 'Basic/Stage1/Stage2 三種 host 要各抓到一隻');
  const specials = energies.filter((e) => e.sub === 'Special');
  assert.ok(specials.length >= 18, '只抓到 ' + specials.length + ' 種特殊能量（應 >= 18）');
});
T('F1 ⭐⭐ 卡名自帶屬性的能量，getEnergyProvided 必須回那個屬性（表與卡名 fallback 一致）', () => {
  let n = 0;
  for (const e of energies) {
    const m = e.name.match(/【(.+?)】/);
    if (!m) continue;
    const want = ZH[m[1]];
    if (!want) continue;
    n++;
    const got = getEnergyProvided(e.id, pool);
    assert.deepStrictEqual(got, [want],
      e.name + ' 的 getEnergyProvided 應為 [' + want + ']，實得 ' + JSON.stringify(got)
      + ' —— 表裡漏了它、或卡名 fallback 沒接上');
  }
  assert.ok(n >= 12, '只檢查到 ' + n + ' 張卡名自帶屬性的能量（應 >= 12）');
});
T('F1b ★ 反對照：卡名沒有【X】的特殊能量不得憑空得到有色屬性', () => {
  for (const e of energies) {
    if (e.sub !== 'Special' || /【.+?】/.test(e.name)) continue;
    const got = getEnergyProvided(e.id, pool);
    // 允許：全屬性（古舊）／[Psychic,Darkness]（火箭隊）／[Colorless]
    const ok = got.length === TYPES.length
      || JSON.stringify(got) === JSON.stringify(['Psychic', 'Darkness'])
      || JSON.stringify(got) === JSON.stringify(['Colorless']);
    assert.ok(ok, e.name + ' 的 getEnergyProvided 是 ' + JSON.stringify(got) + '（不在允許的三種形狀裡）');
  }
});

console.log('\n【A】⭐⭐⭐ 一致性列管：countEnergy（①）vs energyTypeUnitsHostAware（④）逐格比對');
T('A1 ⭐⭐⭐ 全矩陣逐格一致（例外只有白名單裡那兩張，且必須逐條對得上數字）', () => {
  const bad = [];
  let cells = 0;
  for (const h of hosts) {
    for (const e of energies) {
      const inst = mkE(e.id);
      const host = mkHost(h, inst);
      const cm = countEnergy(host, pool);
      for (const t of TYPES) {
        cells++;
        const c = cm.get(t) ?? 0;
        const d = energyTypeUnitsHostAware(host, inst, t, pool);
        if (c === d) continue;
        if (isKnownDiff(e.name, t, c, d)) continue;
        bad.push(h.stage + ' / ' + e.name + ' / ' + t + '：countEnergy=' + c + '  hostAware=' + d);
      }
    }
  }
  assert.ok(cells >= 800, '只比了 ' + cells + ' 格 ⇒ 樣本產生器壞了（下限斷言）');
  assert.strictEqual(bad.length, 0, '有 ' + bad.length + ' 格新的分歧（白名單沒宣告）：\n  ' + bad.join('\n  '));
  console.log('        （逐格比了 ' + cells + ' 格，已知分歧白名單 ' + KNOWN_CD_DIFF.length + ' 條）');
});
T('A1b ★★ 白名單不得有死條目：每一條都必須真的還存在（改好了就要刪掉）', () => {
  for (const k of KNOWN_CD_DIFF) {
    const e = energies.find((x) => x.name === k.name);
    assert.ok(e, '白名單死條目（卡池裡已經沒有這張能量）：' + k.name);
    const inst = mkE(e.id);
    const host = mkHost(hosts[0], inst);
    const cm = countEnergy(host, pool);
    const t = k.types[0];
    assert.strictEqual(cm.get(t) ?? 0, k.countEnergy, k.name + ' 的 countEnergy 已經不是 ' + k.countEnergy + ' 了，白名單要更新');
    assert.strictEqual(energyTypeUnitsHostAware(host, inst, t, pool), k.hostAware,
      k.name + ' 的 hostAware 已經不是 ' + k.hostAware + ' 了，白名單要更新');
  }
});

console.log('\n【B】⭐⭐ 付費端（⑤ canAffordAttack）與計數端一致');
T('B1 ⭐⭐ 有色 cost：付得出來 ⟺ 該屬性的單位數 >= 需求數（夜光除外，見白名單）', () => {
  const bad = [];
  for (const h of hosts) {
    for (const e of energies) {
      // ⭐v6.401：夜光能量以前要在這裡跳過（兩份判準不一致），收斂後不必了。
      const inst = mkE(e.id);
      const host = mkHost(h, inst);
      for (const t of TYPES) {
        if (t === 'Colorless') continue;     // 【無】可由任何單位支付，不是屬性判定
        const units = energyTypeUnitsHostAware(host, inst, t, pool);
        for (const need of [1, 2]) {
          const can = !!canAffordAttack(host, Array(need).fill(t), pool);
          if (can !== (units >= need)) {
            bad.push(h.stage + ' / ' + e.name + ' / ' + t + ' ×' + need + '：afford=' + can + ' units=' + units);
          }
        }
      }
    }
  }
  assert.strictEqual(bad.length, 0, '付費端與計數端不一致 ' + bad.length + ' 處：\n  ' + bad.join('\n  '));
});
T('B2 ⭐ 撤退端（③ totalEnergyUnits）與付費端的單位數一致', () => {
  const bad = [];
  for (const h of hosts) {
    for (const e of energies) {
      const inst = mkE(e.id);
      const host = mkHost(h, inst);
      const total = totalEnergyUnits([inst], pool, undefined, undefined, host);
      // 付費端：用「N 個【無】」反推這張能量提供幾個單位
      let affordable = 0;
      for (let n = 1; n <= 4; n++) if (canAffordAttack(host, Array(n).fill('Colorless'), pool)) affordable = n;
      if (total !== affordable) bad.push(h.stage + ' / ' + e.name + '：totalEnergyUnits=' + total + '  付費端=' + affordable);
    }
  }
  assert.strictEqual(bad.length, 0, '撤退端與付費端的單位數不一致 ' + bad.length + ' 處：\n  ' + bad.join('\n  '));
});

console.log('\n【C】⭐⭐⭐ 本版的行為修正：④ 對「只提供1個【無】」的七張不再答 0');
const COLORLESS_ONLY = ['扣殺能量', '回力鏢能量', '富裕能量', '薄霧能量', '噴射能量', '反轉能量', '治療能量'];
T('C1 ⭐⭐⭐ 七張的 energyTypeUnitsHostAware(Colorless) 必須是 1（修正前是 0）', () => {
  let n = 0;
  for (const name of COLORLESS_ONLY) {
    const e = energies.find((x) => x.name === name);
    if (!e) continue;              // 卡池沒有就跳過（但下面有下限斷言）
    n++;
    for (const h of hosts) {
      const inst = mkE(e.id);
      const host = mkHost(h, inst);
      assert.strictEqual(energyTypeUnitsHostAware(host, inst, 'Colorless', pool), 1,
        name + ' on ' + h.stage + ' 的【無】應為 1（卡面「視為提供1個【無】能量」）');
      // ★ 反向：它們不提供任何有色
      for (const t of TYPES) {
        if (t === 'Colorless') continue;
        assert.strictEqual(energyTypeUnitsHostAware(host, inst, t, pool), 0,
          name + ' 不該提供 ' + t);
      }
    }
  }
  assert.ok(n >= 4, '只檢查到 ' + n + ' 張「只提供【無】」的特殊能量（應 >= 4）');
});
T('C2 ⭐ 卡面查證：這七張的 rulesText 第一段都是「視為提供1個【無】能量」', () => {
  let n = 0;
  for (const name of COLORLESS_ONLY) {
    const e = energies.find((x) => x.name === name);
    if (!e) continue;
    n++;
    const rt = String(e.card.rulesText ?? '').replace(/\s+/g, '');
    assert.ok(rt.includes('視為提供1個【無】能量'), name + ' 的卡面不是「視為提供1個【無】能量」：' + rt.slice(0, 60));
  }
  assert.ok(n >= 4, '只查證到 ' + n + ' 張');
});

console.log('\n【D】⭐⭐ 零回歸：host-dependent 的五張逐格釘住（本版不該動到它們）');
T('D1 稜鏡能量：附【基礎】= 全屬性各 1；附進化 = 只有【無】1', () => {
  const e = energies.find((x) => x.name === '稜鏡能量');
  assert.ok(e, '卡池沒有稜鏡能量');
  for (const h of hosts) {
    const inst = mkE(e.id);
    const host = mkHost(h, inst);
    const isEvo = h.stage !== 'Basic';
    for (const t of TYPES) {
      const want = isEvo ? (t === 'Colorless' ? 1 : 0) : 1;
      assert.strictEqual(energyTypeUnitsHostAware(host, inst, t, pool), want, '稜鏡 on ' + h.stage + ' / ' + t);
    }
  }
});
T('D2 新衝天能量：附【2階進化】= 全屬性各 2；其他 = 只有【無】1', () => {
  const e = energies.find((x) => x.name === '新衝天能量');
  assert.ok(e, '卡池沒有新衝天能量');
  for (const h of hosts) {
    const inst = mkE(e.id);
    const host = mkHost(h, inst);
    const isS2 = h.stage === 'Stage2';
    for (const t of TYPES) {
      const want = isS2 ? 2 : (t === 'Colorless' ? 1 : 0);
      assert.strictEqual(energyTypeUnitsHostAware(host, inst, t, pool), want, '新衝天 on ' + h.stage + ' / ' + t);
    }
  }
});
T('D3 燃火能量：附進化 =【無】3；【基礎】=【無】1；有色一律 0', () => {
  const e = energies.find((x) => x.name === '燃火能量');
  assert.ok(e, '卡池沒有燃火能量');
  for (const h of hosts) {
    const inst = mkE(e.id);
    const host = mkHost(h, inst);
    const isEvo = h.stage !== 'Basic';
    for (const t of TYPES) {
      const want = t === 'Colorless' ? (isEvo ? 3 : 1) : 0;
      assert.strictEqual(energyTypeUnitsHostAware(host, inst, t, pool), want, '燃火 on ' + h.stage + ' / ' + t);
    }
  }
});
T('D4 古舊能量 = 全屬性各 1；火箭隊能量 =【超】【惡】各 2、其餘 0', () => {
  const anc = energies.find((x) => x.name === '古舊能量');
  const rkt = energies.find((x) => x.name === '火箭隊能量');
  assert.ok(anc && rkt, '卡池沒有古舊／火箭隊能量');
  for (const h of hosts) {
    const ai = mkE(anc.id), ah = mkHost(h, ai);
    for (const t of TYPES) assert.strictEqual(energyTypeUnitsHostAware(ah, ai, t, pool), 1, '古舊 / ' + t);
    const ri = mkE(rkt.id), rh = mkHost(h, ri);
    for (const t of TYPES) {
      const want = (t === 'Psychic' || t === 'Darkness') ? 2 : 0;
      assert.strictEqual(energyTypeUnitsHostAware(rh, ri, t, pool), want, '火箭隊 / ' + t);
    }
  }
});
T('D5 ⭐ 基本能量零回歸：每張基本能量只提供自己那一種屬性各 1', () => {
  let n = 0;
  for (const e of energies) {
    if (e.sub !== 'Basic') continue;
    const m = e.name.match(/【(.+?)】/);
    const own = e.card.pokemonType ?? (m ? ZH[m[1]] : null);
    if (!own) continue;
    n++;
    const inst = mkE(e.id);
    const host = mkHost(hosts[0], inst);
    for (const t of TYPES) {
      assert.strictEqual(energyTypeUnitsHostAware(host, inst, t, pool), t === own ? 1 : 0,
        e.name + ' / ' + t);
    }
  }
  assert.ok(n >= 8, '只檢查到 ' + n + ' 張基本能量（應 >= 8）');
});

console.log('\n【E】chain');
T('E1 本守衛已掛進 npm test chain', () => {
  assert.ok(readFileSync(join(ROOT, 'package.json'), 'utf8').includes('test-v6400-special-energy-consistency.mjs'));
});

console.log('\n=== v6.400 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
