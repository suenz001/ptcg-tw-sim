// 測試網：picker modal 按鈕邏輯（selection-ui.ts 純函式）— v5.424
// 跑法：node scripts/test-selection-ui.mjs
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const O = join(ROOT, 'scripts', '.sel-ui.o.mjs');
process.on('exit', () => { try { unlinkSync(O); } catch {} });
await build({ entryPoints: [join(ROOT,'src/lib/game/selection-ui.ts')], outfile: O, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { selectionAllowsSkip, selectionConfirmFloor, isUnknownInfoPicker } = M;
let pass=0, fail=[]; const ck=(n,ok,d='')=>{ ok?pass++:fail.push(n+(d?' — '+d:'')); };
const mk=(type,effectKey='x',src=0,act=0,minCount=0,allowSkipZero=undefined)=>({type,effectKey,sourcePlayerIdx:src,actorIdx:act,minCount,allowSkipZero});
ck('一般牌庫搜尋→可不選', selectionAllowsSkip(mk('deck-search')));
// v5.543：「看牌庫上方N張強制選加手牌」型 → 不可不選（白名單）
ck('偵查指令(看上方2選1)→強制', !selectionAllowsSkip(mk('deck-search','scouting-order',0,0)));
ck('探險家的嚮導(看頂6選2)→強制', !selectionAllowsSkip(mk('deck-search','explorer-guide',0,0)));
ck('辛俐(看頂4選2)→強制', !selectionAllowsSkip(mk('deck-search','shinli-pick',0,0)));
// ★ 搜尋牌庫找特定卡(賽吉/喵頭目等)→ 官方可「找不到」→ 仍可不選
ck('賽吉(搜尋進化卡,可找不到)→可不選', selectionAllowsSkip(mk('deck-search','sage-search-evolve',0,0)));
ck('八朔(看頂8最多3)→可不選', selectionAllowsSkip(mk('deck-search','search-to-hand-reshuffle',0,0)));
ck('牌庫頂排序→可不選', selectionAllowsSkip(mk('reorder-deck-top')));
ck('查看對手手牌(枇琶)→可不選', selectionAllowsSkip(mk('hand-discard','loquat-discard-opp-items',1,0)));
ck('能量撢子→可不選', selectionAllowsSkip(mk('hand-discard','energy-duster-pick',1,0)));
ck('力之沙漏(可不附能量)→可不選', selectionAllowsSkip(mk('discard-search','brailliant-attach',0,0,0)));
ck('棄牌區奇跡耳麥→強制', !selectionAllowsSkip(mk('discard-search','discard-to-hand')));
ck('棄牌區聖灰→強制', !selectionAllowsSkip(mk('discard-search','sacred-ash-discard-to-deck')));
ck('治療→強制', !selectionAllowsSkip(mk('heal-target','heal')));
ck('選對手寶可夢→強制', !selectionAllowsSkip(mk('opp-poke-choose','snipe')));
ck('我方手牌固定取(鋼炮臂蝦)→強制', !selectionAllowsSkip(mk('hand-choose','clamperl-bombard-attach',0,0)));
ck('我方手牌丟代價(沙儷)→強制', !selectionAllowsSkip(mk('hand-discard','sari-return-then-search',0,0)));
ck('急進開關(任意數量)→可不選', selectionAllowsSkip(mk('active-energy-discard','rush-switch-energy-transfer',0,0)));
ck('琵魯(若希望,自手牌)→可不選', selectionAllowsSkip(mk('hand-discard','pirou-discard-then-draw',0,0)));
ck('呆呆獸丟到飽→可不選', selectionAllowsSkip(mk('hand-discard','m5-slowpoke-discard-all',0,0)));
ck('迅速游標→可不選', selectionAllowsSkip(mk('active-energy-discard','swiftcursor-energy-pick',0,0)));
ck('狡兔三窟換場→可不選', selectionAllowsSkip(mk('bench-choose','self-swap-active-bench',0,0)));
// v6.125：拉帝歐斯｜潔淨支援 在 v5.907 已收斂到 active-energy-discard + swiftcursor-energy-pick
//   （第 37 行那條就是它），舊的 cleansing-support-pick-bench 是零 producer 的死 key，已從白名單移除。
// ── v6.125 新契約：params.allowSkipZero 逐卡宣告（解共用 resolver 的衝突）──
ck('已知資訊+allowSkipZero=true→可不選（胖嘟嘟｜深海抽出「若希望」）',
   selectionAllowsSkip(mk('hand-discard','m6-wailord-deep-draw-bottom',0,0,0,true)));
ck('同一 key 但沒宣告 allowSkipZero→維持必選（站規：已知資訊預設不給不選）',
   !selectionAllowsSkip(mk('hand-discard','m6-wailord-deep-draw-bottom',0,0,0,false)));
ck('⭐ allowSkipZero 不得凌駕 minCount>=1（卡面要求至少選 N 就不能跳過）',
   !selectionAllowsSkip(mk('hand-discard','whatever',0,0,1,true)));
ck('共用 key 分流：吉利蛋｜幸運貼附(必選) vs 艾姆利多(可選0) 靠 params 分開',
   !selectionAllowsSkip(mk('hand-discard','v158-energy-chain-start',0,0,1,false))
   && selectionAllowsSkip(mk('hand-discard','v158-energy-chain-start',0,0,0,true)));
// v5.607：minCount>=1 一律不給【不選】(minCount 權威)；衝衝鼓任意檢索強制選1
ck('衝衝鼓(任意檢索 minCount=1)→必選不可跳過', !selectionAllowsSkip(mk('deck-search','search-generic-to-hand-private',0,0,1)));
ck('詭計(任意檢索 最多2 minCount=0)→仍可不選', selectionAllowsSkip(mk('deck-search','search-to-hand-reshuffle',0,0,0)));
ck('賽吉(有條件搜尋 minCount=0)→仍可不選', selectionAllowsSkip(mk('deck-search','sage-search-evolve',0,0,0)));
ck('任意 picker minCount=2→必選', !selectionAllowsSkip(mk('deck-search','whatever',0,0,2)));
ck('未知資訊但 minCount=1→必選', !selectionAllowsSkip(mk('hand-discard','loquat-discard-opp-items',1,0,1)));
ck('confirmFloor(0)=1', selectionConfirmFloor(0)===1);
ck('confirmFloor(1)=1', selectionConfirmFloor(1)===1);
ck('confirmFloor(2)=2', selectionConfirmFloor(2)===2);
ck('confirmFloor(3)=3', selectionConfirmFloor(3)===3);
ck('對手場上 opp-poke 非未知資訊', !isUnknownInfoPicker(mk('opp-poke-choose','x',1,0)));
console.log('selection-ui 測試網：PASS', pass, '/ FAIL', fail.length);
for (const f of fail) console.log('  ❌', f);
process.exit(fail.length ? 1 : 0);
