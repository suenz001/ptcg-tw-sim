#!/usr/bin/env node
/**
 * v6.575／server v1.68 守衛：錦標賽聊天室禁止連續傳送一模一樣的內容（站長 2026-10-16：
 *   「錦標賽聊天室 應該要禁止玩家連續傳送一模一樣的對話內容，造成洗版」）。
 *
 *   【V】伺服器：v168-chat-dedupe 是「同路徑、先註冊」的前置 handler，放在錦標賽區塊（TAIL_ANCHOR）之前 ⇒ 原端點與 28 把鎖不動
 *   【B】伺服器行為（真的執行哨兵區塊，假 app／假 tournIdentity／假原端點）：
 *     B1 第一則放行（交給原端點）；同一人 10 分鐘內再送一模一樣的 ⇒ 429 chat-duplicate、原端點沒被呼叫
 *     B2 空白差異（多個空白、頭尾空白）視為相同；內容不同 ⇒ 放行
 *     B3 只記「原端點回 ok:true」的那一則：原端點擋下（限速 429）的那則不算 ⇒ 再送同樣的可以
 *     B4 超過 10 分鐘 ⇒ 放行；別人送一樣的內容 ⇒ 放行（只比自己的上一則）
 *     B5 系統管理員不擋；身分驗不過／沒有內容 ⇒ 交給原端點（不製造第二套錯誤）
 *   【C】玩家端（真的執行 tChatSend，假 tApi）：
 *     C1 同樣內容第二次不送出、顯示提示、輸入框保留；C2 內容不同照送；C3 管理員不擋；C4 伺服器回 chat-duplicate ⇒ 顯示中文提示
 *   【H】HEAD-FAIL：BASE（v6.574）V／B／C 紅
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.574。
const BASE_SHA = '0a4e480734aaf2e7fa3c44d6158257af315c0a12';
const SAP = 'oracle-admin/server_admin_patch.js', PG = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const nl = (s) => String(s ?? '').replace(/\r\n/g, '\n');
const TAIL_ANCHOR = "app.get('/api/tournament";
const blockOf = (src) => (src.match(/    \/\/ >>> v168-chat-dedupe\n[\s\S]*?    \/\/ <<< v168-chat-dedupe\n/) || [''])[0];

async function scenServer(sap) {
  const r = {};
  const b = blockOf(sap);
  r.V = !!b && sap.indexOf(b) < sap.indexOf(TAIL_ANCHOR) && !b.includes(TAIL_ANCHOR) && b.includes("app.post('/api/tournament/chat', async (req, res, next) =>");
  // V2：管理員判準用區塊內的 isTournAdmin（不另抄一份 ADMIN_EMAILS 解析，Rule 38）
  r.V2 = !!b && /if \(isTournAdmin\(id\)\) return next\(\);/.test(b) && !/ADMIN_EMAILS/.test(b.replace(/\/\/.*$/gm, ''));
  if (!b) return r;
  const handlers = [];
  const app = { post: (p, h) => handlers.push([p, h]), get: () => {} };
  let clock = 1_000_000;
  const RealNow = Date.now; Date.now = () => clock;
  const oldEnv = process.env.ADMIN_EMAILS; process.env.ADMIN_EMAILS = 'boss@x.tw';
  try {
    const ids = { tok_a: { uid: 'A', email: 'a@x.tw', verified: true }, tok_b: { uid: 'B', email: 'b@x.tw', verified: true }, tok_adm: { uid: 'Z', email: 'boss@x.tw', verified: true },
      bad: { error: '需要登入', code: 401 }, pid_a: { uid: 'A', email: null, verified: false } };
    const tournIdentity = async (req) => ids[req.tok] ?? { error: '需要登入', code: 401 };
    // isTournAdmin：照抄區塊內那一份的判準（verified＋email 在 ADMIN_EMAILS）當替身；哨兵本身必須呼叫它（不另抄一份，由 V2 釘）
    const ADM = ['boss@x.tw'];
    const isTournAdmin = (id) => !!(id && id.verified && id.email && ADM.includes(String(id.email).toLowerCase()));
    new Function('app', 'tournIdentity', 'isTournAdmin', b)(app, tournIdentity, isTournAdmin);
    const pre = handlers.find(([p]) => p === '/api/tournament/chat')?.[1];
    if (typeof pre !== 'function') return r;
    let origResult = { ok: true }, origCalls = 0;
    const send = async (tok, text) => {
      const out = { code: 200, body: null, nexted: false };
      const res = { status(c) { out.code = c; return this; }, json(v) { out.body = v; return this; } };
      await pre({ tok, body: { text } }, res, () => { out.nexted = true; origCalls++; res.json(typeof origResult === 'function' ? origResult() : origResult); });
      return out;
    };
    const a1 = await send('tok_a', '大家好'); const a2 = await send('tok_a', '大家好');
    r.B1 = a1.nexted && a1.body?.ok === true && !a2.nexted && a2.code === 429 && a2.body?.code === 'chat-duplicate' && /請勿連續傳送相同的內容/.test(a2.body?.error || '');
    r.B1n = JSON.stringify({ a1, a2 });
    const a3 = await send('tok_a', '  大家好  '); const a4 = await send('tok_a', '大家   早'); const a5 = await send('tok_a', '大家 早');
    r.B2 = !a3.nexted && a3.code === 429 && a4.nexted && !a5.nexted && a5.code === 429;
    r.B2n = JSON.stringify({ a3: a3.code, a4: a4.nexted, a5: a5.code });
    origResult = () => { /* 原端點限速 */ return { error: '發言太快，請稍候' }; };
    const b1 = await send('tok_b', '洗版'); origResult = { ok: true };
    const b2 = await send('tok_b', '洗版'); const b3 = await send('tok_b', '洗版');
    r.B3 = b1.nexted && b2.nexted && b2.body?.ok === true && !b3.nexted && b3.code === 429;
    r.B3n = JSON.stringify({ b1: b1.nexted, b2: b2.nexted, b3: b3.code });
    clock += 10 * 60 * 1000 + 1;
    const b4 = await send('tok_b', '洗版'); const a6 = await send('tok_a', '洗版');
    r.B4 = b4.nexted && b4.body?.ok === true && a6.nexted;
    r.B4n = JSON.stringify({ b4: b4.nexted, a6: a6.nexted });
    const z1 = await send('tok_adm', '公告'); const z2 = await send('tok_adm', '公告');
    const before = origCalls; const x1 = await send('bad', '嗨'); const x2 = await send('tok_a', '   ');
    r.B5 = z1.nexted && z2.nexted && x1.nexted && x2.nexted && origCalls === before + 2;
    r.B5n = JSON.stringify({ z2: z2.nexted, x1: x1.nexted, x2: x2.nexted });
    // B6：未驗證身分（只帶 playerId 冒名）不進比對 ⇒ 交給原端點（原端點回 403）；不可以拿 429 探測別人上一則
    const a7 = await send('tok_a', '探測句'); const p1 = await send('pid_a', '探測句');
    r.B6 = a7.nexted && p1.nexted; r.B6n = JSON.stringify({ p1: p1.nexted, code: p1.code });
    // B7：比對鍵——大小寫、全形英數、零寬字元都算同一句
    const c1 = await send('tok_b', 'Hello World'); const c2 = await send('tok_b', 'hello world'); const c3 = await send('tok_b', 'ｈｅｌｌｏ ｗｏｒｌｄ'); const c4 = await send('tok_b', 'hello\u200b world');
    r.B7 = c1.nexted && !c2.nexted && c2.code === 429 && !c3.nexted && !c4.nexted; r.B7n = JSON.stringify({ c2: c2.code, c3: c3.code, c4: c4.code });
  } catch (e) { r.err = String(e && e.message); }
  finally { Date.now = RealNow; if (oldEnv === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = oldEnv; }
  return r;
}

