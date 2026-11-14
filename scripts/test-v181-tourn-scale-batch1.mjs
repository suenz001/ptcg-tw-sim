// server v1.81 守衛：錦標賽 200 人降載第一批（2026-11-14 Fable 擴容審查）
//
// 【A】P0-1 推進輪次／瑞士配對／單淘汰下一輪／歸檔：四處 TMATCH.find 都帶 projection，且每一處「實際讀到的欄位」都在 projection 內
//      A1 四處都帶 projection、且都不含 finalState／finalLog
//      A2 欄位涵蓋（靜態）：函式裡讀 m.<欄位> 的每一個欄位都在該處 projection 裡（noChampionReason 讀的欄位算進本輪那一處）
//      A3 行為：歸檔在「會照 projection 砍欄位」的假 DB 上，新版輸出與 BASE（讀完整文件）逐欄位相同
// 【B】P2-2 終局 CAS：casGameOverV181 以 version 為條件寫房間；版本被改過 ⇒ false；寫入拋錯 ⇒ true（沿用舊的 best-effort）
//      B5 排程器四處（閒置判負、雙方閒置／死角、時限雙敗、時限比獎賞）都先 CAS、失敗就 continue，之後才寫對戰紀錄
// 【C】P2-3 時限公告合併：一場時文字與原本逐字相同；多場合併成一則；兩種判法分開
// 【D】P1-2 未處理錯誤保護：只註冊一次、每分鐘最多印 20 行、印 log 失敗不拋；沒有 process.on 的環境不炸
// 【E】P2-6 回放緩衝上限 200
// 【H】HEAD-FAIL：BASE（server v1.80）逐條紅（Rule 41：每條各自紅，不整支 throw）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '46274caa';   // server v1.80（前端 v6.640）
const P = 'oracle-admin/server_admin_patch.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 500) : '')); } };
const SRC = readFileSync(join(ROOT, P), 'utf8').replace(/\r\n/g, '\n');

function fnBody(src, name) {
  const i = src.indexOf('    async function ' + name + '(') >= 0 ? src.indexOf('    async function ' + name + '(') : src.indexOf('    function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\n    }\n', i);
  return j > i ? src.slice(i, j + 6) : '';
}
function projOf(line) {
  const m = /projection: (\{[^}]*\})/.exec(line || '');
  if (!m) return null;
  try { return Object.keys(new Function('return ' + m[1])()); } catch { return null; }
}
const fieldsOn = (text) => new Set([...text.matchAll(/\bm\.(\w+)/g)].map((x) => x[1]));

