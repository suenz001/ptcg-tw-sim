// ⭐⭐⭐ v6.208 —— 站長裁定四件（2026-08-18）
//   ① 玩家回報「熔岩洞沒消掉【神秘石居】」→ 全路徑行為端重現（本檔 ⑤ 段是**回歸鎖**）。
//   ② 手牌特性不可以「點一下就發動」——比照其他手牌卡：點擊什麼都不做，只能拖曳。
//   ③ 火炎獅｜威嚇之牙 卡面「只要這隻寶可夢**在戰鬥場上**」，但被動減傷有兩個消費點，
//      備戰那份沒判位置 ⇒ 在備戰被狙擊仍 -30。與 陳舊的顎之化石｜威嚇之顎 卡面逐字相同，
//      收斂成**同一份**宣告 ACTIVE_ONLY_PASSIVE_REDUCE_ABILITIES。
//   ④ 化石在場上是「HP60 的【無】屬性的【基礎】寶可夢」（rulesText 逐字）⇒ 納入中央
//      有效屬性述詞 getEffectivePokemonTypes / hasEffectivePokemonType。
//
// ⚠ 一律**行為端**驅動（applyAction 完整流程 / dealAttackDamageToTarget / 真的執行 template handler）。
// ⚠ 每條修正都配**正對照**（該生效的仍生效）；否定型判準一律附「抓得到違規樣本」的自我驗證。
// ⚠ 擲幣型免疫（躲藏高手／順滑大衣）一律固定種子 LCG —— 不可用恆正面（flip-until-tails 會無窮迴圈）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6208-s.js'), E = join(ROOT, '.x6208-e.ts'), O = join(ROOT, '.x6208-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) try { unlinkSync(p); } catch {} });
writeFileSync(S, 'export const base="";export const assets="";');
// namespace import：把 src 還原成 BASE 做 HEAD-FAIL 時，「新符號不存在」只讓那幾條紅，
// 不會整個 bundle build 不起來而看不出是哪幾條。
writeFileSync(E, "import * as ENG from './src/lib/game/engine';\nimport * as EFF from './src/lib/game/effects';\n"
  + "import * as SH from './src/lib/game/effects/_shared';\nexport { ENG, EFF, SH };\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const m = await import(pathToFileURL(O).href);
const ENG = m.ENG, EFF = m.EFF;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const DESK = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const MOB = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('  ✓ ' + n); pass++; } catch (e) { console.log('  ✗ ' + n + '\n      ' + (e && e.message)); fail++; } };
let _n = 0;
const I = (id, extra = {}) => ({ iid: 'i' + (++_n), cardId: String(id), damage: 0, energyAttached: [], extraTools: [], ...extra });
const ST = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [{ name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
            { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 }], ...extra });
const ab = n => c => c.abilities?.some(a => a.name === n);
const findId = (name, pred) => { for (const [id, c] of pool) if (c.name === name && (!pred || pred(c))) return id; return null; };
const effOf = (id, an) => pool.get(id).abilities.find(a => a.name === an).effect;
// 固定種子 LCG（可重現、必定出得了反面）
let _seed = 20260818;
const RESEED = () => { _seed = 20260818; };
Math.random = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

const FOSSIL_RULE = '這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。';
const isFossilCard = c => c.supertype === 'Trainer' && c.subtype === 'Item' && String(c.rulesText || '').includes(FOSSIL_RULE);
const FOSSILS = [...pool.entries()].filter(([, c]) => isFossilCard(c)).map(([id]) => id);

const LEO = findId('火炎獅', ab('威嚇之牙'));
const JAW = findId('陳舊的顎之化石', ab('威嚇之顎'));
const CRAB = findId('岩殿居蟹', ab('神秘石居'));
const HAWK = findId('烈箭鷹ex', c => c.attacks?.some(a => a.name === '鉤爪搜尋'));
const CAVES = [...pool.entries()].filter(([, c]) => c.name === '傳說的熔岩洞').map(([id]) => id);
const TORN = findId('眷戀雲', c => c.attacks?.some(a => a.name === '愛之同感'));
const GARDEN = findId('神秘花園');
const FIRE_E = findId('基本【火】能量'), PSY_E = findId('基本【超】能量');
// 對照用「乾淨」寶可夢：無特性、基礎、【無】、HP 夠高
const PLAIN = (() => { for (const [id, c] of pool) if (c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.abilities
  && c.subtype === 'Basic' && !c.evolvesFrom && (c.hp ?? 0) >= 120 && c.pokemonType === 'Colorless') return id; return null; })();

console.log('① 卡面逐字錨（static/cards 台灣官方；特性讀 abilities[].effect、訓練家讀 rulesText）');
T('1a. 本檔依賴的卡全部抓得到（抓不到就紅，不做安慰劑綠燈）', () => {
  const NEED = { LEO, JAW, CRAB, HAWK, TORN, GARDEN, FIRE_E, PSY_E, PLAIN };
  const bad = Object.entries(NEED).filter(([, v]) => !v).map(([k]) => k);
  assert.equal(bad.length, 0, '抓不到：' + bad.join(','));
  assert.ok(CAVES.length >= 2, '傳說的熔岩洞（兩張合一）只抓到 ' + CAVES.length + ' 張');
  assert.ok(FOSSILS.length >= 10, '化石只抓到 ' + FOSSILS.length + ' 個印刷');
});
T('1b. 威嚇之牙 與 威嚇之顎 的卡面**逐字相同**（＝位置規則只能有一份）', () => {
  const t = '只要這隻寶可夢在戰鬥場上，對手的戰鬥寶可夢使用的招式的傷害「-30」點。';
  assert.equal(effOf(LEO, '威嚇之牙'), t);
  assert.equal(effOf(JAW, '威嚇之顎'), t);
});
T('1c. 化石 rulesText 逐字寫明「HP60 的【無】屬性的【基礎】寶可夢」（＝④ 的唯一依據）', () => {
  for (const f of FOSSILS) assert.ok(String(pool.get(f).rulesText).includes(FOSSIL_RULE), f);
  // 化石卡本身沒有 pokemonType（它印刷上是 Trainer/Item）—— 這正是舊述詞回 [] 的原因
  for (const f of FOSSILS) assert.ok(!pool.get(f).pokemonType, f + ' 竟然有 pokemonType');
});
T('1d. ① 相關卡面：神秘石居／傳說的熔岩洞／鉤爪搜尋', () => {
  assert.equal(effOf(CRAB, '神秘石居'), '這隻寶可夢不會受到對手的「寶可夢【ex】」招式的傷害。');
  assert.equal(pool.get(CRAB).stage, 'Stage1');            // 進化寶可夢 ⇒ 熔岩洞打得到
  for (const cv of CAVES) assert.equal(pool.get(cv).rulesText, '雙方場上所有進化寶可夢的特性全部消除。');
  const atk = pool.get(HAWK).attacks.find(a => a.name === '鉤爪搜尋');
  assert.equal(atk.damage, '150');
  assert.equal(atk.effect, '若希望，從自己的牌庫任意選擇最多2張卡加入手牌。並且重洗牌庫。');
  assert.ok(EFF.isPokemonExCard(pool.get(HAWK)), '烈箭鷹ex 不被判成寶可夢【ex】，1d 之後的斷言就沒意義');
});