async function scenClient(pg) {
  const r = {};
  // W（審查 P3）：提示的位置——大廳那行緊接在 .tourn-chat-input 結尾之後、對戰中那行緊接在 .chat-input-row 之前（不可以搬回頁尾）
  const ERR = "{#if tChatErr && (tChatInput || '').trim() === tChatErrFor}<div class=\"tourn-chat-err\" role=\"status\">⚠ {tChatErr}</div>{/if}";
  r.W = pg.includes("disabled={!tChatInput.trim()}>送出</button>\n          </div>\n          " + ERR + "\n        {:else}")
    && pg.includes("{#if isTournament && tChatErr && (tChatInput || '').trim() === tChatErrFor}<div class=\"tourn-chat-err\" role=\"status\">⚠ {tChatErr}</div>{/if}\n        <div class=\"chat-input-row\">");
  r.Wn = 'lobby/battle 位置';
  const a = pg.indexOf('  // >>> v6575-chat-dedupe\n'); const fn = pg.indexOf('  async function tChatSend() {');
  if (a < 0 || fn < 0) return r;
  const end = pg.indexOf('\n  }\n', fn) + 4;
  const code = pg.slice(a, end);
  let js;
  try { js = transformSync(code, { loader: 'ts' }).code; } catch (e) { r.err = String(e.message).slice(0, 120); return r; }
  const mk = () => {
    const env = { tChatInput: '', tError: '', tChatErr: '', tChatErrFor: '', tIsAdmin: false, calls: [], reply: { ok: true } };
    const f = new Function('env', `let tChatInput, tError, tIsAdmin;
      const $state = (v) => v;
      const sync = () => { env.tChatInput = tChatInput; env.tError = tError; env.tChatErr = tChatErr; env.tChatErrFor = tChatErrFor; };
      const tApi = async (p, b) => { env.calls.push([p, b && b.text]); const x = typeof env.reply === 'function' ? env.reply() : env.reply; if (x instanceof Error) throw x; return x; };
      const tChatLoad = async () => {};
      ${js}
      return { send: async (t) => { tChatInput = t; tError = ''; tIsAdmin = env.tIsAdmin; await tChatSend(); sync(); } };`)(env);
    return { env, send: f.send };
  };
  const c = mk();
  await c.send('你好'); const n1 = c.env.calls.length; await c.send('  你好 ');
  r.C1 = n1 === 1 && c.env.calls.length === 1 && c.env.tChatErr === '請勿連續傳送相同的內容' && c.env.tChatErrFor === '你好' && c.env.tChatInput === '  你好 ' && c.env.tError === '';
  r.C1n = JSON.stringify(c.env);
  await c.send('換一句'); r.C2 = c.env.calls.length === 2; r.C2n = JSON.stringify(c.env.calls);
  const d = mk(); d.env.tIsAdmin = true; await d.send('公告'); await d.send('公告'); r.C3 = d.env.calls.length === 2;
  const e = mk(); e.env.reply = new Error('429: {"error":"請勿連續傳送相同的內容","code":"chat-duplicate"}'); await e.send('哈');
  r.C4 = e.env.tChatErr === '請勿連續傳送相同的內容' && e.env.tChatInput === '哈' && e.env.tChatErrFor === '哈' && e.env.tError === ''; r.C4n = JSON.stringify(e.env);
  // C5（審查 P2-2）：被伺服器限速（429 發言太快）的那則不可以記成「上一則」⇒ 同樣內容再送一次要真的送出
  const g = mk(); let first = true; g.env.reply = () => { if (first) { first = false; return new Error('429: {"error":"發言太快，請稍候"}'); } return { ok: true }; };
  await g.send('稍等'); await g.send('稍等');
  r.C5 = g.env.calls.length === 2; r.C5n = JSON.stringify(g.env.calls);
  // C6：大小寫／全形視為同一句（與伺服器同一套比對鍵）
  const h = mk(); await h.send('GG'); await h.send('ｇｇ'); r.C6 = h.env.calls.length === 1; r.C6n = JSON.stringify(h.env.calls);
  return r;
}

