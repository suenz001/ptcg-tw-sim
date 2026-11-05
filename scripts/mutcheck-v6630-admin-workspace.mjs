// 只突變獨立暫存副本；必須正常 exit 1、指定真行為紅且三項既有正對照綠。
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'ptcg-v6630-'));
const files=['oracle-admin/admin.html','static/changelog.html','static/changelog-bodies.html','static/changelog-archive.html'];
for(const n of files){mkdirSync(dirname(join(temp,n)),{recursive:true});writeFileSync(join(temp,n),readFileSync(join(ROOT,n)));}
const path=join(temp,files[0]),original=readFileSync(path,'utf8');
const cases=[
 ['M1',"sidebar.setAttribute('aria-modal','true')","sidebar.setAttribute('aria-modal','false')",'手機抽屜含四組全部16入口且背景不能操作'],
 ['M2','|牌組名稱|名稱|卡名','|卡名','手機牌組原型卡片直接顯示規則名稱'],
 ['M3','.admin-section.admin-section-collapsed > .admin-section-body { display:none; }','.admin-section.admin-section-collapsed > .admin-section-body { display:block; }','手機長統計收合後可直接跳最後區段且不溢出'],
 ['M4','state={host,scroll,limit:10}','state={host,scroll,limit:50}','摘要卡片只先顯10筆但保留50筆DOM'],
 ['M5','state.limit+=10','state.limit+=0','再顯示10與本頁全部不發API且可讀最後房間'],
 ['M6',"const inp = input || document.getElementById('rooms-page-input-' + source)","const inp = document.getElementById('rooms-page-input-' + source)",'底部跳頁Enter讀自己數值且輸入不發API'],
 ['M7','close.onclick=()=>original.click()','close.onclick=()=>window.closeModal()','巢狀彈窗返回上一層後關閉按鈕仍可用'],
 ['M8',"||next.querySelector('#cp-save,#cp-clear,#cp-status')",'','卡包政策全頁儲存清除與狀態不隨卡包段隱藏'],
 ['M9',"listPager(panel.querySelector('#cl-full-list'),20)","listPager(panel.querySelector('#cl-full-list'),200)",'更新紀錄每頁20且下頁不同版本不發API'],
 ['M10','preference(viewKey,mode.value)',"preference(viewKey,'cards')",'顯示偏好跨頁不混淆且重載保留'],
 ['M11','overlayFocus.focus({preventScroll:true})','void 0','關閉彈窗焦點回原入口且Escape只關最上層'],
 ['M12','.admin-modal-bar { position:sticky; top:0;','.admin-modal-bar { position:static; top:0;','彈窗捲到底仍有頂部關閉且背景捲動還原'],
 ['M13','overscroll-behavior-x:contain; overscroll-behavior-y:auto;','overscroll-behavior-x:contain; overscroll-behavior-y:contain;','手機卡片與桌機表格內滾輪可繼續捲動整頁'],
];
const positives=['真Auth總覽顯示完整55001帳號與原16分頁','房間原50筆與P1P2資料完整保留','既有搜尋只在Enter送出原query'];
function run(){const result=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6630-admin-workspace.mjs')],{cwd:ROOT,env:{...process.env,V6630_PRODUCT:temp},encoding:'utf8',timeout:240000,maxBuffer:12*1024*1024});assert.equal(result.signal,null,result.stderr);for(const n of positives)assert.ok(result.stdout.includes('PASS 正對照：'+n),'正對照 '+n+'\n'+result.stdout);return result;}
try{
 for(const[id,from,to,test]of cases){assert.equal(original.split(from).length-1,1,id+' 必須唯一命中');writeFileSync(path,original.replace(from,to));const result=run();assert.equal(result.status,1,id+' 必須正常 exit 1');assert.ok(result.stdout.includes('FAIL '+test+':'),id+' 指定真行為未紅\n'+result.stdout);writeFileSync(path,original);console.log('PASS '+id+' '+test);}
 writeFileSync(path,original+'\n<!-- N1 非行為註解 -->\n');assert.equal(run().status,0,'N1');writeFileSync(path,original);assert.equal(run().status,0,'還原');console.log('PASS N1 / restored');
}finally{assert.ok(resolve(temp).startsWith(resolve(tmpdir())+sep));rmSync(temp,{recursive:true,force:true});}