function checkA(src, tag) {
  const arch = fnBody(src, 'recordTournamentArchive'), swiss = fnBody(src, 'advanceSwiss'), round = fnBody(src, 'checkRoundAdvance'), ncr = fnBody(src, 'noChampionReason');
  ok(`前提${tag} 四個函式都抽得到`, arch.length > 500 && swiss.length > 500 && round.length > 1000 && ncr.length > 300, [arch.length, swiss.length, round.length, ncr.length].join(','));
  const lines = (body, re) => body.split('\n').filter((l) => re.test(l));
  const findArch = lines(arch, /TMATCH\.find\(/)[0], findSwiss = lines(swiss, /TMATCH\.find\(/)[0];
  const findRound = lines(round, /const curMatches = await TMATCH\.find\(/)[0], findAll = lines(round, /const allMatches = await TMATCH\.find\(/)[0];
  const P4 = { arch: projOf(findArch), swiss: projOf(findSwiss), round: projOf(findRound), all: projOf(findAll) };
  ok(`★★★ A1${tag} 四處 TMATCH.find 都帶 projection，且都不含 finalState／finalLog`, Object.values(P4).every((p) => Array.isArray(p) && p.length > 0 && !p.includes('finalState') && !p.includes('finalLog')), JSON.stringify(P4));
  // A2 欄位涵蓋
  const need = {
    arch: fieldsOn(lines(arch, /matches\.map\(/).join('\n')),
    swiss: fieldsOn(lines(swiss, /swissMatches\.map\(/).join('\n')),
    round: new Set([...fieldsOn(round.split('\n').filter((l) => !/allMatches|nextMatches/.test(l)).join('\n')), ...fieldsOn(ncr)]),
    all: fieldsOn(lines(round, /allMatches/).join('\n')),
  };
  const miss = {};
  for (const k of Object.keys(need)) { const have = new Set(P4[k] || []); const m = [...need[k]].filter((f) => !have.has(f) && f !== '_id'); if (m.length || !P4[k]) miss[k] = P4[k] ? m : 'no-projection'; }
  ok(`★★★ A2${tag} 每一處實際讀到的 m.<欄位> 都在 projection 裡（歸檔 ${need.arch.size}、瑞士 ${need.swiss.size}、本輪 ${need.round.size}、輪空 ${need.all.size} 個欄位）`,
    Object.keys(miss).length === 0 && need.arch.size >= 20 && need.swiss.size >= 6 && need.round.size >= 7 && need.all.size >= 3, JSON.stringify(miss));
  return { arch };
}

// 假 DB：照 projection 砍欄位（沒給 projection ⇒ 回完整文件）
function projectDoc(doc, proj) {
  if (!proj) return JSON.parse(JSON.stringify(doc));
  const o = { _id: doc._id };
  for (const k of Object.keys(proj)) if (proj[k] && k in doc) o[k] = doc[k];
  return JSON.parse(JSON.stringify(o));
}
const MATCHES = [
  { _id: 'EV_r1_m0', round: 1, idx: 0, p1uid: 'u1', p1name: '甲', p2uid: 'u2', p2name: '乙', winnerUid: 'u1', winnerName: '甲', status: 'done', gameStartedAt: 10, endedAt: 20, finalState: { big: 'x'.repeat(5000) }, finalLog: ['a', 'b'] },
  { _id: 'EV_r1_m1', round: 1, idx: 1, p1uid: 'u3', p1name: '丙', p2uid: null, p2name: null, winnerUid: 'u3', winnerName: '丙', status: 'done', bye: true },
  { _id: 'EV_r2_m0', round: 2, idx: 0, p1uid: 'u1', p1name: '甲', p2uid: 'u3', p2name: '丙', winnerUid: null, winnerName: null, status: 'done', timeLimit: true, draw: true, idleForfeit: true, noShow: true, doubleNoShow: true, gameDraw: true, deadlockDraw: true, forfeit: true, adminResolved: true, doubleDrop: true, dropForfeit: true, finalState: { big: 'y' } },
];
async function runArchive(archSrc) {
  const captured = [], finds = [];
  const env = {
    TREGS: { find: () => ({ toArray: async () => [{ uid: 'u1', name: '甲', deckName: 'D', checkedIn: true }] }) },
    TMATCH: { find: (q, opts) => { finds.push(opts && opts.projection ? Object.keys(opts.projection) : null); return { sort: () => ({ toArray: async () => MATCHES.map((d) => projectDoc(d, opts && opts.projection)) }) }; } },
    TARCHIVE: { updateOne: async (_q, u) => { captured.push(u.$set); } },
    seasonRankInvalidate: () => {},
    Date: { now: () => 1234567 },
  };
  const fn = new Function(...Object.keys(env), '"use strict";\n' + archSrc + '\nreturn recordTournamentArchive;')(...Object.values(env));
  await fn({ _id: 'EV', name: '測試', createdAt: 1, startedAt: 2, format: 'swiss-then-cut', bestOf: 1, championUid: 'u1', championName: '甲', createdByPlayer: false });
  return { doc: captured[0], finds };
}

// 【B】CAS helper
async function checkB(src, tag) {
  const body = fnBody(src, 'casGameOverV181');
  let fn = null;
  const calls = [];
  let mode = 'hit';
  const TROOMS = { updateOne: async (f, u) => { calls.push({ f, u }); if (mode === 'throw') throw new Error('boom'); return { matchedCount: mode === 'miss' ? 0 : 1 }; } };
  if (body) { try { fn = new Function('TROOMS', '"use strict";\n' + body + '\nreturn casGameOverV181;')(TROOMS); } catch { fn = null; } }
  const F = fn || (async () => 'MISSING');
  const og = { phase: 'game-over' };
  const VD = { set: { status: 'done', winnerUid: null, timeLimit: true }, adv: 'advance', wUid: null, wName: null };
  mode = 'hit'; const r1 = await F('R1', { version: 7 }, () => og, 99, VD);
  const pv = calls[0] && calls[0].u.$set.pendingVerdictV181;
  ok(`★★★ B1${tag} 以 version 為條件寫房間；命中 ⇒ true，寫入版本＋1，判決（綁新版本號）與盤面同一次寫入`, r1 === true && calls[0] && calls[0].f._id === 'R1' && calls[0].f.version === 7 && calls[0].u.$set.version === 8 && calls[0].u.$set.gameState === og && calls[0].u.$set.updatedAt === 99
    && pv && pv.v === 8 && pv.set === VD.set && pv.adv === 'advance' && pv.wUid === null, JSON.stringify(calls[0]));
  mode = 'miss'; const r2 = await F('R1', { version: 7 }, () => og, 99);
  ok(`★★★ B2${tag} 版本已被玩家動作改過（沒命中）⇒ false（本次不判）`, r2 === false);
  mode = 'throw'; const r3 = await F('R1', { version: 7 }, () => og, 99);
  ok(`★★ B3${tag} 寫入拋錯 ⇒ true（沿用舊 best-effort 照判）；建盤面拋錯也一樣`, r3 === true && (await F('R1', { version: 7 }, () => { throw new Error('x'); }, 99)) === true);
  mode = 'hit'; calls.length = 0; const r4 = await F('R2', {}, () => og, 1);
  ok(`★★ B4${tag} 舊房間沒有 version 欄位 ⇒ 不加版本條件（照舊可寫），版本寫 2`, r4 === true && calls[0] && !('version' in calls[0].f) && calls[0].u.$set.version === 2, JSON.stringify(calls[0]));
  // B5 四處排程器接線：先 CAS（失敗 continue），再寫對戰紀錄；排程器內不再有舊式無條件整包寫回
  const scan = (() => { const i = src.indexOf('// 閒置判負：對局中(雙方都已進場)'); const j = src.indexOf('// v0.58 清掉「已結束賽事底下', i); return i > 0 && j > i ? src.slice(i, j) : ''; })();
  const sites = [...scan.matchAll(/if \(!\(await casGameOverV181\(m\.roomId, room, \(\) => \{[^\n]*\}, now, \{ set: (_vs\w+), adv: [^\n]*\)\)\) continue;[^\n]*\n\s*await TMATCH\.updateOne\(\{ _id: m\._id \}, \{ \$set: (_vs\w+) \}\)/g)].filter((x) => x[1] === x[2]);   // ⭐判決物件與 TMATCH 寫入是同一份
  const legacy = (scan.match(/await TROOMS\.updateOne\(\{ _id: m\.roomId \}, \{ \$set: \{ gameState: og,/g) || []).length;
  ok(`★★★ B5${tag} 閒置判負／雙方閒置／時限雙敗／時限比獎賞四處都先 CAS（帶同一份判決）、失敗就 continue，之後才寫同一份對戰紀錄；排程器內沒有舊式無條件寫回`, scan.length > 5000 && sites.length === 4 && legacy === 0, JSON.stringify({ scanLen: scan.length, sites: sites.length, legacy }));
}

// 【B6】對帳補寫：房間 game-over＋同版本判決、對戰仍 playing ⇒ 補寫並依 adv 推進；版本不符 ⇒ 不補寫
async function checkB6(src, tag) {
  const i = src.indexOf('                // >>> v181-reconcile-pending-verdict'), j = src.indexOf('                // <<< v181-reconcile-pending-verdict');
  const blk = i > 0 && j > i ? src.slice(i, j) : '';
  const run = async (room, mStatus = 'playing') => {
    if (!blk) return { missing: true };
    const writes = [], adv = [], rounds = [];
    const TMATCH = { updateOne: async (f, u) => { writes.push({ f, u }); return { modifiedCount: f.status === 'playing' && mStatus === 'playing' ? 1 : 0 }; } };
    let cont = false;
    await new Function('_rcRoom', 'm', 'ev', 'TMATCH', 'advanceOrFinish', 'checkRoundAdvance', 'console', '"use strict"; return (async () => { for (const _once of [1]) {' + blk + '\n return "fell"; } return "continued"; })();')(
      room, { _id: 'M1' }, { _id: 'E1' }, TMATCH, async (m, u, n) => { adv.push([m._id, u, n]); }, async (e) => { rounds.push(e); }, { warn: () => {} }).then((x) => { cont = x === 'continued'; });
    return { writes, adv, rounds, cont };
  };
  const set = { status: 'done', winnerUid: null, timeLimit: true, draw: true };
  const a = await run({ version: 9, pendingVerdictV181: { v: 9, set, adv: 'advance', wUid: null, wName: null } });
  ok(`★★★ B6${tag} 對帳：同版本判決 ⇒ 以 status:'playing' 為條件補寫 TMATCH，adv=advance 時推進（雙敗 winner null 也不會卡住）`,
    !a.missing && a.writes.length === 1 && a.writes[0].f.status === 'playing' && a.writes[0].u.$set === set && a.adv.length === 1 && a.adv[0][1] === null && a.cont, JSON.stringify(a));
  const b = await run({ version: 10, pendingVerdictV181: { v: 9, set, adv: 'advance' } });
  ok(`★★★ B7${tag} 版本不符（例如重賽後）⇒ 不補寫、不推進，交給原本的對帳分支`, !b.missing && b.writes.length === 0 && b.adv.length === 0 && !b.cont, JSON.stringify(b));
  const c = await run({ version: 3, pendingVerdictV181: { v: 3, set: { status: 'pending-admin' }, adv: 'none' } });
  const d = await run({ version: 3, pendingVerdictV181: { v: 3, set: { status: 'done', doubleNoShow: true }, adv: 'round' } });
  const e = await run({ version: 3, pendingVerdictV181: { v: 3, set, adv: 'advance' } }, 'done');
  ok(`★★ B8${tag} 死角（none）只補寫不推進；雙方閒置（round）推進輪次；已寫過（modifiedCount 0）不重複推進`,
    !c.missing && c.writes.length === 1 && c.adv.length === 0 && c.rounds.length === 0 && d.rounds.length === 1 && d.rounds[0] === 'E1' && e.writes.length === 1 && e.adv.length === 0, JSON.stringify({ c, d, e }));
}

// 【C】時限公告合併
async function checkC(src, tag) {
  const i = src.indexOf('          } finally {\n            const _tlTail');
  const j = src.indexOf('          // <<< v181-time-limit-chat-merge', i);
  const blk = i > 0 && j > i ? src.slice(i + '          } finally {'.length, j).replace(/\n\s*\}\s*$/, '') : '';
  const run = async (arr, limitMin = 25) => {
    if (!blk) return ['MISSING'];
    const msgs = [];
    await new Function('_tlAnnounceV181', 'limitMin', 'postSystemChat', '"use strict"; return (async () => {' + blk + '\n})();')(arr, limitMin, async (m) => { msgs.push(m); });
    return msgs;
  };
  const one = await run([{ name: '甲 vs 乙', mode: 'prizes' }]);
  ok(`★★★ C1${tag} 只有一場時文字與原本逐字相同`, one.length === 1 && one[0] === '⏰ 「甲 vs 乙」對局時限(25分)到！進行最後回合：後攻方結束他的下一個回合後，依雙方剩餘獎賞卡判定。', JSON.stringify(one));
  const many = await run([1, 2, 3, 4, 5].map((k) => ({ name: 'A' + k + ' vs B' + k, mode: 'double-loss' })));
  ok(`★★★ C2${tag} 五場同時到 ⇒ 合併成一則（列前三場＋「等」）`, many.length === 1 && many[0].startsWith('⏰ 5 場對局時限(25分)到（「A1 vs B1」、「A2 vs B2」、「A3 vs B3」 等）！') && many[0].endsWith('若仍未分出勝負，雙方皆判敗。'), JSON.stringify(many));
  const mixed = await run([{ name: 'a', mode: 'prizes' }, { name: 'b', mode: 'double-loss' }, { name: 'c', mode: 'prizes' }]);
  ok(`★★ C3${tag} 兩種判法分開發（不會把判法講錯）；沒有場次 ⇒ 不發`, mixed.length === 2 && mixed[0].includes('2 場') && mixed[0].endsWith('依雙方剩餘獎賞卡判定。') && mixed[1].includes('「b」') && (await run([])).length === 0, JSON.stringify(mixed));
  const scanTl = (() => { const a = src.indexOf('// v0.44 對局時限：官方「打完剩餘回合」制'); const b = src.indexOf('// v0.58 清掉「已結束賽事底下', a); return a > 0 && b > a ? src.slice(a, b) : ''; })();
  const loopPart = scanTl.slice(0, scanTl.indexOf('} finally {'));
  ok(`★★ C4${tag} 迴圈裡不再逐場發「進行最後回合」公告（改成收集）`, scanTl.length > 2000 && !/postSystemChat\([^\n]*進行最後回合/.test(loopPart) && /_tlAnnounceV181\.push\(/.test(loopPart));
}

// 【D】未處理錯誤保護
function checkD(src, tag) {
  const i = src.indexOf('// >>> v181-unhandled-rejection-guard'), j = src.indexOf('// <<< v181-unhandled-rejection-guard');
  const blk = i >= 0 && j > i ? src.slice(i, j) : '';
  const handlers = [];
  const errs = [];
  const fakeProc = { on: (ev, h) => handlers.push({ ev, h }) };
  const G = {};
  const run = (proc) => new Function('process', 'globalThis', 'console', 'Date', blk)(proc, G, { error: (...a) => errs.push(a.join(' ')) }, { now: () => 1000 });
  let threw = null;
  try { if (blk) { run(fakeProc); run(fakeProc); } } catch (e) { threw = e; }
  ok(`★★★ D1${tag} 只註冊一個 unhandledRejection 處理器（重複載入也只一個）`, !threw && handlers.length === 1 && handlers[0].ev === 'unhandledRejection', JSON.stringify({ n: handlers.length, threw: threw && threw.message }));
  let t2 = null;
  try { if (handlers[0]) for (let k = 0; k < 30; k++) handlers[0].h(new Error('e' + k)); } catch (e) { t2 = e; }
  ok(`★★ D2${tag} 每分鐘最多印 20 行、處理器本身不拋`, !t2 && errs.length === 20 && errs[0].includes('[unhandledRejection]'), errs.length);
  let t3 = null; const G2 = {};
  try { if (blk) new Function('process', 'globalThis', 'console', 'Date', blk)({}, G2, console, Date); } catch (e) { t3 = e; }
  ok(`★★ D3${tag} 沒有 process.on 的環境（既有守衛的沙盒）不會炸`, !!blk && !t3, t3 && t3.message);
  ok(`★ D4${tag} 不攔 uncaughtException（同步例外交給 pm2 重啟）`, !!blk && !/process\.on\('uncaughtException'/.test(src));
}

function checkE(src, tag) {
  const cap = Number((src.match(/const REPLAY_STEPS_MAX_BUFFERS = (\d+);/) || [])[1]);
  ok(`★★ E1${tag} 回放緩衝上限 200（涵蓋 200 場同時進行）`, cap === 200, cap);
}

console.log('【A】推進輪次的四處 projection');
const { arch } = checkA(SRC, '');
const a3 = await runArchive(arch);
let baseArch = null;
console.log('【B】終局 CAS');
await checkB(SRC, '');
await checkB6(SRC, '');
console.log('【C】時限公告合併');
await checkC(SRC, '');
console.log('【D】未處理錯誤保護');
checkD(SRC, '');
console.log('【E】回放緩衝上限');
checkE(SRC, '');

console.log('【A3／H】與 BASE 比對、HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('A3／H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, P);
  const BSRC = b.ok ? b.out.replace(/\r\n/g, '\n') : '';
  baseArch = await runArchive(fnBody(BSRC, 'recordTournamentArchive'));
  ok('★★★ A3 歸檔：新版在「照 projection 砍欄位」的假 DB 上輸出與 BASE（讀完整文件）逐欄位相同，且新版有帶 projection、BASE 沒有',
    JSON.stringify(a3.doc) === JSON.stringify(baseArch.doc) && a3.doc && a3.doc.matches.length === 3 && Array.isArray(a3.finds[0]) && baseArch.finds[0] === null,
    JSON.stringify({ head: a3.doc && a3.doc.matches[2], base: baseArch.doc && baseArch.doc.matches[2] }));
  // 正對照：故意少一個欄位 ⇒ 輸出會不同（A3 不是恆真）
  const mutArch = arch.replace('timeLimit: 1, ', '');
  const am = await runArchive(mutArch);
  ok('★★ A3b 正對照：歸檔 projection 少了 timeLimit ⇒ 輸出與 BASE 不同（A3 抓得到漏欄位）', mutArch !== arch && JSON.stringify(am.doc) !== JSON.stringify(baseArch.doc));
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  checkA(BSRC, '@BASE'); await checkB(BSRC, '@BASE'); await checkB6(BSRC, '@BASE'); await checkC(BSRC, '@BASE'); checkD(BSRC, '@BASE'); checkE(BSRC, '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  const bp = pass - before; pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  const want = ['A1', 'A2', 'B1', 'B2', 'B4', 'B5', 'B6', 'B7', 'B8', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4', 'E1'];
  ok('★★★ H1 BASE 上 A1／A2／B1／B2／B4～B8／C1～C4／D1～D4／E1 逐條紅', want.every((k) => reds.some((r) => r.includes(k + '@BASE'))), reds.join(','));
  ok('★★ H2 BASE 上「前提」照樣綠（正對照：抽取器沒壞）', !reds.some((r) => r.includes('前提')) && bp >= 1, String(bp));
}
console.log(`=== server v1.81 錦標賽降載第一批：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
