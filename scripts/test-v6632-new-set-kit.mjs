// v6.632 守衛：新卡包工具組（scripts/new-set/）與「超級進化 Z ex」判準的事前演練
//
// 由來（2026-11-07，站長）：「官方預計在11月底推出新的擴充包 波導探求者……我希望你能準備好相關的skills、
//   爬蟲程式、audit規則等等……利用現在已經抓取的卡包和卡片，去測試模擬」。
//   這支守住兩件事：①工具本身的判準不會悄悄壞掉（每一條都用「故意做錯」的假資料證明抓得到）；
//   ②波導探求者的「名字有 Z 的超級進化 ex」（官網預告：超級路卡利歐Zex 等）在引擎裡會被當成超級進化 ex。
//
// 【A】audit-new-set 資料檢查：新標記（K）⇒ ⛔；數字 id ⇒ ⛔；ex 從同名非 ex 進化 ⇒ ⛔；階段差錯 ⇒ ⛔；
//      兩張合一 ⇒ 提醒拆右半；名字以「超級」開頭卻不是 ex ⇒ ⛔；正確的卡 0 個 ⛔（反對照）
// 【B】audit-new-set 實裝檢查（假註冊表）：同名同招不同卡面 ⇒ ⛔；同名訓練家不同卡面 ⇒ ⛔；同名特性不同卡面 ⇒ ⛔；
//      範本寫法不一致 ⇒ 提醒；同卡面範本 ⇒ 列出；沒有範本 ⇒ 標新機制
// 【C】fetch-official-qa：解析官網頁片段（卡片 id／問答／商品）；翻頁重疊 ⇒ complete=false；去重合併；規則書比對；參數 fail-closed
// 【D】超級進化 Z ex：isMegaExCard／isPokemonExCard／被擊倒給 3 張（engine 與 effects 兩份）
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditData, auditImpl, parseArgs as auditArgs, isMegaName } from './new-set/audit-new-set.mjs';
import { parsePage, fetchQuery, mergeSnapshot, rulesQuestions, normQ, qaKey, parseArgs as qaArgs } from './new-set/fetch-official-qa.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ── 假資料：一個「波導探求者」樣子的卡包 ──
const site = [
  { id: '100', name: '利歐路', supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', hp: 70, pokemonType: 'Fighting', regulationMark: 'J', _file: 'OLD.json', attacks: [{ name: '拳擊', damage: '20', effect: '' }] },
  { id: '101', name: '路卡利歐', supertype: 'Pokemon', subtype: 'Stage1', stage: 'Stage1', evolvesFrom: '利歐路', hp: 130, pokemonType: 'Fighting', regulationMark: 'J', _file: 'OLD.json',
    attacks: [{ name: '波導彈', damage: '90', effect: '這個招式的傷害不計算弱點。' }], abilities: [{ name: '舊特性', effect: '舊的特性卡面。' }] },
  { id: '102', name: '老舊支援者', supertype: 'Trainer', subtype: 'Supporter', regulationMark: 'J', _file: 'OLD.json', rulesText: '從自己的牌庫抽出2張卡。' },
  { id: '103', name: '範本甲', supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', hp: 60, pokemonType: 'Water', regulationMark: 'J', _file: 'OLD.json', attacks: [{ name: '偷看', damage: '', effect: '從對手的手牌選擇1張丟棄。' }] },
  { id: '104', name: '範本乙', supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', hp: 60, pokemonType: 'Water', regulationMark: 'J', _file: 'OLD.json', attacks: [{ name: '偷看', damage: '', effect: '從對手的手牌選擇1張丟棄。' }] },
];
const good = { id: '200', name: '超級路卡利歐Zex', supertype: 'Pokemon', subtype: 'ex', stage: 'Stage1', evolvesFrom: '利歐路', hp: 340, pokemonType: 'Fighting', regulationMark: 'J', setCode: 'M7',
  attacks: [{ name: '新招', damage: '200', effect: '' }], abilities: [{ name: '波導探求者', effect: '在自己的回合可使用1次。從自己的牌庫選擇1張支援者卡加入手牌。' }] };
const A = auditData([good], site);
ok('A0 反對照：正確的 Z ex 卡 0 個 ⛔', A.stop.length === 0, A.stop.join('｜'));
ok('A6 Z ex 被列為超級進化 ex（被擊倒給 3 張）', A.info.some((x) => /A6/.test(x) && x.includes('超級路卡利歐Zex')));
const bad = [
  { ...good, id: '201', regulationMark: 'K' },
  { ...good, id: 202 },
  { ...good, id: '203', name: '路卡利歐ex', evolvesFrom: '路卡利歐' },
  { ...good, id: '204', stage: 'Stage2', evolvesFrom: '利歐路' },
  { id: '205', name: '傳說的試煉', supertype: 'Trainer', subtype: 'Stadium', regulationMark: 'J', collectorNumber: '077/078,078/078', rulesText: '雙方……' },
  { ...good, id: '206', name: '超級某某', subtype: 'Stage1' },
  { ...good, id: '100', name: '撞號的卡' },
];
const B = auditData(bad, site);
const has = (arr, re) => arr.some((x) => re.test(x));
ok('A1 新標記 K ⇒ ⛔ 停下來問站長', has(B.stop, /新的規則標記「K」/));
ok('A2 數字 id ⇒ ⛔', has(B.stop, /202 的 id 不是字串|id 不是字串/));
ok('A2 與站上 id 撞號 ⇒ ⛔', has(B.stop, /撞號/));
ok('A3 ex 從同名非 ex 進化 ⇒ ⛔', has(B.stop, /路卡利歐ex ← 路卡利歐/));
ok('A3 2 階卻從基礎進化 ⇒ ⛔（階段要剛好差 1）', has(B.stop, /Stage2.*利歐路.*階段不是剛好低一階|階段不是剛好低一階/));
ok('A4 兩張合一 ⇒ 提醒拆 `<id>-1` 右半', has(B.warn, /205-1/));
ok('A6 名字以「超級」開頭卻不是 ex ⇒ ⛔', has(B.stop, /超級某某/));
ok('A1 舊標記（G）只警告不停：不在 H／I／J 依裁定不收', (() => { const r = auditData([{ ...good, id: '210', regulationMark: 'G' }], site); return r.stop.length === 0 && has(r.warn, /「G」/); })());

// ── 【B】實裝檢查（假註冊表）──
const reg = {
  attack: new Set(['路卡利歐|波導彈', '範本甲|偷看', '範本乙|偷看']),
  trainer: new Set(['老舊支援者']),
  nameHandled: new Set(),
  srcText: "'舊特性' '波導探求者'",
  fnSig: new Map([['範本甲|偷看', 'POST:random'], ['範本乙|偷看', 'POST:picker'], ['路卡利歐|波導彈', 'PRE:return 90']]),
  ability: new Set(['叉字蝠|0']),
};
const newCards = [
  { id: '300', name: '路卡利歐', supertype: 'Pokemon', subtype: 'Stage1', stage: 'Stage1', evolvesFrom: '利歐路', regulationMark: 'J',
    attacks: [{ name: '波導彈', damage: '120', effect: '這個招式的傷害不計算弱點。' }], abilities: [{ name: '舊特性', effect: '新的、不同的特性卡面。' }] },
  { id: '301', name: '老舊支援者', supertype: 'Trainer', subtype: 'Supporter', regulationMark: 'J', rulesText: '從自己的牌庫抽出3張卡。' },
  { id: '302', name: '新來的', supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', regulationMark: 'J', attacks: [{ name: '偷看', damage: '', effect: '從對手的手牌選擇1張丟棄。' }, { name: '怪招', damage: '', effect: '全新的效果。' }] },
  { id: '303', name: '新物品', supertype: 'Trainer', subtype: 'Item', regulationMark: 'J', rulesText: '全新的物品。' },
];
const I = auditImpl(newCards, site, reg);
ok('B2 同名同招、傷害不同且有 PRE handler（可能寫死傷害）⇒ ⛔', has(I.stop, /路卡利歐\|波導彈.*傷害不同/));
{ const regPost = { ...reg, fnSig: new Map([['路卡利歐|波導彈', 'POST:status']]) };
  ok('B2 反對照：只有傷害不同、handler 只有 POST（傷害由引擎讀卡面）⇒ 不報（例：卡比獸｜倒下 130／160）', !has(auditImpl([newCards[0]], site, regPost).stop, /波導彈/));
  const diffEff = { ...newCards[0], attacks: [{ name: '波導彈', damage: '90', effect: '完全不同的效果。' }] };
  ok('B2 卡面效果不同 ⇒ ⛔（不論 PRE／POST）', has(auditImpl([diffEff], site, regPost).stop, /波導彈.*卡面效果不同/));
  const whiteboard = { ...newCards[2], name: '範本丙', attacks: [{ name: '白板', damage: '50', effect: '' }] };
  ok('B2 反對照：白板招式（沒有 handler）不報', !auditImpl([whiteboard], [...site, { ...whiteboard, id: '199', attacks: [{ name: '白板', damage: '30', effect: '舊印刷有一段不同的文字，但從來沒有 handler。' }], _file: 'OLD.json' }], reg).stop.length); }
// B3（審查 P2-3）：主動特性以卡名為 key ⇒ 同卡面的新卡也不會自動生效
{ const crobat = { id: '110', name: '叉字蝠', supertype: 'Pokemon', subtype: 'Stage2', stage: 'Stage2', regulationMark: 'J', _file: 'OLD.json', abilities: [{ name: '夜間工作', effect: '在自己的回合可使用1次。從自己的牌庫抽出2張卡。' }] };
  const newbie = { id: '310', name: '測試新卡', supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', regulationMark: 'J', abilities: [crobat.abilities[0]] };
  const regAb = { ...reg, srcText: "'夜間工作'" };
  const r = auditImpl([newbie], [...site, crobat], regAb);
  ok('B3 同卡面的主動特性、新卡名沒註冊 ⇒ 待實裝（不可以報「自動套用」）', has(r.todo, /主動特性未註冊 測試新卡｜夜間工作/) && !r.ok.some((x) => /測試新卡/.test(x)), JSON.stringify(r));
  const r2 = auditImpl([{ ...newbie, name: '叉字蝠' }], [...site, { ...crobat, id: '111' }], regAb);
  ok('B3 反對照：以卡名註冊過（叉字蝠|0）⇒ 已實裝', r2.ok.some((x) => /叉字蝠｜夜間工作/.test(x)));
  const hand = { ...newbie, id: '311', name: '手牌鷹', abilities: [{ name: '激動俯衝', effect: '在自己的回合，若手牌有這張卡，則可使用1次。將這張卡放置於備戰區。' }] };
  ok('B3 手牌觸發型（若手牌有這張卡）不當成 regA 主動特性', !has(auditImpl([hand], site, { ...reg, srcText: "'激動俯衝'" }).todo, /主動特性未註冊/)); }
// B3／B4 正規化：「【ex】」與「ex」同一句
ok('B4 卡面「寶可夢【ex】」與「寶可夢ex」視為相同（不誤報撞號）', !auditImpl([{ id: '320', name: '老舊支援者', supertype: 'Trainer', subtype: 'Supporter', regulationMark: 'J', rulesText: '從自己的牌庫抽出2張卡。' }],
  [{ ...site[2], rulesText: '從自己的牌庫抽出2張卡。' }], reg).stop.length
  && !auditImpl([{ id: '321', name: 'X支援者', supertype: 'Trainer', subtype: 'Supporter', regulationMark: 'J', rulesText: '對寶可夢【ex】有效。' }],
    [{ id: '322', name: 'X支援者', supertype: 'Trainer', subtype: 'Supporter', regulationMark: 'J', _file: 'OLD.json', rulesText: '對寶可夢ex有效。' }], reg).stop.length);
// A2（審查 P3-6）：卡包代號只比前綴會漏；A7 缺號；A3 只查 H／I／J
ok('A2 id 撞到代號前綴相同的別的卡包（M6 vs M6a）⇒ ⛔', has(auditData([{ ...good, id: '400', setCode: 'M6' }], [{ ...site[0], id: '400', _file: 'M6a.json' }]).stop, /撞號/));
ok('A2 反對照：同卡包按標拆檔（M7-J.json）不算撞號', !has(auditData([{ ...good, id: '401', setCode: 'M7' }], [{ ...site[0], id: '401', _file: 'M7-J.json' }]).stop, /撞號/));
ok('A7 收錄編號缺號會列出', has(auditData([{ ...good, id: '410', collectorNumber: '001/005' }, { ...good, id: '411', collectorNumber: '003/005' }], site).warn, /缺號 1 個.*2/));
ok('A3 不收的卡（非 H／I／J）不做進化檢查', auditData([{ ...good, id: '420', regulationMark: 'D', evolvesFrom: '不存在的卡' }], site).stop.length === 0);
ok('B3 同名特性卡面不同 ⇒ ⛔ 撞號', has(I.stop, /特性「舊特性」/));
ok('B4 同名訓練家卡面不同 ⇒ ⛔', has(I.stop, /訓練家「老舊支援者」/));
ok('B1 範本寫法不一致 ⇒ 提醒（拍落型教訓）', has(I.todo, /新來的\|偷看[\s\S]*2 種不同寫法/));
ok('B1 沒有範本 ⇒ 標新機制', has(I.todo, /新來的\|怪招[\s\S]*新機制/));
ok('B4 沒有 handler 的物品 ⇒ 待實裝（並提醒會 fail-closed）', has(I.todo, /新物品.*fail-closed/));
const I2 = auditImpl([{ ...newCards[2], attacks: [newCards[2].attacks[0]] }], site, { ...reg, fnSig: new Map([['範本甲|偷看', 'X'], ['範本乙|偷看', 'X']]) });
ok('B1 反對照：範本寫法一致 ⇒ 不報「不同寫法」', has(I2.todo, /寫法一致/) && !has(I2.todo, /種不同寫法/));
ok('B 參數 fail-closed：未知參數會丟錯', throws(() => auditArgs(['M7', '--bogus'])) && !throws(() => auditArgs(['M7', '--staging', 'x.json'])));

// ── 【C】官方判例抓取 ──
const fx = readFileSync(join(ROOT, 'scripts/new-set/fixtures/qa-page.html'), 'utf8');
const pg = parsePage(fx);
ok('C1 解析官網頁片段：3 筆、每筆有問題／回答／相關卡（含官方 id）／商品', pg.total === 3 && pg.items.length === 3
  && pg.items.every((it) => it.q && it.a && it.cards.length && it.cards.every((c) => /^\d+$/.test(c.id)) && it.tags.length), JSON.stringify(pg.items[0]));
// 翻頁重疊：宣告 3 筆、兩頁，第 2 頁重複第 1 頁 ⇒ 不完整
const page = (items, total, pages) => `<div class="searchResults"><div class="total">${total}<span>個</span></div><div class="page"><span class="all">/共${pages}頁</span></div></div><ul class="questionList">`
  + items.map((q) => `<li class="questionItem"><div class="relation"><a href="/tw/card-search/detail/1/" class="card">卡</a></div><div class="question">${q}</div><div class="answer">可以。</div><div class="tag"><a href="/tw/rules/search/?tag=9">擴充包「測試」</a></div></li>`).join('') + '</ul>';
const overlap = { 1: page(['Q1', 'Q2'], 3, 2), 2: page(['Q2'], 3, 2) };
const full = { 1: page(['Q1', 'Q2'], 3, 2), 2: page(['Q3'], 3, 2) };
const getter = (book) => async (url) => book[(url.match(/pageNo=(\d+)/) || [0, 1])[1]];
const r1 = await fetchQuery({ keyword: 'x' }, 0, { getText: getter(overlap) });
const r2 = await fetchQuery({ keyword: 'x' }, 0, { getText: getter(full) });
ok('C2 翻頁重疊 ⇒ complete=false（不假裝完整）', r1.complete === false && r1.items.length === 2 && r1.total === 3);
ok('C2 反對照：沒有重疊 ⇒ complete=true', r2.complete === true && r2.items.length === 3);
const m = mergeSnapshot({ items: [r2.items[0]] }, r2.items);
ok('C3 合併快照以問答全文去重', m.added === 2 && m.snap.items.length === 3);
const rq = rulesQuestions('- **Q**: 甲 乙？\n- **A**: 可以\n  - **Q**：丙丁？');
ok('C4 規則書比對：「- **Q**:」兩種冒號、空白不影響', rq.has(normQ('甲乙?')) && rq.has(normQ('丙 丁？')));
ok('C5 qaKey：問題相同、回答不同 ⇒ 兩筆', qaKey({ q: 'Q', a: '可以' }) !== qaKey({ q: 'Q', a: '不可以' }));
ok('C6 參數 fail-closed', throws(() => qaArgs(['--bogus'])) && !throws(() => qaArgs(['--set', 'M7', '--write'])));

// ── 【D】超級進化 Z ex 走引擎的中央判準 ──
const S = join(ROOT, '.v6632k-s.js'), E = join(ROOT, '.v6632k-e.ts'), O = join(ROOT, '.v6632k-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { isMegaExCard, isPokemonExCard } from './src/lib/game/selection-filter';\nexport { prizesForKO } from './src/lib/game/engine';\nexport { prizesForKOLocal } from './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const G = await import(pathToFileURL(O).href);
const zCards = ['超級路卡利歐Zex', '超級阿勃梭魯Zex', '超級烈咬陸鯊Zex', '超級噴火龍Xex'].map((n, i) => ({ id: 'z' + i, name: n, supertype: 'Pokemon', subtype: 'ex', stage: 'Stage1' }));
ok('D1 名字有 Z／X 的超級進化 ex：isMegaExCard 全部成立', zCards.every((c) => G.isMegaExCard(c) && isMegaName(c)));
ok('D2 isPokemonExCard 也成立（卡面「寶可夢【ex】」的效果照樣適用）', zCards.every((c) => G.isPokemonExCard(c)));
ok('D3 被擊倒給 3 張獎賞（engine 與 effects 兩份一致）', zCards.every((c) => G.prizesForKO(c) === 3 && G.prizesForKOLocal(c) === 3));
const plainEx = { id: 'p', name: '象徵鳥ex', supertype: 'Pokemon', subtype: 'ex', stage: 'Basic' };
ok('D4 反對照：一般 ex 不是超級進化 ⇒ 2 張', !G.isMegaExCard(plainEx) && G.prizesForKO(plainEx) === 2 && G.prizesForKOLocal(plainEx) === 2);

console.log(`\n=== v6.632 新卡包工具組＋Z ex 判準：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
