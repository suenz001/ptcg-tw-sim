// ⭐⭐⭐ v6.175 守衛 — 「選擇被套到錯的 picker」與「非場區巢狀附加物 = 同 iid 兩份」
//
// 真因（玩家回報：v6.173 錦標賽「薪水小偷 R2」火焰雞ex｜沸騰鬥志，dump_20260812_102715）：
//   log 出現 `沸騰鬥志：將 基本【超】能量 附給 ?`。當下盤面有 1 戰鬥位 + 5 備戰、
//   pending.validIids 也是 6 個 —— **候選從來沒有空過**。
//   真因是 RESOLVE_SELECTION 沒有任何「這是在回答哪一個 picker」的資訊：
//   兩段 picker（選能量 → 選目標）的 payload 形狀一樣，第 1 段的答案遲到就被當成第 2 段的答案。
//
// 本檔全部行為端實跑 applyAction，不 grep bundle。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6175-s.js'), E = join(ROOT, '.x6175-e.ts'), O = join(ROOT, '.x6175-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* ignore */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
  + "export * as SelUI from './src/lib/game/selection-ui';\n"
  + "export { GameActions } from './src/lib/game/actions';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const inst = (iid, cardId, e = {}) => ({ iid, cardId, damage: 0, energyAttached: [], toolAttached: null, ...e });
function countAll(s) {
  let n = 0;
  const cnt = (i) => { n++; for (const k of ['energyAttached', 'extraTools', 'evolvedFromStack']) for (const _ of (i[k] || [])) n++; if (i.toolAttached) n++; };
  for (const p of s.players) {
    for (const z of ['hand', 'deck', 'discard', 'prizes', 'lostZone']) for (const c of (p[z] || [])) cnt(c);
    if (p.active) cnt(p.active);
    for (const b of p.bench) cnt(b);
  }
  return n;
}
const RES = (s, iids, tok) => mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0, ...(tok !== undefined && { pendingToken: tok }) }, pool);

// 依 dump 真實盤面重建：P0 active 莉莉艾的皮皮ex(16758)、bench 火焰雞ex(12086)+多龍奇+多龍梅西亞+火稚雞+含羞苞
const board = () => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'P0', active: inst('ravmbo09', '16758'),
      bench: [inst('94iqs0uq', '12086'), inst('onpdrp8v', '17018'), inst('55ar9m0k', '17017'), inst('48h5nkce', '12768'), inst('pymr9kq8', '14671')],
      hand: [], deck: [inst('d1', '17122')], discard: [inst('wnoipo9e', '17220'), inst('pp5i8egq', '17214')], prizes: [] },
    { name: 'P1', active: inst('jh8sdqnu', '14206'), bench: [inst('fbwm21ec', '13982')],
      hand: [], deck: [inst('d2', '13133')], discard: [], prizes: [] },
  ],
});

