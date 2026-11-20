// Google 登入／綁定：實際共用流程、Svelte 同物件更新、過期雲端回應及版面。
import assert from 'node:assert/strict';
import { readFileSync as rawReadFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { pwLaunch } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { revertV6651IfPresent, V6651_PAIRS } from './lib/revert-v6651-google-auth.mjs';
import { revertV6652IfPresent } from './lib/revert-v6652-google-management.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Rule 40：本版只還原 v6.652 合法新增層，再執行原 v6.651 判準／突變。
function readFileSync(path, encoding) {
  const value = rawReadFileSync(path, encoding);
  return typeof value === 'string' ? revertV6652IfPresent(relative(ROOT, path).replace(/\\/g, '/'), value) : value;
}
const BASE = 'a84cdd89679c07253d8dd7d841764d53f5aac89e';
const SNAP_V6666 = '3075b04ce2e3de6fc55288452f03d8fa8fab488c';
const CORE = 'src/lib/auth/google-flow.ts';
const PAGES = ['src/routes/game/+page.svelte', 'src/routes/decks/+page.svelte'];
const tmp = mkdtempSync(join(tmpdir(), 'ptcg-google6651-'));
let pass = 0, fail = 0, serial = 0;
const T = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } };
const account = (uid = 'anon', anonymous = true, providers = []) => ({ uid, isAnonymous: anonymous, email: anonymous ? null : 'member@example.test', providerData: providers.map(providerId => ({ providerId })) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function moduleFrom(source) {
  const output = join(tmp, 'core' + (++serial) + '.mjs');
  await build({ stdin: { contents: source, loader: 'ts' }, outfile: output, platform: 'node', format: 'esm', logLevel: 'silent', tsconfigRaw: {} });
  return import(pathToFileURL(output).href);
}
function adapter(M, initial, popup) {
  const state = { current: initial, busy: [], changed: [], fallback: 0, links: [] };
  const run = M.createGoogleFlow({ currentUser: () => state.current,
    popup: (u, link) => { state.links.push(link); return popup(state, u, link); },
    credential: e => e.credential ?? null,
    signInCredential: async credential => { state.fallback++; state.current = credential.user; return state.current; },
    busy: value => state.busy.push(value), changed: u => state.changed.push(u.uid) });
  return { run, state };
}
const cases = {
  async A1(M) { // 匿名升級保留 UID、牌組／報名身分不換掉
    const u = account(); const { run, state } = adapter(M, u, async (s, user, link) => {
      assert.equal(link, true); user.isAnonymous = false; user.providerData.push({ providerId: 'google.com' }); return user;
    });
    assert.equal((await run()).uid, 'anon'); assert.deepEqual(state.changed, ['anon']); assert.deepEqual(state.busy, [true, false]);
  },
  async A2(M) { // 沒有匿名身分時可正常登入
    const u = account('google', false, ['google.com']); const { run, state } = adapter(M, null, async (s, _, link) => { assert.equal(link, false); s.current = u; return u; });
    assert.equal(await run(), u); assert.deepEqual(state.changed, ['google']);
  },
  async A3(M) { // 只有匿名碰撞可以用已驗證 credential 回到既有 Google 帳號
    const u = account('existing', false, ['google.com']); const { run, state } = adapter(M, account(), async () => { throw { code: 'auth/credential-already-in-use', credential: { user: u } }; });
    assert.equal(await run(), u); assert.equal(state.fallback, 1);
  },
  async A4(M) { // 正式會員綁定碰撞：不切換、不合併，不論是否傳 linkOnly 都受保護
    for (const linkOnly of [true, false]) {
      const u = account('password', false, ['password']); const { run, state } = adapter(M, u, async () => { throw { code: 'auth/credential-already-in-use', credential: { user: account('other') } }; });
      await assert.rejects(run(linkOnly), e => e.code === 'auth/credential-already-in-use'); assert.equal(state.current, u); assert.equal(state.fallback, 0);
    }
  },
  async A5(M) { // 同一次點擊就呼叫 popup；互斥不開第二個視窗
    const wait = deferred(); let calls = 0; const { run, state } = adapter(M, account(), () => { calls++; return wait.promise; });
    const pending = run(); assert.equal(calls, 1); const duplicate = run();
    wait.resolve(state.current); await pending; await assert.rejects(duplicate, e => e.code === 'google/busy'); assert.equal(calls, 1); assert.deepEqual(state.busy, [true, false]);
  },
  async A6(M) { // 外部換帳號／link 回傳另一個 UID 都拒絕完成
    const u = account('member', false, ['password']); const { run, state } = adapter(M, u, async s => { s.current = account('other', false); return s.current; });
    await assert.rejects(run(true), e => e.code === 'google/account-changed'); assert.equal(state.changed.length, 0);
    const x = adapter(M, account(), async s => { s.current = account('unexpected'); return u; });
    await assert.rejects(x.run(), e => e.code === 'google/account-changed');
  },
  async A7(M) { // 取消不留 busy，且沒有憑證時不偷偷切帳號
    for (const code of ['auth/popup-closed-by-user', 'auth/popup-blocked', 'auth/credential-already-in-use']) {
      const { run, state } = adapter(M, account(), async () => { throw { code }; });
      await assert.rejects(run(), e => e.code === code); assert.equal(state.fallback, 0); assert.deepEqual(state.busy, [true, false]);
    }
  },
  async A8(M) { // 密碼入口依 provider；同一個 User 改成 Google 後重讀 email/provider
    const u = account(); const before = M.authUiState(u, 0); u.isAnonymous = false; u.email = 'google@example.test'; u.providerData.push({ providerId: 'google.com' });
    const after = M.authUiState(u, 1); assert.equal(before.isAnonymous, true); assert.equal(after.isAnonymous, false); assert.equal(after.email, u.email); assert.equal(after.password, false); assert.equal(after.google, true);
    u.providerData.push({ providerId: 'password' }); assert.equal(M.authUiState(u, 2).password, true);
  },
  async A9(M) { // A 舊請求成功／失敗都不蓋 B；相同 UID 第二輪亦使第一輪失效
    let uid = 'A'; const epoch = M.createAuthGeneration(() => uid); const wait = deferred(); const old = epoch.begin(uid); let decks = 'A-local';
    const pending = wait.promise.then(() => { if (old()) decks = 'A-cloud'; }, () => { if (old()) decks = 'A-fallback'; });
    uid = 'B'; const newer = epoch.begin(uid); decks = 'B-cloud'; wait.resolve(); await pending; assert.equal(decks, 'B-cloud'); assert.equal(newer(), true); assert.equal(old(), false);
    const again = epoch.begin(uid); assert.equal(newer(), false); assert.equal(again(), true); epoch.invalidate(); assert.equal(again(), false);
    const stale = epoch.begin('A'); assert.equal(stale(), false);
    const bad = deferred(), check = epoch.begin(uid); const rejected = bad.promise.catch(() => { if (check()) decks = 'wrong'; }); uid = 'C'; bad.reject(); await rejected; assert.equal(decks, 'B-cloud');
  },
  async A10(M) { // 錯誤訊息不吐出 token／原始 exception
    for (const code of ['auth/popup-blocked', 'auth/unauthorized-domain', 'auth/account-exists-with-different-credential', 'auth/email-already-in-use', 'auth/user-disabled']) {
      assert.ok(M.googleAuthError({ code }).length > 5);
    }
    assert.ok(!M.googleAuthError({ code: 'secret-token', message: 'secret-token' }).includes('secret-token'));
  },
};
function wiring(raw, name) {
  const s = stripCommentsBlankChecked(raw.replace(/\r\n/g, '\n'), 'svelte');
  const isGame = name.includes('/game/');
  return {
    F1: s.includes('authUiState(firebaseUser, $googleAuthRevision)') && s.includes('email={accountAuthState.email}') && s.includes('accountAuthState.password ? openChangePasswordModal : undefined'),
    F2: /let authInitializing = \$state\(true\)/.test(s) && [...s.matchAll(/<GoogleAuthButton[^>]*disabled=\{([^}]+)\}/g)].length >= (isGame ? 3 : 1) && [...s.matchAll(/<GoogleAuthButton[^>]*disabled=\{([^}]+)\}/g)].every(m => m[1].includes('authInitializing')),
    F3: s.includes('authGeneration.begin(') && s.includes('authGeneration.invalidate()') && s.split('if (!authCurrent()) return;').length >= (isGame ? 4 : 6),
    ...(isGame ? { F4: s.includes('isTournament && firebaseUser && !isAnonymous && tStep') && s.includes('!isTournament && firebaseUser && !isAnonymous)') && s.includes('!isTournament || _pushSubDone || !u || isAnonymous') && s.includes('!isAnonymous && accountAuthState.email') && s.includes('<GoogleAuthButton user={firebaseUser} wide disabled={authInitializing || tBusy || cpLoading}') } : {}),
    P1: s.includes('async function loginWithEmail()') && s.includes('signInWithEmailAndPassword') && s.includes('async function submitChangePassword()'),
  };
}
let source = existsSync(join(ROOT, CORE)) ? normEol(readFileSync(join(ROOT, CORE), 'utf8')) : '';
const M = source ? await moduleFrom(source) : null;
for (const [name, test] of Object.entries(cases)) await T(name, async () => { assert.ok(M, '共用登入模組不存在'); await test(M); });
for (const page of PAGES) for (const [k, value] of Object.entries(wiring(readFileSync(join(ROOT, page), 'utf8'), page))) await T(k + ' ' + page, () => assert.equal(value, true));