const LABEL = {
  V: '★★★ V 伺服器：前置 handler 在錦標賽區塊之前（原端點與 28 把鎖不動）',
  B1: '★★★ B1 同一人 10 分鐘內連續送一模一樣的 ⇒ 429、不交給原端點寫入',
  B2: '★★ B2 空白差異視為相同；內容不同照送',
  B3: '★★ B3 只記成功送出的那一則（被原端點限速擋下的不算）',
  B4: '★★ B4 超過 10 分鐘放行；別人送一樣的內容放行',
  B5: '★★ B5 管理員不擋；身分驗不過／空白內容交給原端點',
  W: '★★ W 提示位置：大廳緊接在聊天輸入框下方、對戰中緊接在輸入列上方',
  C1: '★★★ C1 玩家端：同樣內容第二次不送出、輸入框下方顯示提示、輸入框保留',
  C2: '★★ C2 玩家端：內容不同照送',
  C3: '★ C3 玩家端：管理員不擋',
  C4: '★★ C4 玩家端：伺服器回 chat-duplicate ⇒ 輸入框下方顯示中文提示、字還回輸入框（不是 429 原文、不走頁尾 tError）',
  C5: '★★ C5 玩家端：被伺服器限速的那則不記成上一則 ⇒ 再送同樣內容照送',
  C6: '★ C6 玩家端：大小寫／全形視為同一句（與伺服器同一套比對鍵）',
  V2: '★★ V2 伺服器：管理員判準直接用 isTournAdmin（不另抄一份）',
  B6: '★★ B6 未驗證身分（冒名帶 playerId）不進比對 ⇒ 交給原端點',
  B7: '★★ B7 比對鍵：大小寫、全形英數、零寬字元都算同一句',
};
const all = async (sap, pg) => ({ ...(await scenServer(sap)), ...(await scenClient(pg)) });
const R = await all(nl(readFileSync(join(ROOT, SAP), 'utf8')), nl(readFileSync(join(ROOT, PG), 'utf8')));
if (R.err) console.log('  （例外：' + R.err + '）');
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);
console.log('【H】HEAD-FAIL（BASE v6.574）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6575 HEAD-FAIL', '需要歷史 commit');
else {
  const rb = (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? nl(x.out) : ''; };
  const B = await all(rb(SAP), rb(PG));
  for (const k of ['V', 'B1', 'C1']) ok(`★★★[H] v6.574：${k} 紅`, B[k] !== true, String(B[k + 'n'] ?? ''));
}
console.log(`\n=== v6.575 錦標賽聊天室禁止連續傳送相同內容：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