console.log('\n── A. 火焰雞ex｜沸騰鬥志：第 1 段的答案不可以被當成第 2 段的答案 ──');
{
  const S0 = board(); const total0 = countAll(S0);
  let s = mod.applyAction(S0, { type: 'USE_ABILITY', iid: '94iqs0uq', abilityIndex: 0, actorIdx: 0 }, pool);
  ck('第1段開 discard-search', s.pendingSelection?.effectKey === 'blaziken-boiling-pick-energy');
  const tok1 = s.pendingSelection?.token;
  ck('★ 新開的 pending 一定有 token（engine 單點蓋章）', typeof tok1 === 'number', String(tok1));
  s = RES(s, ['wnoipo9e'], tok1);
  ck('第2段開 heal-target 且候選非空（卡面保證至少有戰鬥位那一隻）',
    s.pendingSelection?.effectKey === 'blaziken-boiling-attach'
    && (s.pendingSelection?.params?.validIids ?? []).length === 6,
    JSON.stringify(s.pendingSelection?.params?.validIids));
  const tok2 = s.pendingSelection?.token;
  ck('★ 第2段拿到不同的 token', typeof tok2 === 'number' && tok2 !== tok1, `${tok1} → ${tok2}`);

  // ★ 真因重現：把第 1 段的 payload（能量 iid）再送一次
  const mis = RES(s, ['wnoipo9e']);   // 舊 client：不帶 token
  ck('★★★ 錯位選擇（能量 iid 當成目標）不得解析 → pending 必須留在原地',
    mis.pendingSelection?.effectKey === 'blaziken-boiling-attach');
  ck('★★★ 錯位選擇不得留下半套盤面：能量仍在棄牌區',
    mis.players[0].discard.some(c => c.iid === 'wnoipo9e'));
  ck('★★★ 錯位選擇後牌張守恆', countAll(mis) === total0, `${countAll(mis)} vs ${total0}`);
  ck('★★★ log 絕不得再出現「附給 ?」', !mis.log.some(l => /附給 \?/.test(l.message)));
  const misTok = RES(s, ['wnoipo9e'], tok1);   // 新 client：帶「上一段」的 token
  ck('★★★ 帶舊 token 的選擇一律無效（pending 留在原地、盤面不動）',
    misTok.pendingSelection?.effectKey === 'blaziken-boiling-attach'
    && misTok.pendingSelection?.token === tok2
    && misTok.players[0].discard.some(c => c.iid === 'wnoipo9e')
    && !misTok.players[0].bench.some(b => b.energyAttached.length > 0));
  ck('★ 帶舊 token 被擋下時必須留痕（原本完全靜默 → 「按了沒反應」查不出來）',
    misTok.log.length === s.log.length + 1 && /沒有生效/.test(misTok.log[misTok.log.length - 1].message));

  // 被擋下之後，玩家重選一次仍然完全正常
  const okS = RES(mis, ['94iqs0uq'], mis.pendingSelection?.token);
  ck('★ 被擋下之後重選仍可正常結算（不會把特性白白吃掉）',
    okS.players[0].bench[0].energyAttached.some(c => c.iid === 'wnoipo9e') && !okS.pendingSelection);
  ck('正常路徑牌張守恆', countAll(okS) === total0);

  // 死結防線：連續不合法必須有上限
  let t = s, n = 0;
  for (let i = 0; i < 6; i++) { t = RES(t, ['wnoipo9e']); if (!t.pendingSelection) { n = i + 1; break; } }
  ck('★ 連續不合法選擇有上限（不會永遠鎖在同一個 picker）', n > 0 && n <= 5, `第 ${n} 次放行`);
}

console.log('\n── B. 非場區不得留巢狀附加物（同一張卡同 iid 兩份）──');
{
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P0', active: inst('a0', '16829', { energyAttached: [inst('e1', '17220'), inst('e2', '17220')] }),
        bench: [], hand: [], deck: [inst('d1', '17122')], discard: [], prizes: [inst('z1', '17122'), inst('z2', '17122')] },
      { name: 'P1', active: inst('b0', '16829', { damage: 100, energyAttached: [inst('f1', '17214'), inst('f2', '17220')] }),
        bench: [inst('b1', '13982')], hand: [], deck: [inst('d2', '13133')], discard: [], prizes: [inst('z3', '13133')] },
    ],
  };
  const s = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  ck('願增猿 被 KO 進棄牌區', s.players[1].discard.some(c => c.iid === 'b0'));
  const nested = [];
  const iids = [];
  for (const p of s.players) for (const z of ['hand', 'deck', 'discard', 'prizes']) for (const c of (p[z] || [])) {
    iids.push(c.iid);
    for (const k of ['energyAttached', 'extraTools']) for (const x of (c[k] || [])) nested.push(z + ':' + c.iid + '→' + x.iid);
    if (c.toolAttached) nested.push(z + ':' + c.iid + '→tool');
  }
  ck('★★★ 非場上區的卡不得再帶 energyAttached / toolAttached / extraTools', nested.length === 0, JSON.stringify(nested));
  const dup = iids.filter((v, i) => iids.indexOf(v) !== i);
  ck('★★★ 非場上區沒有重複 iid（幻影分身）', dup.length === 0, JSON.stringify(dup));
  ck('★ 被 KO 的能量仍在棄牌區（不是被刪掉）',
    s.players[1].discard.some(c => c.iid === 'f1') && s.players[1].discard.some(c => c.iid === 'f2'));
}