// 抽出兩頁真正的 auth observer，僅注入 Firebase／雲端邊界，驗證 guard 實際接在 await 後。
async function observerFrom(raw, game) {
  const start = raw.indexOf(game ? '_unsubAuth = onAuthStateChanged(auth,' : 'const unsubAuth = onAuthStateChanged(auth,');
  const end = raw.indexOf(game ? '// v4.984: 刪掉冗餘 sign-in block' : '// v5.114：beforeunload', start);
  assert.ok(start >= 0 && end > start, '實際 observer 範圍');
  const observer = raw.slice(start, end);
  return moduleFrom(source + `\nexport function observerFixture(api){
let callback;const onAuthStateChanged=(auth,cb)=>{callback=cb;return()=>{};};
const {auth,cloudDecksUnchanged,loadDecksFromCloud,syncDeckToCloud}=api;
const authGeneration=createAuthGeneration(()=>auth.currentUser?.uid??null);
const loadDecks=()=>[{id:auth.currentUser.uid,updatedAt:1}];const sortDecks=x=>x;
const withTimeout=p=>p;const saveDecks=x=>{};const recordCloudDecksRev=async()=>{};const bumpCloudDecksRev=async()=>{};
const signInAnonymously=api.signInAnonymously??(async()=>{});const newDeck=()=>({id:'first'});const upsertDeck=x=>[x];const setDirty=()=>{};
let firebaseUser=null,authInitializing=true,tAuthResolved=false,myUid=null,_unsubAuth,activeId='',decks=[],syncStatus='idle';const ORACLE_MODE=false;let isAdminMode=false;
${observer}
return {run:callback,get:()=>({decks,activeId,syncStatus,authInitializing}),dispose:()=>authGeneration.invalidate()};
}`);
}
async function staleObserver(raw, game, rejected = false) {
  const factory = await observerFrom(raw, game); const wait = deferred(); const auth = {currentUser:account('A',false,['password'])};
  const x = factory.observerFixture({auth,cloudDecksUnchanged:uid=>uid==='A'?wait.promise:Promise.resolve(!game),loadDecksFromCloud:async uid=>game&&uid==='B'?[{id:'B-cloud',updatedAt:2}]:[],syncDeckToCloud:async()=>{}});
  const old = x.run(auth.currentUser); auth.currentUser=account('B',false,['google.com']); await x.run(auth.currentUser);
  if(rejected)wait.reject(new Error('舊連線失敗'));else wait.resolve(false); await old;
  assert.equal(x.get().decks.some(d=>d.id===(game?'B-cloud':'B')),true); assert.equal(x.get().syncStatus,game?'idle':'synced');
}
for (const page of PAGES) for (const rejected of [false,true]) await T('G 真實 observer '+page+(rejected?' 舊請求失敗':' 舊請求成功'),()=>staleObserver(readFileSync(join(ROOT,page),'utf8'),page.includes('/game/'),rejected));
async function bootstrapObserver(raw, game, rejected = false) {
  const factory = await observerFrom(raw, game); const wait = deferred(); const auth = {currentUser:null}; let calls=0;
  const x = factory.observerFixture({auth,signInAnonymously:()=>{calls++;return wait.promise;}});
  const pending=x.run(null);
  try { assert.equal(calls,1); assert.equal(x.get().authInitializing,true,'匿名請求未完成不可提前解除'); }
  finally { if(rejected)wait.reject(new Error('匿名登入失敗'));else wait.resolve(); await pending; }
  assert.equal(x.get().authInitializing,false,'匿名初始化成功或失敗後應解除');
}
for(const page of PAGES) {
  const raw=normEol(readFileSync(join(ROOT,page),'utf8'));
  for(const rejected of [false,true]) await T('G bootstrap '+page+(rejected?' 失敗':' 成功')+' 必須等真實 observer await 完成',()=>bootstrapObserver(raw,page.includes('/game/'),rejected));
  await T('M8 '+page+' 提前解除匿名初始化必須被攔下',async()=>{
    const needle='authInitializing = true;\n        try { await signInAnonymously(auth); }';assert.equal(raw.split(needle).length,2);
    await assert.rejects(bootstrapObserver(raw.replace(needle,()=>needle.replace('= true','= false')),page.includes('/game/')));
  });
}

