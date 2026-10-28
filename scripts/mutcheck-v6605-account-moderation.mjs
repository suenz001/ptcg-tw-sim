// 僅修改獨立暫存產品副本；不與全套同時執行。
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const scratch=mkdtempSync(join(tmpdir(),'moderation-6605-mut-'));
const files=['oracle-admin/server_admin_patch.js','oracle-admin/admin.html','static/changelog.html','static/changelog-bodies.html','static/changelog-archive.html'];
const originals=new Map(files.map(p=>[p,readFileSync(join(ROOT,p),'utf8').replace(/\r\n/g,'\n')]));
for(const[p,s]of originals){mkdirSync(dirname(join(scratch,p)),{recursive:true});writeFileSync(join(scratch,p),s);}
const sap='oracle-admin/server_admin_patch.js';
const run=()=>spawnSync(process.execPath,[join(ROOT,'scripts/test-v6605-account-moderation.mjs')],{cwd:ROOT,env:{...process.env,V6605_PRODUCT:scratch},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
const cases=[
  ['M1 關閉管理員驗證',"if (!isTournAdmin(id)) return res.status(403).json({error:'需要管理員權限'});", "if (false && !isTournAdmin(id)) return res.status(403).json({error:'需要管理員權限'});", 'A2'],
  ['M2 禁言漏掉私訊',"['/api/friends/dm/send','chat']", "['/api/friends/dm/sent','chat']", 'C1'],
  ['M3 禁賽漏掉報到',"['/api/tournament/checkin','tournament-entry']", "['/api/tournament/checked','tournament-entry']", 'C2'],
  ['M4 到期仍封鎖','{expiresAt:{$gt:now()}}', '{expiresAt:{$gt:0}}', 'B3'],
  ['M5 冪等校驗停用','if (row.requestKey !== requestKey) fail(409', 'if (false && row.requestKey !== requestKey) fail(409', 'B2'],
  ['M6 停用解除CAS',"await collection.updateOne({_id:id, subjectUid, revokedAt:null}", "await collection.updateOne({_id:id, subjectUid}", 'B4'],
  ['M7 資料庫失敗放行',String.raw`} catch (e) { moderationError(res,e); }`, String.raw`} catch (e) { next(); }`, 'C5', 'gate'],
  ['M8 使用另一閉包變數',"createAccountModeration(db.collection('accountSanctions'), moderationAuth,", "createAccountModeration(db.collection('accountSanctions'), adminAuth,", 'D1'],
  ['M9 多處分期限只取最近一筆',"rows.some(x => x.expiresAt === null)", "row.expiresAt === null", 'C6'],
  ['M10 有限處分期限取錯',"Math.max(...rows.map(x => x.expiresAt))", "rows[0].expiresAt", 'C6'],
];
let killed=0;
try {
  assert.equal(run().status,0,'原版必須全綠');
  for(const[id,from,to,red,region]of cases){
    const original=originals.get(sap);
    const start=region==='gate'?original.indexOf('async function accountModerationGate'):0;
    const end=region==='gate'?original.indexOf('// <<< v6605-account-moderation',start):original.length;
    const subject=original.slice(start,end);
    assert.equal(subject.split(from).length-1,1,id+' 指定區域內錨點必須唯一');
    writeFileSync(join(scratch,sap),original.slice(0,start)+subject.replace(from,to)+original.slice(end));
    const r=run();assert.notEqual(r.status,0,id+' 未殺死');assert.match(r.stdout,new RegExp('^FAIL '+red+'\\b','m'),id+' 必須紅在預期行為');
    // P1/P2 不讀本區塊邏輯，屬結構上恆綠，只作範圍正對照。
    assert.match(r.stdout,/^PASS P1\b/m);assert.match(r.stdout,/^PASS P2\b/m);
    console.log('KILLED '+id+' -> '+red);killed++;writeFileSync(join(scratch,sap),original);
  }
  const original=originals.get(sap),from='// 第一階段僅限制發言與參賽入口；已完成報到的賽程、重連與退出不受影響。';
  assert.equal(original.split(from).length-1,1);writeFileSync(join(scratch,sap),original.replace(from,from+'（註解測試）'));
  assert.equal(run().status,0,'N1 只改註解不得誤紅');writeFileSync(join(scratch,sap),original);
  for(const[p,s]of originals)assert.equal(readFileSync(join(scratch,p),'utf8'),s,'逐位元還原 '+p);
  assert.equal(run().status,0,'還原後必須回綠');console.log(`突變 ${killed}/${cases.length} 殺死；N1與還原複驗通過`);
} finally {rmSync(scratch,{recursive:true,force:true});}
