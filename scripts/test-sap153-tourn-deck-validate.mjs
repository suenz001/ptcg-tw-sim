#!/usr/bin/env node
/**
 * server patch v1.53 守衛：錦標賽報名的牌組改在伺服器端也跑完整規則（站長 2026-10-02 核准）
 *
 * 由來：v6.465 前端已經改走 validateDeck 並列出原因，但伺服器的 /register、/register-and-checkin、/propose
 *   只檢查 60 張 ⇒ 改過的前端或很舊的快取版本仍可用「沒有基礎寶可夢／同名超過 4 張／ACE SPEC 超過 1 張／
 *   不能使用的卡」報名。站長裁定：伺服器端也擋；已報名的人、報到、開戰一律不動。
 *
 * 判準
 *   【S】結構
 *     S1 helper tournDeckIssue 在哨兵 v153-tourn-deck-validate 內、而且在 TAIL_ANCHOR 之前（不進錦標賽區塊的鎖）
 *     S2 helper 走引擎 bundle 的 TENG.validateDeck（規則只有一份）、讀 r.legal（不是 valid）、錯誤字首與前端 tDeckSubmitError 相同
 *     S3 全檔恰好三個呼叫點，分別在 /register、/register-and-checkin、/propose，而且都在 60 張檢查**之後**、任何寫入**之前**
 *     S4 範圍：報到（/checkin）、開戰（makeGame）、牌組公布欄（dpValidateDeck 的錦標賽豁免）沒有被改
 *   【B】真 handler × 假 DB × 真 validateDeck（esbuild 打包 src/lib/decks/validation.ts）× 真卡池（static/cards）
 *     B1 合法牌組：三支端點都照常成功，存進 DB 的 deckEntries 與送來的一模一樣（數字 cardId 也可以）
 *     B2 沒有基礎寶可夢：三支端點都回 400「牌組不符合規則：…至少需要 1 隻基礎寶可夢」，而且**一筆都沒寫**
 *     B3 同名 5 張：400「不得超過 4 張」
 *     B4 本站沒有的卡：400「本站沒有的卡片」
 *     B5 舊 bundle 沒有 validateDeck ⇒ 只檢查卡片存在就放行（fail-open，同 dpValidateDeck）；驗證器丟例外 ⇒ 不擋
 *     B6 HEAD-FAIL：v1.52 的 /register 收下「沒有基礎寶可夢」的牌組（漏洞真的存在）
 *   【D】錦標賽區塊 28 把鎖重釘（D1～D5，照 sap152 的形狀）
 *
 * Run: node scripts/test-sap153-tourn-deck-validate.mjs
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync, readdirSync as rdir, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR, revertV153,
  NEW_TAIL_SHA_V153, NEW_TEV_SHA_V153, NEW_TEV_LEN_V153, OLD_TAIL_SHA_V152, OLD_TEV_SHA_V152, OLD_TEV_LEN_V152,
} from './lib/tourn-revert-v153.mjs';
import { revertAdminV153 } from './lib/sap-revert-admin-v153.mjs';
// ⭐v1.54（Rule 40，意圖不變）：之後的 server patch 又合法改過這份檔 ⇒ 位元組比對類判準先剝掉更新的版本。
import { revertAdminV154 } from './lib/sap-revert-admin-v154.mjs';
import { revertAdminV155 } from './lib/sap-revert-admin-v155.mjs';   // ⭐server v1.55：較新的版本先還原（Rule 54）
import { revertAdminV156 } from './lib/sap-revert-admin-v156.mjs';   // ⭐server v1.56（牌組原型序位）：先剝較新的（Rule 54）
import { revertAdminV160 } from './lib/sap-revert-admin-v160.mjs';   // ⭐server v1.60（套牌／玩家戰績未進場不計）：先剝較新的（Rule 54）
import { revertAdminV159 } from './lib/sap-revert-admin-v159.mjs';   // ⭐server v1.59（原型未進場不計＋先攻後攻）：先剝較新的（Rule 54）
import { revertAdminV158 } from './lib/sap-revert-admin-v158.mjs';   // ⭐server v1.58（常用牌組對戰矩陣端點）：先剝較新的（Rule 54）
import { revertAdminV157 } from './lib/sap-revert-admin-v157.mjs';   // ⭐server v1.57（序位預設 50＋用最新規則重新判定）：先剝較新的（Rule 54）
import { revertV154 } from './lib/tourn-revert-v154.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.466（server patch v1.52）。
const BASE_SHA = '2149920b';
const SAP = 'oracle-admin/server_admin_patch.js';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const CUR = rd(SAP);
let BASE = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, SAP); BASE = r.ok ? r.out.replace(/\r\n/g, '\n') : null; }

/** 抽出 `app.post('…',` 整支（括號配對到 `);`）。 */
function handlerSrc(src, head) {
  const a = src.indexOf(head);
  if (a < 0 || src.indexOf(head, a + 1) >= 0) throw new Error('端點不是恰好一支：' + head);
  let depth = 0, i = src.indexOf('(', a);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) break; }
    else if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
    else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
  }
  if (depth !== 0) throw new Error('括號配對失敗：' + head);
  return src.slice(a, i + 2);
}
function sentinel(src, tag) {
  const O = '    // >>> ' + tag + '\n', C = '    // <<< ' + tag + '\n';
  if (src.split(O).length !== 2 || src.split(C).length !== 2) throw new Error('哨兵不是恰好一對：' + tag);
  return src.slice(src.indexOf(O), src.indexOf(C) + C.length);
}
const EP = {
  register: "app.post('/api/tournament/register',",
  late: "app.post('/api/tournament/register-and-checkin',",
  propose: "app.post('/api/tournament/propose',",
};