console.log('② ③ 威嚇之牙「只在戰鬥場」—— 行為端（備戰不減／戰鬥場仍減）');
const hit = (victimId, loc, dmg = 100, victimExtra = {}) => {
  RESEED();
  const v = I(victimId, victimExtra);
  const p1 = loc === 'active' ? { active: v, bench: [I(PLAIN)] } : { active: I(PLAIN), bench: [v] };
  const s = ST({ active: I(PLAIN), bench: [] }, p1);
  const r = EFF.dealAttackDamageToTarget(s, 0, v.iid, dmg, pool, { label: '測試' });
  const now = loc === 'active' ? r.players[1].active : r.players[1].bench.find(x => x.iid === v.iid);
  return { dmg: now ? now.damage : 'KO', log: r.log.map(l => l.message).join('\n') };
};
T('2a.〔核心〕火炎獅在**備戰**被狙擊 100 → 100（卡面限戰鬥場，不該 -30）', () => {
  const r = hit(LEO, 'bench');
  assert.equal(r.dmg, 100, '實得 ' + r.dmg + '\n' + r.log);
  assert.ok(!/威嚇之牙/.test(r.log), '備戰竟然還印出威嚇之牙減傷：' + r.log);
});
T('2b. 正對照：火炎獅在**戰鬥場**被打 100 → 70（該生效的仍生效）', () => {
  const r = hit(LEO, 'active');
  assert.equal(r.dmg, 70, '實得 ' + r.dmg + '\n' + r.log);
});
T('2c. 正對照：陳舊的顎之化石在**戰鬥場** → -30（v6.207 那份手刻仍在）', () => {
  const r = hit(JAW, 'active', 50, { fossilOnField: true });
  assert.equal(r.dmg, 20, '實得 ' + r.dmg + '\n' + r.log);
});
T('2d. 正對照：陳舊的顎之化石在**備戰**不減傷（本來就沒有，別被改壞）', () => {
  const r = hit(JAW, 'bench', 50, { fossilOnField: true });
  assert.equal(r.dmg, 50, '實得 ' + r.dmg + '\n' + r.log);
});
T('2e. 正對照：**沒有**位置限制的被動減傷在備戰仍然生效（防改過頭）', () => {
  const cases = [['草苗龜', '堅硬甲殼', 20], ['巨蔓藤', '密林之軀', 30], ['重泥挽馬', '泥巴膜', 30]];
  for (const [name, abn, n] of cases) {
    const id = findId(name, ab(abn));
    assert.ok(id, '找不到 ' + name);
    assert.equal(effOf(id, abn), '這隻寶可夢受到招式的傷害「-30」點。'.replace('30', String(n)), name);
    const r = hit(id, 'bench', 40);
    assert.equal(r.dmg, 40 - n, name + ' 備戰減傷不見了：' + r.dmg);
  }
});
T('2f. 中央述詞 passiveReduceAppliesAtLocation 的三種答案', () => {
  const f = EFF.passiveReduceAppliesAtLocation;
  assert.equal(f('威嚇之牙', 'active'), true);
  assert.equal(f('威嚇之牙', 'bench'), false);
  assert.equal(f('威嚇之顎', 'active'), true);
  assert.equal(f('威嚇之顎', 'bench'), false);
  assert.equal(f('密林之軀', 'bench'), true);   // 不在清單 ⇒ 一律生效
});
T('2g.〔枚舉守衛〕被動減傷路徑會消費到、且卡面寫「只要這隻寶可夢在戰鬥場上」的特性，'
 + '必須**全部**在中央清單裡（新卡自動抓得到）；清單也不得有死條目', () => {
  // ⭐ 本清單的語意是「**持有者自己受傷**型」的被動減傷（holder 位置 = 受傷者位置）。
  const consumed = new Set([
    ...EFF.PASSIVE_DAMAGE_REDUCE.keys(),
    ...EFF.PASSIVE_DAMAGE_REDUCE_COND.keys(),
    ...EFF.PASSIVE_DAMAGE_REDUCE_BY_ATTACKER.keys(),
    '威嚇之顎',   // engine.ts applyDefenderReductionsBlockA 按卡名手刻的化石 -30
  ]);
  assert.ok(consumed.size >= 12, '被動減傷特性只掃到 ' + consumed.size + ' 個，掃描器壞了？');
  const restricted = scanActiveOnly(consumed, pool);
  const declared = new Set(EFF.ACTIVE_ONLY_PASSIVE_REDUCE_ABILITIES);
  assert.deepEqual([...restricted].sort(), [...declared].sort(),
    '卡面掃出來的 = ' + JSON.stringify([...restricted]) + '，中央宣告 = ' + JSON.stringify([...declared]));
  // 死條目：宣告了卻沒有任何消費點會用到
  const dead = [...declared].filter(n => !consumed.has(n));
  assert.deepEqual(dead, [], '中央清單有死條目：' + dead.join(','));
  // ⭐⭐ 子代理審查抓到的覆蓋缺口：**field-wide** 型（「自己的所有寶可夢…-N」）不在上面三張 map 裡，
  //   位置判斷各自寫在自己的 helper（盾之守護 / 岩石宮殿）。這裡把它們也列出來，
  //   逐張要求「要嘛在中央宣告、要嘛在下面的 FIELD_WIDE 白名單」，白名單那批由 2g2 做**行為端**驗證。
  const FIELD_WIDE = new Set(['盾之守護', '岩石宮殿']);
  const allReduceRestricted = new Set();
  for (const [, c] of pool) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of c.abilities || []) {
      const e = String(a.effect || '');
      if (!/^(只要|若)?這隻寶可夢在(戰鬥場|備戰區)/.test(e.replace(/^只要/, '只要').replace(/^若/, '若'))
          && !/^(只要|若)這隻寶可夢在(戰鬥場上|備戰區)/.test(e)) continue;
      if (!/「-\d+」點/.test(e)) continue;    // 只看「減傷」型
      allReduceRestricted.add(a.name);
    }
  }
  const unhandled = [...allReduceRestricted].filter(n => !declared.has(n) && !FIELD_WIDE.has(n));
  assert.deepEqual(unhandled, [],
    '有位置限定的被動減傷特性既不在中央宣告、也不在 field-wide 白名單：' + unhandled.join(','));
  assert.ok(allReduceRestricted.size >= 4, '位置限定減傷只掃到 ' + allReduceRestricted.size + ' 個');
});
T('2g2.〔行為端〕field-wide 白名單那兩張的位置判斷是真的（不是靠白名單放行）', () => {
  const SHIELD = findId('陳舊的盾甲化石', ab('盾之守護'));
  const PALACE = findId('大吾的小碎鑽', ab('岩石宮殿'));
  assert.ok(SHIELD && PALACE);
  // 盾之守護：卡面「只要這隻寶可夢在**戰鬥場上**，自己的所有寶可夢…-10」
  const shieldCase = (holderLoc) => {
    RESEED();
    const holder = I(SHIELD, { fossilOnField: true });
    const victim = I(PLAIN);
    const p1 = holderLoc === 'active' ? { active: holder, bench: [victim] } : { active: I(PLAIN), bench: [holder, victim] };
    const s = ST({ active: I(PLAIN), bench: [] }, p1);
    const r = EFF.dealAttackDamageToTarget(s, 0, victim.iid, 100, pool, { label: '測' });
    return r.players[1].bench.find(x => x.iid === victim.iid).damage;
  };
  assert.equal(shieldCase('active'), 90, '盾之守護在戰鬥場沒有 -10');
  assert.equal(shieldCase('bench'), 100, '盾之守護在備戰竟然也 -10（卡面限戰鬥場）');
  // 岩石宮殿：卡面「只要這隻寶可夢在**備戰區**，自己的所有『大吾的寶可夢』…-30」
  // ⚠ 受惠者**不可以**也拿 大吾的小碎鑽 —— 它自己就是持有者，放在備戰時 holder 位置就恆為備戰，
  //   'active' 那一組會假紅（第一版就是這樣）。改用「大吾的」但沒有岩石宮殿的卡。
  const MUDKIP = (() => { for (const [id, c] of pool) if (c.supertype === 'Pokemon'
    && String(c.name).startsWith('大吾的') && !c.abilities && (c.hp ?? 0) >= 110) return id; return null; })();
  assert.ok(MUDKIP, '找不到「大吾的」無特性受惠對照卡');
  const palaceCase = (holderLoc) => {
    RESEED();
    const holder = I(PALACE);
    const victim = I(MUDKIP);
    const p1 = holderLoc === 'bench' ? { active: I(PLAIN), bench: [holder, victim] } : { active: holder, bench: [victim] };
    const s = ST({ active: I(PLAIN), bench: [] }, p1);
    const r = EFF.dealAttackDamageToTarget(s, 0, victim.iid, 100, pool, { label: '測' });
    return r.players[1].bench.find(x => x.iid === victim.iid).damage;
  };
  assert.equal(palaceCase('bench'), 70, '岩石宮殿在備戰沒有 -30');
  assert.equal(palaceCase('active'), 100, '岩石宮殿在戰鬥場竟然也 -30（卡面限備戰區）');
});
/** 掃描器：在 live H/I/J 卡面裡找出這些特性名中「只要這隻寶可夢在戰鬥場上」開頭的 */
function scanActiveOnly(names, cardPool) {
  const out = new Set();
  for (const [, c] of cardPool) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of c.abilities || []) {
      if (!names.has(a.name)) continue;
      if (String(a.effect || '').startsWith('只要這隻寶可夢在戰鬥場上')) out.add(a.name);
    }
  }
  return out;
}
T('2h. 掃描器自我驗證：餵偽造樣本必須抓得到；乾淨樣本不得誤報', () => {
  const fake = new Map([
    ['x1', { regulationMark: 'J', abilities: [{ name: '假特性A', effect: '只要這隻寶可夢在戰鬥場上，受到招式的傷害「-30」點。' }] }],
    ['x2', { regulationMark: 'J', abilities: [{ name: '假特性B', effect: '這隻寶可夢受到招式的傷害「-30」點。' }] }],
    ['x3', { regulationMark: 'G', abilities: [{ name: '假特性C', effect: '只要這隻寶可夢在戰鬥場上，受到招式的傷害「-30」點。' }] }],
  ]);
  const got = scanActiveOnly(new Set(['假特性A', '假特性B', '假特性C']), fake);
  assert.deepEqual([...got], ['假特性A'], '掃描器結果：' + JSON.stringify([...got]));  // G 標不列入
  // ⭐⭐ 子代理審查抓到的盲點：只餵自造 Map 的話，「掃描器對**真 pool** 作弊、對假 pool 誠實」
  //   的實作也會全綠。這裡把真 pool 複製一份、把一張**真卡**的 effect 前綴改成位置限定，
  //   掃描器必須抓得到（＝它真的在讀傳進來的那個 pool）。
  const realish = new Map();
  let injected = null;
  for (const [id, c] of pool) {
    if (!injected && c.regulationMark && ['H', 'I', 'J'].includes(c.regulationMark)
        && (c.abilities || []).some(a => a.name === '密林之軀')) {
      injected = '密林之軀';
      realish.set(id, { ...c, abilities: c.abilities.map(a => a.name === '密林之軀'
        ? { ...a, effect: '只要這隻寶可夢在戰鬥場上，這隻寶可夢受到招式的傷害「-30」點。' } : a) });
    } else realish.set(id, c);
  }
  assert.ok(injected, '找不到可注入的真卡（密林之軀）');
  const got2 = scanActiveOnly(new Set(['密林之軀']), realish);
  assert.deepEqual([...got2], ['密林之軀'], '掃描器沒有真的讀傳進來的 pool：' + JSON.stringify([...got2]));
  assert.deepEqual([...scanActiveOnly(new Set(['密林之軀']), pool)], [], '真 pool 的密林之軀不該被列入');
});

