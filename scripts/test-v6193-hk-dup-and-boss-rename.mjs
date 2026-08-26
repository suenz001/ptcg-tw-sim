// ⭐⭐⭐ v6.193 站長兩個裁定的守衛（2026-08-15）
//
//   ① 刪掉 `M-P-J.json` 裡兩筆**港版重複收錄**的卡（圖檔 `…/hk/card-img/hk000*.png`），
//      只留台版：18965 超級妖火紅狐ex 103/M-P（台版 18560）、18969 古歷 107/M-P（台版 18564）。
//      站長：「就算影響玩家的牌組也沒關係，那張牌本來就少人用。」
//      ⇒ 但**必須優雅降級**：已存牌組帶著已刪 id 進對戰時不可以崩潰。
//   ② `M-P-I.json` id 19630（215/M-P，I 標）改名：「老大的指令（烏羽）」→「老大的指令」。
//      reg key 是**卡名** ⇒ 改名後它要自動吃到既有「老大的指令」的實作，
//      而 v6.191 為括號卡名多建的清單條目變成零產出的死條目，必須刪乾淨。
//
// HEAD-FAIL 依據（在 BASE = v6.192 上跑，以下每一條都會紅）：
//   ・BASE 的 static/cards 還有 18965/18969                → ① FAIL
//   ・BASE 的 19630 name 是「老大的指令（烏羽）」            → ② FAIL
//   ・BASE 沒有 RETIRED_DUP_TO_TW_ID / mergeDuplicateEntries → ⑤ FAIL
//   ・BASE 的 GUST_SUPPORTER_NAMES 仍含括號版本              → ④ FAIL
//
// ⚠ 方法論：能行為端就不用靜態掃（v6.154「只驗字串存在擋不住接線沒接上」）。
//   ③ 實跑 gust 全流程（開 picker → RESOLVE_SELECTION → 盤面真的換人）；
//   ⑤ 實跑 createGame + ATTACK 證明「不崩潰」，並用**正對照**（一個真的查無的 id）
//   證明這條斷言抓得到崩潰，否則「沒 throw」跟「測試根本沒跑到」長得一樣。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6193-s.js'), E = join(ROOT, '.x6193-e.ts'), O = join(ROOT, '.x6193-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_EFFECTS, TRAINER_GUARDS } from './src/lib/game/effects/_shared';\n"
  + "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { GUST_SUPPORTER_NAMES } from './src/lib/game/gust-supporters';\n"
  + "export * as MIG from './src/lib/decks/cardIdMigration';\n"
  + "export { validateDeck, sameNameKey } from './src/lib/decks/validation';\n"
  + "export { deckEntriesAllInPool, loadDeckSets } from './src/lib/cards/pool';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const live = new Set(INDEX.map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

// 掃描器自驗（v6.124~126 教訓：先證明自己看得到東西）
T('自驗：live 卡庫載得到（≥4000 張）、19630 與 18560/18564 都在', () => {
  ok(pool.size >= 4000, '只掃到 ' + pool.size + ' 張 —— 掃描器壞了？');
  for (const id of ['19630', '18560', '18564']) ok(pool.get(id), '卡庫沒有 id ' + id);
});

console.log('① 港版重複卡：v6.193 刪除 → v6.194 改判為「下架但資料留著」');

// v6.194 起語義是「下架（hidden）」不是「刪除」：id 仍在卡庫，只是玩家選不到。
const DELETED = { '18965': '18560', '18969': '18564' };

// ⚠⚠⚠ v6.194 站長改判：「那 2 組港版就**先存在資料裡面就好**，但請從卡牌資料庫和
//   牌組編輯器裡面把連結移除。」⇒ 本版把 v6.193 的「刪掉」改成「下架（資料留著）」。
//   真因：已歸檔的比賽紀錄與**對戰回放**快照裡直接寫著 cardId 18965，回放不經
//   migrateDeck／createGame，卡池沒有那個 id 就會 getCard() throw。
//   ⇒ 這一條的斷言在 v6.194 反向：卡必須「還在卡庫裡」，可選性交給
//   scripts/test-v6194-hidden-cards-and-energy-metadata.mjs 的行為端斷言。
T('⭐⭐⭐ 18965／18969 仍在 live 卡庫與 card-set-map（v6.194 改判：下架≠刪除）', () => {
  const csm = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
  for (const id of Object.keys(DELETED)) {
    ok(pool.get(id), '卡庫沒有 ' + id + ' —— 回放／比賽紀錄會 getCard() throw');
    ok(csm[id] === 'M-P-J', 'card-set-map.json 的 ' + id + ' 不是 M-P-J：' + csm[id]);
  }
  // 全站唯二的 hk 圖床卡就是這兩張（多出第三張＝又有人從港版來源抓卡）
  const hk = [...pool.values()].filter((c) => (c.imageUrl || '').includes('/hk/card-img/'));
  ok(hk.length === 2 && hk.every((c) => c.id in DELETED),
    '香港圖床卡應該剛好是那 2 張，實際 ' + hk.length + ' 張：' + hk.slice(0, 3).map((c) => c.id + ' ' + c.name).join(', '));
});

