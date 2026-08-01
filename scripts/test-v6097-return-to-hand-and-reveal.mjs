// v6.097 兩個玩家回報的 bug + 同維度收斂守衛
//
// ① 火箭隊的叉字蝠ex｜刺殺迴旋 —— 卡面（static/cards MC 16911 等）
//    「若希望，將這隻寶可夢放回手牌。（寶可夢以外的卡全部丟棄。）」
//    HEAD 只把最上層那張搬進手牌，evolvedFromStack（火箭隊的超音蝠／大嘴蝠）
//    既沒進手牌也沒進棄牌區 → 直接從對局消失（破壞卡片守恆）。
//    修法＝中央 splitPokemonReturnToHand（與耿鬼｜無限之影同一來源）。
//
// ② 「在給對手看過後加入手牌」的揭示 —— 站規（v5.859）：卡面有這句 → 必須公開 addLog 卡名；
//    卡面**沒有**這句（頭巾混混｜偷竊、賽富豪｜抓到飽）→ 不可公開卡名（負對照，防修過頭）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v697-s.js'), E = join(ROOT, '.v697-e.ts'), O = join(ROOT, '.v697-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { ATTACK_POST, RESOLVERS, TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\n" +
  "export { splitPokemonReturnToHand, bareCardsForReturn, resolveInfiniteShadowKo, logPickedCards } from './src/lib/game/effects/_shared';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred) => [...pool].find(([, c]) => c.name === n && (!pred || pred(c)))?.[0];

const ZUBAT = byName('火箭隊的超音蝠');
const GOLBAT = byName('火箭隊的大嘴蝠');
const CROBAT = byName('火箭隊的叉字蝠ex');
const BASIC_ENERGY = [...pool].find(([, c]) => c.supertype === 'Energy' && c.subtype === 'Basic')?.[0];
const TOOL = [...pool].find(([, c]) => c.supertype === 'Trainer' && c.subtype === 'Tool')?.[0];
const ITEM = [...pool].find(([, c]) => c.supertype === 'Trainer' && c.subtype === 'Item')?.[0];
const STADIUM = [...pool].find(([, c]) => c.supertype === 'Trainer' && c.subtype === 'Stadium')?.[0];

