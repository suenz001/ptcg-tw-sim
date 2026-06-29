/**
 * v5.758 一勞永逸守衛:M5 卡名/招式名一律以 static/cards 官方(M5.json)為準。
 * 防止 m5_preview.ts 等用 preview/legacy 舊譯名(如 光子密碼→光子纜線、增光→亮光增長)的回歸。
 *  (1) m5_preview.ts 的 addLog/顯示字串名,不得是「該卡 legacy 招式名但與官方不同」者。
 *  (2) engine.ts BENCH_FILL_ATTACK_NAMES 必含 M5 純放備戰招式的官方名(燈火幽靈/螺釘地鼠/下石鳥)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SC = join(ROOT, 'static/cards');
function cardMoves(files) {
  const d = {};
  for (const f of files) {
    let cards; try { cards = JSON.parse(readFileSync(join(SC, f), 'utf8')); } catch { continue; }
    for (const c of cards) {
      if (!c?.name) continue;
      const s = (d[c.name] ??= new Set());
      for (const a of (c.abilities || [])) s.add(a.name);
      for (const a of (c.attacks || [])) s.add(a.name);
    }
  }
  return d;
}
const legacy = cardMoves(['M5_jp_legacy.json', 'M5_translate.json']);
const official = cardMoves(['M5.json']);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// (1) m5_preview 顯示名不得用 legacy 名(與官方不同者)
T('m5_preview 顯示字串名一律官方(無 legacy 殘留)', () => {
  const lines = readFileSync(join(ROOT, 'src/lib/game/effects/cards/m5_preview.ts'), 'utf8').split('\n');
  const reg = /reg[A-Za-z]*\('([^']+)\|([^']+)'/;
  const nm = /['`]([一-鿿]{2,8})：/g;
  let cur = null; const bad = [];
  for (const line of lines) {
    const m = reg.exec(line); if (m) cur = [m[1], m[2]];
    if (line.includes('addLog') || line.includes('：')) {
      let x; nm.lastIndex = 0;
      while ((x = nm.exec(line))) {
        const name = x[1];
        if (cur && name !== cur[1] && (legacy[cur[0]]?.has(name)) && (official[cur[0]]?.has(cur[1]))) bad.push(`${cur[0]}:「${name}」應為「${cur[1]}」`);
      }
    }
  }
  assert.equal(bad.length, 0, '殘留 legacy 顯示名: ' + bad.slice(0, 5).join('; '));
});

// (2) BENCH_FILL 必含 M5 純放備戰招式官方名
T('engine BENCH_FILL 含 M5 官方放備戰招式名', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  for (const n of ['呼朋引伴', '亮光增長', '親送挑戰']) {
    assert.ok(eng.includes(`'${n}',`), `BENCH_FILL 缺官方名「${n}」`);
  }
});

console.log('\nM5 官方名守衛:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
