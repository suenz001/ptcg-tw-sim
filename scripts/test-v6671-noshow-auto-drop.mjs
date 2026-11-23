#!/usr/bin/env node
/**
 * v6.671（server v1.88）守衛：瑞士輪未進場自動棄賽（玩家建議＋站長裁定 2026-11-24）。
 *
 * 站長裁定：瑞士輪未進場時，若該玩家「本場之前」已有 1 敗以上 ⇒ 自動棄賽、後續輪次不再配對；
 *   ①「敗」＝沒贏的都算（一般敗、未進場敗、平手／時限雙敗、雙方未進場、雙方棄賽）
 *   ②只看本場之前（0 敗的人未進場只判負）
 *   ③所有瑞士輪（網站賽與社群賽）；單淘汰／複賽不適用
 *
 * 【A】helper noShowAutoDropV188 實跑（假 Mongo）
 *   A1 之前 1 敗 ⇒ 棄賽（dropped/droppedAt/droppedReason）＋系統公告
 *   A2 之前 0 敗（全勝）⇒ 不棄賽、不公告
 *   A3 「沒贏的都算」：之前只有一場雙敗（winnerUid null）⇒ 棄賽
 *   A4 本場自己不算：查詢排除本場 _id（本場已寫成未進場敗也不會被算進去）
 *   A5 bye 不算敗、也不算進查詢
 *   A6 非瑞士階段（複賽／單淘汰）⇒ 完全不動
 *   A7 已經手動棄賽 ⇒ 條件式搶占失敗 ⇒ 不重複公告、回 false
 *   A8 查詢帶 projection（只取 winnerUid）＝不拉整份對戰紀錄（鐵律 Rule 92）
 * 【B】接線（未進場判負區塊，剝註解後）
 *   B1 單方未進場：寫完未進場敗之後、advanceOrFinish 之前呼叫 helper（傳「沒進場的那一方」）
 *   B2 雙方未進場：兩位都各呼叫一次，而且在 checkRoundAdvance 之前
 *   B3 迴圈後有人被棄賽 ⇒ finishIfLastSurvivor（比照 /api/tournament/drop）
 *   B4 helper 失敗不影響判負（try/catch 包住）
 * 【D】錦標賽區塊鎖：D1 現行＝v1.88 新值、D2 revertV188 回 v1.86 tail、D3 改一字就對不上
 * 【H】HEAD-FAIL：BASE（c24b7701）沒有 helper ⇒ A／B 全紅（各自紅，不整支 throw）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, shallowSkip, readBaseBlob } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = 'c24b7701';   // ⚠ Rule 45：main 上的那一顆（v6.670＋鐵律 Rule 93）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function helperSrc(src) {
  const a = src.indexOf('    // >>> v188-noshow-auto-drop\n    // ⭐server v1.88');
  if (a < 0) return null;
  const b = src.indexOf('    // <<< v188-noshow-auto-drop', a);
  return b > a ? src.slice(a, b) : null;
}
function noShowSection(src) {
  const a = src.indexOf('// 未進場判負：倒數(roundCountdownMin)+遲到容許(noShowMin) 過後，本輪未進場者判負');
  const b = src.indexOf('// 閒置判負：對局中(雙方都已進場)', a);
  return a > 0 && b > a ? src.slice(a, b) : null;
}
const stripLineComments = (s) => s.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');

function fakeColl(docs) {
  const calls = [];
  const match = (d, f) => Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((o) => match(d, o));
    if (v && typeof v === 'object' && '$ne' in v) return d[k] !== v.$ne;
    return d[k] === v;
  });
  return {
    calls, docs,
    find(f, opt) { calls.push({ op: 'find', f, opt }); const r = docs.filter((d) => match(d, f)); return { toArray: async () => r.map((d) => (opt && opt.projection ? Object.fromEntries(Object.keys(opt.projection).map((k) => [k, d[k]]).concat([['_id', d._id]])) : d)) }; },
    async updateOne(f, u) { calls.push({ op: 'updateOne', f, u }); const d = docs.find((x) => match(x, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 }; Object.assign(d, u.$set); return { matchedCount: 1, modifiedCount: 1 }; },
  };
}

async function runHelper(src, { matches, regs, swiss = true, uid = 'u1', curId = 'cur' }) {
  const h = helperSrc(src);
  if (!h) return 'MISSING';
  const TMATCH = fakeColl(matches), TREGS = fakeColl(regs), chats = [];
  const fn = new Function('TMATCH', 'TREGS', 'postSystemChat', 'swissPhase', h + '\nreturn noShowAutoDropV188;')(
    TMATCH, TREGS, async (t) => { chats.push(t); }, () => swiss);   // helper 本身不可公告（審查 P2-1：公告併進判負那一則）
  const r = await fn({ _id: 'E' }, { _id: curId }, uid, '小明');
  const reg = regs.find((x) => x.uid === uid);
  return { r, dropped: !!reg?.dropped, reason: reg?.droppedReason ?? null, at: typeof reg?.droppedAt === 'number', chats: chats.length, findCalls: TMATCH.calls.filter((c) => c.op === 'find') };
}
const M = (id, p1, p2, w, x = {}) => ({ _id: id, eventId: 'E', status: 'done', p1uid: p1, p2uid: p2, winnerUid: w, ...x });
const REG = () => [{ _id: 'E__u1', uid: 'u1' }, { _id: 'E__u2', uid: 'u2' }];

async function scenarios(src) {
  const out = {};
  const T = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = 'ERR ' + String(e?.message ?? e).split('\n')[0]; } };
  await T('A1', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u2')], regs: REG() }));
  await T('A2', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u1'), M('m2', 'u3', 'u1', 'u1')], regs: REG() }));
  await T('A3', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u1'), M('m2', 'u1', 'u3', null, { doubleNoShow: true })], regs: REG() }));
  await T('A4', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u1'), M('cur', 'u1', 'u2', 'u2', { noShow: true })], regs: REG() }));
  await T('A5', () => runHelper(src, { matches: [M('b1', 'u1', null, null, { bye: true })], regs: REG() }));
  await T('A6', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u2')], regs: REG(), swiss: false }));
  await T('A7', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u2')], regs: [{ _id: 'E__u1', uid: 'u1', dropped: true }] }));
  // 審查 P2-2：三個「不屬於本人之前敗場」的干擾場次 ⇒ 都不可以棄賽（各拿掉 $or／status／eventId 其中一個條件就會紅）
  await T('A9', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u1'), M('m2', 'u2', 'u3', 'u3')], regs: REG() }));
  await T('A10', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u1'), M('m2', 'u1', 'u3', null, { status: 'playing' })], regs: REG() }));
  await T('A11', () => runHelper(src, { matches: [M('m1', 'u1', 'u2', 'u1'), M('m2', 'u1', 'u3', 'u3', { eventId: 'OTHER' })], regs: REG() }));
  out.N = (() => { try {
    const h = helperSrc(src); if (!h || !h.includes('function noShowAutoDropNoteV188(')) return 'MISSING';
    const f = new Function('TMATCH', 'TREGS', 'postSystemChat', 'swissPhase', h + '\nreturn noShowAutoDropNoteV188;')(null, null, null, null);
    return { one: f(['小明']), two: f(['小明', '小華']), none: f([]) };
  } catch (e) { return 'ERR ' + e.message; } })();
  const sec = noShowSection(src);
  const s = sec ? stripLineComments(sec) : '';
  out.B = {
    single: /noShow: true \} \}\);\s*let _adLoserV188 = false;\s*try \{ if \(await noShowAutoDropV188\(ev, m, e0 \? m\.p2uid : m\.p1uid, lName\)\) \{ _adAnyV188 = true; _adLoserV188 = true; \} \} catch \(_adE\)[^\n]*\n[\s\S]*?await postSystemChat\(swissPhase\(ev\) \? \('⏰ ' \+ \(lName \|\| '一方'\) \+ ' 未進場，本場由 ' \+ wName \+ ' 獲勝' \+ \(_adLoserV188 [^?]*\? '。' \+ noShowAutoDropNoteV188\(\[lName \|\| '一方'\]\) : '（瑞士制：雙方仍繼續後續輪次）。'\)\)[\s\S]*?await advanceOrFinish\(m, wUid, wName\);/.test(s),
    double: /doubleNoShow: true \} \}\);\s*const _adNamesV188 = \[\];\s*for \(const \[_adU, _adN\] of \[\[m\.p1uid, m\.p1name\], \[m\.p2uid, m\.p2name\]\]\) \{\s*try \{ if \(await noShowAutoDropV188\(ev, m, _adU, _adN\)\) \{ _adAnyV188 = true; _adNamesV188\.push\(_adN \|\| '一位選手'\); \} \} catch[\s\S]*?noShowAutoDropNoteV188\(_adNamesV188\)[\s\S]*?await checkRoundAdvance\(ev\._id\);/.test(s),
    last: /if \(_adAnyV188\) \{ try \{ await finishIfLastSurvivor\(ev\._id\); \} catch/.test(s),
    declared: /let _adAnyV188 = false;/.test(s),
    noStandalone: !/postSystemChat\('🏳/.test(s) && !/postSystemChat\('🏳/.test(helperSrc(src) || 'postSystemChat(\'🏳'),
  };
  return out;
}

const judge = (r) => ({
  A1: r.A1?.r === true && r.A1.dropped && r.A1.reason === 'noShow' && r.A1.at && r.A1.chats === 0,
  A2: r.A2?.r === false && !r.A2.dropped && r.A2.chats === 0,
  A3: r.A3?.r === true && r.A3.dropped,
  A4: r.A4?.r === false && !r.A4.dropped && !!r.A4.findCalls?.[0]?.f?._id && r.A4.findCalls[0].f._id.$ne === 'cur',
  A5: r.A5?.r === false && !r.A5.dropped,
  A6: r.A6?.r === false && !r.A6.dropped && r.A6.findCalls?.length === 0,
  A7: r.A7?.r === false && r.A7.chats === 0,
  A9: r.A9?.r === false && !r.A9.dropped, A10: r.A10?.r === false && !r.A10.dropped, A11: r.A11?.r === false && !r.A11.dropped,
  N: typeof r.N === 'object' && r.N.one.includes('小明') && r.N.one.includes('自動棄賽') && r.N.two.includes('小明、小華') && r.N.none === '',
  A8: JSON.stringify(r.A1?.findCalls?.[0]?.opt) === JSON.stringify({ projection: { winnerUid: 1 } }),
  B1: !!r.B?.single && r.B.declared, B4: !!r.B?.single && !!r.B?.double && !!r.B?.noStandalone, B2: !!r.B?.double, B3: !!r.B?.last,
});
const LABEL = {
  A1: '★★★ A1 之前 1 敗 ⇒ 自動棄賽（dropped／droppedAt／droppedReason=noShow）；helper 本身不公告（公告併進判負那一則）',
  A2: '★★★ A2 之前全勝 ⇒ 不棄賽、不公告（0 敗的人還有一次機會）',
  A3: '★★★ A3「沒贏的都算」：之前一場雙方未進場（winnerUid null）⇒ 棄賽',
  A4: '★★★ A4 本場自己不算：查詢排除本場 _id',
  A5: '★★★ A5 bye 不算敗（只有 bye ⇒ 不棄賽）',
  A6: '★★★ A6 非瑞士階段（複賽／單淘汰）⇒ 不查、不動',
  A7: '★★★ A7 已經手動棄賽 ⇒ 不重複公告、回 false',
  A9: '★★★ A9 別人之間的場次（u2 對 u3、u3 勝）不算本人敗場（守 $or 條件）',
  A10: '★★★ A10 未結束的場次（status playing）不算敗場（守 status:done）',
  A11: '★★★ A11 別的賽事的敗場不算（守 eventId）',
  N: '★★★ N 公告文字單一來源：一人／兩人名字都列出、無人棄賽時為空字串',
  B4: '★★★ B4 公告不矛盾：被棄賽者的判負公告不再寫「雙方仍繼續」，改附棄賽說明',
  A8: '★★★ A8 查詢只取 winnerUid（projection；不拉整份對戰紀錄）',
  B1: '★★★ B1 單方未進場：寫完未進場敗後、advanceOrFinish 之前，對「沒進場的那一方」呼叫，失敗有 try/catch',
  B2: '★★★ B2 雙方未進場：兩位各呼叫一次，在 checkRoundAdvance 之前',
  B3: '★★★ B3 有人被自動棄賽 ⇒ 迴圈後 finishIfLastSurvivor（比照手動棄賽）',
};

const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8').replace(/\r\n/g, '\n');
console.log('【A／B】');
const H = await scenarios(SRC), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k] ?? H.B).slice(0, 300));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  if (!b.ok) ok('★★★[H] 讀得到 BASE 補丁', false);
  else {
    const B = await scenarios(b.out.replace(/\r\n/g, '\n')), BJ = judge(B);
    for (const k of Object.keys(LABEL)) ok(`★★★[H] BASE：${k} 紅`, BJ[k] === false, JSON.stringify(B[k] ?? B.B));
  }
} else shallowSkip('v6671 H', '需要 BASE commit');

console.log('\n【D】錦標賽區塊鎖（Rule 68）');
{
  const { createHash } = await import('node:crypto');
  const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
  let L = null;
  try { L = await import('./lib/tourn-revert-v188.mjs'); } catch (e) { ok('★★★ D0 讀得到 tourn-revert-v188', false, e.message); }
  if (L) {
    const tail = (t) => t.slice(t.indexOf(L.TAIL_ANCHOR));
    const tev = (t) => t.slice(t.indexOf(L.TEV_ANCHOR));
    ok('★★★ D1 現行 tail／tev／len ＝ v1.88 新值', sha(tail(SRC)) === L.NEW_TAIL_SHA_V188 && sha(tev(SRC)) === L.NEW_TEV_SHA_V188 && tev(SRC).length === L.NEW_TEV_LEN_V188);
    let back = null; try { back = L.revertV188(tail(SRC)); } catch (e) { back = 'ERR ' + e.message; }
    ok('★★★ D2 revertV188 後逐位元回 v1.86 的 tail 指紋', typeof back === 'string' && sha(back) === L.NEW_TAIL_SHA_V186, String(back).slice(0, 80));
    const mut = SRC.replace('依規則自動棄賽', '依規則自動棄賽!');
    ok('★★★ D3 自驗：本版改一個字 ⇒ D1 指紋對不上（非恆真）', mut !== SRC && sha(tail(mut)) !== L.NEW_TAIL_SHA_V188);
  }
}

console.log(`\n=== v6.671 瑞士輪未進場自動棄賽：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