console.log('③ ④ 化石在場上是【無】屬性 —— 中央述詞 ＋ 消費點 ＋ 對照組');
const typesOf = (id, loc, extra) => {
  const inst = I(id, extra);
  const p1 = loc === 'active' ? { active: inst, bench: [I(PLAIN)] } : { active: I(PLAIN), bench: [inst] };
  const s = ST(p1, { active: I(PLAIN), bench: [] });
  return EFF.getEffectivePokemonTypes(s, 0, inst, pool.get(id), pool);
};
T('3a.〔核心〕化石**在場上**（fossilOnField）→ ["Colorless"]；戰鬥場與備戰一致', () => {
  for (const f of FOSSILS) {
    assert.deepEqual(typesOf(f, 'active', { fossilOnField: true }), ['Colorless'], f + ' active');
    assert.deepEqual(typesOf(f, 'bench', { fossilOnField: true }), ['Colorless'], f + ' bench');
  }
});
T('3b. 判準只認 fossilOnField —— 沒有這個旗標（例：還在手牌／被 toBareCard 洗回牌庫）→ 維持 []\n        ⚠ 被 KO 進棄牌區的化石**仍帶著**旗標（toBareCard 不經過那條路徑），傳說的山頂正靠這點', () => {
  for (const f of FOSSILS) assert.deepEqual(typesOf(f, 'active', {}), [], f);
});
T('3c. 不變式：全卡池「有效屬性 ⊇ 印刷屬性」，且**偏離印刷屬性的卡名集合逐一釘死**（多改少改都紅）', () => {
  // ⚠ 子代理審查抓到：舊版只寫 `changed <= 8` 是**單邊、無下界** —— 把既有兩族雙屬性
  //   實作整個刪掉 changed 會變 0，測試照樣全綠。改成精確集合斷言。
  const changed = new Set();
  for (const [id, c] of pool) {
    const isF = isFossilCard(c);
    if (c.supertype !== 'Pokemon' && !isF) continue;
    const t = typesOf(id, 'active', isF ? { fossilOnField: true } : {});
    if (c.pokemonType) assert.ok(t.includes(c.pokemonType), c.name + ' 弄丟了印刷屬性 ' + JSON.stringify(t));
    if (JSON.stringify(t) !== JSON.stringify(c.pokemonType ? [c.pokemonType] : [])) changed.add(c.name);
  }
  const expect = ['小碎鑽', '狠辣椒ex',
    '陳舊的根狀化石', '陳舊的背蓋化石', '陳舊的羽毛化石', '陳舊的顎之化石',
    '陳舊的鰭之化石', '陳舊的頭蓋化石', '陳舊的盾甲化石'].filter(n => [...pool.values()].some(c => c.name === n));
  assert.deepEqual([...changed].sort(), expect.sort(),
    '實得 ' + JSON.stringify([...changed].sort()));
});
T('3d.〔行為端消費點〕眷戀雲｜愛之同感：對手戰鬥場是化石 ⇒【無】同屬性在場 → 200（80+120）', () => {
  const AI = pool.get(TORN).attacks.findIndex(a => a.name === '愛之同感');
  assert.ok(AI >= 0);
  for (const f of FOSSILS.slice(0, 3)) {
    RESEED();
    const s = ST({ active: I(TORN, { energyAttached: [I(PSY_E), I(PSY_E), I(PSY_E), I(PSY_E)] }), bench: [I(PLAIN)], deck: [I(PLAIN)] },
                 { active: I(f, { fossilOnField: true }), bench: [], deck: [I(PLAIN)] });
    const r = ENG.applyAction(s, { type: 'ATTACK', attackIndex: AI, actorIdx: 0 }, pool);
    assert.ok(/愛之同感：同屬性在場/.test(r.log.map(l => l.message).join('\n')), f + ' 沒有判定成同屬性');
  }
});
T('3e. 正對照：眷戀雲對手是**非【超】非【無】**且我方也沒有那個屬性 → 不加傷（判準不是恆真）', () => {
  const AI = pool.get(TORN).attacks.findIndex(a => a.name === '愛之同感');
  const dark = (() => { for (const [id, c] of pool) if (c.supertype === 'Pokemon' && c.pokemonType === 'Darkness'
    && !c.abilities && (c.hp ?? 0) >= 200) return id; return null; })();
  assert.ok(dark, '找不到乾淨的【惡】對照卡');
  RESEED();
  const s = ST({ active: I(TORN, { energyAttached: [I(PSY_E), I(PSY_E), I(PSY_E), I(PSY_E)] }), bench: [], deck: [I(PLAIN)] },
               { active: I(dark), bench: [], deck: [I(PLAIN)] });
  const r = ENG.applyAction(s, { type: 'ATTACK', attackIndex: AI, actorIdx: 0 }, pool);
  assert.ok(!/愛之同感：同屬性在場/.test(r.log.map(l => l.message).join('\n')));
});
T('3f. 正對照：【超】的消費點（神秘花園）數不到化石 —— 化石是【無】不是【超】', () => {
  // ⚠ 子代理審查抓到：第一版把 hand 寫成 []，engine 第一道閘「手牌沒有能量卡」就 early-return，
  //   **根本沒跑到那個【超】計數**；而且成功路徑是開 hand-discard picker、當下不抽牌，
  //   拿 hand.length===0 當判準是雙重恆真。改成「手牌放 1 張基本【超】能量」＋看 pendingSelection。
  const mk = (benchIds) => ST(
    { active: I(PLAIN), bench: benchIds.map(x => I(x.id, x.extra)), deck: [I(PLAIN), I(PLAIN), I(PLAIN)], hand: [I(PSY_E)] },
    { active: I(PLAIN), bench: [], deck: [I(PLAIN)] },
    { activeStadium: I(GARDEN), activeStadiumOwnerIdx: 0 });
  const rFossil = ENG.applyAction(mk([{ id: FOSSILS[0], extra: { fossilOnField: true } },
                                      { id: FOSSILS[1], extra: { fossilOnField: true } }]),
                                  { type: 'USE_STADIUM', actorIdx: 0 }, pool);
  assert.equal(rFossil.pendingSelection, null, '神秘花園竟然把化石算成【超】而開了丟棄視窗');
  assert.ok(/場上【超】寶可夢數量/.test(rFossil.log.map(l => l.message).join('\n')),
    '沒有走到【超】計數那一關：' + rFossil.log.map(l => l.message).slice(-1));
  // 正對照：真的【超】寶可夢 ⇒ 同一盤面會開丟棄視窗（證明上面不是恆假）
  const PSYB = (() => { for (const [id, c] of pool) if (c.supertype === 'Pokemon' && c.pokemonType === 'Psychic'
    && c.stage === 'Basic' && !c.evolvesFrom) return id; return null; })();
  assert.ok(PSYB, '找不到【超】基礎對照卡');
  const rPsy = ENG.applyAction(mk([{ id: PSYB }, { id: PSYB }]), { type: 'USE_STADIUM', actorIdx: 0 }, pool);
  assert.equal(rPsy.pendingSelection?.type, 'hand-discard', '正對照失敗：' + JSON.stringify(rPsy.pendingSelection));
});
T('3h.〔行為端消費點〕傳說的山頂：化石被招式 KO ⇒ 獎賞 −1（化石在場上是【無】）', () => {
  const PEAKS = [...pool.entries()].filter(([, c]) => c.name === '傳說的山頂').map(([id]) => id);
  assert.ok(PEAKS.length >= 2, '傳說的山頂只抓到 ' + PEAKS.length + ' 張');
  assert.equal(pool.get(PEAKS[0]).rulesText,
    '雙方的【無】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，被獲得的獎賞卡減少1張。');
  const koPrizes = (victimId, extra, stadium) => {
    RESEED();
    const v = I(victimId, extra);
    const six = () => [I(PLAIN), I(PLAIN), I(PLAIN), I(PLAIN), I(PLAIN), I(PLAIN)];
    const s = ST({ active: I(PLAIN), bench: [], prizes: six() },
                 { active: v, bench: [I(PLAIN)], prizes: six() },
                 stadium ? { activeStadium: I(stadium), activeStadiumOwnerIdx: 0 } : {});
    const r = EFF.dealAttackDamageToTarget(s, 0, v.iid, 200, pool, { label: '測' });
    return 6 - r.players[0].prizes.length;
  };
  for (const f of FOSSILS.slice(0, 4)) {
    assert.equal(koPrizes(f, { fossilOnField: true }, PEAKS[0]), 0, f + '：山頂在場仍拿 1 張');
    assert.equal(koPrizes(f, { fossilOnField: true }, null), 1, f + '：沒有山頂卻不給獎賞');
  }
  assert.equal(koPrizes(PLAIN, {}, PEAKS[0]), 0, '印刷【無】的正對照壞了');
  const fireMon = (() => { for (const [id, c] of pool) if (c.supertype === 'Pokemon' && c.pokemonType === 'Fire'
    && !c.abilities && (c.hp ?? 999) <= 120) return id; return null; })();
  assert.ok(fireMon);
  assert.equal(koPrizes(fireMon, {}, PEAKS[0]), 1, '負對照：非【無】不該減獎賞');
});
T('3i.〔行為端消費點〕玻璃喇叭：備戰的化石算【無】（regG 三態）', () => {
  const HORN = findId('玻璃喇叭');
  const TERA = (() => { for (const [id, c] of pool) if (c.supertype === 'Pokemon' && c.tags?.includes('太晶')) return id; return null; })();
  assert.ok(HORN && TERA);
  const g = EFF.TRAINER_GUARDS.get('玻璃喇叭');
  assert.ok(g, '玻璃喇叭 regG 不存在（換過 key？）');
  const mk = (benchId, extra) => ST(
    { active: I(TERA), bench: [I(benchId, extra)], hand: [I(HORN)], discard: [I(FIRE_E)], deck: [I(PLAIN)] },
    { active: I(PLAIN), bench: [] });
  assert.equal(g(mk(FOSSILS[0], { fossilOnField: true }), 0, pool), true, '備戰化石不被當【無】');
  assert.equal(g(mk(PLAIN, {}), 0, pool), true, '正對照：印刷【無】壞了');
  assert.equal(g(mk(LEO, {}), 0, pool), false, '負對照：【火】竟然過了');
});
T('3g. 正對照：逆境保險不受本版影響（全卡池沒有任何一張的弱點是【無】）', () => {
  const colorlessWeak = [...pool.values()].filter(c => c.weakness?.type === 'Colorless');
  assert.equal(colorlessWeak.length, 0, '出現了【無】弱點的卡 ⇒ 逆境保險對化石的行為會改變，要回頭補差分');
});