T('⭐⭐ 保留的台版與被刪的港版是同一張卡（卡名／編號／卡面逐字相同）', () => {
  const want = { '18560': ['超級妖火紅狐ex', '103/M-P'], '18564': ['古歷', '107/M-P'] };
  for (const [id, [name, num]] of Object.entries(want)) {
    const c = pool.get(id);
    ok(c && c.name === name && c.collectorNumber === num,
      id + ' 應為「' + name + '」' + num + '，實際 ' + JSON.stringify(c && [c.name, c.collectorNumber]));
    ok(c.setCode === 'M-P-J' && c.regulationMark === 'J', id + ' setCode/標不對');
    ok(c.imageUrl === 'https://asia.pokemon-card.com/tw/card-img/tw000' + id + '.png', id + ' 卡圖不是台版');
  }
  ok(pool.get('18564').rulesText === '將雙方的所有寶可夢各恢復「50」HP。', '古歷 rulesText 對不上卡面');
});

// ⚠ v6.232：9 張基本能量官方標 I→J 搬入 M-P-J（92→101）；本條數字同步。
T('⭐⭐ 卡包張數同步（M-P-J = 101；index.json 禁重生）', () => {
  const e = INDEX.find((x) => x.code === 'M-P-J');
  const arr = JSON.parse(readFileSync(join(dir, 'M-P-J.json'), 'utf8'));
  ok(arr.length === 101, 'M-P-J.json 應為 101 張（v6.194 放回 2 張、v6.232 收入 9 張能量），實際 ' + arr.length);
  ok(e.cardCount === 101 && e.count === 101, 'index.json M-P-J 張數沒同步：' + e.cardCount + '/' + e.count);
  const sc = e.supertypeCounts;
  ok(sc.Pokemon + sc.Trainer + sc.Energy === 101, 'supertypeCounts 加總 ≠ 101：' + JSON.stringify(sc));
  ok(e.name === 'M-P特典卡(J)' && e.regulationMark === 'J', 'index.json 的手工欄位被重生洗掉了');
});

console.log('② 19630 改名為「老大的指令」（其餘欄位一字不動）');

T('⭐⭐⭐ 19630 的 name 是「老大的指令」，卡面／編號／標未被連帶改動', () => {
  const c = pool.get('19630');
  ok(c.name === '老大的指令', 'name 應為「老大的指令」，實際「' + c.name + '」');
  ok(c.collectorNumber === '215/M-P' && c.regulationMark === 'I' && c.setCode === 'M-P-I',
    '編號/標/卡包被連帶改到了：' + JSON.stringify([c.collectorNumber, c.regulationMark, c.setCode]));
  ok(c.supertype === 'Trainer' && c.subtype === 'Supporter', 'supertype/subtype 被改到了');
  ok(c.rulesText === '選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。', 'rulesText 被改到了：' + c.rulesText);
  ok(!/[（()）]/.test(c.name), 'name 還帶括號');
});

T('⭐ 卡庫已無任何括號冠名卡名（v6.192 的 sameNameKey 因此沒有實際作用對象）', () => {
  const paren = [...new Set([...pool.values()].map((c) => c.name))].filter((n) => /[（()）]/.test(n));
  ok(paren.length === 0, '還有括號卡名：' + paren.join(' / '));
});

console.log('③ 行為端：19630 用的就是既有「老大的指令」那份實作（不是驗字串）');

let iidN = 0;
const inst = (cardId, extra = {}) => ({
  iid: 'i' + (++iidN), cardId: String(cardId), damage: 0, energyAttached: [], toolAttached: null, ...extra,
});
const mkState = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
  ...extra,
});
const BASIC = [...pool.values()].find(
  (c) => c.supertype === 'Pokemon' && !c.evolvesFrom && c.subtype !== 'Other' && ['H', 'I', 'J'].includes(c.regulationMark));