console.log('\n── C. attach-tool：站長裁定「寶可夢道具可以反悔」──');
{
  const sk = { type: 'heal-target', actorIdx: 0, sourcePlayerIdx: 0, effectKey: 'attach-tool', minCount: 1 };
  ck('attach-tool 仍不是「選 0 張」（selectionAllowsSkip 維持 false）', mod.SelUI.selectionAllowsSkip(sk) === false);
  ck('★★★ attach-tool 有【取消】出口（selectionAllowsCancel = true）',
    mod.SelUI.selectionAllowsCancel({ effectKey: 'attach-tool' }) === true);
  ck('★ 逐卡宣告 params.allowCancel 也算', mod.SelUI.selectionAllowsCancel({ effectKey: 'whatever', allowCancel: true }) === true);
  ck('★ 未宣告的 picker 不得有取消鈕（不可全站放行）', mod.SelUI.selectionAllowsCancel({ effectKey: 'blaziken-boiling-attach' }) === false);
  ck('★ 有取消鈕就不算「完全沒有出口」', mod.SelUI.selectionHasNoExit({ ...sk, allowCancel: true }, 0) === false);
  ck('★ 沒有取消鈕、候選為空、minCount>=1 仍算沒有出口（安全網不可被弱化）',
    mod.SelUI.selectionHasNoExit({ type: 'heal-target', actorIdx: 0, sourcePlayerIdx: 0, effectKey: 'blaziken-boiling-attach', minCount: 1 }, 0) === true);

  // 行為端：打出「氣球」→ 取消 → 道具乾淨回到手牌
  const balloon = [...pool.values()].find(c => c.name === '氣球' && c.supertype === 'Trainer');
  if (!balloon) { ck('找得到「氣球」卡（fixture）', false); }
  else {
    const st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
      players: [
        { name: 'P0', active: inst('a0', '16829'), bench: [], hand: [inst('tool1', String(balloon.id))],
          deck: [inst('d1', '17122')], discard: [], prizes: [] },
        { name: 'P1', active: inst('b0', '16829'), bench: [], hand: [], deck: [inst('d2', '13133')], discard: [], prizes: [] },
      ],
    };
    const total0 = countAll(st);
    let s = mod.applyAction(st, { type: 'PLAY_TRAINER', iid: 'tool1', actorIdx: 0 }, pool);
    ck('氣球打出後開 attach-tool picker', s.pendingSelection?.effectKey === 'attach-tool');
    ck('★ attach-tool pending 帶 allowCancel（UI 才渲染得出取消鈕）', s.pendingSelection?.params?.allowCancel === true);
    const c = RES(s, [], s.pendingSelection?.token);
    ck('★★★ 取消後道具乾淨退回手牌', c.players[0].hand.some(x => x.iid === 'tool1'));
    ck('★★★ 取消後沒有留下半套狀態（沒附到任何寶可夢）', !c.players[0].active.toolAttached);
    ck('★★★ 取消後牌張守恆', countAll(c) === total0, `${countAll(c)} vs ${total0}`);
    ck('★★★ 取消後 pending 關閉、可以再打一次同一張道具', !c.pendingSelection
      && mod.applyAction(c, { type: 'PLAY_TRAINER', iid: 'tool1', actorIdx: 0 }, pool).pendingSelection?.effectKey === 'attach-tool');
  }
}