console.log('④ ② 手牌特性「點一下就放到場上」回歸 —— template 行為端求值');
function braceBody(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let j = src.indexOf('{', i + header.length - 1), depth = 0; const start = j;
  if (j < 0) return null;
  while (j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start + 1, j); }
    j++;
  }
  return null;
}
/** 從 `onclick={` 之後的第一個 `{` 開始做括號配對，抓出 arrow function 的 body。
 *  ⚠ 不可以用 braceBody(header) —— header 本身含 `{`，indexOf 會跳到**下一個**屬性
 *    （title={...}）去，抓到的 body 是別人的（第一版就這樣，錯誤訊息是 canEvolve is not defined）。*/
function handOnClickBody(src) {
  const key = 'onclick={()=>{if(actionBusy){tActSay(TACT_BLOCKED_MSG,5000);return;}';
  const i = src.indexOf(key);
  if (i < 0) return null;
  const j = src.indexOf('{', i + 'onclick='.length - 1);   // `onclick=` 後的第一個 `{`（arrow 的外層）
  let depth = 0, k = j;
  while (k < src.length) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
    k++;
  }
  // 外層是 `{()=>{ ... }}` 的 svelte 表達式 ⇒ 內容是 `()=>{ ... }`
  const expr = src.slice(j + 1, k);
  const b = expr.indexOf('{');
  return b < 0 ? null : expr.slice(b + 1, expr.lastIndexOf('}'));
}
const HAND_ONCLICK = handOnClickBody(DESK);
T('4a. anchor：抓得到桌機手牌卡的 onclick body（抓不到就紅，不做掃空字串的安慰劑）', () => {
  assert.ok(HAND_ONCLICK && HAND_ONCLICK.length > 40 && HAND_ONCLICK.length < 600,
    '抓到長度 ' + (HAND_ONCLICK ? HAND_ONCLICK.length : 'null'));
});
T('4b.〔核心〕真的執行 onclick：手牌特性可用時**不送出任何動作**（站長裁定：只能拖曳）', () => {
  // ⚠ 子代理審查抓到：anchor 失效時 HAND_ONCLICK===null，`null + ';return …'` 是**合法 JS**
  //   ⇒ 三條斷言全過的恆真式。每一條用到它的都要先確認 anchor 還在。
  assert.ok(HAND_ONCLICK, 'anchor 失效（抓不到 onclick body）');
  const body = HAND_ONCLICK;
  let dispatched = 0, triggered = 0, sel = null;
  // eslint-disable-next-line no-new-func
  const fn = new Function('actionBusy', 'tActSay', 'TACT_BLOCKED_MSG', 'canHandActivate', 'canEnergy',
    'dragging', 'selectedEnergyIid', 'inst', 'dispatch', 'GameActions', 'triggerHandActivateAbility',
    body + '\n;return selectedEnergyIid;');
  sel = fn(false, () => {}, 'blocked', /* canHandActivate */ true, /* canEnergy */ false,
    null, null, { iid: 'h1' }, () => { dispatched++; },
    { useHandAbility: () => ({ type: 'USE_HAND_ABILITY' }) }, () => { triggered++; });
  assert.equal(triggered, 0, 'onclick 仍然呼叫了 triggerHandActivateAbility');
  assert.equal(dispatched, 0, 'onclick 仍然送出了動作');
  assert.equal(sel, null, 'onclick 不該對非能量卡動 selectedEnergyIid');
});
T('4c. 正對照：能量卡點一下仍然切換 selectedEnergyIid（比照對象的行為沒被一起關掉）', () => {
  assert.ok(HAND_ONCLICK, 'anchor 失效（抓不到 onclick body）');
  const body = HAND_ONCLICK;
  // eslint-disable-next-line no-new-func
  const fn = new Function('actionBusy', 'tActSay', 'TACT_BLOCKED_MSG', 'canHandActivate', 'canEnergy',
    'dragging', 'selectedEnergyIid', 'inst', 'dispatch', 'GameActions', 'triggerHandActivateAbility',
    body + '\n;return selectedEnergyIid;');
  const on = fn(false, () => {}, 'blocked', false, true, null, null, { iid: 'h1' }, () => {}, {}, () => {});
  assert.equal(on, 'h1', '選取沒生效');
  const off = fn(false, () => {}, 'blocked', false, true, null, 'h1', { iid: 'h1' }, () => {}, {}, () => {});
  assert.equal(off, null, '再點一下沒有取消選取');
});
T('4d. 正對照：actionBusy 時 onclick 仍然先擋下並提示（v6.147 的 gate 沒被拆掉）', () => {
  assert.ok(HAND_ONCLICK, 'anchor 失效（抓不到 onclick body）');
  const body = HAND_ONCLICK;
  let said = 0;
  // eslint-disable-next-line no-new-func
  const fn = new Function('actionBusy', 'tActSay', 'TACT_BLOCKED_MSG', 'canHandActivate', 'canEnergy',
    'dragging', 'selectedEnergyIid', 'inst', 'dispatch', 'GameActions', 'triggerHandActivateAbility',
    body + '\n;return selectedEnergyIid;');
  const r = fn(true, () => { said++; }, 'blocked', false, true, null, null, { iid: 'h1' }, () => {}, {}, () => {});
  assert.equal(said, 1); assert.equal(r, null);
});
T('4e. 死碼清除：triggerHandActivateAbility 已完全不存在（函式還在＝入口還在的錯覺）', () => {
  assert.ok(!/function triggerHandActivateAbility/.test(DESK), '函式還在');
  assert.ok(!/triggerHandActivateAbility\s*\(/.test(DESK), '還有呼叫端');
});
T('4f.〔正對照〕拖曳仍然發得動：桌機 pointerup 的 hand-ability 分支還在且送出 useHandAbility', () => {
  const dragBody = braceBody(DESK, "} else if (op === 'hand-ability' && benchEmpty) {");
  assert.ok(dragBody, '拖曳分支不見了');
  let act = null;
  // eslint-disable-next-line no-new-func
  const fn = new Function('d', 'handActivateAbilities', 'dispatch', 'GameActions', '(async () => {' + dragBody + '})();');
  fn({ iid: 'h1' }, new Map([['h1', { abilityName: '激動俯衝', abilityIndex: 2 }]]),
     a => { act = a; }, { useHandAbility: (iid, idx) => ({ type: 'USE_HAND_ABILITY', cardIid: iid, abilityIndex: idx }) });
  assert.deepEqual(act, { type: 'USE_HAND_ABILITY', cardIid: 'h1', abilityIndex: 2 });
});
T('4g.〔正對照〕手機直式的入口原封不動（沒有拖曳 ⇒ 點卡開 sheet、按鈕才發動）', () => {
  assert.ok(/ops\.has\('hand-ability'\)/.test(MOB), '手機的可用性判定不見了');
  assert.ok(/GameActions\.useHandAbility\(iid, a\.abilityIndex\)/.test(MOB), '手機的發動按鈕不見了');
  assert.ok(!/startDrag\(/.test(MOB), '手機不該有拖曳');
});
T('4h. 提示文字不再叫玩家「點擊」（UI 與行為不可以說不同的話）', () => {
  assert.ok(!/點擊或拖到備戰格使用特性/.test(DESK), 'title 還寫著「點擊或拖到備戰格」');
  assert.ok(/拖到備戰格使用特性/.test(DESK), 'title 沒有改成拖曳版');
  assert.ok(/⚡ 拖到備戰發動特性/.test(DESK), '手牌提示沒有改成拖曳版');
});

console.log('⑤ ① 神秘石居 × 傳說的熔岩洞 —— 回歸鎖（玩家回報的完整流程）');
function clawSearch({ seat = 0, caveId = null, caveOwner = 0, crabId = CRAB }) {
  RESEED();
  const A = { active: I(HAWK, { energyAttached: [I(FIRE_E), I(FIRE_E), I(FIRE_E)] }), bench: [], deck: [I(PLAIN), I(PLAIN), I(PLAIN)] };
  const crab = I(crabId);
  const B = { active: crab, bench: [I(PLAIN)], deck: [I(PLAIN), I(PLAIN)] };
  const s = ST(seat === 0 ? A : B, seat === 0 ? B : A,
    { activePlayerIndex: seat, ...(caveId ? { activeStadium: I(caveId), activeStadiumOwnerIdx: caveOwner } : {}) });
  let r = ENG.applyAction(s, { type: 'ATTACK', attackIndex: 0, actorIdx: seat }, pool);
  let g = 0;
  while (r.pendingSelection && g++ < 6) {
    const ps = r.pendingSelection;
    const pick = r.players[seat].deck[0];
    r = ENG.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: pick ? [pick.iid] : [], actorIdx: ps.actorIdx ?? seat }, pool);
  }
  const d = r.players[1 - seat].active;
  return { ko: !d || d.iid !== crab.iid, dmg: d && d.iid === crab.iid ? d.damage : 'KO', log: r.log.map(l => l.message).join('\n') };
}
T('5a.〔核心〕熔岩洞在場 → 鉤爪搜尋（150）打得動岩殿居蟹：兩個熔岩洞印刷 × 兩個座位 × 兩種擁有者', () => {
  for (const cv of CAVES) for (const seat of [0, 1]) for (const owner of [0, 1]) {
    const r = clawSearch({ seat, caveId: cv, caveOwner: owner });
    assert.ok(r.ko, `cave=${cv} seat=${seat} owner=${owner} 仍被免疫：` + r.log);
  }
});
T('5b. 正對照：沒有熔岩洞 → 神秘石居仍然免疫（沒有把特性整個改壞）', () => {
  const r = clawSearch({});
  assert.equal(r.dmg, 0, r.log);
  assert.ok(/神秘石居/.test(r.log), '免疫的理由不是神秘石居：' + r.log);
});
T('5c. 六個岩殿居蟹印刷行為一致（熔岩洞在場全部打得到、不在場全部免疫）', () => {
  const prints = [...pool.entries()].filter(([, c]) => c.name === '岩殿居蟹' && c.abilities?.some(a => a.name === '神秘石居')).map(([id]) => id);
  assert.ok(prints.length >= 4, '岩殿居蟹只抓到 ' + prints.length + ' 個印刷');
  for (const p of prints) {
    assert.ok(clawSearch({ caveId: CAVES[0], crabId: p }).ko, p + ' 熔岩洞在場仍免疫');
    assert.equal(clawSearch({ crabId: p }).dmg, 0, p + ' 沒有熔岩洞卻不免疫');
  }
});
T('5d. 備戰路徑同一答案：passiveImmunityDamageBlock 在熔岩洞在場時不擋（active/bench 都測）', () => {
  for (const loc of ['active', 'bench']) for (const cave of [null, CAVES[0]]) {
    const crab = I(CRAB);
    const p1 = loc === 'active' ? { active: crab, bench: [I(PLAIN)] } : { active: I(PLAIN), bench: [crab] };
    const s = ST({ active: I(HAWK), bench: [] }, p1, cave ? { activeStadium: I(cave), activeStadiumOwnerIdx: 0 } : {});
    const r = EFF.passiveImmunityDamageBlock(s, 0, crab, pool.get(CRAB), pool);
    assert.equal(r.blocked, !cave, `loc=${loc} cave=${cave} → ${JSON.stringify(r)}`);
  }
});