T('⭐⭐⭐ 實跑：以 19630 的卡名發動 → 開 opp-bench picker → 對手備戰真的換上戰鬥位', () => {
  const NAME = pool.get('19630').name;
  ok(mod.TRAINER_EFFECTS.has(NAME) && mod.TRAINER_GUARDS.has(NAME),
    '改名後 19630 的卡名「' + NAME + '」沒有對應的 effect/gate —— 沒有自動吃到既有實作');
  const st0 = mkState(
    { active: inst(BASIC.id), hand: [inst('19630')] },
    { active: inst(BASIC.id), bench: [inst(BASIC.id), inst(BASIC.id)] },
  );
  ok(mod.TRAINER_GUARDS.get(NAME)(st0, 0, pool) === true, '對手備戰有 2 隻卻 gate 成不可使用');
  const st1 = mod.TRAINER_EFFECTS.get(NAME)(st0, 0, pool);
  const ps = st1.pendingSelection;
  ok(ps && ps.type === 'opp-bench-choose' && ps.effectKey === 'gust-opp',
    '沒有開 gust 的 opp-bench picker：' + JSON.stringify(ps && [ps.type, ps.effectKey]));
  ok(ps.minCount === 1 && ps.maxCount === 1, '「選擇1隻」必須是單選');
  ok((ps.params?.validIids ?? []).length === 2, '可選目標應為對手備戰 2 隻，實際 ' + JSON.stringify(ps.params));
  const targetIid = ps.params.validIids[1];
  const st2 = mod.applyAction(st1, { type: 'RESOLVE_SELECTION', selectedIids: [targetIid] }, pool);
  ok(st2.players[1].active.iid === targetIid,
    '選了對手備戰卻沒換上戰鬥位（實際 active=' + st2.players[1].active.iid + '）');
  ok(st2.players[1].bench.some((b) => b.iid === st1.players[1].active.iid),
    '原本的對手戰鬥寶可夢沒有被換到備戰區');
});

T('⭐⭐ 行為端：生效的是 supporters_gust 的 factory 版（fail log 含「化石/」）', () => {
  const NAME = pool.get('19630').name;
  const empty = mkState({ active: inst(BASIC.id) }, { active: inst(BASIC.id), bench: [] });
  ok(mod.TRAINER_GUARDS.get(NAME)(empty, 0, pool) === false, '對手備戰空卻可使用');
  const out = mod.TRAINER_EFFECTS.get(NAME)(empty, 0, pool);
  const last = out.log[out.log.length - 1];
  const msg = typeof last === 'string' ? last : (last?.message ?? '');
  ok(msg.startsWith(NAME + '：') && msg.includes('化石/'),
    '生效的不是 factory 版（有別的檔重複註冊把它覆蓋掉了）：' + msg);
});

console.log('④ 死碼清乾淨：清單／註冊都不得留括號卡名');

T('⭐⭐⭐ GUST_SUPPORTER_NAMES 只剩「老大的指令」（零產出的條目 = 死碼）', () => {
  const L = mod.GUST_SUPPORTER_NAMES;
  ok(L.includes('老大的指令'), '清單缺「老大的指令」');
  ok(!L.includes('老大的指令（烏羽）'), '清單還留著已不存在的卡名（零產出死條目）');
  const names = new Set([...pool.values()].map((c) => c.name));
  const ghost = L.filter((n) => !names.has(n));
  ok(ghost.length === 0, '清單裡有卡庫查無的卡名：' + ghost.join('、'));
  ok(!mod.TRAINER_EFFECTS.has('老大的指令（烏羽）') && !mod.TRAINER_GUARDS.has('老大的指令（烏羽）'),
    '註冊表還留著「老大的指令（烏羽）」的 key');
});

T('⭐⭐ 靜態：src 全樹不得再出現「老大的指令（烏羽）」的字面量註冊（含正對照）', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (f.isDirectory()) walk(d + '/' + f.name);
      else if (f.name.endsWith('.ts') || f.name.endsWith('.svelte')) files.push(d + '/' + f.name);
    }
  };
  walk('src');
  ok(files.length >= 100, '只掃到 ' + files.length + ' 個檔 —— 掃描器壞了？');
  const RE = /reg[GRA]?\(\s*'老大的指令（烏羽）'/;
  // ⚠ 剝註解（v6.126 教訓：註解裡的字面量會讓否定型守衛誤報）
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bad = files.filter((p) => RE.test(strip(readFileSync(join(ROOT, p), 'utf8'))));
  ok(bad.length === 0, '這些檔還在註冊已不存在的卡名：' + bad.join(', '));
  ok(RE.test(strip("regG('老大的指令（烏羽）', () => true);")), '正對照失效 —— 判準抓不到違規樣本');
  ok(!RE.test(strip("// regG('老大的指令（烏羽）', …) 已移除")), '剝註解失效，會誤報');
});