// 突變直接替換實際產品模組，再跑對應行為斷言，不能只測 fixture 的假函式。
const mutations = [
  ['M1 匿名改成 signin', 'const link = linkOnly || !!initial?.isAnonymous;', 'const link = linkOnly;', 'A1'],
  ['M2 正式會員碰撞也切帳號', '!linkOnly && initial?.isAnonymous && code', 'code', 'A4'],
  ['M3 取消全域互斥', "if (running) throw { code: 'google/busy' };", '', 'A5'],
  ['M4 丟失 finally busy 清理', 'api.busy(false);', '', 'A7'],
  ['M5 Google-only 誤顯示改密碼', "p.providerId === 'password'", "p.providerId === 'google.com'", 'A8'],
  ['M6 舊雲端回應漏 UID 及世代檢查', 'ticket === generation && currentUid() === uid', 'true', 'A9'],
  ['M7 綁定可切 UID', "if (linkOnly && user.uid !== initial?.uid) throw { code: 'google/account-changed' };", '', 'A6'],
];
for (const [name, needle, replacement, test] of mutations) await T(name, async () => {
  assert.equal(source.split(needle).length, 2, '突變錨點必須唯一');
  const mutant = await moduleFrom(source.replace(needle, () => replacement)); let killed = false;
  try { await cases[test](mutant); } catch { killed = true; } assert.ok(killed, '存活突變');
});

