// v5.602 進化鏈 seed 不再被「不同species前綴」誤抓(咕咕≠咕咕鴿/豆豆鴿)；同線後代仍完整
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.ev-e.ts'),O=join(ROOT,'.ev-o.mjs');
process.on('exit',()=>{for(const p of [E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(E,`export { getEvolutionChainNames } from './src/lib/cards/evolutionChain';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib')},logLevel:'error'});
const {getEvolutionChainNames}=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=[];
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.push(c);}
let pass=0,fail=0; const ck=(l,c,e)=>{if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');}};
const chain=q=>getEvolutionChainNames(q,pool);
console.log('1) 咕咕 → 只含 咕咕線(咕咕/貓頭夜鷹)，不含豆豆鴿線');
{ const n=chain('咕咕');
  ck('含 咕咕', n.has('咕咕'));
  ck('含 貓頭夜鷹', n.has('貓頭夜鷹'));
  ck('不含 豆豆鴿', !n.has('豆豆鴿'), [...n].join(','));
  ck('不含 咕咕鴿', !n.has('咕咕鴿'), [...n].join(','));
  ck('不含 高傲雉雞', !n.has('高傲雉雞'), [...n].join(','));
}
console.log('2) 豆豆鴿 → 只含 豆豆鴿線，不含咕咕線');
{ const n=chain('豆豆鴿');
  ck('含 豆豆鴿/咕咕鴿/高傲雉雞', n.has('豆豆鴿')&&n.has('咕咕鴿')&&n.has('高傲雉雞'));
  ck('不含 咕咕', !n.has('咕咕'), [...n].join(','));
  ck('不含 貓頭夜鷹', !n.has('貓頭夜鷹'), [...n].join(','));
}
console.log('3) 同線後代仍完整：鬼斯 → 鬼斯通 + 耿鬼類');
{ const n=chain('鬼斯');
  ck('含 鬼斯', n.has('鬼斯'));
  ck('含 鬼斯通(BFS後代)', n.has('鬼斯通'), [...n].join(','));
  ck('含 耿鬼(BFS孫)', [...n].some(x=>x.includes('耿鬼')), [...n].join(','));
}
console.log('4) ex/超級變體同 species：甲賀忍蛙 → 含 ex / 超級ex');
{ const n=chain('甲賀忍蛙');
  ck('含 甲賀忍蛙 系', [...n].some(x=>x.includes('甲賀忍蛙')), [...n].join(','));
  ck('含 呱呱泡蛙(root)或呱頭蛙', n.has('呱呱泡蛙')||n.has('呱頭蛙'), [...n].join(','));
}
console.log('\n進化鏈前綴隔離 PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
