#!/usr/bin/env node
// Audit 三組預組（奧利瓦 / 鋁鋼橋龍 / 超級寶石海星）每張卡的招式/特性/訓練家 effect 實裝狀態
import fs from 'node:fs';
import path from 'node:path';

function readAll(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readAll(p, out);
    else if (e.name.endsWith('.ts')) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}
const src = readAll('src/lib/game').join('\n');
const pool = new Map();
for (const f of fs.readdirSync('static/cards').filter(f => f.endsWith('.json') && f !== 'index.json')) {
  const arr = JSON.parse(fs.readFileSync(path.join('static/cards', f), 'utf8'));
  for (const c of arr) if (!pool.has(c.name)) pool.set(c.name, c);
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const deckPokes = ['奧利瓦ex','奧利紐','迷你芙','大竺葵','月桂葉','菊草葉','含羞苞','厄鬼椪 碧草面具ex','喵喵ex','吉雉雞ex','鋁鋼龍','鋁鋼橋龍ex','鋁鋼橋龍','超級大嘴娃ex','土龍弟弟','土龍節節','土龍節節ex','旋轉洛托姆','雪童子','雪妖女','超級雪妖女ex','海星星','超級寶石海星ex','願增猿'];
const trainers = ['高級球','寶可平板','不公印章','夜間擔架','捕蟲組合','好友寶芬','寶可裝置3.0','寶可夢交替','特殊紅牌','裁判','水蓮的照顧','白蕾雅','老大的指令','小光','莉莉艾的決意','吉普索','滿充的體貼','青木的手法','赤松','鬥子'];
const stadiums = ['活力森林','稜鏡塔','阻礙之塔','險惡廢墟'];
const energies = ['古舊能量','燃火能量'];

console.log('═══ 寶可夢 — 特性/招式 effect 實裝狀態 ═══');
for (const name of deckPokes) {
  const c = pool.get(name);
  if (!c) { console.log('✗ ' + name + ' [找不到]'); continue; }
  const abilities = c.abilities || [];
  const attacks = c.attacks || [];
  let any = false;
  for (let i = 0; i < abilities.length; i++) {
    const ab = abilities[i];
    if (!ab.effect) continue;
    any = true;
    const reA = new RegExp(`regA\\(\\s*['"]${esc(name)}['"]\\s*,\\s*${i}`);
    const has = reA.test(src);
    console.log((has ? '✓' : '✗'), '[特性]', name.padEnd(18), ab.name, has ? '' : '— ' + ab.effect.slice(0, 60));
  }
  for (const atk of attacks) {
    if (!atk.effect) continue; // 純傷害無 effect 文字 → 不需實裝
    any = true;
    const rePre = new RegExp(`reg(Pre|Post)\\(\\s*['"]${esc(name)}\\|${esc(atk.name)}['"]`);
    const has = rePre.test(src);
    console.log((has ? '✓' : '✗'), '[招式]', name.padEnd(18), atk.name, has ? '' : '— ' + atk.effect.slice(0, 60));
  }
  if (!any) console.log('—  ' + name.padEnd(18) + '（純傷害，無需實裝）');
}

console.log('\n═══ 訓練家 effect 實裝狀態 ═══');
for (const name of trainers) {
  const c = pool.get(name);
  if (!c) { console.log('✗ ' + name + ' [找不到]'); continue; }
  const reReg = new RegExp(`reg\\(\\s*['"]${esc(name)}['"]`);
  const has = reReg.test(src);
  console.log((has ? '✓' : '✗'), name.padEnd(18), has ? '' : '— ' + (c.rulesText || '').slice(0, 80));
}

console.log('\n═══ Stadium 實裝狀態 ═══');
for (const name of stadiums) {
  const c = pool.get(name);
  if (!c) { console.log('✗ ' + name + ' [找不到]'); continue; }
  const passive = new RegExp(`['"]${esc(name)}['"]`).test(src) && /PASSIVE_STADIUMS|STATIC_PASSIVE_STADIUMS|JAMMING_TOWER|ROCKET_WATCHTOWER|BENCH_PROTECTION|GRAVITY_MOUNTAIN/.test(src.split(name)[0]?.slice(-500) || '');
  const reReg = new RegExp(`reg\\(\\s*['"]${esc(name)}['"]`);
  const passiveInSet = src.match(new RegExp(`STATIC_PASSIVE_STADIUMS[\\s\\S]{0,2000}['"]${esc(name)}['"]`, ''));
  const has = reReg.test(src);
  const isPassiveListed = passiveInSet !== null;
  console.log((has || isPassiveListed ? '✓' : '✗'), name.padEnd(10), has ? '(主動 reg)' : isPassiveListed ? '(被動列表)' : '', '— ' + (c.rulesText || '').slice(0, 80));
}

console.log('\n═══ 特殊能量 實裝狀態 ═══');
for (const name of energies) {
  const c = pool.get(name);
  if (!c) { console.log('✗ ' + name + ' [找不到]'); continue; }
  const reAttach = new RegExp(`SPECIAL_ENERGY_ATTACH[\\s\\S]{0,3000}['"]${esc(name)}['"]`).test(src);
  const reTypes = new RegExp(`SPECIAL_ENERGY_TYPES[\\s\\S]{0,1000}['"]${esc(name)}['"]`).test(src);
  const has = reAttach || reTypes;
  console.log((has ? '✓' : '✗'), name.padEnd(12), reAttach ? '(attach)' : '', reTypes ? '(types)' : '', '— ' + (c.rulesText || '').slice(0, 80));
}
