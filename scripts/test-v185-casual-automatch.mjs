// server v1.85 守衛：休閒線上對戰「⚡ 自動配對」（2026-11-15 站長需求）
//
// 站長裁定：①只做標準賽 ②配對成功要雙方按接受 ③開放觀戰（前端）④盡量避免連續同一個對手，真的沒人還是要配；封鎖名單不配 ⑤限定登入。
// 把 server_admin_patch.js 的 v185-casual-automatch 哨兵區塊抽出來，接假的 app／身分／牌組檢查／好友表／時鐘實跑：
//   S1 登入閘：沒有身分 401、匿名 403；S2 牌組：不是 60 張 400、不是標準賽 400（訊息帶 tournDeckIssue 的內容）、卡表未就緒 503
//   S3 先到先配：A、B 加入 ⇒ 雙方 found、同一個 matchId、看得到對方暱稱；回應不含 email／uid
//   S4 雙方接受 ⇒ 先排隊的 A 是房主（host）、B 等房（wait-host）；A 回報房號 ⇒ A hosting、B join＋房號
//   S5 拒絕 ⇒ 拒絕的人退出；對手回佇列（附原因、排隊順序不變）
//   S6 接受逾時 ⇒ 按了接受的回佇列、沒按的退出；S7 房主建房逾時 ⇒ 客人回佇列、房主退出
//   S8 15 秒沒查詢 ⇒ 移出佇列
//   S9 封鎖名單（任一方封鎖）⇒ 不配；第三人加入 ⇒ 配給第三人
//   S10 上一場的對手：有別人就配別人；只剩他 ⇒ 雙方都等滿 15 秒才配
//   S11 回報房號：不是房主 409、房號格式錯 400；S12 開房前離開 ⇒ 對手回佇列
//   S13 負擔：查詢狀態（poll）一次都不碰資料庫；只有「加入配對」讀一次好友表
//   S14 已在配對流程中再按加入 ⇒ 冪等；配對完成後再加入 ⇒ 重新排隊
// 【H】HEAD-FAIL：BASE（b3fa288d＝v6.644／v1.84）上沒有這個區塊 ⇒ 逐條紅；前提（抽取器）在 HEAD 綠
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'b3fa288d';
const SAP = 'oracle-admin/server_admin_patch.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
const blockOf = (src, tag) => { const i = src.indexOf('// >>> ' + tag), j = src.indexOf('// <<< ' + tag); return i >= 0 && j > i ? src.slice(i, j) : ''; };

function makeEnv(blk, opts = {}) {
  const routes = {};
  const app = { post: (p, f) => { routes[p] = f; }, get: (p, f) => { routes[p] = f; } };
  const clock = { t: 1_800_000_000_000 };
  const dbCalls = [];
  const blocks = opts.blocks || [];   // [{a, b}] status blocked
  const db = { collection: (name) => { dbCalls.push(name); return { find: (q) => ({ limit: () => ({ toArray: async () => {
    const me = q.$or[0].a;
    return blocks.filter((d) => d.a === me || d.b === me).map((d) => ({ a: d.a, b: d.b }));
  } }) }) }; } };
  const ids = opts.ids || {};
  const tournIdentity = async (req) => { const t = req.headers.authorization; if (!t) return { error: '需要登入', code: 401 }; if (t === 'anon') return { error: '匿名', code: 403 }; return ids[t]; };
  const tournDeckIssue = opts.deckIssue || (() => null);
  let err = null;
  if (blk) { try { new Function('app', 'tournIdentity', 'tournDeckIssue', 'db', 'FR_COLL', 'Date', blk)(app, tournIdentity, tournDeckIssue, db, 'friendships', { now: () => clock.t }); } catch (e) { err = e.message; } }
  async function call(path, who, body = {}) {
    const f = routes['/api/casual-match/' + path];
    if (typeof f !== 'function') return { status: 0, out: { missing: true } };
    let status = 200, out = null;
    const res = { status: (c) => { status = c; return res; }, json: (o) => { out = o; return res; }, set: () => res };
    await f({ headers: { authorization: who }, body }, res);
    return { status, out };
  }
  return { call, clock, dbCalls, err, routes };
}
const D60 = [{ cardId: '1', count: 60 }];
const IDS = { A: { uid: 'uA', email: 'a@x.com', verified: true }, B: { uid: 'uB', email: 'b@x.com', verified: true }, C: { uid: 'uC', email: 'c@x.com', verified: true }, D: { uid: 'uD', email: 'd@x.com', verified: true } };
const join_ = (E, who, name) => E.call('join', who, { deckEntries: D60, deckName: 'x', name: name || who + '暱稱' });

