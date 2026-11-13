// v6.640 守衛：回合開始防誤觸——「你的回合」橫幅那 1 秒內點招式按鈕不算數
//
// 由來：錦標賽 evt_mwcx3he43kc3_r1_m1，玩家回報「對手換上土龍節節ex 後，我都還沒動，系統就自動打出第一招」。
//   伺服器紀錄：輪到他 0.79 秒後就收到「貪心之牙」。全站送出 ATTACK 的入口查過沒有自動出招；
//   最可疑的是回合開始 1.5 秒的「你的回合」橫幅（蓋滿畫面、看起來像彈出視窗，但 pointer-events:none，
//   點它的那一下會穿透到底下剛出現的招式按鈕）。站長選擇：橫幅期間招式鈕不接受點擊。
//
// 【A】中央判準 attackClickGuarded（src/lib/game/turn-start-guard.ts）：邊界逐點
// 【B】+page.svelte 接線（剝註解後）：
//   B1 initiateAttack 在 canAct 檢查之後、取招式之前就問 attackClickGuarded，擋下時只關橫幅並 return
//   B2 已宣告的招式（attackGatePendingFor 有值）不擋——重新打開選擇視窗照常
//   B3 回合切換時：只有「輪到自己而且真的顯示了橫幅」才記時間；否則記 null（背景分頁回來不擋）
//   B4 玩家能出招的入口（桌機招式鈕、招式清單視窗、手機版選單）全部經過 initiateAttack；
//      頁面送 ATTACK（type: 'ATTACK' 與 GameActions.attack( 兩種寫法）只出現在白名單位置（initiateAttack 與只能由它打開的選擇視窗）
//   B5 判準只有一份：+page.svelte 不可自己寫 1000ms／TURN_START_ATTACK_GUARD_MS 的比較
// 【H】HEAD-FAIL：BASE（v6.639）上 A、B 逐條紅
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'f697be88';   // v6.639（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 300) : '')); } };
const MISSING = Symbol('missing');

