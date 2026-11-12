// v6.632 守衛：擴充包「30th CELEBRATION」（M6a）官方 Q&A 逐條實跑比對
//
// 由來（2026-11-07，站長：「官方預計在11月底推出新的擴充包 波導探求者……透過學習的方式，例如利用現在已經
//   抓取的卡包和卡片，去測試模擬你的skills、相關記憶和爬蟲程式、判定規則是否正確」）：
//   演練「新卡包上架後比對官方判例」這一步時，用新的抓取工具（scripts/new-set/fetch-official-qa.mjs）發現
//   M6a 有 37 條官方判例是 2026-10-10 那次比對之後才公布的，從來沒跟網站行為比對過。本檔逐條用 applyAction 實跑。
//
// 判例原文：scripts/data/official-qa.json（台灣官方 Q&A 資料庫，標準賽制）；每一條測試的標題寫「Q 摘要 ⇒ 官方答案」。
// ⭐ 每一條都附哨兵或正對照，證明斷言不是空真（例：「不能使用」要同時證明「條件成立時可以使用」）。
// ⚠ 靶一律挑「對出招者屬性中立」的；基本能量 id 依名稱查。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { extractBaseArchive } from './lib/base-archive.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);   // HEAD-FAIL 用：子行程跑同一支守衛（路徑根定義另起一行，test-v6371 F0b 才掃得到）
// HEAD-FAIL 用：子行程把 V6632_SRC_ROOT 指到 BASE 的 src 副本（卡池、判例快照永遠讀現行工作樹）
const SRC_ROOT = process.env.V6632_SRC_ROOT || ROOT;
const IS_CHILD = !!process.env.V6632_SRC_ROOT;
const BASE_SHA = '570afeaf';   // v6.631（本版的上一版）
const S = join(SRC_ROOT, '.v6632-s.js'), E = join(SRC_ROOT, '.v6632-e.ts'), O = join(SRC_ROOT, '.v6632-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities, getEffectiveHP, getEffectiveAttacks, getPlayableTrainers } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(SRC_ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getUsableAbilities, getEffectiveHP, getEffectiveAttacks } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const QA = JSON.parse(readFileSync(join(ROOT, 'scripts/data/official-qa.json'), 'utf8'));

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const en = (t, n = 1) => Array.from({ length: n }, () => inst(EID[t]));
/** 中立填充卡（Basic／無特性／非太晶／【無】） */
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 60 && Number(c.hp) <= 120 && c.pokemonType === 'Colorless' && ['H', 'I', 'J'].includes(c.regulationMark));
/** 挨打的靶：HP 夠高、無弱點無抵抗、沒有特性、非 ex */
const TARGET = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 300 && !c.weakness && !c.resistance && !/ex$/.test(c.name))
  ?? all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && Number(c.hp) >= 280 && !c.weakness && !c.resistance);
const deckN = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: deckN(30), discard: [], prizes: deckN(6), abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 7,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P({ name: 'A', ...p0 }), P({ name: 'B', ...p1 })], ...extra,
});

let pass = 0, fail = 0;
const results = [];
const chk = (t, c, extra = '') => { results.push([t, !!c]); if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const withCoin = (heads, fn) => { const orig = Math.random; Math.random = () => (heads ? 0.1 : 0.9); try { return fn(); } finally { Math.random = orig; } };
const act = (st, a, heads = true) => withCoin(heads, () => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: st.players }; } });
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
const effNames = (st, p) => getEffectiveAttacks(st, p, pool).map((e) => e.atk.name);
const atkIndexOf = (st, p, name) => effNames(st, p).indexOf(name);
const attack = (st, name, heads = true) => { const i = atkIndexOf(st, st.players[st.activePlayerIndex].active, name); return i < 0 ? null : act(st, { type: 'ATTACK', attackIndex: i }, heads); };
const dmgOn = (r, idx = 1) => r?.players?.[idx]?.active?.damage ?? null;
const qaHas = (frag) => QA.items.some((it) => it.q.includes(frag));

console.log(`fixture：PLAIN=${PLAIN?.name}(${PLAIN?.id}) TARGET=${TARGET?.name}(${TARGET?.id} HP${TARGET?.hp})`);
chk('0a 哨兵：判例快照存在、M6a（30th CELEBRATION）判例 ≥ 37 筆', QA.items.filter((it) => it.tags.some((t) => t.label.includes('30th'))).length >= 37);
chk('0b 哨兵：填充卡與靶都找得到', !!PLAIN && !!TARGET);

const MEW = byId('19969'), CRAB = byId('13994'), GIRA = byId('19581'), TOAD_SING = byId('13891');
const NIGHT_MINE = byId('14848'), MIRA = byId('18259'), DELTA_CAP = byId('19616');
const LUCARIO = byId('13986'), PROTEIN = byId('14015'), LURANT = byId('19148'), URSA = byId('10299');
const LUGIA = byId('20009'), PRISM = byId('13028'), RESHI = byId('19920');