console.log('⑤ 優雅降級：引用已刪 id 的牌組不可以崩潰');

T('⭐⭐⭐ migrateCardId：已刪的港版 id 對照回台版（M5 舊對照不受影響）', () => {
  ok(typeof mod.MIG.migrateCardId === 'function', '沒有 migrateCardId');
  for (const [from, to] of Object.entries(DELETED)) {
    ok(mod.MIG.migrateCardId(from) === to, from + ' 應對照成 ' + to + '，實際 ' + mod.MIG.migrateCardId(from));
  }
  ok(mod.MIG.migrateCardId('50220') === '19145', 'M5 jp→tw 對照被弄壞了');
  ok(mod.MIG.migrateCardId('19630') === '19630', '沒在對照表的 id 必須原樣回傳');
});

T('⭐⭐ migrateDeck：對照後同 id 的兩筆要合併（重複 key 會讓牌組頁 runtime error）', () => {
  const d = { id: 'x', name: 'x', createdAt: '', updatedAt: '', entries: [
    { cardId: '18560', count: 2 }, { cardId: '18965', count: 2 }, { cardId: '19630', count: 1 }] };
  const out = mod.MIG.migrateDeck(d).entries;
  const ids = out.map((e) => e.cardId);
  ok(new Set(ids).size === ids.length, 'migrate 後仍有重複 cardId：' + ids.join(','));
  const m = out.find((e) => e.cardId === '18560');
  ok(m && m.count === 4, '兩筆應合併成 4 張，實際 ' + JSON.stringify(out));
  ok(out.find((e) => e.cardId === '19630')?.count === 1, '其他 entry 被動到了');
  // 冪等
  const twice = mod.MIG.migrateDeck({ ...d, entries: out }).entries;
  ok(JSON.stringify(twice) === JSON.stringify(out), 'migrateDeck 不冪等');
});

