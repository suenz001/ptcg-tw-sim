// v6.652：實際 Google 管理流程、SDK 接線及 Svelte 視窗；Firebase 網路邊界以 stub 隔離。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { pwLaunch } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { revertV6652IfPresent, V6652_PAIRS } from './lib/revert-v6652-google-management.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'b8bf25ce5db187f2feac0c04ea1be3446cd01759';
const CORE = 'src/lib/auth/google-flow.ts';
const tmp = mkdtempSync(join(tmpdir(), 'ptcg-google6652-'));
let pass = 0, fail = 0, serial = 0;
const T = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } };
const wait = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const member = (password = true, google = true) => ({ uid: 'A', isAnonymous: false, email: 'BBB@gmail.com', decks: ['saved'], wins: 7,
  providerData: [...(password ? [{providerId:'password',email:'AAA@yahoo.com'}] : []), ...(google ? [{providerId:'google.com',uid:'google-B',email:'BBB@gmail.com'}] : [])] });
async function moduleFrom(source) {
  const fp = join(tmp, 'core-' + (++serial) + '.mjs');
  await build({stdin:{contents:source,loader:'ts'},outfile:fp,platform:'node',format:'esm',tsconfigRaw:{},logLevel:'silent'});
  return import(pathToFileURL(fp).href);
}
function adapter(M, user = member(), hooks = {}) {
  const s = {current:user,reauth:[],unlinks:0,popups:0,changes:[],busy:[]};
  const run = M.createGoogleFlow({currentUser:()=>s.current,
    popup:async u=>{s.popups++;return hooks.popup ? hooks.popup(s,u) : u;}, credential:()=>null, signInCredential:async()=>{throw Error('不應切帳號');},
    busy:v=>s.busy.push(v),changed:u=>s.changes.push(u.uid),
    reauthenticate:async(u,email,password)=>{s.reauth.push({uid:u.uid,email,password});if(hooks.reauth)await hooks.reauth(s,u);},
    unlink:async u=>{s.unlinks++;if(hooks.unlink)return hooks.unlink(s,u);u.providerData=u.providerData.filter(p=>p.providerId!=='google.com');return u;}});
  const key=M.authUiState(user).googleKey;
  return {s,run,disconnect:(password='secret',uid='A')=>run.disconnectGoogle(password,uid,key)};
}
const cases = {
  async S1(M) { const x=M.authUiState(member());assert.equal(x.email,'AAA@yahoo.com');assert.equal(x.passwordEmail,'AAA@yahoo.com');assert.equal(x.googleEmail,'BBB@gmail.com');assert.equal(x.differentGoogleEmail,true);assert.equal(x.canUnlinkGoogle,true); },
  async S2(M) { const u=member();u.providerData[0].email='bbb@GMAIL.com';const x=M.authUiState(u);assert.equal(x.differentGoogleEmail,false);assert.equal(x.google,true);assert.equal(x.canUnlinkGoogle,true); },
  async S3(M) { const x=M.authUiState(member(false));assert.equal(x.passwordEmail,null);assert.equal(x.differentGoogleEmail,false);assert.equal(x.canUnlinkGoogle,false);assert.equal(x.email,'BBB@gmail.com'); },
  async S4(M) { const u=member();u.providerData[1].uid='google-sub-B';assert.equal(M.authUiState(u).googleKey,'google-sub-B');u.providerData[1].email='new-address@gmail.com';assert.equal(M.authUiState(u).googleKey,'google-sub-B'); },
  async U1(M) { const {s,disconnect}=adapter(M);const u=s.current;assert.equal(await disconnect(),u);assert.deepEqual(s.reauth,[{uid:'A',email:'AAA@yahoo.com',password:'secret'}]);assert.equal(s.unlinks,1);assert.equal(s.current.uid,'A');assert.deepEqual(s.current.decks,['saved']);assert.equal(s.current.wins,7);assert.equal(M.authUiState(u).google,false);assert.equal(M.authUiState(u).password,true);assert.deepEqual(s.busy,[true,false]);assert.deepEqual(s.changes,['A']); },
  async U2(M) { const {s,disconnect}=adapter(M,member(),{reauth:async()=>{throw {code:'auth/wrong-password'};}});await assert.rejects(disconnect(),e=>e.code==='auth/wrong-password');assert.equal(s.unlinks,0);assert.equal(s.current.providerData.length,2);assert.deepEqual(s.busy,[true,false]);assert.deepEqual(s.changes,[]); },
  async U3(M) { const {s,disconnect}=adapter(M,member(false));await assert.rejects(disconnect(),e=>e.code==='google/last-provider');assert.equal(s.reauth.length,0);assert.equal(s.unlinks,0); },
  async U4(M) { const {s,disconnect}=adapter(M);await assert.rejects(disconnect(''),e=>e.code==='google/password-required');assert.equal(s.unlinks,0);assert.equal(s.reauth.length,0); },
  async U5(M) { const {s,disconnect}=adapter(M);await assert.rejects(disconnect('secret','B'),e=>e.code==='google/account-changed');assert.equal(s.reauth.length,0);assert.equal(s.unlinks,0); },
  async U6(M) { const {s,disconnect}=adapter(M,member(),{reauth:async s=>{s.current={...member(),uid:'B'};}});await assert.rejects(disconnect(),e=>e.code==='google/account-changed');assert.equal(s.unlinks,0);assert.deepEqual(s.changes,[]);assert.deepEqual(s.busy,[true,false]); },
  async U7(M) { const {s,disconnect}=adapter(M,member(),{reauth:async(s,u)=>{u.providerData=u.providerData.filter(p=>p.providerId!=='password');}});await assert.rejects(disconnect(),e=>e.code==='google/account-changed');assert.equal(s.unlinks,0); },
  async U8(M) { const gate=wait();const {s,run,disconnect}=adapter(M,member(),{reauth:async()=>gate.promise});const p=disconnect();assert.equal(s.reauth.length,1);const capture=p=>p.then(()=>({code:'resolved'}),e=>e);const p2=capture(run(true));const p3=capture(disconnect());gate.resolve();await p;assert.equal((await p2).code,'google/busy');assert.equal((await p3).code,'google/busy');assert.equal(s.unlinks,1);assert.equal(s.popups,0); },
  async U12(M) { const u=member(),x=adapter(M,u);const key=M.authUiState(u).googleKey;u.providerData[1].uid='google-C';await assert.rejects(x.run.disconnectGoogle('secret','A',key),e=>e.code==='google/account-changed');assert.equal(x.s.reauth.length,0);assert.equal(x.s.unlinks,0); },
  async U13(M) { const x=adapter(M,member(),{reauth:async(s,u)=>{u.providerData[1].uid='google-C';}});await assert.rejects(x.disconnect(),e=>e.code==='google/account-changed');assert.equal(x.s.unlinks,0); },
  async U14(M) { const x=adapter(M,member(true,false));await assert.rejects(x.disconnect(),e=>e.code==='google/not-linked');assert.equal(x.s.reauth.length+x.s.unlinks,0); },
  async U15(M) { const u=member();u.isAnonymous=true;const x=adapter(M,u);await assert.rejects(x.disconnect(),e=>e.code==='google/account-changed');assert.equal(x.s.reauth.length+x.s.unlinks,0); },
  async U16(M) { const x=adapter(M,member(),{unlink:async s=>{s.current={...member(),uid:'B'};return member();}});await assert.rejects(x.disconnect(),e=>e.code==='google/account-changed');assert.deepEqual(x.s.changes,[]); },
  async U17(M) { const gate=wait();const x=adapter(M,member(true,false),{popup:async(s,u)=>{await gate.promise;return u;}});const p=x.run(true);const q=x.disconnect().then(()=>({code:'resolved'}),e=>e);gate.resolve();await p;assert.equal((await q).code,'google/busy');assert.equal(x.s.unlinks,0); },
  async U18(M) { const x=adapter(M,member(),{reauth:async(s,u)=>{u.providerData[1].email='new-name@gmail.com';}});assert.equal((await x.disconnect()).uid,'A');assert.equal(x.s.unlinks,1); },
  async U9(M) { const {s,disconnect}=adapter(M,member(),{unlink:async()=>{throw {code:'auth/network-request-failed'};}});await assert.rejects(disconnect(),e=>e.code==='auth/network-request-failed');assert.equal(s.current.providerData.length,2);assert.deepEqual(s.busy,[true,false]);assert.deepEqual(s.changes,[]); },
  async U10(M) { const {s,disconnect}=adapter(M,member(),{unlink:async()=>({...member(),uid:'B'})});await assert.rejects(disconnect(),e=>e.code==='google/account-changed');assert.deepEqual(s.changes,[]); },
  async U11(M) { const {s,run}=adapter(M);await assert.rejects(run(true,'B'),e=>e.code==='google/account-changed');assert.equal(s.popups,0);assert.equal(await run(true,'A'),s.current);assert.equal(s.popups,0); },
  async P1(M) { const u={uid:'guest',isAnonymous:true,email:null,providerData:[]};const {s,run}=adapter(M,u,{popup:async(s,u)=>{u.isAnonymous=false;u.providerData=[{providerId:'google.com',email:'BBB@gmail.com'}];u.email='BBB@gmail.com';return u;}});assert.equal((await run()).uid,'guest');assert.equal(s.popups,1);assert.deepEqual(s.busy,[true,false]); },
};
const source=normEol(readFileSync(join(ROOT,CORE),'utf8'));
try {
  const M=await moduleFrom(source);
  for(const [name,fn] of Object.entries(cases))await T(name,()=>fn(M));
  if(!hasBaseCommit(ROOT,BASE))shallowSkip('v6652 BASE '+BASE);
  else { const old=readBaseBlob(ROOT,BASE,CORE);assert.ok(old.ok);const before=await moduleFrom(normEol(old.out));
    for(const path of Object.keys(V6652_PAIRS))await T('R 精確還原且 BASE 不變 '+path,()=>{const blob=readBaseBlob(ROOT,BASE,path);assert.ok(blob.ok);const prev=normEol(blob.out);assert.equal(revertV6652IfPresent(path,readFileSync(join(ROOT,path),'utf8')),prev);assert.equal(revertV6652IfPresent(path,prev),prev);});
    for(const name of Object.keys(cases).filter(n=>n!=='P1'))await T('H '+name+' BASE 紅／HEAD 綠',async()=>{await assert.rejects(cases[name](before));await cases[name](M);});
    await T('P 匿名登入正對照 BASE／HEAD',async()=>{await cases.P1(before);await cases.P1(M);});
  }
  const mutants=[
    ['M1 允許移除唯一登入方式',"if (!before.canUnlinkGoogle) throw { code: 'google/last-provider' };",'', 'U3'],
    ['M2 未驗原密碼', 'await api.reauthenticate(user, before.passwordEmail!, password);','', 'U1'],
    ['M3 驗錯 Google 信箱','before.passwordEmail!, password','user.email!, password','U1'],
    ['M4 空密碼仍解綁',"if (!password) throw { code: 'google/password-required' };",'', 'U4'],
    ['M5 過期帳號視窗仍有效',' || user.uid !== expectedUid','', 'U5'],
    ['M6 驗證途中換帳號',"if (api.currentUser()?.uid !== expectedUid) throw { code: 'google/account-changed' };",'', 'U6'],
    ['M7 驗證後遺失密碼方式仍解綁',"if (!current.google || !current.canUnlinkGoogle || current.passwordEmail !== before.passwordEmail || current.googleKey !== expectedGoogleKey) throw { code: 'google/account-changed' };",'', 'U7'],
    ['M8 解綁不釋放忙碌狀態','api.busy(false);','void 0;', 'U1'],
    ['M9 移除忙碌互斥',"if (running) throw { code: 'google/busy' };",'', 'U8'],
    ['M10 將 Google 信箱當玩家原信箱','const email = passwordEmail || user?.email || null;','const email = user?.email || null;', 'S1'],
    ['M11 確認時 Google 身分未固定',"if (!expectedGoogleKey || before.googleKey !== expectedGoogleKey) throw { code: 'google/account-changed' };",'', 'U12'],
    ['M12 驗證途中 Google 身分更換仍解綁',' || current.googleKey !== expectedGoogleKey','', 'U13'],
    ['M13 忽略解綁回傳 UID',' || result.uid !== expectedUid','', 'U10'],
    ['M14 已綁 Google 仍開新選帳號視窗','if (linkOnly && authUiState(initial).google) return initial!;','', 'U11'],
    ['M15 忽略 Google provider UID','google?.uid || googleEmail?.trim().toLowerCase()','googleEmail?.trim().toLowerCase()', 'S4'],
  ];
  for(const [name,needle,replacement,test] of mutants)await T(name,async()=>{assert.ok(source.includes(needle),'突變錨點必須存在');const text=source.split(needle).join(replacement);const mutant=await moduleFrom(text);await assert.rejects(cases[test](mutant),'存活突變');});
  const sdk=join(tmp,'sdk.js'),firebase=join(tmp,'firebase.js'),fixture=join(tmp,'Fixture.svelte');
  writeFileSync(sdk,`export class GoogleAuthProvider{setCustomParameters(){}static credentialFromError(e){return e.credential??null;}}
export class EmailAuthProvider{static credential(email,password){return {email,password};}}
export async function reauthenticateWithCredential(u,c){window.h.reauth.push(c);if(window.h.wrong)throw {code:'auth/wrong-password'};return {user:u};}
export async function unlink(u,id){window.h.unlinks.push(id);u.providerData=u.providerData.filter(p=>p.providerId!==id);return u;}
export async function linkWithPopup(u,p){window.h.popups++;u.providerData.push({providerId:'google.com',email:'BBB@gmail.com'});return {user:u};}
export async function signInWithPopup(){throw Error('不應切帳號');}
export async function signInWithCredential(){throw Error('不應切帳號');}`);
  writeFileSync(firebase,'export const auth=window.h.auth;');
  writeFileSync(fixture,`<script>import AccountBar from '$lib/ui/AccountBar.svelte';import {authUiState,googleAuthRevision,googleAuthBusy} from '$lib/auth/google-auth';let user=$state.raw(window.h.auth.currentUser);const a=$derived(authUiState(user,$googleAuthRevision));window.h.member=u=>{window.h.auth.currentUser=u;user=u;};</script><AccountBar email={a.email} anonymous={a.isAnonymous} googleUser={user} busy={$googleAuthBusy} onGoogleComplete={u=>{user=u;window.h.completed++;}} onSignOut={()=>{}}/>`);
  const compiled=await build({stdin:{contents:`import {mount} from 'svelte';import F from ${JSON.stringify(fixture)};mount(F,{target:document.body});`,resolveDir:ROOT},bundle:true,write:false,format:'iife',conditions:['browser'],nodePaths:[join(ROOT,'node_modules')],tsconfigRaw:{},logLevel:'silent',alias:{'$lib/firebase':firebase,'firebase/auth':sdk,'$lib':join(ROOT,'src/lib')},plugins:[{name:'actual-svelte',setup(b){b.onLoad({filter:/\.svelte$/},args=>({contents:compile(readFileSync(args.path,'utf8'),{generate:'client',css:'injected',filename:args.path}).js.code,loader:'js',resolveDir:dirname(args.path)}));}}]});
  const browser=await pwLaunch('v6652 Google 管理真元件');
  if(browser)try {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://google6652.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:8px;--ui-bg:#eee;--ui-bg-elev:#fff;--ui-text:#222;--ui-border:#aaa;--ui-accent:#276749;--ui-accent-contrast:#fff}</style>'}));
    await page.goto('https://google6652.invalid/decks?set=M6#saved');const url=page.url();
    await page.evaluate(u=>{window.h={auth:{currentUser:u},popups:0,unlinks:[],reauth:[],completed:0,wrong:false};},member());await page.addScriptTag({content:compiled.outputFiles[0].text});
    await T('B1 不同信箱原帳號與 Google 各自顯示',async()=>{assert.ok((await page.locator('.auth-email').innerText()).includes('AAA@yahoo.com'));assert.equal(await page.locator('.google-email').innerText(),'Google：BBB@gmail.com');});
    await page.locator('.google-unlink').click();
    await T('B2 解除前顯示信箱，尚無任何驗證／解除請求',async()=>{assert.ok((await page.locator('dialog').innerText()).includes('BBB@gmail.com'));assert.equal(await page.locator('dialog button[type=submit]').isDisabled(),true);assert.equal(await page.evaluate(()=>window.h.reauth.length+window.h.unlinks.length),0);});
    await page.locator('dialog button[type=button]').click();
    await T('B3 取消解除不改登入方式',async()=>{assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.evaluate(()=>window.h.unlinks.length),0);});
    await page.locator('.google-unlink').click();await page.evaluate(()=>window.h.wrong=true);await page.locator('dialog input').fill('wrong');await page.locator('dialog button[type=submit]').click();
    await T('B4 密碼錯誤保留綁定，清空密碼，可再試',async()=>{await page.waitForSelector('dialog [role=alert]');assert.equal(await page.locator('dialog input').inputValue(),'');assert.equal(await page.evaluate(()=>window.h.unlinks.length),0);});
    await page.evaluate(()=>window.h.wrong=false);await page.locator('dialog input').fill('secret');await page.locator('dialog button[type=submit]').click();await page.waitForSelector('.google-signin');
    await T('B5 驗密碼後正確 unlink google.com，原 UID／資料／網址保留',async()=>{const x=await page.evaluate(()=>window.h);assert.deepEqual(x.unlinks,['google.com']);assert.equal(x.reauth.at(-1).email,'AAA@yahoo.com');assert.equal(x.auth.currentUser.uid,'A');assert.deepEqual(x.auth.currentUser.decks,['saved']);assert.equal(x.auth.currentUser.wins,7);assert.equal(page.url(),url);assert.equal(await page.locator('dialog').count(),0);});
    await page.locator('.google-signin').click();
    await T('B6 綁定前先確認原帳號，按取消不開 Google popup',async()=>{assert.ok((await page.locator('dialog').innerText()).includes('AAA@yahoo.com'));await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>window.h.popups),0);});
    await page.locator('.google-signin').click();await page.getByRole('button',{name:'確認，前往選擇 Google 帳號'}).click();await page.waitForSelector('.google-unlink');
    await T('B7 確認後才開 popup，綁定同 UID 並顯示不同 Google 信箱',async()=>{assert.equal(await page.evaluate(()=>window.h.popups),1);assert.equal(await page.locator('.google-email').innerText(),'Google：BBB@gmail.com');assert.equal(await page.evaluate(()=>window.h.auth.currentUser.uid),'A');});
    await T('B8 同信箱不重複顯示，Google-only 無法移除唯一登入方式',async()=>{const u=member(false);await page.evaluate(u=>window.h.member(u),u);await page.waitForFunction(()=>document.querySelector('.google-unlink')?.disabled===true);assert.equal(await page.locator('.google-email').count(),0);assert.ok((await page.locator('.google-auth').innerText()).includes('唯一'));});
    await T('B9 手機／桌機長信箱不溢出，視窗可見且可操作',async()=>{const u=member();u.providerData[1].email='a-very-long-google-account-name@a-very-long-example-domain.test';await page.evaluate(u=>window.h.member(u),u);for(const width of [320,390,768,1376]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),String(width));await page.locator('.google-unlink').click();const box=await page.locator('dialog').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=844);await page.getByRole('button',{name:'取消',exact:true}).click();}});
    await T('B10 開著解綁視窗換帳號，舊密碼表單消失且無解除請求',async()=>{await page.locator('.google-unlink').click();await page.locator('dialog input').fill('secret');const n=await page.evaluate(()=>window.h.unlinks.length);await page.evaluate(u=>window.h.member({...u,uid:'B'}),member());await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.evaluate(()=>window.h.unlinks.length),n);assert.deepEqual(errors,[]);});
    await T('B11 桌機短視窗文字區滾輪能捲到確認按鈕',async()=>{await page.setViewportSize({width:900,height:260});await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.google-unlink').click();const node=page.locator('dialog p').first();const box=await node.boundingBox();assert.ok(box);const scroll=()=>page.locator('dialog').evaluate(e=>Math.max(e.scrollTop,...[...e.querySelectorAll('*')].map(n=>n.scrollTop)));const before=await scroll();await page.mouse.move(box.x+8,box.y+5);await page.mouse.wheel(0,400);await page.waitForTimeout(150);assert.ok((await scroll())>before,'文字區滾輪被攔截，對話框無法捲動');await page.keyboard.press('Escape');});
    await T('B12 同玩家換綁另一個 Google，舊解綁視窗關閉',async()=>{await page.setViewportSize({width:390,height:844});await page.locator('.google-unlink').click();await page.locator('dialog input').fill('secret');await page.evaluate(u=>{u.uid='B';u.providerData[1].uid='another-google';u.providerData[1].email='CCC@gmail.com';window.h.member(u);},member());await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.locator('.google-email').innerText(),'Google：CCC@gmail.com');});
    if(process.env.V6652_SHOT)await page.screenshot({path:process.env.V6652_SHOT,fullPage:true});
    await ctx.close();
  } finally {await browser.close();}
} catch(e){fail++;console.log('FAIL 驗收程序：'+e.stack);}
finally{rmSync(tmp,{recursive:true,force:true});}
console.log(`=== v6.652 Google 管理：${pass} PASS / ${fail} FAIL ===`);
process.exitCode=fail?1:0;
