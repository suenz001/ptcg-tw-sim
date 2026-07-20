// v5.992 守衛:copy-attack 的 dispatch 一律走 dispatchBorrowedAttack
//   禁止 initiateAttack 各 intercept 的「單一選項 fast-path」直接
//   dispatch(GameActions.attack(idx, undefined, { pokeIid: xxx, ... }))
//   — 這會繞過被借招式的 ATTACK_PRE_DISCARD_CHOICE(「若希望」modal),
//   玩家回報:皮可西|揮指 複製 超級甲賀忍蛙ex|忍者飛旋(單招卡)拿不到「回水+80」選項只打 120。
//   合法白名單:
//     - dispatchBorrowedAttack 內部 shorthand `{ pokeIid, attackIndex }`(無冒號)
//     - skip sentinel `{ pokeIid: '__rocket_command_skip__' ... }`
import { readFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = process.env.PTCG_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT,'src/routes/game/+page.svelte'),'utf8');
const lines = src.split('\n');
const bad = [];
lines.forEach((l,i)=>{
  if(!l.includes('GameActions.attack')) return;
  if(!/pokeIid\s*:/.test(l)) return;               // 字面 copyAttackChoice(帶冒號)才可疑
  if(l.includes('__rocket_command_skip__')) return; // 「不複製」sentinel 合法
  bad.push(`${i+1}: ${l.trim()}`);
});
if(bad.length){
  console.log('FAIL: 發現繞過 dispatchBorrowedAttack 的 copy-attack 直接 dispatch(會吃掉被借招式「若希望」選擇):');
  for(const b of bad) console.log('  ', b);
  process.exit(1);
}
console.log('PASS: copy-attack dispatch 全部收斂 dispatchBorrowedAttack(無 fast-path 繞過)');