console.log('⑥ 整體 audit：位置限定的 passive 特性（卡面「只要這隻寶可夢在戰鬥場上／在備戰區」）');
T('6a. 掃描器抓得到全站位置限定特性（下限斷言：掃不到就是掃描器壞了）', () => {
  const all = [];
  for (const [, c] of pool) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of c.abilities || []) {
      const e = String(a.effect || '');
      if (e.startsWith('只要這隻寶可夢在戰鬥場上') || e.startsWith('只要這隻寶可夢在備戰區')) all.push(a.name);
    }
  }
  const uniq = [...new Set(all)];
  assert.ok(uniq.length >= 23, '只掃到 ' + uniq.length + ' 個位置限定 passive：' + JSON.stringify(uniq));
});
T('6b. 中央宣告的內容逐字釘死（多一個少一個都紅）', () => {
  assert.deepEqual([...EFF.ACTIVE_ONLY_PASSIVE_REDUCE_ABILITIES].sort(), ['威嚇之牙', '威嚇之顎']);
});
/** 只剝註解、**保留字串內容**（v6.207 教訓：先剝字串會把要比對的字面量一起清掉）。 */
function stripComments(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i++; } out += src[i]; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
/** 取出函式 body（大括號配對）。
 *  ⚠ `openMarker` 是**必填**：TS 的回傳型別本身含 `{`（`): { amount: number; … } {`），
 *    直接 `indexOf('{', header)` 會抓到回傳型別那一對（第一版抓到 68 字元的空殼，6c 假紅）。 */
