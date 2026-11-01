#!/usr/bin/env node
/**
 * v6.615 守衛：卡牌資料庫收錄「戰術牌組」四副（MTL／MTS／MTH／MTK）
 *
 * 站長 2026-11-01 轉述玩家建議：「希望卡牌資料庫中加入對戰的內建牌組中已有的戰術牌組
 *   （超級噴火龍Xex、超級沙奈朵ex、超級巨牙鯊ex、超級快龍ex）」。
 * 官方卡牌檢索的商品代號（2026-11-01 現查 asia.pokemon-card.com/tw/card-search/ 的 expansionCode）：
 *   MTL 戰術牌組「超級噴火龍Xex」／MTS「超級沙奈朵ex」／MTH「超級巨牙鯊ex」／MTK「超級快龍ex」，發售日 2026-07-17。
 *
 * 【D】資料層
 *   D1 四個卡表存在，張數 24／24／21／25，全部 H／I／J，id 不和站上任何卡重複
 *   D2 與官方快照（scripts/data/official-set-manifest.json）雙向一致
 *   D3 index.json 四筆：名稱、標記 J、發售日、張數、supertypeCounts 與檔案一致；既有筆數逐字等於 BASE
 *   D4 card-set-map.json 四副每張都對應到自己的卡包代號；既有鍵值逐字等於 BASE
 *   D5 沒有括號卡名（站長 2026-09-15 裁定：官網的「老大的指令（烏羽）」改回「老大的指令」），
 *      而且改名的四張 rulesText 與站上既有「老大的指令」逐字相同（反對照：卡還在，只是換名）
 * 【C】卡面與實作
 *   C1 每張卡在站上都有同名、卡面相同的既有印刷（小光只差「1／一」一個字，逐字釘住）
 *   C2 行為端：打包引擎，有效果的招式全部在 ATTACK_PRE／ATTACK_POST、訓練家全部在 TRAINER_EFFECTS、
 *      特性：主動特性在 hasAbilityFn，其餘被動特性逐一列名（不可以多也不可以少）
 *   C3 對戰預組四副戰術牌組的卡名集合 ＝ 官方商品卡表（60 張）
 *   C4 行為端：牌組合法性（validateDeck）——新印刷的 ACE SPEC 與既有 ACE SPEC 合計 2 張必須違規、單用新印刷 4 張必須違規
 *      （審查 P1：官方 ACE SPEC 篩選頁沒收這四張 ⇒ 抓卡時 tags 沒補上 ⇒ 「一副 1 張」對新印刷失效；C1 也因為比對欄位漏了 tags 而沒抓到）
 * 【H】HEAD-FAIL：BASE（v6.614）上 D1、D3、D4 紅
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '1f30545c';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const SETS = { MTL: { name: '戰術牌組「超級噴火龍Xex」', n: 24, preset: 'CHARIZARDX_TACTIC_DECK' }, MTS: { name: '戰術牌組「超級沙奈朵ex」', n: 24, preset: 'GARDEVOIR_TACTIC_DECK' },
  MTH: { name: '戰術牌組「超級巨牙鯊ex」', n: 21, preset: 'SHARPEDO_TACTIC_DECK' }, MTK: { name: '戰術牌組「超級快龍ex」', n: 25, preset: 'DRAGONITE_TACTIC_DECK' } };
const HIJ = new Set(['H', 'I', 'J']);
// 主動特性表以外、由各自的被動表實作的特性（現查：每一個在 src/lib/game 都有實作；名單變動要重新查證）
const PASSIVE_ABILITIES = ['小火龍|一身輕', '莉莉艾的皮皮ex|妖精領域', '拉帝亞斯ex|天空徑線', '胖嘟嘟ex|海之詛咒', '超級蒂安希ex|鑽石膜', '飯匙蛇|激動力量'];

function dataChecks(read, exists) {
  const r = {};
  const files = Object.keys(SETS).map((c) => [c, exists(`static/cards/${c}.json`) ? read(`static/cards/${c}.json`) : null]);
  const idx = read('static/cards/index.json');
  const others = new Map();
  for (const e of idx) if (!SETS[e.code] && exists(`static/cards/${e.code}.json`)) for (const c of read(`static/cards/${e.code}.json`)) others.set(String(c.id), c);
  r.D1 = files.every(([c, d]) => d && d.length === SETS[c].n && d.every((x) => HIJ.has(x.regulationMark) && !others.has(String(x.id))));
  const ent = Object.fromEntries(idx.filter((e) => SETS[e.code]).map((e) => [e.code, e]));
  r.D3 = files.every(([c, d]) => { const e = ent[c]; if (!d || !e) return false;
    const st = {}; for (const x of d) st[x.supertype] = (st[x.supertype] || 0) + 1;
    return e.name === SETS[c].name && e.regulationMark === 'J' && e.releaseDate === '2026-07-17' && e.cardCount === d.length && e.count === d.length && JSON.stringify(e.supertypeCounts) === JSON.stringify(Object.fromEntries(['Pokemon', 'Trainer', 'Energy'].filter((k) => st[k]).map((k) => [k, st[k]]))); });
  const map = read('static/card-set-map.json');
  r.D4 = files.every(([c, d]) => d && d.every((x) => map[String(x.id)] === c));
  return { r, files, idx, map, others };
}

const cur = dataChecks(J, (p) => existsSync(join(ROOT, p)));
console.log('【D】資料層');
ok('★★★ D1 四個卡表存在、張數 24／24／21／25、全部 H／I／J、id 不重複', cur.r.D1 === true);
const man = J('scripts/data/official-set-manifest.json').sets;
const d2bad = Object.keys(SETS).filter((c) => { const d = cur.files.find(([k]) => k === c)[1] || []; const a = new Set((man[c]?.ids) || []), b = new Set(d.map((x) => String(x.id)));
  return !man[c] || man[c].total !== b.size || a.size !== b.size || [...a].some((i) => !b.has(i)) || [...b].some((i) => !a.has(i)) || JSON.stringify(man[c].localSetCodes) !== JSON.stringify([c]); });
ok('★★ D2 與官方快照雙向一致（官方有的我們都有、我們有的官方都有）', d2bad.length === 0, d2bad.join(','));
ok('★★★ D3 index.json 四筆：名稱／標記 J／發售日 2026-07-17／張數／supertypeCounts 與檔案一致', cur.r.D3 === true);
ok('★★★ D4 card-set-map.json：四副每張卡都對應到自己的卡包代號', cur.r.D4 === true);
const all = cur.files.flatMap(([c, d]) => (d || []).map((x) => [c, x]));
const boss = all.filter(([, x]) => x.name === '老大的指令');
const bossOld = [...cur.others.values()].find((x) => x.name === '老大的指令');
ok('★★ D5 沒有括號卡名；四副各一張「老大的指令」且 rulesText 與站上既有「老大的指令」逐字相同（反對照：卡還在，只是換了名字）',
  all.every(([, x]) => !/[（(][^（()）]*[）)]\s*$/.test(x.name)) && boss.length === 4 && new Set(boss.map(([c]) => c)).size === 4 && !!bossOld && boss.every(([, x]) => x.rulesText === bossOld.rulesText && x.subtype === bossOld.subtype));

console.log('【C】卡面與實作');
// ⚠ tags 必須在比對欄位裡（審查 P1：ACE SPEC／訓練家冠名 漏了，C1 卻是綠的）
const F = ['supertype', 'subtype', 'stage', 'hp', 'pokemonType', 'evolvesFrom', 'abilities', 'attacks', 'weakness', 'resistance', 'retreatCost', 'rulesText', 'tags'];
const norm = (x) => JSON.stringify(F.map((k) => x[k] ?? null));
const byName = new Map(); for (const x of cur.others.values()) { if (!byName.has(x.name)) byName.set(x.name, []); byName.get(x.name).push(x); }
const c1bad = [];
for (const [c, x] of all) {
  const cs = byName.get(x.name) || [];
  if (cs.some((o) => norm(o) === norm(x))) continue;
  // 唯一允許的例外：小光 rulesText 只差「各1張」／「各一張」
  if (x.name === '小光' && cs.some((o) => norm({ ...o, rulesText: (o.rulesText || '').replace('各一張', '各1張') }) === norm(x))) continue;
  c1bad.push(`${c} ${x.id} ${x.name}`);
}
ok('★★★ C1 每張卡在站上都有同名、卡面與標籤（tags）相同的既有印刷（小光只差「1／一」一個字）', all.length === 94 && c1bad.length === 0, c1bad.join('；'));

// C2 行為端：打包引擎，讀實際註冊表
{
  const S = join(ROOT, '.v6615-s.js'), E = join(ROOT, '.v6615-e.ts'), O = join(ROOT, '.v6615-o.mjs');
  const clean = () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } };
  process.on('exit', clean);
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, "export * from './src/lib/game/effects/_shared';\nexport { PASSIVE_ATTACK_BONUS, PASSIVE_DAMAGE_REDUCE, ABILITY_RETREAT_MOD, FREE_RETREAT_BASIC_ABILITY_NAMES } from './src/lib/game/effects';");
  let M = null;
  try { await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' }); M = await import(pathToFileURL(O).href); } catch (e) { M = null; }
  clean();
  const atkMiss = [], trMiss = [], abLeft = []; let atkWithEffect = 0, tr = 0;
  if (M) for (const [, x] of all) {
    for (const a of x.attacks || []) { if (!a.effect) continue; atkWithEffect++; const k = `${x.name}|${a.name}`; if (!M.ATTACK_PRE.has(k) && !M.ATTACK_POST.has(k)) atkMiss.push(k); }
    (x.abilities || []).forEach((ab, i) => { if (!M.hasAbilityFn(x.name, ab.name, i)) abLeft.push(`${x.name}|${ab.name}`); });
    if (x.supertype === 'Trainer') { tr++; if (!M.TRAINER_EFFECTS.has(x.name)) trMiss.push(x.name); }
  }
  const left = [...new Set(abLeft)].sort(), want = [...PASSIVE_ABILITIES].sort();
  // 被動特性：只比名單擋不住「實作被刪掉」（審查 P2）⇒ 剝掉註解後，src/lib/game 的程式碼裡必須真的有這個特性名的字串字面
  const { stripCommentsBlank } = await import('./lib/strip-comments.mjs');
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d) => readdirSync(d).flatMap((f) => { const q = join(d, f); return statSync(q).isDirectory() ? walk(q) : (/\.ts$/.test(f) ? [q] : []); });
  const code = walk(join(ROOT, 'src/lib/game')).map((f) => stripCommentsBlank(readFileSync(f, 'utf8'))).join('\n');
  // ⭐複審 P2：字面檢查擋不住「實作刪掉、分類表的字面還在」（激動力量有 3 處字面，只有 1 處是實作）
  //   ⇒ 有註冊表的四個直接查引擎的實際表；妖精領域／海之詛咒寫在函式裡（effects.ts、v3001_g3_wave3.ts），維持字面檢查
  const TABLE = { '飯匙蛇|激動力量': () => M.PASSIVE_ATTACK_BONUS.has('激動力量'), '超級蒂安希ex|鑽石膜': () => M.PASSIVE_DAMAGE_REDUCE.has('鑽石膜'),
    '小火龍|一身輕': () => M.ABILITY_RETREAT_MOD.has('一身輕'), '拉帝亞斯ex|天空徑線': () => M.FREE_RETREAT_BASIC_ABILITY_NAMES.has('天空徑線') };
  const passiveImplMissing = PASSIVE_ABILITIES.filter((k) => {
    if (TABLE[k]) { try { return !TABLE[k](); } catch { return true; } }
    const ab = k.split('|')[1]; return !code.includes(`'${ab}'`) && !code.includes(`"${ab}"`);
  });
  ok('★★★ C2 行為端：有效果的招式全部已註冊、訓練家全部有效果、主動特性以外剛好是 6 個已知被動特性且程式碼裡真的有實作',
    !!M && atkWithEffect >= 30 && tr >= 50 && atkMiss.length === 0 && trMiss.length === 0 && JSON.stringify(left) === JSON.stringify(want) && passiveImplMissing.length === 0,
    JSON.stringify({ built: !!M, atkWithEffect, atkMiss, tr, trMiss, left, passiveImplMissing }));
}

// C3 對戰預組 ＝ 官方商品卡表（卡名集合）
{
  const src = readFileSync(join(ROOT, 'src/lib/decks/presets.ts'), 'utf8');
  const nameOf = new Map([...cur.others.values()].map((x) => [String(x.id), x.name]));
  const bad = [];
  for (const [c, d] of cur.files) {
    const i = src.indexOf(`const ${SETS[c].preset}`); const blk = i >= 0 ? src.slice(i, src.indexOf('};', i)) : '';
    const ent = [...blk.matchAll(/cardId: '(\d+)', count: (\d+)/g)];
    const names = new Set(ent.map((m) => nameOf.get(m[1])));
    const total = ent.reduce((s, m) => s + +m[2], 0);
    const off = new Set((d || []).map((x) => x.name));
    if (total !== 60 || names.size !== off.size || [...names].some((n) => !off.has(n))) bad.push(`${c}: 預組 ${total} 張 ${names.size} 種／官方 ${off.size} 種`);
  }
  ok('★★ C3 對戰預組四副戰術牌組 60 張、卡名集合 ＝ 官方商品卡表', bad.length === 0, bad.join('；'));
}

// C4 行為端：牌組合法性（ACE SPEC 一副 1 張）—— 打包真的 validateDeck，用全站卡池跑
{
  const S = join(ROOT, '.v6615v-s.js'), E = join(ROOT, '.v6615v-e.ts'), O = join(ROOT, '.v6615v-o.mjs');
  const clean = () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } };
  process.on('exit', clean);
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, "export { validateDeck, isAceSpec } from './src/lib/decks/validation';");
  let V = null;
  try { await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' }); V = await import(pathToFileURL(O).href); } catch { V = null; }
  clean();
  const pool = new Map([...cur.others.values()].map((x) => [String(x.id), x]));
  for (const [, x] of all) pool.set(String(x.id), x);
  const ACE = all.filter(([, x]) => (x.tags || []).includes('ACE SPEC')).map(([, x]) => String(x.id));
  const oldAce = [...cur.others.values()].find((x) => x.name === '頂尖捕捉器' && (x.tags || []).includes('ACE SPEC'));
  const issuesOf = (entries) => { const r = V.validateDeck({ id: 't', name: 't', createdAt: '', updatedAt: '', entries }, pool); return (r.issues || r.errors || []).join('；'); };
  let res = null;
  if (V && oldAce) {
    const mix = issuesOf([{ cardId: '19297', count: 1 }, { cardId: String(oldAce.id), count: 1 }]);
    const four = issuesOf([{ cardId: '19297', count: 4 }]);
    const allNew = issuesOf(ACE.map((id) => ({ cardId: id, count: 1 })));
    res = { aceIds: ACE, isAce: ['19297', '19345', '19319', '19370'].map((id) => V.isAceSpec(pool.get(id))), mix, four, allNew };
  }
  ok('★★★ C4 牌組合法性：四張新印刷都是 ACE SPEC；新＋舊各 1、新印刷 4 張、四張新印刷各 1 ⇒ 都違反「ACE SPEC 一副 1 張」',
    !!res && res.aceIds.length === 4 && res.isAce.every(Boolean) && /ACE SPEC/.test(res.mix) && /ACE SPEC/.test(res.four) && /ACE SPEC/.test(res.allNew), JSON.stringify(res));
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const rb = (p) => { const b = readBaseBlob(ROOT, BASE_SHA, p); if (!b.ok) throw new Error('missing ' + p); return JSON.parse(b.out); };
  const eb = (p) => readBaseBlob(ROOT, BASE_SHA, p).ok;
  const base = dataChecks(rb, eb);
  ok('★★★ HEAD-FAIL：BASE（v6.614）上 D1、D3、D4 紅', base.r.D1 !== true && base.r.D3 !== true && base.r.D4 !== true, JSON.stringify(base.r));
  // 既有資料逐字未動
  const bIdx = rb('static/cards/index.json');
  ok('★★ index.json 既有筆數逐字等於 BASE（只在後面追加四筆）', JSON.stringify(cur.idx.slice(0, bIdx.length)) === JSON.stringify(bIdx) && cur.idx.length === bIdx.length + 4);
  const bMap = rb('static/card-set-map.json');
  ok('★★ card-set-map.json 既有鍵值逐字等於 BASE（只新增 94 筆）', Object.entries(bMap).every(([k, v]) => cur.map[k] === v) && Object.keys(cur.map).length === Object.keys(bMap).length + 94);
}

console.log(`\n=== v6.615 戰術牌組四副收錄：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