console.log('\n── D. 超級甲賀忍蛙ex｜必殺手裡劍：代價與效果原子化 ──');
{
  const gren = [...pool.values()].find(c => c.name === '超級甲賀忍蛙ex');
  const water = [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【水】'));
  if (!gren || !water) { ck('fixture：找得到 超級甲賀忍蛙ex 與 基本【水】能量', false); }
  else {
    const st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
      players: [
        { name: 'P0', active: inst('g0', String(gren.id)), bench: [], hand: [inst('w1', String(water.id))],
          deck: [inst('d1', '17122')], discard: [], prizes: [] },
        { name: 'P1', active: inst('b0', '16829'), bench: [inst('b1', '13982')], hand: [], deck: [inst('d2', '13133')], discard: [], prizes: [] },
      ],
    };
    const total0 = countAll(st);
    const s = mod.applyAction(st, { type: 'USE_ABILITY', iid: 'g0', abilityIndex: 0, actorIdx: 0 }, pool);
    ck('必殺手裡劍開 opp-poke-choose', s.pendingSelection?.effectKey === 'greninja-shuriken-6');
    ck('★★★ pending 帶 validIids（沒有的話完全不經中央消毒閘）',
      Array.isArray(s.pendingSelection?.params?.validIids) && s.pendingSelection.params.validIids.length === 2,
      JSON.stringify(s.pendingSelection?.params?.validIids));
    const bad = RES(s, ['NOT_A_REAL_IID'], s.pendingSelection?.token);
    ck('★★★ 送不存在的 iid → 不解析、pending 留著（代價不會白付）',
      bad.pendingSelection?.effectKey === 'greninja-shuriken-6');
    // 空選擇（舊 client 的放棄鈕）→ 原子還原
    const empt = RES(s, [], s.pendingSelection?.token);
    ck('★★★ 空選擇 → 基本【水】能量退回手牌', empt.players[0].hand.some(c => c.iid === 'w1'));
    ck('★★★ 空選擇 → 本回合特性標記解除（可再用）', !empt.players[0].active.abilityUsedThisTurn);
    ck('★★★ 空選擇 → 牌張守恆', countAll(empt) === total0, `${countAll(empt)} vs ${total0}`);
    const ok = RES(s, ['b0'], s.pendingSelection?.token);
    ck('正常路徑：對手戰鬥位吃 6 個指示物（60 傷）', ok.players[1].active.damage === 60, String(ok.players[1].active.damage));
    ck('正常路徑：能量留在棄牌區（代價照付）', ok.players[0].discard.some(c => c.iid === 'w1'));
  }
}