let nn = 0;
const inst = (cid, ex = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
const mkState = (p0, p1 = {}) => ({
  id: 't', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'ME', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'OP', active: inst(ZUBAT), bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
});
const countCards = (st) => {
  let n = 0;
  for (const p of st.players) {
    const walk = (i) => { n += 1 + (i.energyAttached?.length ?? 0) + (i.toolAttached ? 1 : 0) + (i.extraTools?.length ?? 0) + (i.evolvedFromStack?.length ?? 0); };
    if (p.active) walk(p.active);
    for (const b of p.bench) walk(b);
    for (const z of ['hand', 'deck', 'discard', 'prizes']) for (const c of p[z]) walk(c);
  }
  return n;
};
const nameOf = (c) => pool.get(c.cardId)?.name ?? '?';
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('中央 splitPokemonReturnToHand 存在且是函式', () => {
  assert.strictEqual(typeof mod.splitPokemonReturnToHand, 'function', 'splitPokemonReturnToHand 必須從 _shared 匯出');
});
T('中央 logPickedCards 存在且是函式', () => {
  assert.strictEqual(typeof mod.logPickedCards, 'function', 'logPickedCards 必須從 _shared 匯出');
});
T('splitPokemonReturnToHand：toHand ∪ toDiscard === bareCardsForReturn（卡集合等價，零遺失）', () => {
  const stack = [inst(ZUBAT), inst(GOLBAT)];
  const target = inst(CROBAT, { damage: 120, energyAttached: [inst(BASIC_ENERGY), inst(BASIC_ENERGY)], toolAttached: inst(TOOL), evolvedFromStack: stack });
  const { toHand, toDiscard } = mod.splitPokemonReturnToHand(target);
  const got = [...toHand, ...toDiscard].map(c => c.iid).sort();
  const want = mod.bareCardsForReturn(target).map(c => c.iid).sort();
  assert.deepStrictEqual(got, want, '兩個 helper 必須覆蓋完全相同的卡片集合');
});

const crobatPost = () => mod.ATTACK_POST.get('火箭隊的叉字蝠ex|刺殺迴旋');
const mkCrobatBoard = () => {
  const zubat = inst(ZUBAT), golbat = inst(GOLBAT);
  const e1 = inst(BASIC_ENERGY), e2 = inst(BASIC_ENERGY), t1 = inst(TOOL), t2 = inst(TOOL);
  const active = inst(CROBAT, { damage: 100, energyAttached: [e1, e2], toolAttached: t1, extraTools: [t2], evolvedFromStack: [zubat, golbat] });
  return { st: mkState({ active, bench: [inst(ZUBAT)] }), zubat, golbat, e1, e2, t1, t2, active };
};

T('①-1 刺殺迴旋選「是」：本體＋進化來源 3 張全部進手牌（HEAD 只有 1 張）', () => {
  const fn = crobatPost(); assert.ok(fn, '找得到刺殺迴旋 ATTACK_POST');
  const { st, zubat, golbat, active } = mkCrobatBoard();
  const out = fn(st, 0, pool, { discardedEnergyIids: ['yes'] });
  const handNames = out.players[0].hand.map(nameOf).sort();
  assert.strictEqual(out.players[0].hand.length, 3, '手牌應得到 3 張寶可夢，實際 ' + out.players[0].hand.length + ' 張：' + handNames.join('、'));
  assert.deepStrictEqual(handNames, ['火箭隊的叉字蝠ex', '火箭隊的大嘴蝠', '火箭隊的超音蝠'].sort(), '手牌內容不符：' + handNames.join('、'));
  const iids = out.players[0].hand.map(c => c.iid);
  assert.ok(iids.includes(zubat.iid) && iids.includes(golbat.iid) && iids.includes(active.iid), '必須是原本那三張實體卡（iid 守恆）');
});
T('①-2 刺殺迴旋：能量與全部道具（含 extraTools）進棄牌區', () => {
  const { st, e1, e2, t1, t2 } = mkCrobatBoard();
  const out = crobatPost()(st, 0, pool, { discardedEnergyIids: ['yes'] });
  const dIids = out.players[0].discard.map(c => c.iid);
  for (const [k, c] of [['能量1', e1], ['能量2', e2], ['道具 toolAttached', t1], ['道具 extraTools', t2]]) {
    assert.ok(dIids.includes(c.iid), k + ' 應進棄牌區');
  }
  assert.strictEqual(out.players[0].discard.length, 4, '棄牌區應恰好 4 張（寶可夢以外的卡全部丟棄）');
});
T('①-3 刺殺迴旋：卡片守恆（總卡數不變、active 清空）', () => {
  const { st } = mkCrobatBoard();
  const before = countCards(st);
  const out = crobatPost()(st, 0, pool, { discardedEnergyIids: ['yes'] });
  assert.strictEqual(countCards(out), before, '總卡數必須守恆（HEAD 會少 2 張＝進化來源憑空消失）');
  assert.strictEqual(out.players[0].active, null, '戰鬥位應清空');
});
T('①-4 刺殺迴旋：回手的卡必須裸化（傷害/能量/道具/進化棧全清）', () => {
  const { st } = mkCrobatBoard();
  const out = crobatPost()(st, 0, pool, { discardedEnergyIids: ['yes'] });
  for (const c of out.players[0].hand) {
    assert.strictEqual(c.damage ?? 0, 0, nameOf(c) + ' 回手應無傷害');
    assert.strictEqual((c.energyAttached ?? []).length, 0, nameOf(c) + ' 回手不應帶能量');
    assert.ok(!c.toolAttached && !(c.extraTools ?? []).length, nameOf(c) + ' 回手不應帶道具');
    assert.ok(!c.evolvedFromStack, nameOf(c) + ' 回手不應保留進化棧');
  }
});
T('①-5 刺殺迴旋選「否」：完全不動（不回手、不丟棄）', () => {
  const { st } = mkCrobatBoard();
  const out = crobatPost()(st, 0, pool, { discardedEnergyIids: [] });
  assert.ok(out.players[0].active, '選否應留場');
  assert.strictEqual(out.players[0].hand.length, 0, '選否不應有卡進手牌');
  assert.strictEqual(out.players[0].discard.length, 0, '選否不應丟棄附加卡');
});
T('①-6 無限之影仍然把進化來源帶回手牌（中央化零行為變更）', () => {
  // ⚠ 不做軟跳過：耿鬼｜無限之影 在現役卡池，找不到＝卡池讀取壞了，守衛必須紅。
  //   ⚠ 特性文字在 abilities[].effect（**不是** text）—— 這一點在本輪害我誤判過一次。
  const GENGAR = byName('耿鬼', c => (c.abilities ?? []).some(a => a.name === '無限之影'));
  assert.ok(GENGAR, '現役卡池必須找得到「無限之影」耿鬼（找不到＝卡池載入異常，不是可跳過的情況）');
  const ko = inst(GENGAR, { damage: 200, energyAttached: [inst(BASIC_ENERGY)], evolvedFromStack: [inst(ZUBAT)] });
  const r = mod.resolveInfiniteShadowKo(ko, pool, true);
  assert.strictEqual(r.toHand.length, 2, '本體＋進化來源共 2 張回手，實際 ' + r.toHand.length);
  assert.strictEqual(r.toDiscard.length, 1, '能量進棄牌區');
});

const runDeckSearch = (effectKey, params, deckCards) => {
  const st = mkState({ active: inst(ZUBAT), deck: deckCards });
  const fn = mod.RESOLVERS.get(effectKey);
  assert.ok(fn, '找得到 resolver ' + effectKey);
  const out = fn(st, 0, deckCards.map(c => c.iid), params, pool);
  return out.log[out.log.length - 1];
};
const ODDISH = byName('走路草') ?? byName('火箭隊的超音蝠');

T('②-1 wave13-deck-take-any + publicReveal:true（熔蟻獸｜舔舔捕捉）→ 公開卡名', () => {
  const card = inst(ODDISH);
  const l = runDeckSearch('wave13-deck-take-any', { label: '舔舔捕捉', publicReveal: true }, [card]);
  assert.ok(l.message.includes(nameOf(card)), '公開 log 應含卡名，實際：' + l.message);
  assert.ok(!l.privateMessage, '公開揭示不應走私訊');
});
T('②-2 【負對照】wave13-deck-take-any + publicReveal:false（抓到飽／偷竊）→ 公開訊息不得含卡名', () => {
  const card = inst(ODDISH);
  const l = runDeckSearch('wave13-deck-take-any', { label: '抓到飽', publicReveal: false }, [card]);
  assert.ok(!l.message.includes(nameOf(card)), '卡面沒有「給對手看過」→ 公開訊息不可洩漏卡名，實際：' + l.message);
  assert.ok(l.privateMessage && l.privateMessage.includes(nameOf(card)), '自己那側仍應看得到卡名，實際 priv=' + l.privateMessage);
});
T('②-3 wave12-deck-take-trainer（籌備／築窩）→ 公開卡名', () => {
  const card = inst(ODDISH);
  const l = runDeckSearch('wave12-deck-take-trainer', { label: '籌備', publicReveal: true }, [card]);
  assert.ok(l.message.includes(nameOf(card)), '公開 log 應含卡名，實際：' + l.message);
});
T('②-4 small-messenger-search（小使者）→ 公開卡名（HEAD 完全沒有 log）', () => {
  const card = inst(ODDISH);
  const l = runDeckSearch('small-messenger-search', { label: '小使者', publicReveal: true }, [card]);
  assert.ok(l && l.message && l.message.includes(nameOf(card)), '公開 log 應含卡名，實際：' + JSON.stringify(l));
});
T('②-5 能量輸送PRO → 公開卡名（HEAD 用 addPrivateLog，對手只看得到張數）', () => {
  const e = inst(BASIC_ENERGY);
  const st = mkState({ active: inst(ZUBAT), deck: [e] });
  const out = mod.RESOLVERS.get('energy-pro-search')(st, 0, [e.iid], {}, pool);
  const l = out.log.find(x => (x.message ?? '').includes('能量輸送PRO：搜到'));
  assert.ok(l, '應有能量輸送PRO 搜到 log');
  assert.ok(l.message.includes(nameOf(e)), '公開訊息應含卡名，實際：' + l.message);
  assert.ok(!l.privateMessage, '不應走私訊');
});
T('②-6 m5 好啦魷｜籌備 / 熱帶龍｜果實香氣 → 公開卡名（HEAD 只寫張數＝假揭示）', () => {
  for (const [key, label] of [['m5-inkay-procurement', '籌備'], ['m5-tropius-fruit-aroma', '果實香氣']]) {
    const card = inst(ODDISH);
    const st = mkState({ active: inst(ZUBAT), deck: [card] });
    const out = mod.RESOLVERS.get(key)(st, 0, [card.iid], {}, pool);
    const joined = out.log.map(l => l.message ?? '').join(' | ');
    assert.ok(joined.includes(nameOf(card)), label + ' 公開 log 應含卡名，實際：' + joined);
  }
});
T('②-7 棄牌區取回類（能量回收器 / 招喚 / 打水）→ 公開卡名', () => {
  for (const key of ['energy-retrieval', 'h-wave2-pickup-energy-to-hand', 'h-wave2-discard-back-to-deck']) {
    const card = inst(BASIC_ENERGY);
    const st = mkState({ active: inst(ZUBAT), discard: [card] });
    const out = mod.RESOLVERS.get(key)(st, 0, [card.iid], {}, pool);
    const joined = out.log.map(l => l.message ?? '').join(' | ');
    assert.ok(joined.includes(nameOf(card)), key + ' 公開 log 應含卡名，實際：' + joined);
  }
});

// ⚠ 卡面文字的三個來源：招式 attacks[].effect、**特性 abilities[].effect**（不是 .text！）、
//   訓練家 rulesText。本輪我一度誤讀 abilities[].text（恆為 undefined）而誤判「資料缺、無法查證」，
//   差點漏掉銀伴戰獸｜拍檔呼喚。守衛一律三個來源都看。
const cardTextOf = (cardName, subName) => {
  for (const [, c] of pool) {
    if (c.name !== cardName) continue;
    if (!subName && c.supertype === 'Trainer' && c.rulesText) return c.rulesText;
    for (const a of (c.attacks ?? [])) if (a.name === subName && a.effect) return a.effect;
    for (const a of (c.abilities ?? [])) if (a.name === subName && (a.effect || a.text)) return a.effect || a.text;
  }
  return null;
};
const cardAttackEffect = cardTextOf;
T('③-1 卡面查證：有「給對手看過」的卡確實被標成公開', () => {
  for (const [nm, atk] of [['熔蟻獸', '舔舔捕捉'], ['扒手貓', '邪惡邀請'], ['牙牙', '集力'], ['霜奶仙', '彩色甜點'], ['電飛鼠', '小使者'], ['探探鼠', '籌備']]) {
    const eff = cardAttackEffect(nm, atk);
    assert.ok(eff, '找得到卡面 ' + nm + '|' + atk);
    assert.ok(eff.includes('給對手看過'), nm + '|' + atk + ' 卡面應含「給對手看過」，實際：' + eff);
  }
});
T('③-2 卡面查證：頭巾混混｜偷竊 與 賽富豪｜抓到飽 卡面確實沒有「給對手看過」', () => {
  for (const [nm, atk] of [['頭巾混混', '偷竊'], ['賽富豪', '抓到飽']]) {
    const eff = cardAttackEffect(nm, atk);
    assert.ok(eff, '找得到卡面 ' + nm + '|' + atk);
    assert.ok(!eff.includes('給對手看過'), nm + '|' + atk + ' 卡面不應含「給對手看過」（若官方改版請同步改 publicReveal），實際：' + eff);
  }
});

T('④ 三個共用 resolver 的呼叫端都必須明示 publicReveal', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.ts')) files.push(p); } };
  walk(join(ROOT, 'src/lib/game/effects'));
  const KEYS = ['wave13-deck-take-any', 'wave12-deck-take-trainer', 'small-messenger-search'];
  const bad = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!KEYS.some(k => lines[i].includes("effectKey: '" + k + "'"))) continue;
      const win = lines.slice(i, i + 8).join('\n');
      if (!win.includes('publicReveal')) bad.push(f.replace(ROOT, '') + ':' + (i + 1));
    }
  }
  assert.strictEqual(bad.length, 0, '以下呼叫端沒有明示 publicReveal（會靜默落到「不公開」）：\n  ' + bad.join('\n  '));
});