// ════════════════════════════════════════════════════════════════
console.log('\n【一】夢幻ex｜記憶螺旋');
{ // Q：附 1 個【惡】、身上有指示物的夢幻ex 可以用備戰鐵螯龍蝦的「反撲剪」嗎？⇒ 可以（減費看夢幻ex 自己身上）
  const s = mk({ active: inst(MEW.id, { damage: 10, energyAttached: en('Darkness') }), bench: [inst(CRAB.id)] }, { active: inst(TARGET.id) });
  { const r1a = attack(s, '反撲剪'); chk('1a 反撲剪：夢幻ex 有指示物＋1 惡 ⇒ 可以使用（官方：可以）', effNames(s, s.players[0].active).includes('反撲剪') && dmgOn(r1a) === 130, JSON.stringify({ eff: effNames(s, s.players[0].active), dmg: dmgOn(r1a), err: r1a?.__err, log: LOGS(r1a).slice(-3) })); }
  const s2 = mk({ active: inst(MEW.id, { damage: 0, energyAttached: en('Darkness') }), bench: [inst(CRAB.id, { damage: 30 })] }, { active: inst(TARGET.id) });
  const r2 = attack(s2, '反撲剪');
  chk('1b 反撲剪：指示物在備戰鐵螯龍蝦、夢幻ex 沒有 ⇒ 不能使用（官方：不可以；要看使用招式的夢幻ex）', r2 === null || dmgOn(r2) === 0, JSON.stringify(effNames(s2, s2.players[0].active)));
}
{ // Q：上個自己的回合用過渾沌匍匐 ⇒ 夢幻ex 不能用記憶螺旋使出渾沌匍匐
  const base = { active: inst(MEW.id, { energyAttached: en('Psychic', 3) }), bench: [inst(GIRA.id)] };
  const s0 = mk(base, { active: inst(TARGET.id) });
  chk('1c 渾沌匍匐 正對照：上回合沒用過 ⇒ 夢幻ex 可以使出', dmgOn(attack(s0, '渾沌匍匐')) === 120);
  let s = mk({ active: inst(GIRA.id, { energyAttached: en('Psychic', 3) }), bench: [inst(MEW.id, { energyAttached: en('Psychic', 3) })] }, { active: inst(TARGET.id) });
  s = attack(s, '渾沌匍匐');
  s = act(s, { type: 'END_TURN' }); s = act(s, { type: 'END_TURN' });
  // 換夢幻ex 上戰鬥場（直接改盤面：撤退不是本條的重點）
  const p = s.players[0]; const mew = p.bench[0]; p.bench = [p.active]; p.active = mew;
  const r = attack(s, '渾沌匍匐');
  chk('1d 渾沌匍匐：上個自己的回合騎拉帝納用過 ⇒ 夢幻ex 不能用記憶螺旋使出（官方：不可以）', r === null || dmgOn(r) === s.players[1].active.damage, JSON.stringify(effNames(s, p.active)));
}
{ // Q：場上只有夢幻ex 與 1 隻蟾蜍王，夢幻ex 使出輪唱 ⇒ 70
  const s = mk({ active: inst(MEW.id, { energyAttached: en('Psychic', 3) }), bench: [inst(TOAD_SING.id)] }, { active: inst(TARGET.id) });
  chk('1e 輪唱：夢幻ex 不算「持有輪唱」⇒ 70（官方：70）', dmgOn(attack(s, '輪唱')) === 70);
}
{ // Q：古空棘魚（潛入記憶）＋從小火龍進化的超級噴火龍Xex ⇒ 夢幻ex 不能選小火龍的招式
  const zard = inst(byId('14331').id, { evolvedFromStack: [inst('14329'), inst(all.find((c) => c.name === '火恐龍' && ['H', 'I', 'J'].includes(c.regulationMark))?.id ?? '14330')] });
  const s = mk({ active: inst(MEW.id, { energyAttached: en('Fire', 2) }), bench: [inst('9804'), zard] }, { active: inst(TARGET.id) });
  chk('1f 潛入記憶：夢幻ex 不能使出「進化前的招式」火種（官方：不可以）', !effNames(s, s.players[0].active).includes('火種'), JSON.stringify(effNames(s, s.players[0].active)));
  chk('1f 哨兵：超級噴火龍Xex 自己可以用火種（潛入記憶真的有效）', getEffectiveAttacks(s, zard, pool).some((e) => e.atk.name === '火種'));
}
{ // Q：夜間礦山在場，附 1 雷的夢幻ex 可以用備戰密勒頓ex 的利爪揮砍 ⇒ 可以（夢幻ex 不是太晶）
  const s = mk({ active: inst(MEW.id, { energyAttached: en('Lightning') }), bench: [inst(MIRA.id)] }, { active: inst(TARGET.id) },
    { activeStadium: inst(NIGHT_MINE.id), activeStadiumOwnerIdx: 1 });
  const isTera = (MIRA.tags || []).includes('太晶');
  const r = attack(s, '利爪揮砍');
  chk('1g 夜間礦山：夢幻ex 用 1 雷使出利爪揮砍（官方：可以，費用不增加）', dmgOn(r) === 40, `密勒頓ex 太晶=${isTera} log=${LOGS(r).slice(-3)}`);
}
{ // Q：夢幻ex 不能用備戰寶可夢身上「超級烈空坐帽子」寫的招式
  const ray = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && ['J'].includes(c.regulationMark) && /烈空坐/.test(c.name)) ?? PLAIN;
  // ⚠（審查 P2-1）引擎讀的道具欄位是 toolAttached；第一版掛在 tool／attachedTool ⇒ 帽子根本沒掛上去（安慰劑）
  const rayInst = inst(ray.id, { toolAttached: inst(DELTA_CAP.id) });
  const s = mk({ active: inst(MEW.id, { energyAttached: en('Psychic', 2) }), bench: [rayInst] }, { active: inst(TARGET.id) });
  chk('1h 哨兵：帽子真的掛上去了（烈空坐自己看得到德爾塔之禮）', getEffectiveAttacks(s, rayInst, pool).some((e) => e.atk.name === '德爾塔之禮'), ray.name);
  chk('1h 超級烈空坐帽子：夢幻ex 不能用道具上的「德爾塔之禮」（官方：不可以）', !effNames(s, s.players[0].active).includes('德爾塔之禮'), JSON.stringify(effNames(s, s.players[0].active)));
}
{ // Q：力量蛋白飲的回合，夢幻ex 使出超級路卡利歐ex 的波動突刺 ⇒ 不 +30（夢幻ex 是【超】）
  let s = mk({ active: inst(MEW.id, { energyAttached: en('Fighting') }), bench: [inst(LUCARIO.id)], hand: [inst(PROTEIN.id)] }, { active: inst(TARGET.id) });
  s = act(s, { type: 'PLAY_TRAINER', iid: s.players[0].hand[0].iid });
  const r = attack(s, '波動突刺');
  if (r?.pendingSelection) { /* 能量附加選擇：選 0 張 */ }
  chk('1i 力量蛋白飲：夢幻ex 使出波動突刺 ⇒ 130 不 +30（官方：不會）', dmgOn(r) === 130, String(dmgOn(r)));
  let s2 = mk({ active: inst(LUCARIO.id, { energyAttached: en('Fighting') }), bench: [], hand: [inst(PROTEIN.id)] }, { active: inst(TARGET.id) });
  s2 = act(s2, { type: 'PLAY_TRAINER', iid: s2.players[0].hand[0].iid });
  chk('1i 正對照：超級路卡利歐ex 自己使出 ⇒ 160', dmgOn(attack(s2, '波動突刺')) === 160);
}
{ // Q：只恢復蘭螳花ex 的回合，夢幻ex 使出活潑刀 ⇒ 不加傷害
  const s = mk({ active: inst(MEW.id, { energyAttached: en('Grass') }), bench: [inst(LURANT.id, { healedThisTurn: true, hpHealedThisTurn: 30 })] }, { active: inst(TARGET.id) });
  s.players[0].bench[0].healedAmountThisTurn = 30;
  chk('1j 活潑刀：恢復的是備戰蘭螳花ex、夢幻ex 沒恢復 ⇒ 60（官方：不可以加）', dmgOn(attack(s, '活潑刀')) === 60);
  const s2 = mk({ active: inst(LURANT.id, { energyAttached: en('Grass'), healedThisTurn: true, hpHealedThisTurn: 30, healedAmountThisTurn: 30 }) }, { active: inst(TARGET.id) });
  chk('1j 正對照：蘭螳花ex 自己這回合恢復過 ⇒ 260（同一組欄位真的會被讀到）', dmgOn(attack(s2, '活潑刀')) === 260, String(dmgOn(attack(s2, '活潑刀'))));
}
{ // Q：對手已拿 5 張，沒附能量的夢幻ex 不能用記憶螺旋使出赫月 ex 的血月
  const s = mk({ active: inst(MEW.id, { energyAttached: [] }), bench: [inst(URSA.id)] }, { active: inst(TARGET.id), prizes: deckN(1) });
  chk('1k 血月：老練招式只對赫月 ex 自己生效 ⇒ 夢幻ex 0 能量不能使出（官方：不可以）', (() => { const r = attack(s, '血月'); return r === null || dmgOn(r) === 0; })());
  const s2 = mk({ active: inst(URSA.id, { energyAttached: [] }), bench: [] }, { active: inst(TARGET.id), prizes: deckN(1) });
  chk('1k 正對照：赫月 ex 自己 0 能量可以使出血月（對手已拿 5 張）', dmgOn(attack(s2, '血月')) === 240);
}