// ══════════════════════════════════════════════════════════════════════════
console.log('【S】結構');
const TAG = 'v153-tourn-deck-validate';
let helper = '';
try { helper = sentinel(CUR, TAG); } catch (e) { helper = ''; }
ok('★★[S1] helper 在哨兵內、且在 TAIL_ANCHOR 之前（不進錦標賽區塊的鎖）',
  !!helper && CUR.indexOf(helper) < CUR.indexOf(TAIL_ANCHOR) && /function tournDeckIssue\(entries, deckName\)/.test(helper));
{
  const code = helper.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const front = rd('src/routes/game/+page.svelte');
  const frontPrefix = /return issues\.length \? '(牌組不符合規則：)' \+ issues\.join\('；'\) : null;/.exec(front);
  ok('★★★[S2] 走 TENG.validateDeck（規則只有一份）、讀 r.legal、錯誤格式與前端 tDeckSubmitError 相同',
    /TENG\.validateDeck\(/.test(code) && /r\.legal === false/.test(code) && !/\.valid\b/.test(code)
    && !!frontPrefix && code.includes("'" + frontPrefix[1] + "' + r.issues.join('；')"));
  ok('[S2b] helper 沒有自己寫任何牌組規則（沒有 4 張／ACE SPEC／基礎寶可夢的字面）', !/=== ?4|> ?4|ACE|Basic|基礎/.test(code));
}
{
  const calls = CUR.split('tournDeckIssue(').length - 1;   // 1 個定義＋3 個呼叫
  const inEp = Object.entries(EP).map(([k, h]) => {
    const s = handlerSrc(CUR, h);
    const i60 = s.indexOf("if (deckCount(deckEntries) !== 60)"), iCall = s.indexOf('tournDeckIssue('), iWrite = s.search(/insertOne\(/);
    return { k, n: s.split('tournDeckIssue(').length - 1, order: i60 > 0 && iCall > i60 && iWrite > iCall };
  });
  ok('★★★[S3] 恰好三個呼叫點，各在 60 張檢查之後、任何寫入之前', calls === 4 && inEp.every((x) => x.n === 1 && x.order), JSON.stringify(inEp) + ' total=' + calls);
}
{
  const checkin = handlerSrc(CUR, "app.post('/api/tournament/checkin',");
  ok('★★[S4] 範圍：報到端點沒有呼叫（已報名的人不受影響）、dpValidateDeck 的錦標賽豁免原封不動',
    !checkin.includes('tournDeckIssue') && CUR.includes('const bad = tournament ? null : dpValidateDeck(norm, deckName);'));
  if (BASE) {
    // 開戰（makeGame）與報到的程式碼在 v1.52 → v1.53 之間逐位元沒變
    const strip = (s) => s.replace(/[ \t]*\/\/ >>> v153-tourn-deck-validate\n[\s\S]*?[ \t]*\/\/ <<< v153-tourn-deck-validate\n/, '');
    ok('★[S4b] 剝掉本版哨兵、三行呼叫與一段說明註解後，整份 server patch 與 v1.52 逐位元相同（沒有夾帶其他改動）',
      strip(revertAdminV153(revertAdminV154(revertAdminV155(revertAdminV156(revertAdminV157(revertAdminV158(revertAdminV159(revertAdminV160(CUR))))))))) === BASE);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【B】真 handler × 假 DB × 真 validateDeck × 真卡池');
const S = join(ROOT, '.sap153-s.js'), E = join(ROOT, '.sap153-e.ts'), O = join(ROOT, '.sap153-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* ignore */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { validateDeck } from './src/lib/decks/validation';\nexport { isHiddenFromPlayers } from './src/lib/cards/visibility';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const CDIR = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(CDIR, 'index.json'), 'utf8')).map((e) => e.code));
const TPOOL = new Map();
for (const f of readdirSync(CDIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CDIR, f), 'utf8'))) if (c && c.id != null && !M.isHiddenFromPlayers(c.id)) TPOOL.set(String(c.id), c);
}
const cards = [...TPOOL.values()];
const basicPoke = cards.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && c.regulationMark === 'J' && !/ex$/.test(c.name) && !/ACE/.test(String(c.subtypes || '')));
const basicEnergy = cards.find((c) => c.supertype === 'Energy' && /基本【雷】能量/.test(c.name));
ok('[B 前提] 卡池讀得到、找得到 J 標基礎寶可夢與基本雷能量', TPOOL.size > 3000 && !!basicPoke && !!basicEnergy, `${TPOOL.size} ${basicPoke && basicPoke.name} ${basicEnergy && basicEnergy.name}`);
const DECK_OK = [{ cardId: String(basicPoke.id), count: 4 }, { cardId: String(basicEnergy.id), count: 56 }];
const DECK_OK_NUM = [{ cardId: Number(basicPoke.id), count: 4 }, { cardId: Number(basicEnergy.id), count: 56 }];
const DECK_NOBASIC = [{ cardId: String(basicEnergy.id), count: 60 }];
const DECK_FIVE = [{ cardId: String(basicPoke.id), count: 5 }, { cardId: String(basicEnergy.id), count: 55 }];
const DECK_UNKNOWN = [{ cardId: '99999999', count: 4 }, { cardId: String(basicEnergy.id), count: 56 }];

function makeRunner(src, TENG) {
  const helperSrc = (() => { try { return sentinel(src, TAG); } catch { return ''; } })();
  const eps = Object.values(EP).map((h) => handlerSrc(src, h)).join('\n');
  const body = '"use strict";\n'
    + 'const { app, TEVENTS, TREGS, TENG, TPOOL, evDoc } = env;\n'
    + 'const TMINVER_RE = /^\\d+\\.\\d+$/;\n'
    + 'async function tournIdentity() { return { uid: "u1", email: "a@b.tw", verified: true }; }\n'
    + 'function tournRequireVerified() { return false; }\n'
    + 'async function resolveEventFromReq() { return evDoc(); }\n'
    + 'function deckCount(entries) { if (!Array.isArray(entries)) return -1; let n = 0; for (const e of entries) n += (e && e.count) || 0; return n; }\n'
    + 'function runInSeedChain(fn) { return fn(); }\n'
    + 'async function postSystemChat() {}\n'
    + helperSrc + '\n' + eps + '\n';
  return async (which, deck) => {
    const routes = {}, writes = [];
    const status = which === 'late' ? 'checkin' : 'registration';
    const coll = (name) => ({
      async findOne(q) { if (name === 'TEVENTS' && q && q._id) return { _id: 'EV', status }; return null; },
      async countDocuments() { return 0; },
      async insertOne(d) { writes.push({ name, d }); return { insertedId: d._id }; },
      async deleteOne() { return { deletedCount: 1 }; },
      async updateOne() { return { matchedCount: 1, modifiedCount: 1 }; },
      find() { return { sort() { return this; }, limit() { return this; }, async toArray() { return []; } }; },
    });
    const env = { app: { post: (p, h) => { routes[p] = h; }, locals: {} }, TEVENTS: coll('TEVENTS'), TREGS: coll('TREGS'), TENG, TPOOL, evDoc: () => ({ _id: 'EV', status, maxPlayers: null }) };
    new Function('env', body)(env);
    const path = { register: '/api/tournament/register', late: '/api/tournament/register-and-checkin', propose: '/api/tournament/propose' }[which];
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const payload = { deckEntries: deck, name: '測試', nickname: '測試', deckName: '牌', coinPref: 'random' };
    await routes[path]({ body: payload, headers: {}, query: {} }, res);
    return { code: res.code, error: res.body && res.body.error, writes };
  };
}
const REAL = { validateDeck: M.validateDeck };
const run = makeRunner(CUR, REAL);
const ALL = ['register', 'late', 'propose'];
const deckWrite = (r) => r.writes.find((w) => w.name === 'TREGS');
{
  const rs = await Promise.all(ALL.map((w) => run(w, DECK_OK)));
  ok('★★★[B1] 合法牌組：三支端點都照常寫入報名，deckEntries 原封不動',
    rs.every((r) => r.code !== 400 && deckWrite(r) && JSON.stringify(deckWrite(r).d.deckEntries) === JSON.stringify(DECK_OK)), JSON.stringify(rs.map((r) => [r.code, r.error])));
  const rn = await run('register', DECK_OK_NUM);
  ok('★[B1b] 數字型 cardId 也認得（伺服器端正規化成字串查卡池）', rn.code === 200 && !!deckWrite(rn), JSON.stringify([rn.code, rn.error]));
}
{
  const rs = await Promise.all(ALL.map((w) => run(w, DECK_NOBASIC)));
  ok('★★★[B2] 沒有基礎寶可夢：三支都 400「牌組不符合規則：…至少需要 1 隻基礎寶可夢」，而且一筆都沒寫',
    rs.every((r) => r.code === 400 && /^牌組不符合規則：/.test(r.error || '') && /至少需要 1 隻基礎寶可夢/.test(r.error) && r.writes.length === 0), JSON.stringify(rs.map((r) => [r.code, r.error, r.writes.length])));
  const r5 = await run('register', DECK_FIVE);
  ok('★★[B3] 同名 5 張：400「不得超過 4 張」', r5.code === 400 && /不得超過 4 張/.test(r5.error || '') && r5.writes.length === 0, JSON.stringify([r5.code, r5.error]));
  const ru = await run('late', DECK_UNKNOWN);
  ok('★★[B4] 本站沒有的卡：400「本站沒有的卡片」', ru.code === 400 && /本站沒有的卡片/.test(ru.error || '') && ru.writes.length === 0, JSON.stringify([ru.code, ru.error]));
}
{
  const old = makeRunner(CUR, {});
  const r1 = await old('register', DECK_NOBASIC);
  const thrower = makeRunner(CUR, { validateDeck: () => { throw new Error('boom'); } });
  const r2 = await thrower('register', DECK_NOBASIC);
  const ru = await old('register', DECK_UNKNOWN);
  ok('★[B5] 舊 bundle（沒有 validateDeck）／驗證器丟例外 ⇒ 不擋；但卡片不存在仍擋',
    r1.code === 200 && r2.code === 200 && ru.code === 400, JSON.stringify([r1.code, r2.code, ru.code]));
}
if (BASE) {
  const base = makeRunner(BASE, REAL);
  const rb = await base('register', DECK_NOBASIC);
  ok('★★★[B6] HEAD-FAIL：v1.52 的 /register 收下沒有基礎寶可夢的牌組（漏洞真的存在）', rb.code === 200 && !!deckWrite(rb), JSON.stringify([rb.code, rb.error]));
} else shallowSkip('sap153 B6 HEAD-FAIL', '需要 v6.466 commit');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【D】錦標賽區塊 28 把鎖重釘');
{
  const tail = revertV154(CUR.slice(CUR.indexOf(TAIL_ANCHOR))), tev = revertV154(CUR.slice(CUR.indexOf(TEV_ANCHOR)));
  ok('★★[D1] 現行區塊（剝掉 v1.54 之後）指紋 ＝ NEW_*_V153（tail／tev／len）', sha(tail) === NEW_TAIL_SHA_V153 && sha(tev) === NEW_TEV_SHA_V153 && tev.length === NEW_TEV_LEN_V153);
  const rt = revertV153(tail), rv = revertV153(tev);
  ok('★★★[D2] revertV153 之後逐位元回到 v1.52 的值', sha(rt) === OLD_TAIL_SHA_V152 && sha(rv) === OLD_TEV_SHA_V152 && rv.length === OLD_TEV_LEN_V152);
  const mut = tail.replace('⭐v1.53 完整規則（/register）', '⭐v1.53 完整規則（/registeR）');
  ok('[D3] 自驗：本版區塊改一個字元 ⇒ 指紋對不上（D1 不是恆真式）', mut !== tail && sha(mut) !== NEW_TAIL_SHA_V153);
  // D4 v1.52 舊值零殘留（還原鏈宣告端除外）
  const EXEMPT = new Set(['scripts/lib/tourn-revert-v152.mjs', 'scripts/lib/tourn-revert-v153.mjs']);
  const stale = [];
  const walk = (dir) => { for (const n of rdir(dir)) { const fp = join(dir, n);
    if (statSync(fp).isDirectory()) { walk(fp); continue; }
    if (!n.endsWith('.mjs')) continue;
    const rel = fp.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
    if (EXEMPT.has(rel)) continue;
    const s = readFileSync(fp, 'utf8');
    if (s.includes(OLD_TAIL_SHA_V152) || s.includes(OLD_TEV_SHA_V152)) stale.push(rel);
  } };
  walk(join(ROOT, 'scripts'));
  ok('★★[D4] v1.52 的舊指紋零殘留（28 把鎖全部重釘）', OLD_TAIL_SHA_V152 !== NEW_TAIL_SHA_V153 && stale.length === 0, stale.join(', '));
  const CONSUMERS = ['scripts/test-v6276-deck-tournament-stats.mjs', 'scripts/test-v6291-tourn-verified-gate.mjs', 'scripts/test-v6292-tourn-verified-gate2.mjs',
    'scripts/test-v6303-ui-batch.mjs', 'scripts/test-v6381-archive-gamedraw-and-swiss-note.mjs'];
  const bad = CONSUMERS.filter((f) => { const s = rd(f); return !(/from '\.\/lib\/tourn-revert-v15\d\.mjs'/.test(s) && /revert(?:Admin)?V153\(/.test(s)); });
  ok('★★[D5] 五支消費者都 import 新 lib 且呼叫 v1.53 的還原器', bad.length === 0, bad.join(', '));
  ok('★[D5b] test-v6303 的 SAP 還原鏈最內層是 revertAdminV153', /revertAdminV152\(revertAdminV153\((?:SAP_RAW|revertAdminV15\d\()/.test(rd('scripts/test-v6303-ui-batch.mjs')));
}

console.log(`\n=== server patch v1.53 錦標賽報名牌組完整規則: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END sap153-tourn-deck-validate ===');
process.exit(fail ? 1 : 0);
