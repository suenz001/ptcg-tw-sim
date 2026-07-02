// 重複註冊守衛(收斂):掃描全 source,若出現「新的」重複註冊 key 即 FAIL。
//   背景:reg/regPre/regPost/regA/regG/regR 用 Map.set 後者覆蓋前者;同 key 多次註冊→
//   只有一份生效、其餘是死碼。實證(2026-06)發現「哪份生效」無法用載入順序或 toString 可靠
//   自動判定(handler 多為 helper 包裝、實作相似),故不盲刪;改用本守衛鎖死現況:
//   - 現存 43 個已知重複(KNOWN)= 歷史技術債,允許存在(待逐卡行為驗證後個別清理)。
//   - 任何「不在 KNOWN 內的新重複 key」→ FAIL,避免日後再悄悄長出同名覆蓋 bug。
//   清理掉某個已知重複後,把它從 KNOWN 移除即可(該 key 不再是 dup,本測試不會因此 fail)。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const KNOWN = new Set([
  "regA|吉雉雞ex|0","regA|米立龍|0","regG|鬼之假面",
  "regPost|妙喵|小憩","regPost|洗翠 風速狗|灼燒","regPost|鐵面忍者|急速折返",
  "regPre|恰雷姆|七度踢腿","regPre|波盪水ex|宣洩吼嘯","regPre|貓鼬斬|連斬",
  "regPre|雙彈瓦斯|瘋狂炸彈","reg|鬼之假面",
]);

function listTs(dir){let out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);
  if(e.isDirectory())out=out.concat(listTs(p));else if(e.name.endsWith('.ts'))out.push(p);}return out;}
const reSimple=/\b(reg|regG|regPre|regPost|regR)\s*\(\s*'([^']+)'/g;
const reA=/\bregA\s*\(\s*'([^']+)'\s*,\s*(\d+)/g;
const hits=new Map();
for(const f of listTs(join(ROOT,'src/lib/game'))){
  let inblock=false;
  readFileSync(f,'utf8').split('\n').forEach((ln,idx)=>{
    let s=ln;
    if(inblock){if(s.includes('*/')){s=s.split('*/').slice(1).join('*/');inblock=false;}else return;}
    if(s.includes('/*')&&!s.includes('*/')){s=s.split('/*')[0];inblock=true;}
    if(s.includes('//'))s=s.split('//')[0];
    let m; reSimple.lastIndex=0;
    while((m=reSimple.exec(s))){const k=`${m[1]}|${m[2]}`;(hits.get(k)??hits.set(k,[]).get(k)).push(`${f.split('/').pop()}:${idx+1}`);}
    reA.lastIndex=0;
    while((m=reA.exec(s))){const k=`regA|${m[1]}|${m[2]}`;(hits.get(k)??hits.set(k,[]).get(k)).push(`${f.split('/').pop()}:${idx+1}`);}
  });
}
const dups=[...hits].filter(([k,v])=>v.length>1);
const newDups=dups.filter(([k])=>!KNOWN.has(k));
const staleKnown=[...KNOWN].filter(k=>!dups.some(([dk])=>dk===k));

console.log(`重複註冊守衛:現存重複 ${dups.length} 個(已知 ${KNOWN.size})、新增 ${newDups.length} 個`);
if(staleKnown.length){
  console.log(`ℹ 已清理(可從 KNOWN 移除): ${staleKnown.join(', ')}`);
}
if(newDups.length){
  console.log('\n❌ 偵測到新的重複註冊(後者會覆蓋前者→死碼/覆蓋 bug 風險):');
  for(const [k,locs] of newDups) console.log(`   ${k}  ->  ${locs.join(', ')}`);
  console.log('\n請避免同 key 重複註冊;若為刻意覆蓋,移除舊版或確認後加入 KNOWN 白名單。');
  process.exit(1);
}
console.log('✅ 無新增重複註冊');
process.exit(0);