async function checkAll(src, tag) {
  const blk = blockOf(src, 'v185-casual-automatch');
  const E0 = makeEnv(blk, { ids: IDS });
  ok(`前提${tag} 抽得到配對區塊、五支端點都註冊`, blk.length > 3000 && !E0.err && ['join', 'poll', 'accept', 'room', 'leave'].every((k) => typeof E0.routes['/api/casual-match/' + k] === 'function'), `${blk.length} ${E0.err}`);
  // S1
  {
    const E = makeEnv(blk, { ids: IDS });
    const r1 = await E.call('join', '', { deckEntries: D60 }), r2 = await E.call('join', 'anon', { deckEntries: D60 }), r3 = await E.call('poll', '');
    ok(`★★★ S1${tag} 登入閘：沒有身分 401、匿名 403（poll 一樣擋）`, r1.status === 401 && r2.status === 403 && r3.status === 401 && r1.out?.code === 'casual-match-auth', JSON.stringify([r1, r2, r3]));
  }
  // S2
  {
    const E = makeEnv(blk, { ids: IDS, deckIssue: (en) => (en[0].cardId === 'G' ? '牌組不符合規則：含有不能使用的卡' : null) });
    const r1 = await E.call('join', 'A', { deckEntries: [{ cardId: '1', count: 59 }] });
    const r2 = await E.call('join', 'A', { deckEntries: [{ cardId: 'G', count: 60 }] });
    const E2 = makeEnv(blk, { ids: IDS, deckIssue: () => { throw new Error('TPOOL not ready'); } });
    const r3 = await E2.call('join', 'A', { deckEntries: D60 });
    const p = await E.call('poll', 'A');
    ok(`★★★ S2${tag} 牌組：59 張 400、非標準賽 400（訊息含「標準賽」與檢查內容）、卡表未就緒 503；被擋的人沒進佇列`,
      r1.status === 400 && r2.status === 400 && /標準賽/.test(r2.out?.error) && /不能使用的卡/.test(r2.out?.error) && r3.status === 503 && p.out?.state === 'idle', JSON.stringify([r1.out, r2.out, r3.out, p.out]));
  }
  // S3／S4
  {
    const E = makeEnv(blk, { ids: IDS });
    const a1 = await join_(E, 'A', '小明');
    E.clock.t += 1000;
    const b1 = await join_(E, 'B', '小華');
    const a2 = await E.call('poll', 'A');
    ok(`★★★ S3${tag} 先到先配：A 搜尋中 → B 加入後雙方 found、同一個 matchId、看得到對方暱稱`,
      a1.out?.state === 'searching' && b1.out?.state === 'found' && a2.out?.state === 'found' && a2.out.matchId === b1.out.matchId && a2.out.opponentNick === '小華' && b1.out.opponentNick === '小明' && a2.out.msLeft > 0,
      JSON.stringify([a1.out, b1.out, a2.out]));
    const dump = JSON.stringify([a1, b1, a2]);
    ok(`★★ S3b${tag} 回應不含 email、不含 uid`, !/@/.test(dump) && !/"uA"|"uB"/.test(dump), dump.slice(0, 300));
    const mid = a2.out?.matchId;
    const acA = await E.call('accept', 'A', { matchId: mid, accept: true });
    const acB = await E.call('accept', 'B', { matchId: mid, accept: true });
    const pa = await E.call('poll', 'A');
    ok(`★★★ S4${tag} 雙方接受 ⇒ 先排隊的 A 是房主（host）、B 等房（wait-host）`, acA.out?.state === 'found' && acA.out.accepted === true && acB.out?.state === 'wait-host' && pa.out?.state === 'host', JSON.stringify([acA.out, acB.out, pa.out]));
    const rr = await E.call('room', 'A', { matchId: mid, roomCode: 'abcd' });
    const pb = await E.call('poll', 'B');
    ok(`★★★ S4b${tag} 房主回報房號 ⇒ A hosting、B join＋房號（大寫）；兩人都離開等待人數`, rr.out?.state === 'hosting' && pb.out?.state === 'join' && pb.out.roomCode === 'ABCD' && pb.out.waitingCount === 0, JSON.stringify([rr.out, pb.out]));
    // S14 完成後再加入 ⇒ 重新排隊
    E.clock.t += 1000;
    const again = await join_(E, 'B');
    ok(`★★ S14${tag} 配對完成後再按加入 ⇒ 重新排隊（不卡在上一場的 join 狀態）`, again.out?.state === 'searching', JSON.stringify(again.out));
  }
  // S5 拒絕
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A'); E.clock.t += 2000; const b = await join_(E, 'B');
    const d = await E.call('accept', 'B', { matchId: b.out?.matchId, accept: false });
    E.clock.t += 1000;
    const pa = await E.call('poll', 'A'), pb = await E.call('poll', 'B');
    ok(`★★★ S5${tag} B 拒絕 ⇒ B 退出（idle）、A 回佇列附原因，排隊時間從原本算起`, d.out?.state === 'idle' && pa.out?.state === 'searching' && /沒有接受/.test(pa.out.notice || '') && pa.out.waitedMs >= 3000 && pb.out?.state === 'idle', JSON.stringify([d.out, pa.out, pb.out]));
  }
  // S6 接受逾時
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A'); const b = await join_(E, 'B');
    await E.call('accept', 'A', { matchId: b.out?.matchId, accept: true });
    E.clock.t += 15001;
    const pa = await E.call('poll', 'A'), pb = await E.call('poll', 'B');
    ok(`★★★ S6${tag} 接受逾時 ⇒ 按了接受的 A 回佇列、沒按的 B 退出（附原因）`, pa.out?.state === 'searching' && pb.out?.state === 'idle' && /時限/.test(pb.out.notice || ''), JSON.stringify([pa.out, pb.out]));
  }
  // S7 建房逾時
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A'); const b = await join_(E, 'B');
    await E.call('accept', 'A', { matchId: b.out?.matchId, accept: true }); await E.call('accept', 'B', { matchId: b.out?.matchId, accept: true });
    E.clock.t += 10000; await E.call('poll', 'B');
    E.clock.t += 15001;
    const pb = await E.call('poll', 'B'), pa = await E.call('poll', 'A');
    ok(`★★★ S7${tag} 房主 25 秒沒開好房 ⇒ 客人 B 回佇列、房主 A 退出`, pb.out?.state === 'searching' && /開房失敗/.test(pb.out.notice || '') && pa.out?.state === 'idle', JSON.stringify([pa.out, pb.out]));
  }
  // S8 沒在查詢
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A');
    E.clock.t += 15001;
    const b = await join_(E, 'B');
    ok(`★★ S8${tag} A 15 秒沒查詢 ⇒ 移出佇列，B 加入時不會配到他`, b.out?.state === 'searching' && b.out.waitingCount === 1, JSON.stringify(b.out));
  }
  // S9 封鎖
  {
    const E = makeEnv(blk, { ids: IDS, blocks: [{ a: 'a@x.com', b: 'b@x.com' }] });
    await join_(E, 'A'); const b = await join_(E, 'B');
    const c = await join_(E, 'C');
    const pa = await E.call('poll', 'A');
    ok(`★★★ S9${tag} A、B 有封鎖關係 ⇒ 不配；C 加入 ⇒ 配給先排隊的 A`, b.out?.state === 'searching' && c.out?.state === 'found' && pa.out?.state === 'found' && pa.out.matchId === c.out.matchId, JSON.stringify([b.out, c.out, pa.out]));
    // 封鎖方向：B 封鎖 A（B 的名單）也一樣
    const E2 = makeEnv(blk, { ids: IDS, blocks: [{ a: 'b@x.com', b: 'a@x.com' }] });
    await join_(E2, 'A'); const b2 = await join_(E2, 'B');
    ok(`★★ S9b${tag} 反方向的封鎖也不配`, b2.out?.state === 'searching', JSON.stringify(b2.out));
  }
  // S10 上一場的對手
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A'); let b = await join_(E, 'B');
    const mid = b.out.matchId;
    await E.call('accept', 'A', { matchId: mid, accept: true }); await E.call('accept', 'B', { matchId: mid, accept: true });
    await E.call('room', 'A', { matchId: mid, roomCode: 'ROOM1' });
    E.clock.t += 60000;
    await join_(E, 'A'); E.clock.t += 100; b = await join_(E, 'B'); E.clock.t += 100; const c = await join_(E, 'C');
    const pa = await E.call('poll', 'A');
    ok(`★★★ S10${tag} 剛打過的 A、B 再排隊、C 也在 ⇒ A 配 C，不配 B`, b.out?.state === 'searching' && c.out?.state === 'found' && pa.out?.state === 'found' && pa.out.matchId === c.out.matchId && pa.out.opponentNick === 'C暱稱', JSON.stringify([b.out, c.out, pa.out]));
    const E2 = makeEnv(blk, { ids: IDS });
    await join_(E2, 'A'); let b2 = await join_(E2, 'B');
    const m2 = b2.out.matchId;
    await E2.call('accept', 'A', { matchId: m2, accept: true }); await E2.call('accept', 'B', { matchId: m2, accept: true });
    await E2.call('room', 'A', { matchId: m2, roomCode: 'ROOM2' });
    E2.clock.t += 60000;
    await join_(E2, 'A'); E2.clock.t += 1000; b2 = await join_(E2, 'B');
    const early = b2.out?.state;
    for (let i = 0; i < 15; i++) { E2.clock.t += 1000; await E2.call('poll', 'A'); await E2.call('poll', 'B'); }
    const late = await E2.call('poll', 'B');
    ok(`★★★ S10b${tag} 只剩上一場的對手 ⇒ 一開始不配；雙方都等滿 15 秒後還是會配（不會永遠等）`, early === 'searching' && late.out?.state === 'found', JSON.stringify([early, late.out]));
  }
  // S11／S12
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A'); const b = await join_(E, 'B');
    const mid = b.out.matchId;
    await E.call('accept', 'A', { matchId: mid, accept: true }); await E.call('accept', 'B', { matchId: mid, accept: true });
    const r1 = await E.call('room', 'B', { matchId: mid, roomCode: 'ABCD' });
    const r2 = await E.call('room', 'A', { matchId: mid, roomCode: 'AB<script>' });
    ok(`★★ S11${tag} 回報房號：不是房主 409、格式錯 400（配對沒有被弄壞）`, r1.status === 409 && r2.status === 400 && (await E.call('poll', 'A')).out?.state === 'host', JSON.stringify([r1, r2]));
    const lv = await E.call('leave', 'A');
    const pb = await E.call('poll', 'B');
    ok(`★★★ S12${tag} 開房前房主離開 ⇒ 房主 idle、客人回佇列（附原因）`, lv.out?.state === 'idle' && pb.out?.state === 'searching' && /取消/.test(pb.out.notice || ''), JSON.stringify([lv.out, pb.out]));
  }
  // S13 負擔
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A');
    const n0 = E.dbCalls.length;
    for (let i = 0; i < 50; i++) { E.clock.t += 3000; await E.call('poll', 'A'); }
    ok(`★★★ S13${tag} 負擔：加入時讀一次好友表；查詢狀態 50 次一次都不碰資料庫`, n0 === 1 && E.dbCalls.length === 1 && E.dbCalls[0] === 'friendships', JSON.stringify(E.dbCalls));
  }
  // S14 冪等
  {
    const E = makeEnv(blk, { ids: IDS });
    await join_(E, 'A'); const b = await join_(E, 'B');
    const a2 = await join_(E, 'A');
    ok(`★★ S14b${tag} 等接受時再按加入 ⇒ 冪等（仍是同一場 found）`, a2.out?.state === 'found' && a2.out.matchId === b.out.matchId, JSON.stringify(a2.out));
  }
}

const src = readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n');
console.log('【S】自動配對佇列（實跑）');
await checkAll(src, '');
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, SAP);
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  await checkAll(b.ok ? b.out.replace(/\r\n/g, '\n') : '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.length + ' 條');
  ok('★★★ H1 BASE 上沒有配對區塊 ⇒ 前提與 S1～S14 逐條紅（每條各自紅，不是整支 throw）', ['前提@', 'S1@', 'S2@', 'S3@', 'S4@', 'S5@', 'S6@', 'S7@', 'S9@', 'S10@', 'S11@', 'S12@', 'S13@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
}
console.log(`=== server v1.85 休閒自動配對：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