// ════════════════════════════════════════════════════════════════
console.log('\n【二】稜鏡能量');
{ // v6.638 Rule40：目前官方直接QA為「不可以」，三張能量都必須丟棄；不是放寬舊守衛。
  const fire = inst(EID.Fire), water = inst(EID.Water), prism = inst(PRISM.id);
  const s = mk({ active: inst(LUGIA.id, { energyAttached: [fire, water, prism] }) }, { active: inst(TARGET.id) });
  const r = attack(s, '元素爆破');
  chk('2a 元素爆破：不能把唯一雷來源稜鏡當火先丟（官方：不可以）', !r?.pendingSelection && dmgOn(r) === 250);
  const left = r?.players?.[0]?.active?.energyAttached ?? [];
  const discarded = r?.players?.[0]?.discard?.map(e => e.iid) ?? [];
  chk('2a 結算：基本火、基本水、稜鏡各丟棄一張（官方：三張全丟）', left.length === 0 && [fire, water, prism].every(e => discarded.includes(e.iid)));
}
{ // Q：附稜鏡能量的萊希拉姆用鐳射火焰，可以 +80 嗎？⇒ 可以
  const s = mk({ active: inst(RESHI.id, { energyAttached: [inst(EID.Fire), inst(PRISM.id), inst(EID.Water)] }) }, { active: inst(TARGET.id) });
  chk('2b 鐳射火焰：基礎萊希拉姆身上的稜鏡能量算【雷】能量卡 ⇒ 160（官方：可以 +80）', dmgOn(attack(s, '鐳射火焰')) === 160);
  const s2 = mk({ active: inst(RESHI.id, { energyAttached: [inst(EID.Fire), inst(EID.Water), inst(EID.Water)] }) }, { active: inst(TARGET.id) });
  chk('2b 正對照：沒有雷也沒有稜鏡 ⇒ 80', dmgOn(attack(s2, '鐳射火焰')) === 80);
}