T('⑤ 卡面查證（含特性/訓練家欄位）：Fable 覆核找出的 5 張方向', () => {
  // 有「給對手看過」→ 必須公開
  const t1 = cardTextOf('銀伴戰獸', '拍檔呼喚');
  assert.ok(t1 && t1.includes('給對手看過'), '銀伴戰獸｜拍檔呼喚（特性 abilities[].effect）卡面應含「給對手看過」，實際：' + t1);
  // 沒有「給對手看過」→ 不可公開卡名
  for (const [nm, sub] of [['焰后蜥ex', '詭計'], ['白蓬蓬', '微風之禮'], ['桃歹郎', '最後鎖鏈'], ['希望護身符', null]]) {
    const t = cardTextOf(nm, sub);
    assert.ok(t, '找得到卡面 ' + nm + (sub ? '|' + sub : ''));
    assert.ok(!t.includes('給對手看過'), nm + ' 卡面不應含「給對手看過」（若官方改版請同步改 privateReveal），實際：' + t);
  }
});
T('⑥ 銀伴戰獸｜拍檔呼喚 → 公開卡名，且 log 用官方特性名（不得寫「夥伴呼喚」）', () => {
  const card = inst(ODDISH);
  const st = mkState({ active: inst(ZUBAT), deck: [card] });
  const out = mod.RESOLVERS.get('m5-silvally-partner-call')(st, 0, [card.iid], {}, pool);
  const joined = out.log.map(l => l.message ?? '').join(' | ');
  assert.ok(joined.includes(nameOf(card)), '公開 log 應含卡名，實際：' + joined);
  assert.ok(joined.includes('拍檔呼喚'), 'log 應使用官方特性名「拍檔呼喚」，實際：' + joined);
  assert.ok(!joined.includes('夥伴呼喚'), 'log 不得出現非官方名「夥伴呼喚」，實際：' + joined);
});
T('⑦ 【反向洩漏負對照】卡面沒有「給對手看過」的四處 → search-to-hand-reshuffle 必須帶 privateReveal', () => {
  const card = inst(ODDISH);
  const st = mkState({ active: inst(ZUBAT), deck: [card] });
  const fn = mod.RESOLVERS.get('search-to-hand-reshuffle');
  const pub = fn(st, 0, [card.iid], {}, pool);
  const priv = fn(st, 0, [card.iid], { privateReveal: true }, pool);
  const lPub = pub.log[pub.log.length - 1], lPriv = priv.log[priv.log.length - 1];
  assert.ok(lPub.message.includes(nameOf(card)), '未帶 privateReveal 時 resolver 本來就是公開的（前提檢查）');
  assert.ok(!lPriv.message.includes(nameOf(card)), '帶 privateReveal 時公開訊息不可含卡名，實際：' + lPriv.message);
  assert.ok(lPriv.privateMessage && lPriv.privateMessage.includes(nameOf(card)), '自己那側仍要看得到卡名');
});
T('⑧ 四個呼叫端確實帶了 privateReveal（焰后蜥ex｜詭計 / 白蓬蓬｜微風之禮 / 希望護身符 / 桃歹郎｜最後鎖鏈）', () => {
  const CASES = [
    ['src/lib/game/effects/cards/v2353_j_mark_batch.ts', '焰后蜥ex|詭計'],
    ['src/lib/game/effects.ts', 'selfReturnToDeckThenSearchPost'],
    ['src/lib/game/effects/cards/tools.ts', "TOOL_ON_KO.set('希望護身符'"],
    ['src/lib/game/effects.ts', "['最後鎖鏈', (state, dIdx"],
  ];
  for (const [f, anchor] of CASES) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const i = src.indexOf(anchor);
    assert.ok(i >= 0, '找得到 ' + anchor + ' @ ' + f);
    const win = src.slice(i, i + 2600);
    const k = win.indexOf("effectKey: 'search-to-hand-reshuffle'");
    assert.ok(k >= 0, anchor + ' 區塊內找得到 search-to-hand-reshuffle');
    assert.ok(win.slice(k, k + 500).includes('privateReveal'), anchor + ' 的 search-to-hand-reshuffle 必須帶 privateReveal（否則卡名會被公開＝資訊洩漏）');
  }
});
T('⑨ 行為端枚舉：14 張共用 resolver 的卡打出後，pendingSelection.params.publicReveal 必須是 boolean', () => {
  // ⚠ 這是行為守衛（不是字串比對）：字面掃描掃不到 helper 內的 `effectKey: effectKeyName` 變數式。
  const ENERGY_TYPES = [BASIC_ENERGY, BASIC_ENERGY];
  const CASES = [
    ['熔蟻獸|舔舔捕捉', true], ['扒手貓|邪惡邀請', true], ['小霞的拉普拉斯|一起游水', true],
    ['夢夢蝕|夢境呼喚', true], ['嗡蝠|搬運破爛', true], ['牙牙|集力', true],
    ['霜奶仙|彩色甜點', true], ['火箭隊的咩利羊|籌備', true], ['探探鼠|籌備', true],
    ['赫普的沙包蛇|築窩', true], ['電飛鼠|小使者', true], ['青木的姆克兒|小使者', true],
    ['頭巾混混|偷竊', false], ['賽富豪|抓到飽', false],
  ];
  const rnd = Math.random;
  Math.random = () => 0.1;  // 固定正面（賽富豪擲幣到反面，第一次正面即可開 pending）
  try {
    const bad = [];
    for (const [key, want] of CASES) {
      const fn = mod.ATTACK_POST.get(key);
      if (!fn) { bad.push(key + '：找不到 ATTACK_POST（reg key 與卡名不符？）'); continue; }
      const deck = [inst(ODDISH), inst(BASIC_ENERGY), inst(TOOL), inst(ITEM), inst(STADIUM), inst(ZUBAT), inst(GOLBAT)];
      const active = inst(ZUBAT, { energyAttached: ENERGY_TYPES.map(c => inst(c)) });
      const st = mkState({ active, bench: [inst(ZUBAT), inst(GOLBAT)], deck });
      let out;
      try { out = fn(st, 0, pool, {}); } catch (e) { bad.push(key + '：執行拋錯 ' + e.message); continue; }
      const ps = out.pendingSelection;
      if (!ps) { bad.push(key + '：沒有開出 pendingSelection'); continue; }
      const pr = ps.params?.publicReveal;
      if (typeof pr !== 'boolean') { bad.push(key + '：params.publicReveal 不是 boolean（實際 ' + JSON.stringify(pr) + '）'); continue; }
      if (pr !== want) bad.push(key + '：publicReveal 應為 ' + want + '（依官方卡面），實際 ' + pr);
    }
    assert.strictEqual(bad.length, 0, '\n  ' + bad.join('\n  '));
  } finally { Math.random = rnd; }
});

console.log('\n=== v6.097 回手守恆 + 給對手看過揭示: ' + pass + ' PASS, ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
