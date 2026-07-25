// v6.022 錦標賽通知 — 純函式決策核心單元測試（比照 test-sw-policy 先例，零 DOM）。
//   鎖住三件最容易出錯的事：①前景一律不發（Wilson 明確要求的「不干擾」）
//   ②去重（F5 後從 localStorage 還原不重發）③換手節流（頻繁切分頁不被轟炸）。
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.nc-s.js'); const E=join(ROOT,'.nc-e.ts'); const O=join(ROOT,'.nc-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export * from './src/lib/notify-core';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { decideNotify, buildNotifyKey, scanTournamentAlerts, buildTurnIntent, pruneSeen, resolveClickUrl, TURN_MIN_INTERVAL_MS, SEEN_TTL_MS }=M;

const NOW=1_700_000_000_000;
const base={ enabled:true, permission:'granted', hidden:true, key:'k', seen:{}, now:NOW };
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('前景一律不發（不干擾正在看畫面的玩家）',()=>{
  assert.equal(decideNotify({...base, hidden:false}).show, false);
  assert.equal(decideNotify({...base, hidden:false}).reason, 'foreground');
  assert.equal(decideNotify({...base, hidden:true}).show, true, '背景才發');
});

T('偏好關閉 / 無權限 → 不發',()=>{
  assert.equal(decideNotify({...base, enabled:false}).reason, 'disabled');
  assert.equal(decideNotify({...base, permission:'default'}).reason, 'no-permission');
  assert.equal(decideNotify({...base, permission:'denied'}).reason, 'no-permission');
});

T('去重：同 key 已發過就不再發（模擬 F5 後從 localStorage 還原 seen）',()=>{
  assert.equal(decideNotify({...base, seen:{ k: NOW-1000 }}).reason, 'already-sent');
  assert.equal(decideNotify({...base, seen:{ other: NOW-1000 }}).show, true, '不同 key 不受影響');
});

T('換手節流：同房間最小間隔內壓制、超過放行',()=>{
  const t={...base, key:'turn|r1|5|0', minIntervalMs:TURN_MIN_INTERVAL_MS};
  assert.equal(decideNotify({...t, lastShownAt:NOW-1000}).reason, 'throttled', '1秒前剛發過→壓制');
  assert.equal(decideNotify({...t, lastShownAt:NOW-TURN_MIN_INTERVAL_MS-1}).show, true, '超過間隔→放行');
  assert.equal(decideNotify({...t, lastShownAt:undefined}).show, true, '沒發過→放行');
  assert.equal(TURN_MIN_INTERVAL_MS, 30000, '節流間隔 30 秒');
});

T('報到掃描：四條件矩陣（階段/已報名/未報到/未過期）',()=>{
  const ok={ _id:'e1', name:'週末盃', status:'checkin', registered:true, checkedIn:false, checkInDeadline:NOW+60000 };
  assert.equal(scanTournamentAlerts([ok], null, NOW).length, 1, '全符合→發');
  assert.equal(scanTournamentAlerts([{...ok, status:'registration'}], null, NOW).length, 0, '非報到階段不發');
  assert.equal(scanTournamentAlerts([{...ok, registered:false}], null, NOW).length, 0, '沒報名不發');
  assert.equal(scanTournamentAlerts([{...ok, checkedIn:true}], null, NOW).length, 0, '已報到不發');
  assert.equal(scanTournamentAlerts([{...ok, checkInDeadline:NOW-1}], null, NOW).length, 0, '已過截止不發');
  const it=scanTournamentAlerts([ok], null, NOW)[0];
  assert.ok(it.title.includes('週末盃'), '標題含賽名（Wilson 選含賽名與對手名）');
  assert.equal(it.key, 'checkin|e1');
});

T('進場掃描：進場時間到才發（配對當下不發，因每輪有休息倒數）',()=>{
  const m={ matchId:'m1', round:2, oppName:'CSD 子龍', enterOpenAt:NOW+30000, entered:false, roomId:'r1' };
  assert.equal(scanTournamentAlerts([], m, NOW).length, 0, '進場時間未到→不發');
  assert.equal(scanTournamentAlerts([], {...m, enterOpenAt:NOW}, NOW).length, 1, '時間到→發');
  assert.equal(scanTournamentAlerts([], {...m, enterOpenAt:NOW, entered:true}, NOW).length, 0, '已進場不發');
  assert.equal(scanTournamentAlerts([], {...m, enterOpenAt:null}, NOW).length, 0, '無進場時間不發');
  const it=scanTournamentAlerts([], {...m, enterOpenAt:NOW}, NOW)[0];
  assert.ok(it.title.includes('第 2 輪') && it.title.includes('CSD 子龍'), '含輪次與對手名');
  assert.equal(it.requireInteraction, true, '可進場＝重要，常駐到點擊');
  assert.equal(it.key, 'enter|m1');
});

T('換手 key：同場同回合同行動方唯一（重連重放不重發）',()=>{
  const a=buildTurnIntent({ roomId:'r1', turn:5, apIdx:0 });
  const b=buildTurnIntent({ roomId:'r1', turn:5, apIdx:0 });
  const c=buildTurnIntent({ roomId:'r1', turn:6, apIdx:0 });
  assert.equal(a.key, b.key, '同回合同 key');
  assert.notEqual(a.key, c.key, '新回合不同 key');
  assert.equal(a.tag, 'ptcg-t-turn-r1', '同房間同 tag→系統上覆蓋不疊加');
});

T('pruneSeen：修剪過期記錄',()=>{
  const seen={ fresh: NOW-1000, old: NOW-SEEN_TTL_MS-1 };
  const out=pruneSeen(seen, NOW, SEEN_TTL_MS);
  assert.deepEqual(Object.keys(out), ['fresh']);
  assert.deepEqual(pruneSeen({}, NOW), {}, '空表安全');
});

T('resolveClickUrl：正式站(/)與測試站(/ptcg-tw-sim/)兩種 base 都正確',()=>{
  assert.equal(resolveClickUrl('https://www.ptcg-tw-sim.com/'), 'https://www.ptcg-tw-sim.com/tournament');
  assert.equal(resolveClickUrl('https://suenz001.github.io/ptcg-tw-sim/'), 'https://suenz001.github.io/ptcg-tw-sim/tournament');
  assert.equal(resolveClickUrl('https://x.com'), 'https://x.com/tournament', '無結尾斜線也正確');
});

T('buildNotifyKey 穩定性',()=>{
  assert.equal(buildNotifyKey('checkin',{eventId:'e1'}), 'checkin|e1');
  assert.equal(buildNotifyKey('enter',{matchId:'m1'}), 'enter|m1');
  assert.equal(buildNotifyKey('turn',{roomId:'r1',turn:3,apIdx:1}), 'turn|r1|3|1');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