console.log('\n── E. UI 接線（真的接上了嗎，不是「有這個字串」）──');
{
  const raw = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  // 剝註解（HTML 註解 + 區塊註解 + 「整行都是 //」的行註解；不動行尾，避免打壞網址字串）
  const strip = (t) => t
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/[​-‍﻿]/g, '');
  const src = strip(raw);

  // ① 每一個 resolveSelection 呼叫點都必須把 pendingToken 帶出去
  const callRe = /GameActions\.resolveSelection\(([^\n]*)/g;
  const calls = [];
  let m;
  while ((m = callRe.exec(src)) !== null) calls.push(m[1]);
  ck('★ 掃描器有掃到東西（下限斷言：resolveSelection 呼叫點 >= 5）', calls.length >= 5, `找到 ${calls.length} 個`);
  const missing = calls.filter((a) => !/_pendingTok\(\)|\.token/.test(a));
  ck('★★★ 每一個 resolveSelection 呼叫點都帶了 pendingToken', missing.length === 0, JSON.stringify(missing));
  // 掃描器自我驗證（正對照）：餵一個違規樣本，判準必須抓得到
  {
    const bad = 'dispatch(GameActions.resolveSelection(payload, sid));';
    const found = [];
    const re2 = /GameActions\.resolveSelection\(([^\n]*)/g;
    let mm; while ((mm = re2.exec(bad)) !== null) found.push(mm[1]);
    ck('★ 掃描器正對照：違規樣本必須被抓到',
      found.length === 1 && !/_pendingTok\(\)|\.token/.test(found[0]));
  }

  // ② 取消鈕真的渲染在 picker footer，而且按下去走 abandonSelection
  const cancelBlk = src.match(/\{:else if selectionAllowsCancel\(([\s\S]{0,600}?)\{\/if\}/);
  ck('★★★ picker footer 有 selectionAllowsCancel 分支', !!cancelBlk);
  ck('★★★ 取消鈕 onclick 走 abandonSelection（送空選擇 → resolver 退回手牌）',
    !!cancelBlk && /onclick=\{abandonSelection\}/.test(cancelBlk[0]), cancelBlk ? cancelBlk[0].slice(0, 200) : '');
  ck('★ selectionAllowsCancel 有 import 進來（沒 import = runtime 炸彈）',
    /import \{[^}]*selectionAllowsCancel[^}]*\} from '\$lib\/game\/selection-ui'/.test(src));
  ck('★ pendingStuckEmpty 有把 allowCancel 餵給中央述詞（否則會多長一顆「放棄」鈕）',
    /allowCancel: pendingSelection\.params\?\.allowCancel === true/.test(src));

  // ③ AI 無進展防呆：pending 還在時必須真的 dispatch，不可以靜默 return（否則 AI 從此不再有 tick）
  const gi = src.indexOf('if (_aiStuck >= 2) {');
  ck('★ 找得到 AI 無進展防呆分支（掃描器 anchor 有效）', gi >= 0);
  const gblk = gi >= 0 ? src.slice(gi, gi + 1600) : '';
  ck('★ anchor 沒有失效（窗口長度合理）', gblk.length > 0 && gblk.length <= 1600);
  ck('★★★ AI 無進展且 pending 未解時，必須以空選擇強制推進（不可靜默 return）',
    /_g\.pendingSelection && _g\.pendingSelection\.actorIdx === aiPlayerIndex[\s\S]{0,400}?resolveSelection\(\[\], undefined, _g\.pendingSelection\.token\)/.test(gblk));
  ck('★ 掃描器正對照：拿掉那段 dispatch 後判準必須變紅',
    !/_g\.pendingSelection && _g\.pendingSelection\.actorIdx === aiPlayerIndex[\s\S]{0,400}?resolveSelection\(\[\], undefined, _g\.pendingSelection\.token\)/
      .test('if (_aiStuck >= 2) { _aiStuck = 0; return; }'));
}

console.log('\n── F. 同維度枚舉（棘輪）：場上目標型 picker 有多少個完全不經中央消毒閘 ──');
{
  // 背景：sanitizeSelectedIids 對非 deck-search 型是「有 params.validIids 才濾」。
  //   ⇒ 場上目標型 pending 若沒宣告 validIids，client 送任何 iid 都會原封送進 resolver，
  //     resolver 找不到目標時各自為政（多數靜默 return state，代價卻已經付掉）。
  //   這一輪已補：超級甲賀忍蛙ex｜必殺手裡劍（greninja-shuriken-6）。
  //   其餘為既有債 —— 這條棘輪只保證**數量不准再變多**（新卡一律要宣告 validIids）。
  // ⚠ 掃描器自我驗證：下限斷言 + 正對照，避免「掃不到 = 全綠」的安慰劑。
  const FIELD = new Set(['heal-target', 'bench-choose', 'opp-bench-choose', 'opp-poke-choose']);
  const strip2 = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/[​-‍﻿]/g, '');
  const walk = (d, acc = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const fp = join(d, e.name);
      if (e.isDirectory()) walk(fp, acc); else if (e.name.endsWith('.ts')) acc.push(fp);
    }
    return acc;
  };
  const seenKeys = new Set();
  const noValid = [];
  let scanned = 0;
  for (const f of walk(join(ROOT, 'src/lib/game'))) {
    const s2 = strip2(readFileSync(f, 'utf8'));
    for (const mm of s2.matchAll(/effectKey:\s*'([^']+)'/g)) {
      const blk = s2.slice(Math.max(0, mm.index - 1500), mm.index + 900);
      const tm = blk.match(/type:\s*'([a-z-]+)'/);
      if (!tm || !FIELD.has(tm[1])) continue;
      if (seenKeys.has(mm[1])) continue;
      seenKeys.add(mm[1]);
      scanned++;
      const mc = blk.match(/minCount:\s*([^,\n]+)/);
      const mcv = (mc ? mc[1].trim() : '?');
      if (mcv.startsWith('0')) continue;
      if (!blk.includes('validIids')) noValid.push(tm[1] + '|' + mm[1]);
    }
  }
  ck('★ 掃描器有掃到東西（下限：場上目標型 pending >= 120 個）', scanned >= 120, `掃到 ${scanned}`);
  ck('★ 掃描器正對照：沒宣告 validIids 的樣本必須被算進來',
    !"type: 'heal-target', minCount: 1, effectKey: 'x'".includes('validIids'));
  ck('★★★ 「minCount>=1 卻沒有 validIids」的場上目標型 picker 不得增加（棘輪 <= 55）',
    noValid.length <= 55, `目前 ${noValid.length} 個：${noValid.slice(0, 6).join(', ')}…`);
  ck('★ 必殺手裡劍已脫離名單', !noValid.some((x) => x.endsWith('greninja-shuriken-6')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.175 pending-token / non-field-stacks：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