// ════════════════════════════════════════════════════════════════
console.log('\n【三】其他');
const MOLT = byId('19918'), ARTI_R = byId('12772'), ZAP_R = byId('12783');
{ const arti = all.find((c) => c.name === '急凍鳥' && ['H', 'I', 'J'].includes(c.regulationMark));
  const zap = all.find((c) => c.name === '閃電鳥' && ['H', 'I', 'J'].includes(c.regulationMark));
  const usable = (bench) => { const s = mk({ active: inst(MOLT.id), bench, hand: [inst(EID.Fire)] }, { active: inst(TARGET.id) }); return getUsableAbilities(s, pool).some((u) => u.abilityName === '燃燒羽擊'); };
  chk('3a 燃燒羽擊：場上只有火箭隊的急凍鳥／閃電鳥 ⇒ 不能用（官方：不同名）', !usable([inst(ARTI_R.id), inst(ZAP_R.id)]));
  chk('3a 正對照：急凍鳥＋閃電鳥 ⇒ 可以用', !!arti && !!zap && usable([inst(arti.id), inst(zap.id)]));
}
{ // Q：甜甜螢 絕佳費洛蒙 × 化隱 來悲粗茶 ⇒ 弱點 ×2
  const BEEDLE = byId('19916'), SINIS = byId('19150');
  const volbeat = all.find((c) => c.name === '電螢蟲' && ['H', 'I', 'J'].includes(c.regulationMark));
  const atkr = all.find((c) => c.supertype === 'Pokemon' && c.pokemonType === SINIS.weakness?.type && c.stage === 'Basic' && (c.attacks || []).some((a) => /^\d+$/.test(String(a.damage)) && !a.effect && (a.cost || []).length <= 2) && ['H', 'I', 'J'].includes(c.regulationMark) && !(c.abilities || []).length);
  const ai = atkr ? atkr.attacks.findIndex((a) => /^\d+$/.test(String(a.damage)) && !a.effect && (a.cost || []).length <= 2) : -1;
  const run = (benchA) => { const s = mk({ active: inst(atkr.id, { energyAttached: en(atkr.attacks[ai].cost?.[0] === 'Colorless' ? 'Water' : atkr.attacks[ai].cost?.[0] ?? 'Water', 3) }), bench: benchA },
    { active: inst(SINIS.id), bench: [] }); return dmgOn(act(s, { type: 'ATTACK', attackIndex: ai })); };
  const base = Number(atkr?.attacks?.[ai]?.damage);
  const plainWeak = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && c.weakness?.type === SINIS.weakness?.type && String(c.weakness?.value).startsWith('×') && Number(c.hp) >= 100 && ['H', 'I', 'J'].includes(c.regulationMark));
  const runPlain = () => { const st = mk({ active: inst(atkr.id, { energyAttached: en(atkr.attacks[ai].cost?.[0] === 'Colorless' ? 'Water' : atkr.attacks[ai].cost?.[0] ?? 'Water', 3) }), bench: [inst(BEEDLE.id), inst(volbeat.id)] },
    { active: inst(plainWeak.id) }); return dmgOn(act(st, { type: 'ATTACK', attackIndex: ai })); };
  chk('3b 正對照：同一盤面、受招方沒有化隱 ⇒ 弱點 ×3（絕佳費洛蒙真的生效）', !!plainWeak && runPlain() === Number(atkr?.attacks?.[ai]?.damage) * 3, `got=${plainWeak ? runPlain() : '—'}`);
  const runOwnSide = () => { const st = mk({ active: inst(atkr.id, { energyAttached: en(atkr.attacks[ai].cost?.[0] === 'Colorless' ? 'Water' : atkr.attacks[ai].cost?.[0] ?? 'Water', 3) }) },
    { active: inst(SINIS.id), bench: [inst(BEEDLE.id), inst(volbeat.id)] }); return dmgOn(act(st, { type: 'ATTACK', attackIndex: ai })); };
  chk('3b 甜甜螢在化隱那一側（自己的特性）⇒ 照樣 ×3（化隱只擋對手的效果；卡面「雙方」）', runOwnSide() === Number(atkr?.attacks?.[ai]?.damage) * 3, `got=${runOwnSide()}`);
  chk('3b 絕佳費洛蒙 × 化隱：來悲粗茶的弱點仍以 ×2 計算（官方：×2）', !!atkr && !!volbeat && run([inst(BEEDLE.id), inst(volbeat.id)]) === Math.min(base * 2, 60 + 999) , `atk=${atkr?.name} base=${base} got=${atkr && volbeat ? run([inst(BEEDLE.id), inst(volbeat.id)]) : '—'}`);
}
{ // Q：大竺葵 繁茂 + 阿羅拉椰蛋樹 一長再長，附 3 張基本草 ⇒ 最大 HP 400
  const EXEGG = byId('19914'), LILI = byId('14025');
  const egg = inst(EXEGG.id, { energyAttached: en('Grass', 3) });
  const s = mk({ active: egg, bench: [inst(LILI.id)] }, { active: inst(TARGET.id) });
  chk('3c 繁茂 × 一長再長：3 張基本草 ⇒ 最大 HP 400（官方：400）', getEffectiveHP(egg, pool, s) === 400 || getEffectiveHP(s, egg, pool) === 400, String(getEffectiveHP(egg, pool, s)));
}
{ // 寶寶丁 軟彈陣
  const IGGY = byId('20008'), ARENA = byId('11285');
  const s = mk({ active: inst(IGGY.id), bench: [inst(IGGY.id), inst(IGGY.id), inst(IGGY.id)] }, { active: inst(TARGET.id) },
    { activeStadium: inst(ARENA.id), activeStadiumOwnerIdx: 0 });
  chk('3d 軟彈陣 × 激動競技場：備戰 3 隻寶寶丁最大 HP 變 60 ⇒ 0 點（官方：0）', dmgOn(attack(s, '軟彈陣')) === 0);
  const s0 = mk({ active: inst(IGGY.id), bench: [inst(IGGY.id), inst(IGGY.id), inst(IGGY.id)] }, { active: inst(TARGET.id) });
  chk('3d 正對照：沒有激動競技場 ⇒ 90', dmgOn(attack(s0, '軟彈陣')) === 90);
  const s2 = mk({ active: inst(IGGY.id), bench: [inst(IGGY.id, { damage: 10 }), inst(IGGY.id)] }, { active: inst(TARGET.id) });
  chk('3e 軟彈陣：最大 HP 30、身上 1 個指示物仍算 ⇒ 60（官方：可以算）', dmgOn(attack(s2, '軟彈陣')) === 60);
  const hp60 = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && Number(c.hp) === 60 && !(c.abilities || []).length && ['H', 'I', 'J'].includes(c.regulationMark));
  const s3 = mk({ active: inst(IGGY.id), bench: [inst(hp60.id, { damage: 30 }), inst(IGGY.id)] }, { active: inst(TARGET.id) });
  chk('3f 軟彈陣：最大 HP 60、剩 30 不算 ⇒ 30（官方：不可以算）', dmgOn(attack(s3, '軟彈陣')) === 30);
}
{ // 賽富豪 歡慶
  const GHOLD = byId('19999');
  const hand30 = () => Array.from({ length: 30 }, () => inst(PLAIN.id));
  const s = mk({ active: inst(GHOLD.id, { energyAttached: en('Metal') }), hand: hand30(), prizes: deckN(6), deck: deckN(10) }, { active: inst(TARGET.id) });
  const r = attack(s, '歡慶');
  const p = r?.players?.[0];
  chk('3g 歡慶：手牌剛好 30 張 ⇒ 拿 2 張獎賞，拿到的也一起放回牌庫（官方：是的）', !!p && p.prizes.length === 4 && p.hand.length === 0 && p.deck.length === 10 + 30 + 2, p ? `prizes=${p.prizes.length} hand=${p.hand.length} deck=${p.deck.length}` : r?.__err);
  const s2 = mk({ active: inst(GHOLD.id, { energyAttached: en('Metal') }), hand: [...hand30(), inst(PLAIN.id)], prizes: deckN(6) }, { active: inst(TARGET.id) });
  const p2 = attack(s2, '歡慶')?.players?.[0];
  chk('3h 歡慶：手牌 31 張 ⇒ 不能拿獎賞（官方：必須剛好 30）', !!p2 && p2.prizes.length === 6);
}
{ // 百變怪 整人變身
  const DITTO = byId('20005');
  const cands = (deck) => {
    const s = mk({ active: inst(DITTO.id, { energyAttached: en('Water', 2) }), deck }, { active: inst(TARGET.id) });
    const r = attack(s, '整人變身', true);
    const ps = r?.pendingSelection;
    return { r, ids: ps ? JSON.stringify(ps.params?.validIids ?? ps.validIids ?? ps.params ?? {}) : '', ps };
  };
  const fossil = inst('19216'), dolph = inst('10450'), plain = inst(PLAIN.id);
  const { ids, ps } = cands([fossil, dolph, plain, ...deckN(5)]);
  chk('3i 整人變身：牌庫裡的陳舊的盾甲化石不能選（官方：在牌庫裡是物品卡）', !!ps && !ids.includes(fossil.iid), `pending=${ps?.type}`);
  chk('3j 整人變身：海豚俠ex（全能靈魂）不能選（官方：不可以）', !!ps && !ids.includes(dolph.iid));
  chk('3j 哨兵：一般寶可夢可以選（候選清單真的有東西）', !!ps && ids.includes(plain.iid));
}
{ // 帕路奇亞 蟲洞 → 對手換上來的寶可夢；夢妖魔ex 漩渦言靈
  const PALK = byId('19926'), MIMI = byId('14354');
  const s = mk({ active: inst(PALK.id, { energyAttached: en('Water', 3) }), bench: [inst(PLAIN.id)] },
    { active: inst(MIMI.id), bench: [inst(PLAIN.id)] });
  let r = attack(s, '蟲洞');
  // 對手換人可能要對手選
  if (r?.pendingSelection && r.pendingSelection.actorIdx === 1) r = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [r.players[1].bench[0].iid], actorIdx: 1 });
  if (r?.pendingSelection && r.pendingSelection.actorIdx !== 1) r = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [r.players[0].bench[0].iid], actorIdx: 0 });
  const myNew = r?.players?.[0]?.active;
  const st = myNew ? [myNew.status, myNew.secondaryStatus, myNew.tertiaryStatus] : [];
  chk('3k 蟲洞：對手的夢妖魔ex 被換到備戰之前，帕路奇亞已退到備戰 ⇒ 新上場的己方寶可夢混亂（官方：會生效）', st.includes('confused'), JSON.stringify({ st, active: myNew?.cardId, mimiAt: r?.players?.[1]?.active?.cardId, pend: r?.pendingSelection?.type, log: LOGS(r).slice(-4) }));
}