console.log('【HEAD-FAIL 與正對照】');
if (!hasBaseCommit(ROOT, BASE) || !hasBaseCommit(ROOT, SNAP_V6666)) shallowSkip('v6651 BASE ' + BASE + ' / SNAP ' + SNAP_V6666.slice(0, 8));
else {
for(const path of Object.keys(V6651_PAIRS)) await T('R 逐字還原且 BASE 不變 '+path,()=>{const old=readBaseBlob(ROOT,BASE,path);const snap=readBaseBlob(ROOT,SNAP_V6666,path);assert.ok(old.ok&&snap.ok);const baseline=old.out.replace(/\r\n/g,'\n');assert.equal(revertV6651IfPresent(path,snap.out.replace(/\r\n/g,'\n')),baseline);assert.equal(revertV6651IfPresent(path,baseline),baseline);});
for (const page of PAGES) {
  const old = readBaseBlob(ROOT, BASE, page); assert.ok(old.ok);
  const before = wiring(old.out, page), after = wiring(readFileSync(join(ROOT, page), 'utf8'), page);
  for (const k of ['F1', 'F2', 'F3', ...(page.includes('/game/') ? ['F4'] : [])]) await T('H ' + page + ' ' + k + ' 逐條 BASE 紅／HEAD 綠', () => { assert.equal(before[k], false); assert.equal(after[k], true); });
  await T('P ' + page + ' 舊 Email／密碼流程兩版均在', () => { assert.ok(before.P1); assert.ok(after.P1); });
  for(const rejected of [false,true]) await T('H 真實 observer '+page+(rejected?' 舊錯誤分支':' 舊成功分支')+' BASE 紅',async()=>{await assert.rejects(staleObserver(old.out,page.includes('/game/'),rejected));});
}
}

