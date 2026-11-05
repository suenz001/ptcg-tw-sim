// 只突變外部暫存副本；兩項既有正對照每輪保持通過。
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,symlinkSync,realpathSync,rmSync} from 'node:fs';
import {join,dirname,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..',import.meta.url));
const temp = mkdtempSync(join(tmpdir(),'ptcg-v6629-'));
const files=['oracle-admin/admin.html','src/routes/deck-posts/+page.svelte','src/routes/+layout.svelte'];
const original=new Map(files.map(n=>[n,readFileSync(join(ROOT,n),'utf8')]));
for(const [n,s]of original){mkdirSync(dirname(join(temp,n)),{recursive:true});writeFileSync(join(temp,n),s);}
symlinkSync(realpathSync(join(ROOT,'node_modules')),join(temp,'node_modules'),process.platform==='win32'?'junction':'dir');
const admin='oracle-admin/admin.html',post='src/routes/deck-posts/+page.svelte';
const cases=[
 ['M1',admin,'color:#176333; background:#e4f4e8','color:#5a6472; background:#e4f4e8','勝者實際連結顏色及勝字不同於敗者'],
 ['M2',admin,'results.set(String(p.uid), typeof res.results','results.set(String(part[0].uid), typeof res.results','原型按本場uid而非同名並只送單次批量'],
 ['M3',admin,'const TV_PAGE_SIZE = 50;','const TV_PAGE_SIZE = 500;','冠軍榜120筆分成50與20且排名延續'],
 ['M4',admin,"if (state) state.draft = String(value || '');","if (state) state.draft = String(value || ''); window.adminSearchApply(id);",'Oracle打字含停頓均零請求提交一發'],
 ['M5',admin,'!state || state.busy || !input','!state || !input','Oracle連按不重送舊response不覆蓋新頁'],
 ['M6',admin,'if (request !== oracleRoomsRequest) return;','if (false && request !== oracleRoomsRequest) return;','Oracle連按不重送舊response不覆蓋新頁'],
 ['M7',admin,'function mxReadOpts() { return { ..._mxOpt }; }','function mxReadOpts() { return mxCommitOpts(); }','矩陣回應不偷用等待期間的下拉草稿'],
 ['M8',admin,'function currentArchSince() { return _archSince; }',"function currentArchSince() { return document.getElementById('arch-since').value; }",'選時間草稿不改已提交範圍明確套用後才改'],
 ['M9',admin,"const resolved = m.status === 'done' && !m.bye;","const resolved = m.status === 'done' && !m.bye && !m.deadlockDraw;",'管理員裁定勝方優先於殘留平手旗標'],
 ['M10',post,'.tabs > button.primary.post-submit-cta { background: #236447; color: #fff;','.tabs > button.primary.post-submit-cta { background: #236447; color: #182c20;','投稿按鈕真Svelte編譯CSS手機桌機深淺綠底白字'],
 ['M11',admin," || overlay.querySelector('[data-bracket-view]')?.dataset.bracketView !== String(view)",'','同場併發只一發且跨場舊回應不覆蓋'],
 ['M12',admin,'const result = cache?.results;','const result = tsBracketCached(a)?.results;','暖快取賽程只計算常數次牌表簽章'],
];
function run(){const r=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6629-admin-search-bracket.mjs')],{cwd:ROOT,env:{...process.env,V6629_PRODUCT:temp},encoding:'utf8',timeout:120000,maxBuffer:12*1024*1024});assert.equal(r.signal,null,r.stderr);for(const n of ['既有賽程雙方與輪次保留','既有HTML跳脫與玩家總覽連結保留'])assert.ok(r.stdout.includes('PASS '+n),n+' 正對照');return r;}
try{
 for(const [id,n,from,to,test]of cases){const s=original.get(n);assert.equal(s.split(from).length-1,1,id+' 精確錨點');writeFileSync(join(temp,n),s.replace(from,to));const r=run();assert.equal(r.status,1,id+' 必須正常 exit 1');assert.ok(r.stdout.includes('FAIL '+test+':'),id+' 指定行為未紅\n'+r.stdout);writeFileSync(join(temp,n),s);console.log('PASS '+id+' '+test);}
 writeFileSync(join(temp,admin),original.get(admin)+'\n// N1 無行為註解\n');assert.equal(run().status,0,'N1');writeFileSync(join(temp,admin),original.get(admin));assert.equal(run().status,0,'還原');console.log('PASS N1 / restored');
}finally{assert.ok(resolve(temp).startsWith(resolve(tmpdir())+sep));rmSync(temp,{recursive:true,force:true});}