// ════════════════════════════════════════════════════════════════
console.log('\n【四】蟾蜍王｜撼盪拳（對手下個回合從手牌使出訓練家卡前擲硬幣，反面＝不算使用過、丟棄）');
const TOAD = byId('19982');
const tremorFlips = (before, after) => LOGS(after).slice(LOGS(before).length).filter((x) => /^撼盪拳（.+）：擲硬幣 — /.test(x)).length;
/** A（idx0）的蟾蜍王用撼盪拳 → 結束回合 ⇒ 輪到 B（idx1）。bOpts：B 的盤面 */
const tremorSetup = (bOpts, stadium = null, useTremor = true) => {
  const toad = inst(TOAD.id, { energyAttached: en('Fighting', 4) });
  let st = mk({ active: toad, bench: [inst(PLAIN.id)] }, { active: inst(TARGET.id), bench: [inst(PLAIN.id)], ...bOpts },
    stadium ? { activeStadium: stadium, activeStadiumOwnerIdx: 0 } : {});
  if (useTremor) st = act(st, { type: 'ATTACK', attackIndex: (TOAD.attacks || []).findIndex((a) => a.name === '撼盪拳') });
  if (st.activePlayerIndex === 0) st = act(st, { type: 'END_TURN' });
  return st;
};
const handIid = (st, cardId, nth = 0) => st.players[1].hand.filter((c) => String(c.cardId) === String(cardId))[nth]?.iid;
const play = (st, iid, heads) => act(st, { type: 'PLAY_TRAINER', iid }, heads);
{ // 蓋伊 反面 ⇒ 不算使用過支援者 ⇒ 可以再使出別張支援者，而且要再擲一次
  const GUY = byId('18322');
  const s0 = tremorSetup({ hand: [inst(GUY.id), inst(GUY.id)] });
  chk('4a 哨兵：輪到 B、撼盪拳旗標在', s0.activePlayerIndex === 1);
  const s1 = play(s0, handIid(s0, GUY.id, 0), false);
  const flips1 = tremorFlips(s0, s1);
  const s2 = play(s1, handIid(s1, GUY.id, 0), true);
  chk('4a 蓋伊反面後還能使出另一張支援者，且再擲一次硬幣（官方：可以；要再擲）', flips1 === 1 && tremorFlips(s1, s2) === 1 && s2.players[1].hand.length >= 3,
    JSON.stringify({ flips1, flips2: tremorFlips(s1, s2), hand: s2.players[1].hand.length, log: LOGS(s2).slice(-3) }));
}
{ // 變化之書 2 張同時使用 ⇒ 擲 1 次
  const BOOK = byId('18494');
  const s0 = tremorSetup({ hand: [inst(BOOK.id), inst(BOOK.id)], discard: [inst(PLAIN.id)] });
  const s1 = play(s0, handIid(s0, BOOK.id, 0), true);
  chk('4b 變化之書 2 張同時使用 ⇒ 撼盪拳只擲 1 次（官方：1 次）', tremorFlips(s0, s1) === 1, String(tremorFlips(s0, s1)));
}
{ // 塔拉剛 反面 ⇒ 視為未使用 ⇒ 同回合河馬獸龍捲風噴射不丟對手牌庫
  const TARA = byId('18050'), HIPPO = byId('18016');
  const resolve0 = (st) => (st?.pendingSelection ? act(st, { type: 'RESOLVE_SELECTION', selectedIids: [], actorIdx: st.pendingSelection.actorIdx ?? 1 }) : st);
  const s0 = tremorSetup({ active: inst(HIPPO.id, { energyAttached: en('Fighting', 3) }), hand: [inst(TARA.id)], discard: en('Fighting', 2) });
  const s1 = resolve0(play(s0, handIid(s0, TARA.id), false));
  const deckBefore = s1.players[0].deck.length;
  const s2 = act(s1, { type: 'ATTACK', attackIndex: (HIPPO.attacks || []).findIndex((a) => a.name === '龍捲風噴射') });
  chk('4c 塔拉剛反面 ⇒ 龍捲風噴射不丟對手牌庫上方 3 張（官方：視為未使用）', tremorFlips(s0, s1) === 1 && s2.players[0].deck.length === deckBefore,
    JSON.stringify({ before: deckBefore, after: s2.players[0].deck.length, err: s2.__err, log: LOGS(s2).slice(-3), log1: LOGS(s1).slice(-3) }));
  const s0b = tremorSetup({ active: inst(HIPPO.id, { energyAttached: en('Fighting', 3) }), hand: [inst(TARA.id)], discard: en('Fighting', 2) });
  const s1b = resolve0(play(s0b, handIid(s0b, TARA.id), true));
  const s2b = act(s1b, { type: 'ATTACK', attackIndex: (HIPPO.attacks || []).findIndex((a) => a.name === '龍捲風噴射') });
  chk('4c 正對照：塔拉剛正面 ⇒ 龍捲風噴射丟對手牌庫 3 張', s2b.players[0].deck.length === s1b.players[0].deck.length - 3, JSON.stringify({ b: s1b.players[0].deck.length, a: s2b.players[0].deck.length, log: LOGS(s2b).slice(-4) }));
}
{ // 傳說的熔岩洞（兩張合一）⇒ 擲 1 次
  const lavaL = all.find((c) => c.name === '傳說的熔岩洞' && String(c.id) === '19623');
  const lavaR = all.find((c) => c.name === '傳說的熔岩洞' && String(c.id) === '19623-1');
  const s0 = tremorSetup({ hand: [inst(lavaL.id), inst(lavaR.id)] });
  const s1 = play(s0, handIid(s0, lavaL.id), true);
  chk('4d 傳說的熔岩洞兩張組合放置 ⇒ 擲 1 次（官方：1 次）', tremorFlips(s0, s1) === 1 && !!s1.activeStadium, JSON.stringify({ flips: tremorFlips(s0, s1), stadium: s1.activeStadium?.cardId }));
}
{ // 密阿雷市 反面 ⇒ 可以放別張競技場／再放密阿雷市，且再擲一次
  const LUM = byId('18054');
  const other = all.find((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium' && ['H', 'I', 'J'].includes(c.regulationMark) && !/傳說|密阿雷|稜鏡塔|昂主/.test(c.name));
  const s0 = tremorSetup({ hand: [inst(LUM.id), inst(other.id), inst(LUM.id)] });
  const s1 = play(s0, handIid(s0, LUM.id, 0), false);
  const s2 = play(s1, handIid(s1, other.id), true);
  chk('4e 密阿雷市反面 ⇒ 還能放別張競技場，且再擲一次（官方：可以；要再擲）', tremorFlips(s0, s1) === 1 && tremorFlips(s1, s2) === 1 && String(s2.activeStadium?.cardId) === String(other.id),
    JSON.stringify({ f1: tremorFlips(s0, s1), f2: tremorFlips(s1, s2), st: s2.activeStadium?.cardId }));
  const s3 = play(s1, handIid(s1, LUM.id, 0), true);
  chk('4f 密阿雷市反面 ⇒ 還能再放另一張密阿雷市，且再擲一次（官方：可以）', tremorFlips(s1, s3) === 1 && String(s3.activeStadium?.cardId) === String(LUM.id),
    JSON.stringify({ f: tremorFlips(s1, s3), st: s3.activeStadium?.cardId }));
}
{ // 稜鏡塔在場，使出昂主花葉蒂 ⇒ 先擲幣；反面 ⇒ 稜鏡塔不丟
  const TOWER = byId('18500'), GRAND = byId('18499');
  const s0 = tremorSetup({ hand: [inst(GRAND.id)] }, inst(TOWER.id));
  const s1 = play(s0, handIid(s0, GRAND.id), false);
  chk('4g 昂主花葉蒂反面 ⇒ 原本的稜鏡塔不丟（官方：先擲硬幣，反面不丟）', tremorFlips(s0, s1) === 1 && String(s1.activeStadium?.cardId) === String(TOWER.id), JSON.stringify({ f: tremorFlips(s0, s1), st: s1.activeStadium?.cardId, err: s1.__err }));
  // 通則：不同名競技場反面 ⇒ 原本的不丟
  const other = all.find((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium' && ['H', 'I', 'J'].includes(c.regulationMark) && !/傳說|密阿雷|稜鏡塔|昂主/.test(c.name));
  const s2 = tremorSetup({ hand: [inst(other.id)] }, inst(TOWER.id));
  const s3 = play(s2, handIid(s2, other.id), false);
  chk('4h 不同名競技場反面 ⇒ 場上原本的競技場不丟（官方：先擲硬幣）', String(s3.activeStadium?.cardId) === String(TOWER.id) && s3.players[0].discard.every((c) => String(c.cardId) !== String(TOWER.id)), JSON.stringify({ st: s3.activeStadium?.cardId }));
}
{ // 高級球：先擲撼盪拳的硬幣，反面 ⇒ 不丟 2 張手牌
  const UB = byId('14140');
  const s0 = tremorSetup({ hand: [inst(UB.id), inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)] });
  const s1 = play(s0, handIid(s0, UB.id), false);
  const handDiff = s0.players[1].hand.length - s1.players[1].hand.length;
  const pend = s1.pendingSelection;
  chk('4i 高級球反面 ⇒ 先擲硬幣，不丟那 2 張手牌（官方：先擲撼盪拳的硬幣）', tremorFlips(s0, s1) === 1 && handDiff === 1 && !pend, JSON.stringify({ handDiff, pend: pend?.type, log: LOGS(s1).slice(-3) }));
}

// ════════════════════════════════════════════════════════════════
console.log('\n【五】弱丁魚｜群聚反擊、裹蜜蟲｜祭典樂舞、故勒頓｜輪番狂攻');
const WISH = byId('19928'), DIPPLIN = byId('10426'), FEST = byId('10513');
{ // 多隻群聚反擊 ⇒ 分別生效
  const atkr = TARGET;  // 只用來算放置的指示物
  const atkCard = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && ['H', 'I', 'J'].includes(c.regulationMark)
    && Number(c.hp) >= 200 && (c.attacks || []).some((a) => /^\d+$/.test(String(a.damage)) && Number(a.damage) >= 10 && Number(a.damage) < 30 && !a.effect));
  const ai = atkCard.attacks.findIndex((a) => /^\d+$/.test(String(a.damage)) && Number(a.damage) >= 10 && Number(a.damage) < 30 && !a.effect);
  const run = (n) => {
    const opp = { active: inst(WISH.id), bench: Array.from({ length: n - 1 }, () => inst(WISH.id)) };
    const st = mk({ active: inst(atkCard.id, { energyAttached: en('Water', 4) }) }, opp);
    const r = act(st, { type: 'ATTACK', attackIndex: ai });
    return r?.players?.[0]?.active?.damage ?? null;
  };
  chk('5a 群聚反擊：場上 2 隻弱丁魚 ⇒ 分別生效，攻擊方放 6 個指示物（官方：分別生效）', run(2) === 60, `1隻=${run(1)} 2隻=${run(2)} atk=${atkCard?.name}`);
  void atkr;
}
{ // 裹蜜蟲 祭典樂舞 vs 群聚反擊：HP30 的裹蜜蟲第 1 次之後就昏厥 ⇒ 不能用第 2 次
  const st = mk({ active: inst(DIPPLIN.id, { damage: 50, energyAttached: en('Grass', 1) }), bench: [inst(PLAIN.id)] },
    { active: inst(WISH.id, { damage: 0 }), bench: [inst(PLAIN.id)] }, { activeStadium: inst(FEST.id), activeStadiumOwnerIdx: 0 });
  const r = attack(st, '朋友之環');
  const usedTwice = LOGS(r).filter((x) => /朋友之環/.test(x)).length;
  // ⚠（審查 P2-2）祭典第 2 次走的是 state.festivalDancePendingSecondAttack，不是 pendingSelection（第一版判錯機制 ⇒ 恆真）
  chk('5b 祭典樂舞：剩 30 HP 的裹蜜蟲第 1 次被群聚反擊打昏 ⇒ 不能用第 2 次（官方：不可以）', !!r && !r.festivalDancePendingSecondAttack && String(r.players[0].active?.cardId ?? '') !== String(DIPPLIN.id),
    JSON.stringify({ fdps: r?.festivalDancePendingSecondAttack, mentions: usedTwice, active0: r?.players?.[0]?.active?.cardId }));
  const stOk = mk({ active: inst(DIPPLIN.id, { damage: 0, energyAttached: en('Grass', 1) }), bench: [inst(PLAIN.id)] },
    { active: inst(WISH.id, { damage: 0 }), bench: [inst(PLAIN.id)] }, { activeStadium: inst(FEST.id), activeStadiumOwnerIdx: 0 });
  const rOk = attack(stOk, '朋友之環');
  chk('5b 正對照：HP 夠（滿血 80）⇒ 第 1 次後仍掛著「第 2 次」待使用', !!rOk?.festivalDancePendingSecondAttack || (rOk?.turnPhase !== 'end' && rOk?.activePlayerIndex === 0), JSON.stringify({ fdps: rOk?.festivalDancePendingSecondAttack, phase: rOk?.turnPhase }));
}
{ // 夢幻ex 用記憶螺旋使出裹蜜蟲的朋友之環（祭典會場在場）⇒ 不能用第 2 次
  const st = mk({ active: inst(MEW.id, { energyAttached: en('Grass', 1) }), bench: [inst(DIPPLIN.id), inst(PLAIN.id)] },
    { active: inst(TARGET.id) }, { activeStadium: inst(FEST.id), activeStadiumOwnerIdx: 0 });
  const r = attack(st, '朋友之環');
  const d1 = dmgOn(r);
  chk('5c 祭典會場＋記憶螺旋使出朋友之環 ⇒ 夢幻ex 只能用 1 次（官方：不可以第 2 次）', d1 === 40 && !(r?.pendingSelection && /festival|second|祭典/.test(JSON.stringify(r.pendingSelection))) && (r?.activePlayerIndex === 1 || r?.turnPhase === 'end'),
    JSON.stringify({ d1, pend: r?.pendingSelection?.effectKey, ptype: r?.pendingSelection?.type, turn: r?.activePlayerIndex, phase: r?.turnPhase, log: LOGS(r).slice(-5) }));
}
{ // 正對照：裹蜜蟲自己（祭典會場在場）用完第 1 次後，回合沒結束（還能用第 2 次）
  const st = mk({ active: inst(DIPPLIN.id, { energyAttached: en('Grass', 1) }), bench: [inst(PLAIN.id), inst(PLAIN.id)] },
    { active: inst(TARGET.id) }, { activeStadium: inst(FEST.id), activeStadiumOwnerIdx: 0 });
  const r = attack(st, '朋友之環');
  chk('5c 正對照：裹蜜蟲自己用 ⇒ 第 1 次後還沒結束回合（祭典樂舞有效）', dmgOn(r) === 40 && r?.activePlayerIndex === 0 && r?.turnPhase !== 'end',
    JSON.stringify({ d: dmgOn(r), turn: r?.activePlayerIndex, phase: r?.turnPhase, pend: r?.pendingSelection?.type }));
}

{ // 裹蜜蟲（祭典會場）對弱丁魚連續用 2 次朋友之環 ⇒ 群聚反擊第 1、2 次都生效
  const st = mk({ active: inst(DIPPLIN.id, { energyAttached: en('Grass', 1) }), bench: [inst(PLAIN.id)] },
    { active: inst(WISH.id, { damage: 0 }), bench: [inst(PLAIN.id)] }, { activeStadium: inst(FEST.id), activeStadiumOwnerIdx: 0 });
  const r1 = attack(st, '朋友之環');
  const after1 = r1?.players?.[0]?.active?.damage;
  const r2 = r1 && r1.turnPhase !== 'end' ? attack(r1, '朋友之環') : null;
  const after2 = r2?.players?.[0]?.active?.damage;
  chk('5d 祭典樂舞連續 2 次 ⇒ 群聚反擊分別生效（第 1 次後 30、第 2 次後 60）（官方：會分別生效）', after1 === 30 && after2 === 60, JSON.stringify({ after1, after2, phase1: r1?.turnPhase }));
}
{ // 百變怪整人變身換成古代寶可夢 ⇒ 下個自己的回合，故勒頓的輪番狂攻不加傷
  const DITTO = byId('20005'), KORAI = byId('11249');
  const ancient = all.find((c) => c.supertype === 'Pokemon' && (c.tags || []).includes('古代') && ['H', 'I', 'J'].includes(c.regulationMark) && c.stage === 'Basic' && String(c.id) !== String(KORAI.id));
  let st = mk({ active: inst(DITTO.id, { energyAttached: en('Water', 2) }), bench: [inst(KORAI.id, { energyAttached: en('Fire', 2) })], deck: [inst(ancient.id), ...deckN(10)] },
    { active: inst(TARGET.id) });
  st = attack(st, '整人變身', true);
  const pick = st?.pendingSelection ? st.players[0].deck.find((c) => String(c.cardId) === String(ancient.id))?.iid : null;
  if (pick) st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [pick], actorIdx: 0 });
  const swapped = String(st.players[0].active?.cardId) === String(ancient.id);
  st = act(st, { type: 'END_TURN' }); st = act(st, { type: 'END_TURN' });
  const p = st.players[0]; const k = p.bench.find((b) => String(b.cardId) === String(KORAI.id)); p.bench = [p.active]; p.active = k;
  const before = st.players[1].active.damage;
  const r = attack(st, '輪番狂攻');
  { // 正對照：古代寶可夢自己上回合用過招式 ⇒ +150
    const ai2 = (ancient.attacks || []).findIndex((x) => /^\d/.test(String(x.damage)) || !x.damage);
    const costEn = (ancient.attacks[ai2].cost || []).map((t) => inst(EID[t] ?? EID.Water));
    let st2 = mk({ active: inst(ancient.id, { energyAttached: [...costEn, ...en('Water', 2)] }), bench: [inst(KORAI.id, { energyAttached: en('Fire', 2) })] }, { active: inst(TARGET.id) });
    st2 = act(st2, { type: 'ATTACK', attackIndex: ai2 });
    if (st2.pendingSelection) st2 = act(st2, { type: 'RESOLVE_SELECTION', selectedIids: [], actorIdx: st2.pendingSelection.actorIdx ?? 0 });
    st2 = act(st2, { type: 'END_TURN' }); st2 = act(st2, { type: 'END_TURN' });
    const p2 = st2.players[0]; const k2 = p2.bench.find((b) => String(b.cardId) === String(KORAI.id)); p2.bench = [p2.active]; p2.active = k2;
    const b2 = st2.players[1].active.damage;
    const r2 = attack(st2, '輪番狂攻');
    chk('5e 正對照：古代寶可夢自己上回合用過招式 ⇒ 故勒頓 +150（180）', dmgOn(r2) - b2 === 180, JSON.stringify({ ancient: ancient.name, atk: ancient.attacks[ai2]?.name, got: dmgOn(r2) - b2 }));
  }
  chk('5e 整人變身換上古代寶可夢 ⇒ 下回合故勒頓輪番狂攻不 +150（使用招式的是百變怪，不是古代）（官方：不可以）', swapped && dmgOn(r) - before === 30,
    JSON.stringify({ swapped, ancient: ancient?.name, got: dmgOn(r) - before }));
}
// ════════════════════════════════════════════════════════════════
// 【H】HEAD-FAIL：同一份測試用 BASE（v6.631）的引擎跑一次 ⇒ 本版修的三條必須紅、其餘照綠（證明不是測試自己壞）
const FIXED = ['1a ', '3b 絕佳費洛蒙 × 化隱', '3j 整人變身：海豚俠ex'];
if (!IS_CHILD) {
  console.log('\n【H】HEAD-FAIL（BASE v6.631 引擎）');
  if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'v6632-base-'));
    try {
      extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
      const r = spawnSync(process.execPath, [SELF_PATH], { env: { ...process.env, V6632_SRC_ROOT: tmp }, encoding: 'utf8', timeout: 150000 });
      const out = String(r.stdout || '');
      const red = out.split('\n').filter((l) => l.includes('❌')).map((l) => l.trim());
      const green = out.split('\n').filter((l) => l.includes('✓')).length;
      console.log('    BASE 上紅的：' + (red.map((l) => l.slice(2, 40)).join('｜') || '（無）'));
      chk('H1 BASE 上本版修的三條（反撲剪借招減費／化隱 × 弱點 ×3／整人變身排除海豚俠ex）逐條紅', FIXED.every((f) => red.some((l) => l.includes(f))), red.join('\n'));
      // v6.638：更正2a的兩項錯誤舊斷言後，v6.631也必須在這兩項紅；原三項HEAD-FAIL仍由H1逐條守。
      const corrected = ['2a 元素爆破：', '2a 結算：'];
      chk('H2 BASE 僅原三項及更正後元素爆破兩項紅，其餘照綠', red.length === FIXED.length + corrected.length && corrected.every(f => red.some(l => l.includes(f))) && green >= 40, `紅 ${red.length} 綠 ${green}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
}

console.log(`\n=== v6.632 M6a 官方判例實跑比對：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