T('⭐⭐⭐ 行為端：牌組帶著已刪 id 進對戰 → 上戰鬥位攻擊**不崩潰**（含正對照）', () => {
  const energy = [...pool.values()].find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  const mkSpec = (badId) => ({ name: 'A', entries: [
    { cardId: String(BASIC.id), count: 4 }, { cardId: badId, count: 4 }, { cardId: String(energy.id), count: 52 }] });
  // createGame 是所有對戰（本機/AI/線上/錦標賽）的共同咽喉點，內含 migrateCardId
  const st = mod.createGame(mkSpec('18965'), mkSpec('18969'), pool,
    { firstPlayerOverride: 0, forceLegacyOpening: true });
  const all = [...st.players[0].deck, ...st.players[0].hand, ...st.players[0].prizes];
  ok(all.length === 60, '牌組張數不是 60：' + all.length);
  ok(all.every((c) => pool.has(c.cardId)), '仍有卡在卡池解不出來 —— UI 會顯示「？/HP 0/0」、一行動就整局卡死');
  ok(all.filter((c) => c.cardId === '18560').length === 4, '18965 沒有被對照成台版 18560');
  // 直接把該卡放上戰鬥位攻擊（v5.336 的崩潰路徑：getCard(active.cardId) throw）
  const play = (cardId) => mod.applyAction(
    mkState({ active: inst(cardId, { energyAttached: [inst(energy.id), inst(energy.id), inst(energy.id)] }) },
            { active: inst(BASIC.id) }),
    { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  play('18560');   // 對照後的台版：必須不 throw
  // 正對照：真的查無又沒對照表的 id 必須 throw，否則上面那條「沒 throw」證明不了任何事
  let threw = false;
  try { play('99999991'); } catch (e) { threw = /Card not found/.test(e.message); }
  ok(threw, '正對照失效 —— 連完全不存在的 id 都不 throw，代表這條斷言沒測到崩潰路徑');
});

// ⭐⭐⭐ 審查子代理抓到、查證屬實：⑤ 原本只驗「已 migrate 的 id 不崩潰」，
//   沒有釘住「資料裡真的還留著已刪 id」時的入口。線上房建局 gate
//   （game/+page.svelte checkAndStartOnlineGame → deckEntriesAllInPool）與
//   loadDeckSets 都是**不經 createGame** 的 cardId 入口：不 migrate 的話那張卡永遠
//   補不進 pool ⇒ 重試 6 次後「建局卡住」，房間開不了局（不崩潰，但玩不了）。
T('⭐⭐⭐ 行為端：建局 gate（deckEntriesAllInPool）吃得下未 migrate 的已刪 id', () => {
  const entries = [{ cardId: '18965' }, { cardId: '18969' }, { cardId: '19630' }];
  ok(mod.deckEntriesAllInPool(entries, pool) === true,
    'seat.deckEntries 帶著已刪的港版 id 時 gate 回 false ⇒ 線上房會卡在「建局卡住：缺少卡片 id」');
  // 正對照：真的查無又沒對照的 id 必須讓 gate 回 false（否則這條斷言沒有鑑別度）
  ok(mod.deckEntriesAllInPool([{ cardId: '99999991' }], pool) === false, '正對照失效');
  ok(mod.deckEntriesAllInPool([], pool) === false, '空 entries 的既有語義被改掉了');
});

// ⚠ T() 是同步 runner：async 回呼丟出的例外會變成未處理的 rejection、測試照樣顯示 ✓（假綠）。
//   ⇒ 非同步的部分先用 top-level await 算完，再用同步斷言檢查結果。
const fakeFetch = async (url) => {
  const m = String(url).split('?')[0].match(/(cards\/[^/]+|card-set-map\.json)$/);
  const file = m[1] === 'card-set-map.json' ? join(ROOT, 'static/card-set-map.json') : join(ROOT, 'static', m[1]);
  return { ok: true, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};
const _lds = await mod.loadDeckSets(['18965', '18969'], fakeFetch);
const _ldsMissProbe = await mod.loadDeckSets(['99999991'], fakeFetch);
T('⭐⭐ 行為端：loadDeckSets 用已刪 id 也解得出卡包（不會誤判成「本站沒有這張卡」）', () => {
  ok(_lds.missingIds.length === 0, '已刪的港版 id 被當成「對照表查不到」：' + JSON.stringify(_lds.missingIds));
  const ids = new Set(_lds.cards.map((c) => String(c.id)));
  ok(ids.has('18560') && ids.has('18564'), '沒有把保留版所在的卡包載進來');
  ok(ids.has('18965') && ids.has('18969'),
    'v6.194 起下架卡仍留在同一個卡包（M-P-J）裡 —— 載不到就代表資料又被刪了');
  ok(_ldsMissProbe.missingIds.length === 1, '正對照失效：真的查無的 id 應該進 missingIds');
});


T('⭐ 牌組驗證：對照後的牌組合法（不會變成「查無資料」或張數不足）', () => {
  const energy = [...pool.values()].find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  const d = mod.MIG.migrateDeck({ id: 'x', name: 'x', createdAt: '', updatedAt: '', entries: [
    { cardId: String(BASIC.id), count: 4 }, { cardId: '18969', count: 2 }, { cardId: String(energy.id), count: 54 }] });
  const r = mod.validateDeck(d, pool);
  ok(r.totalCount === 60, '張數 ' + r.totalCount);
  ok(!r.issues.some((s) => s.includes('查無資料')), '仍有「查無資料」：' + JSON.stringify(r.issues));
  ok(r.legal === true, JSON.stringify(r.issues));
});

console.log('⑥ 正對照：v6.192 的 sameNameKey 通則守衛行為不變（改名後仍要留著）');

T('⭐⭐ sameNameKey：括號冠名仍併回本名、前綴冠名仍不動', () => {
  ok(mod.sameNameKey('老大的指令（烏羽）') === '老大的指令', '括號冠名沒有併回本名');
  ok(mod.sameNameKey('老大的指令（赤日）') === '老大的指令', '未來的括號冠名也要併');
  ok(mod.sameNameKey('老大的指令') === '老大的指令', '本名被改寫了');
  ok(mod.sameNameKey('N的達摩狒狒') === 'N的達摩狒狒', '前綴冠名被誤併（官方 L2686：兩種不同名稱）');
  ok(mod.sameNameKey('（烏羽）') === '（烏羽）', '整個卡名就是括號段時不可回空字串');
});

console.log('\n=== v6.193 港版重複卡下架 ＋ 老大的指令改名：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