async function browserChecks(browser) {
  // 只替換 Firebase 網路邊界；Google 按鈕、帳號列、流程、store、Svelte 編譯皆用產品程式。
  const sdk = join(tmp, 'sdk.js'), firebase = join(tmp, 'firebase.js'), fixture = join(tmp, 'Fixture.svelte');
  writeFileSync(sdk, `export class GoogleAuthProvider { setCustomParameters(x){window.h.parameters=x;} static credentialFromError(e){return e.credential??null;} }
export function linkWithPopup(user,p){window.h.popupCalls++;window.h.lastLink=true;return window.h.popup(user,true).then(user=>({user}));}
export function signInWithPopup(auth,p){window.h.popupCalls++;window.h.lastLink=false;return window.h.popup(auth.currentUser,false).then(user=>({user}));}
export async function signInWithCredential(auth,c){auth.currentUser=c.user;return {user:c.user};}`);
  writeFileSync(firebase, 'export const auth=window.h.auth;');
  writeFileSync(fixture, `<script>
import GoogleAuthButton from '$lib/auth/GoogleAuthButton.svelte';
import AccountBar from '$lib/ui/AccountBar.svelte';
import {authUiState,googleAuthRevision,googleAuthBusy} from '$lib/auth/google-auth';
let user=$state.raw(window.h.auth.currentUser);let initializing=$state(true);let modal=$state(true);
const snapshot=$derived(authUiState(user,$googleAuthRevision));
$effect(()=>{if(!snapshot.isAnonymous)window.h.authenticatedEffects++;});
window.h.ready=()=>{initializing=false;};window.h.member=(u)=>{window.h.auth.currentUser=u;user=u;};
function complete(u){user=u;modal=false;window.h.completed++;}
</script>
<AccountBar email={snapshot.email} anonymous={snapshot.isAnonymous} busy={initializing||$googleAuthBusy} googleUser={user} onGoogleComplete={complete} onCreateAccount={()=>modal=true} onSignOut={()=>{}} onChangePassword={snapshot.password?()=>{}:undefined}/>
{#if modal}<div role="dialog"><h3>帳號管理</h3><GoogleAuthButton {user} wide disabled={initializing} oncomplete={complete}/><button class="close" onclick={()=>modal=false}>關閉</button></div>{/if}
<button class="open" onclick={()=>modal=true}>開啟登入</button>`);
  const compiled = await build({ stdin: { contents: `import {mount} from 'svelte';import F from ${JSON.stringify(fixture)};mount(F,{target:document.body});`, resolveDir: ROOT }, bundle: true, write: false, format: 'iife', conditions: ['browser'], nodePaths: [join(ROOT, 'node_modules')], tsconfigRaw: {}, logLevel: 'silent',
    alias: { '$lib/firebase': firebase, 'firebase/auth': sdk, '$lib': join(ROOT, 'src/lib') },
    plugins: [{ name: 'actual-svelte', setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]lib[\\/]auth[\\/].*\.ts$/ }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'ts', resolveDir: join(args.path, '..') }));
      b.onLoad({ filter: /\.svelte$/ }, args => ({ contents: compile(readFileSync(args.path, 'utf8'), { generate: 'client', css: 'injected', filename: args.path }).js.code, loader: 'js', resolveDir: join(args.path, '..') }));
    } }] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage();
  try {
    await pg.route('https://auth-fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:8px}button{font:inherit}</style>' }));
    await pg.goto('https://auth-fixture.invalid/game?mode=online&tab=match#deck');
    await pg.evaluate(() => { window.h = { auth: { currentUser: { uid: 'same-user', isAnonymous: true, email: null, providerData: [] } }, authenticatedEffects: 0, completed: 0, popupCalls: 0, popup: async user => { user.isAnonymous = false; user.email = 'google@example.test'; user.providerData.push({providerId:'google.com'}); return user; } }; });
    await pg.addScriptTag({ content: compiled.outputFiles[0].text });
    const original = pg.url();
    await T('B0 錦標賽寬版 Google 按鈕：390／1376 置中且寬度不超過 360',async()=>{
      for(const width of [390,1376]){await pg.setViewportSize({width,height:844});const b=await pg.locator('.google-signin').boundingBox();assert.ok(b&&Math.abs(b.x+b.width/2-width/2)<=1&&b.width<=360&&b.height>=40,JSON.stringify(b));}
      await pg.setViewportSize({width:390,height:844});
    });
    await T('B1 UI 初始化旗標為 true 時 Google 按鈕 disabled，無 popup', async () => { assert.equal(await pg.locator('.google-signin').isDisabled(), true); assert.equal(await pg.evaluate(() => window.h.popupCalls), 0); });
    await pg.evaluate(() => window.h.ready()); await pg.locator('.google-signin').click(); await pg.waitForSelector('.acct .auth-email');
    await T('B2 同 User 同 UID 升級，Email／effect／Google-only 密碼入口立即更新，原頁 query/hash 保留', async () => {
      await pg.waitForFunction(() => window.h.authenticatedEffects === 1 && window.h.completed === 1);
      assert.ok((await pg.locator('.auth-email').innerText()).includes('google@example.test')); assert.equal(await pg.getByText('🔑 更改密碼', { exact: true }).count(), 0);
      assert.equal(await pg.locator('[role=dialog]').count(), 0); assert.equal(pg.url(), original); assert.equal(await pg.evaluate(() => window.h.lastLink), true);
    });
    await pg.evaluate(() => window.h.member({uid:'email-member',isAnonymous:false,email:'long-account-name@example.test',providerData:[{providerId:'password'}]}));
    await pg.waitForSelector('.acct .google-signin');
    await T('B3 Email 會員可綁 Google，保留更改密碼，手機／桌機按鈕無橫向溢出', async () => {
      assert.equal(await pg.getByText('🔑 更改密碼', {exact:true}).count(), 1);
      for (const width of [320, 390, 768, 1376]) { await pg.setViewportSize({width,height:844}); assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), String(width)); }
    });
    await pg.locator('.acct .google-signin').click(); await pg.waitForSelector('text=Google 已綁定');
    await T('B4 綁定保留原會員 UID、原頁且不抹除 password provider', async () => { assert.equal(await pg.evaluate(() => window.h.auth.currentUser.uid), 'email-member'); assert.equal(await pg.getByText('🔑 更改密碼',{exact:true}).count(),1); assert.equal(pg.url(),original); });
    await pg.locator('.open').click(); await pg.evaluate(() => { window.h.popup=async()=>{throw {code:'auth/popup-closed-by-user'};}; });
    await pg.locator('[role=dialog] .google-signin').click(); await pg.waitForSelector('[role=alert]');
    await T('B5 取消 Google 保留登入框／原頁，解除 busy 可再按', async () => { assert.ok((await pg.locator('[role=alert]').innerText()).includes('已取消')); assert.equal(await pg.locator('[role=dialog] .google-signin').isDisabled(),false); assert.equal(pg.url(),original); });
    if (process.env.V6651_SHOT) await pg.screenshot({path:process.env.V6651_SHOT,fullPage:true});
  } finally { await ctx.close(); }
}
try { const browser = await pwLaunch('v6651 Google 登入實際 Svelte 元件'); if (browser) try { await browserChecks(browser); } finally { await browser.close(); } }
catch (e) { fail++; console.log('FAIL B 瀏覽器驗收: ' + e.stack); }
finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`=== v6.651 Google 登入：${pass} PASS / ${fail} FAIL ===`);
process.exitCode = fail ? 1 : 0;
