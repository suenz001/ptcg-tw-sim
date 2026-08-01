/**
 * v6.093「傳說」競技場拆成兩張獨立卡片
 *
 * ⭐ Wilson 裁定（2026-08-01）：
 *   「傳說的山頂(左) 當作編號073那張、傳說的山頂(右) 當作編號074那張，
 *     等於完全就當成是2張牌來處理」
 *   ＋ 張數上限＝左右合計最多 4 張（＝2 套）
 *   ＋ 既有牌組自動轉換成左右各半
 *
 * 官方 collectorNumber（static/cards/M6.json，唯一權威）本來就標成兩個編號。
 * ⭐ 卡名刻意維持相同 → 場地效果 hook、reg key、同名 4 張規則全部自動保持正確；左右由 cardId 區分。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v93-s.js'), E = join(ROOT, '.v93-e.ts'), O = join(ROOT, '.v93-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { validateDeck, isTwoCardStadium, TWO_CARD_STADIUM_NAMES, twoCardStadiumPartnerCardId as vPartner, twoCardStadiumSide as vSide } from './src/lib/decks/validation';\n" +
  "export { migrateDeck, splitTwoCardStadiumEntries } from './src/lib/decks/cardIdMigration';\n" +
  "export { twoCardStadiumPartnerCardId, twoCardStadiumSide, canPlayTwoCardStadium, findTwoCardStadiumPair } from './src/lib/game/effects/_shared';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const byId = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) byId.set(String(c.id), c);
}
const byNum = (name, num) => [...byId.values()].find(c => c.name === name && c.collectorNumber === num);

let pass = 0, fail = 0;
const ok = (c, l, extra = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', l, extra); } };

// ══ A) 卡片資料：三張各拆成兩筆，編號來自官方 collectorNumber ══
const SPEC = [
  ['傳說的海溝', '071/076', '072/076'],
  ['傳說的山頂', '073/076', '074/076'],
  ['傳說的熔岩洞', '075/076', '076/076'],
];
for (const [name, ln, rn] of SPEC) {
  const l = byNum(name, ln), r = byNum(name, rn);
  ok(!!l && !!r, `⭐ A「${name}」左右兩張都在卡片資料庫裡（${ln} / ${rn}）`);
  if (!l || !r) continue;
  ok(l.id !== r.id, `A「${name}」左右是不同的 cardId`, `${l.id}/${r.id}`);
  ok(l.name === r.name, `⭐ A「${name}」左右卡名相同（效果 hook 與同名 4 張規則才會自動正確）`);
  ok(l.rulesText === r.rulesText && !!l.rulesText, `A「${name}」左右卡面效果文字一致`);
  ok(l.regulationMark === r.regulationMark && l.subtype === 'Stadium', `A「${name}」標記與類型一致`);
  // 左右對照表（引擎層 + 牌組層兩份必須一致）
  ok(M.twoCardStadiumPartnerCardId(String(l.id)) === String(r.id)
    && M.twoCardStadiumPartnerCardId(String(r.id)) === String(l.id), `⭐ A「${name}」引擎層對照表互為一對`);
  ok(M.vPartner(String(l.id)) === String(r.id) && M.vPartner(String(r.id)) === String(l.id),
    `⭐ A「${name}」牌組層對照表與引擎層一致（兩份不可漂移）`);
  ok(M.twoCardStadiumSide(String(l.id)) === 0 && M.twoCardStadiumSide(String(r.id)) === 1,
    `A「${name}」左右側判定正確`);
  ok(M.vSide(String(l.id)) === 0 && M.vSide(String(r.id)) === 1, `A「${name}」牌組層左右側判定一致`);
}
ok(M.twoCardStadiumPartnerCardId('19551') === null, 'A 否定對照：一般卡沒有另一半');
ok(M.twoCardStadiumSide('19551') === null, 'A 否定對照：一般卡沒有左右側');

// ══ B) 舊牌組自動轉換（Wilson 裁定：玩家無感）══
{
  const PEAK_L = byNum('傳說的山頂', '073/076'), PEAK_R = byNum('傳說的山頂', '074/076');
  const cnt = (d, id) => d.entries.find(e => e.cardId === String(id))?.count ?? 0;
  // 舊牌組只存左半那個 id
  const old4 = { id: 'd', name: 'd', entries: [{ cardId: String(PEAK_L.id), count: 4 }, { cardId: '19551', count: 10 }] };
  const m4 = M.migrateDeck(old4);
  ok(cnt(m4, PEAK_L.id) === 2 && cnt(m4, PEAK_R.id) === 2,
    '⭐ B 舊牌組 4 張 → 自動轉成 左 2 ＋ 右 2（＝2 套，與拆卡前完全等價）',
    JSON.stringify(m4.entries));
  ok(cnt(m4, '19551') === 10, 'B 其他卡不受影響');
  const m2 = M.migrateDeck({ id: 'd', name: 'd', entries: [{ cardId: String(PEAK_L.id), count: 2 }] });
  ok(cnt(m2, PEAK_L.id) === 1 && cnt(m2, PEAK_R.id) === 1, 'B 舊牌組 2 張 → 左 1 ＋ 右 1');
  // 奇數張：不靜默補成偶數，讓牌組驗證提示玩家自己修
  const m3 = M.migrateDeck({ id: 'd', name: 'd', entries: [{ cardId: String(PEAK_L.id), count: 3 }] });
  ok(cnt(m3, PEAK_L.id) === 2 && cnt(m3, PEAK_R.id) === 1,
    '⭐ B 奇數 3 張 → 左 2 ＋ 右 1（不靜默動玩家的牌組，交給驗證提示）');
  // 冪等：已轉換過的牌組再轉一次不會變多
  const twice = M.migrateDeck(m4);
  ok(cnt(twice, PEAK_L.id) === 2 && cnt(twice, PEAK_R.id) === 2, '⭐ B 冪等：已轉換過的牌組再跑一次不會愈轉愈多');
  const twice2 = M.splitTwoCardStadiumEntries(M.splitTwoCardStadiumEntries(old4));
  ok(twice2.entries.filter(e => e.cardId === String(PEAK_R.id)).length === 1, 'B 冪等：不會產生重複的右半 entry');
}

// ══ C) 牌組驗證：左右張數要相等、合計 ≤4 ══
{
  const L = byNum('傳說的山頂', '073/076'), R = byNum('傳說的山頂', '074/076');
  const basic = [...byId.values()].find(c => c.supertype === 'Pokemon' && !c.evolvesFrom && ['H','I','J'].includes(c.regulationMark));
  const water = [...byId.values()].find(c => c.name === '基本【水】能量');
  const mk = (l, r) => ({ id: 't', name: 't', entries: [
    ...(l > 0 ? [{ cardId: String(L.id), count: l }] : []),
    ...(r > 0 ? [{ cardId: String(R.id), count: r }] : []),
    { cardId: String(basic.id), count: 4 },
    { cardId: String(water.id), count: 56 - l - r },
  ] });
  const HINT = '要成套';
  ok(M.validateDeck(mk(2, 1), byId).issues.some(s => s.includes(HINT)), '⭐ C 左 2 右 1 → 報「左右要成套」');
  ok(M.validateDeck(mk(0, 2), byId).issues.some(s => s.includes(HINT)), '⭐ C 只有右半 → 報「左右要成套」');
  ok(!M.validateDeck(mk(2, 2), byId).issues.some(s => s.includes(HINT)), 'C 否定對照：左 2 右 2 → 不報成套問題');
  ok(M.validateDeck(mk(3, 3), byId).issues.some(s => s.includes('4')),
    '⭐ C 合計 6 張 → 被「同名最多 4 張」擋下（Wilson 裁定：左右合計 4 張）');
  ok(!M.validateDeck(mk(2, 2), byId).issues.some(s => s.includes('4')), 'C 否定對照：合計 4 張不報上限');
}

// ══ D) 對戰層：要一左一右才能打出 ══
{
  const L = String(byNum('傳說的熔岩洞', '075/076').id), R = String(byNum('傳說的熔岩洞', '076/076').id);
  ok(M.canPlayTwoCardStadium([{ iid: '1', cardId: L }, { iid: '2', cardId: L }], L) === false,
    '⭐ D 手上兩張都是左半 → 不可打出');
  ok(M.canPlayTwoCardStadium([{ iid: '1', cardId: L }, { iid: '2', cardId: R }], L) === true, 'D 一左一右 → 可打出');
  const p = M.findTwoCardStadiumPair([{ iid: '1', cardId: R }, { iid: '2', cardId: L }], R);
  ok(p && p.left.cardId === L && p.right.cardId === R, 'D 配對的 left/right 對應正確（從右半按也不顛倒）');
}

// ══ E) 牌組編輯器：成套加減（靜態守衛）══
{
  const decks = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
  ok(/bump\(card\.id, 1\);\s*\n\s*if \(partnerId\) bump\(partnerId, 1\);/.test(decks),
    '⭐ E 加入時左右各 +1（按任一半都成套加入）');
  ok(/const drop = new Set\(\[cardId, \.\.\.\(partnerId \? \[partnerId\] : \[\]\)\]\)/.test(decks),
    '⭐ E 移除時左右各 −1（與加入對稱，不會留下半張）');
  ok(!/const step = isTwoCardStadium\(card\) \? 2 : 1/.test(decks), 'E 舊的「同一張卡 ±2」寫法已移除');
}

console.log(`v6093 傳說競技場拆成兩張獨立卡片：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