async function loadLeaf(src) {
  if (src == null) return null;
  const E = join(ROOT, `.v6640-${process.pid}-e.ts`), O = join(ROOT, `.v6640-${process.pid}-o.mjs`);
  process.on('exit', () => { for (const p of [E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
  writeFileSync(E, src);
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' });
  return import(pathToFileURL(O).href + '?t=' + Date.now());
}

function checkA(M, tag) {
  const f = typeof M?.attackClickGuarded === 'function' ? M.attackClickGuarded : () => MISSING;
  const T = 1_800_000_000_000;
  ok(`★★★ A1${tag} 剛輪到自己（0ms、500ms、999ms）⇒ 擋`, f(T, T) === true && f(T, T + 500) === true && f(T, T + 999) === true);
  ok(`★★ A2${tag} 1000ms 以後 ⇒ 不擋（不影響正常出招）`, f(T, T + 1000) === false && f(T, T + 60_000) === false);
  ok(`★★ A3${tag} 沒有顯示橫幅（null）⇒ 不擋；時間倒退／非數字 ⇒ 不擋`, f(null, T) === false && f(T, T - 1) === false && f(NaN, T) === false && f(T, NaN) === false);
  ok(`★ A4${tag} 常數 TURN_START_ATTACK_GUARD_MS ＝ 1000（不超過橫幅 1500ms）`, M?.TURN_START_ATTACK_GUARD_MS === 1000);
}

function sliceFn(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return '';
}

function checkB(pageRaw, mobileRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const mobile = stripCommentsBlankChecked(normEol(mobileRaw), 'svelte');
  const ia = sliceFn(page, 'function initiateAttack(attackIndex: number)');
  ok(`前提${tag} 抓得到 initiateAttack 函式本體`, ia.length > 1500 && ia.length < 20000, ia.length);
  const iCan = ia.indexOf('if (!canAct) return;'), iG = ia.indexOf('attackClickGuarded(myTurnShownAt, Date.now())'), iEff = ia.indexOf('getEffectiveAttacks(');
  const gateLine = iG >= 0 ? ia.slice(iG, ia.indexOf('}', iG) + 1) : '';
  ok(`★★★ B1${tag} canAct 之後、取招式之前就擋；擋下時只關橫幅並 return`, iCan > 0 && iG > iCan && iEff > iG && /turnBanner\s*=\s*null;\s*return;/.test(gateLine), JSON.stringify({ iCan, iG, iEff, gateLine: gateLine.slice(0, 200) }));
  ok(`★★ B2${tag} 已宣告的招式不擋（attackGatePendingFor(...) == null 才擋）`, /attackClickGuarded\(myTurnShownAt, Date\.now\(\)\)\s*&&\s*attackGatePendingFor\(game, game\.activePlayerIndex\)\s*==\s*null/.test(ia));
  const eff = (() => { const i = page.indexOf('let _prevTurnPlayerIdx = -1;'); return i < 0 ? '' : page.slice(i, i + 1600); })();
  ok(`★★★ B3${tag} 只有「輪到自己且顯示了橫幅」才記時間，否則 null`, /myTurnShownAt\s*=\s*\(isMine\s*&&\s*_showBanner\)\s*\?\s*ts\s*:\s*null;/.test(eff) && /if \(_showBanner\) turnBanner = \{ text, timestamp: ts \};/.test(eff), eff.slice(0, 400));
  const btnOk = /onclick=\{\(\)=>initiateAttack\(i\)\}/.test(page);
  const listOk = /onclick=\{\(\)=>\{ attackListPicker = null; initiateAttack\(it\.i\); \}\}/.test(page);
  const mobOk = /onInitiateAttack=\{initiateAttack\}/.test(page) && /onInitiateAttack\(i\)/.test(mobile);
  // ⭐（審查 P2-1）頁面送 ATTACK 有兩種寫法：`type: 'ATTACK'` 字面與 `GameActions.attack(`；兩種都要數。
  //   允許的位置（白名單）：script 段只能在 initiateAttack 與「只能由 initiateAttack 打開的選擇視窗」的確認函式裡；
  //   樣板段只能在 preAttackDiscard 視窗（同樣只能由 initiateAttack 打開）裡。白名單以外出現 ⇒ 可能繞過 1 秒防護 ⇒ 紅。
  const SCRIPT_OK = new Set(['initiateAttack', 'finishBorrowChain', 'skipRocketCommand', 'confirmPreAttackDiscard']);
  const scriptEnd = page.indexOf('<' + '/script>');
  const sites = [...page.matchAll(/GameActions\.attack\(|type: 'ATTACK'/g)].map((m) => {
    const pre = page.slice(0, m.index);
    if (m.index < scriptEnd) {
      const fns = [...pre.matchAll(/function (\w+)\(/g)];
      const fn = fns.length ? fns[fns.length - 1][1] : '?';
      return { where: 'fn:' + fn, ok: SCRIPT_OK.has(fn) };
    }
    const win = pre.split('\n').slice(-120).join('\n');
    return { where: 'tpl', ok: /\{#if preAttackDiscard\b/.test(win) };
  });
  const bad = sites.filter((x) => !x.ok).map((x) => x.where);
  const iaAttackDispatch = (ia.match(/GameActions\.attack\(|type: 'ATTACK'/g) || []).length;
  ok(`★★ B4${tag} 桌機招式鈕／招式清單／手機選單都經過 initiateAttack；頁面送 ATTACK 的位置全在白名單內（共 ${sites.length} 處）`, btnOk && listOk && mobOk && scriptEnd > 0 && sites.length >= 8 && bad.length === 0 && iaAttackDispatch >= 2 && !/GameActions\.attack\(|type: 'ATTACK'/.test(mobile), JSON.stringify({ btnOk, listOk, mobOk, n: sites.length, bad, iaAttackDispatch }));
  ok(`★ B5${tag} 判準只有一份（頁面沒有自己比 1000ms）`, iG > 0 && !/TURN_START_ATTACK_GUARD_MS/.test(page) && !/myTurnShownAt\s*[<>]=?|Date\.now\(\)\s*-\s*myTurnShownAt/.test(page));
}

const PAGE = 'src/routes/game/+page.svelte', MOB = 'src/routes/game/MobilePortraitBattle.svelte', LEAF = 'src/lib/game/turn-start-guard.ts';
console.log('【A】中央判準');
checkA(await loadLeaf(readFileSync(join(ROOT, LEAF), 'utf8')), '');
console.log('【B】+page.svelte 接線');
checkB(readFileSync(join(ROOT, PAGE), 'utf8'), readFileSync(join(ROOT, MOB), 'utf8'), '');

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const blob = (p) => { try { return execFileSync('git', ['-C', ROOT, 'cat-file', '-p', `${BASE_SHA}:${p}`], { maxBuffer: 1 << 28 }).toString(); } catch { return null; } };
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(s);
  checkA(await loadLeaf(blob(LEAF)), '@BASE');
  checkB(blob(PAGE) ?? '', blob(MOB) ?? '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 40));
  const bPass = pass - before; pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 A1／A2／A3／A4／B1／B2／B3／B5 都紅（本版新加的判準與接線在 BASE 不存在）', ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B5'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  ok('★★ H2 BASE 上「前提」與 B4（入口都經過 initiateAttack）照樣綠（正對照：掃描器沒壞）', !reds.some((r) => r.includes('前提') || r.includes('B4')) && bPass >= 2, `${bPass} ${reds}`);
}
console.log(`=== v6.640 回合開始防誤觸：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
