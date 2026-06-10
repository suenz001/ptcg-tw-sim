// 伺服器權威用：把遊戲引擎打包成 Node CJS bundle，給 Oracle 伺服器(server_admin_patch.js)require。
//   輸出 oracle-admin/tournament/server-engine.cjs，export { createGame, applyAction, buildPool }
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = join(ROOT, 'oracle-admin/tournament/.appstub.js');
writeFileSync(STUB, 'export const base = "";');
const ENTRY = join(ROOT, 'oracle-admin/tournament/.engine-entry.ts');
writeFileSync(ENTRY, `
import { createGame, applyAction } from '$lib/game/engine';
import type { Card } from '$lib/cards/types';
// buildPool：從 static/cards/*.json 組 pool（伺服器端用 fs 讀，故這裡只 re-export engine 函式）
export { createGame, applyAction };
export type { Card };
`);
await build({
  entryPoints: [ENTRY],
  outfile: join(ROOT, 'oracle-admin/tournament/server-engine.cjs'),
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': STUB },
  logLevel: 'error',
});
try { unlinkSync(STUB); unlinkSync(ENTRY); } catch {}
console.log('OK: oracle-admin/tournament/server-engine.cjs 已產生');
// 同時輸出 live 卡池(伺服器 require 用，免在 VM 找 static/cards)
import { readFileSync, readdirSync } from 'node:fs';
const CARDS = join(ROOT, 'static/cards');
const liveCodes = new Set(JSON.parse(readFileSync(join(CARDS, 'index.json'), 'utf8')).map((e) => e.code));
const poolObj = {};
for (const f of readdirSync(CARDS)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CARDS, f), 'utf8'))) if (c && c.id != null) poolObj[String(c.id)] = c;
}
writeFileSync(join(ROOT, 'oracle-admin/tournament/tournament-pool.json'), JSON.stringify(poolObj));
console.log('OK: tournament-pool.json 已產生（' + Object.keys(poolObj).length + ' 張卡）');