function fnBody(src, header, openMarker) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  const k = src.indexOf(openMarker, i);
  if (k < 0) return null;
  let j = k + openMarker.lastIndexOf('{'), depth = 0; const start = j;
  while (j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start + 1, j); }
    j++;
  }
  return null;
}
/**
 * 否定型判準：**唯一真正有行為的消費點**（`_applyBenchAbilityReduce`）有沒有被去中央化 ——
 * 子代理審查的 D6：把中央呼叫換成本地 `if (ab.name === '威嚇之牙' && _vloc !== 'active') continue;`
 * 行為完全正確、原本 33 條**一條都不會紅**，中央宣告就變成沒有消費者的死宣告。
 * ⚠ 判準刻意只看這一支函式的 body，不做全檔掃描 —— 全檔掃「=== '威嚇之顎'」會把
 *   engine.ts 那句合法的「這張化石卡有沒有這個特性」誤判成違規（第一版就這樣假紅）。
 */
const BENCH_REDUCE_BODY = fnBody(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'),
  'function _applyBenchAbilityReduce(', '): { amount: number; logs: string[]; toolToDiscard: CardInstance | null } {');
function decentralizeHits(body) {
  const code = stripComments(body ?? '');
  const bad = [];
  for (const n of ['威嚇之牙', '威嚇之顎']) if (code.includes(n)) bad.push(n);
  if (!/passiveReduceAppliesAtLocation\(/.test(code)) bad.push('<沒有呼叫中央述詞>');
  return bad;
}
T('6c.〔否定型〕備戰減傷消費點沒有被去中央化（不得自己硬編特性名，必須呼叫中央述詞）', () => {
  assert.ok(BENCH_REDUCE_BODY && BENCH_REDUCE_BODY.length > 2000,
    'anchor 失效：抓到 body 長度 ' + (BENCH_REDUCE_BODY ? BENCH_REDUCE_BODY.length : 'null'));
  assert.deepEqual(decentralizeHits(BENCH_REDUCE_BODY), [], '備戰減傷消費點被去中央化');
});
T('6d.〔自我驗證〕6c 的判準抓得到違規樣本，且不誤報乾淨樣本／註解／字串', () => {
  const violating = "let x=1;\n" + "if (ab.name === '威嚇之牙' && _vloc !== 'active') continue;\n".repeat(3);
  assert.ok(decentralizeHits(violating).includes('威嚇之牙'), '抓不到硬編特性名');
  assert.ok(decentralizeHits(violating).includes('<沒有呼叫中央述詞>'), '抓不到「中央述詞不見了」');
  assert.deepEqual(decentralizeHits("if (!passiveReduceAppliesAtLocation(ab.name, _vloc)) continue;"), [],
    '乾淨樣本誤報');
  assert.deepEqual(decentralizeHits("// 威嚇之牙 只是註解\nif (!passiveReduceAppliesAtLocation(a,b)) continue;"), [],
    '註解被誤判成硬編');
  assert.ok(stripComments("const u = 'a//b';").includes("'a//b'"), 'strip 不該動字串內容');
  assert.ok(decentralizeHits("const s = 'https://x//y';\nif (ab.name === '威嚇之顎') {}\npassiveReduceAppliesAtLocation(1,2);")
    .includes('威嚇之顎'), 'strip 把字串裡的 // 當註解，砍掉了同一行後面的真碼');
});
T('6e. engine.ts 的兩個消費點確實呼叫中央述詞（**未來用**的接線，本身回傳恆真，故只能靜態釘）', () => {
  const eng = stripComments(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const n = (eng.match(/passiveReduceAppliesAtLocation\(/g) || []).length;
  assert.equal(n, 2, 'engine.ts 呼叫中央述詞 ' + n + ' 次（應為 2：戰鬥位 PASSIVE_DAMAGE_REDUCE 迴圈 ＋ 化石 -30）');
  const effSrc = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  assert.ok((effSrc.match(/passiveReduceAppliesAtLocation\(/g) || []).length >= 1, 'effects.ts 備戰管線沒有接上');
});
T('6f.〔注入點〕_shared 的中央有效屬性注入真的接上了（沒接上＝靜默 fallback 印刷屬性，全綠）', () => {
  // 行為端：傳說的山頂 + 化石被 KO ⇒ 0 張獎賞。注入點沒接上就會退回印刷屬性（null）⇒ 拿 1 張。
  const PEAKS = [...pool.entries()].filter(([, c]) => c.name === '傳說的山頂').map(([id]) => id);
  RESEED();
  const v = I(FOSSILS[0], { fossilOnField: true });
  const six = () => [I(PLAIN), I(PLAIN), I(PLAIN), I(PLAIN), I(PLAIN), I(PLAIN)];
  const s = ST({ active: I(PLAIN), bench: [], prizes: six() }, { active: v, bench: [I(PLAIN)], prizes: six() },
               { activeStadium: I(PEAKS[0]), activeStadiumOwnerIdx: 0 });
  const r = EFF.dealAttackDamageToTarget(s, 0, v.iid, 200, pool, { label: '測' });
  assert.equal(r.players[0].prizes.length, 6, '注入點沒接上（山頂對化石沒生效）');
});

console.log(`\n=== v6.208 ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
