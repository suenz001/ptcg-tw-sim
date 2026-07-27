// 批次 4a 守衛：打法表的載入模組（ai-playbook.ts）。
//
// 這一批**刻意零消費點** —— ai.ts 還不會用它，行為與先前完全相同。
// 所以本檔要盯的是兩件事：
//   ① **fail-open**：表載不到／JSON 壞掉／版本不符，一律當「沒有表」，絕不 throw。
//      這張表是錦上添花，不是必要相依 —— 對戰不可以因為一張策略表而掛掉。
//   ② **零行為變更**：ai.ts 現在不得引用它。等接線時（批次 4b）這條會改成
//      「引用了，但必須包在 try/catch 且無表時走原路徑」。
//
// ⚠為什麼載入要跟決策分開成兩個模組：getAIAction 是**同步**的，表必須在對戰開始前
//   就備好。把 fetch 塞進決策路徑會逼它變 async，那是整條 AI 呼叫鏈的破壞性改動。
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const S = join(ROOT, '.x-pbf-s.js'), E = join(ROOT, '.x-pbf-e.ts'), O = join(ROOT, '.x-pbf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export * from './src/lib/game/ai-playbook';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const pb = await import(pathToFileURL(O).href);

const real = JSON.parse(readFileSync(join(ROOT, 'static/ai-playbooks/n-zoroark-ex.json'), 'utf8'));

T('前提：真實的打法表通得過結構檢查', () => {
  assert.ok(pb.isUsablePlaybook(real), '線上那份表應可用');
  assert.equal(real.schemaVersion, pb.PLAYBOOK_SCHEMA_VERSION);
});

T('⭐⭐結構檢查擋掉會讓消費端誤讀的輸入（但不做內容審查）', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { schemaVersion: 1 }, { archetypeKey: 'k' }]) {
    assert.equal(pb.isUsablePlaybook(bad), false, '應擋掉：' + JSON.stringify(bad));
  }
  // 版本不符要擋 —— 否則改格式後舊檔會被當新格式誤讀
  assert.equal(pb.isUsablePlaybook({ ...real, schemaVersion: 999 }), false, '版本不符應擋掉');
  // ⚠但「內容合不合理」不在這裡管（沒有卡面資料可比對，且執行期做很慢）——
  //   那是 test-ai-playbook-contract 的職責。只有必要欄位的最小表就該通過。
  assert.equal(pb.isUsablePlaybook({ schemaVersion: 1, archetypeKey: 'k' }), true,
    '只有必要欄位的最小表應可用（其餘欄位缺了＝那個決策點沒有建議）');
});

await TA('⭐⭐fail-open：HTTP 失敗回 null，不 throw', async () => {
  pb.clearPlaybook();
  const r = await pb.loadPlaybook('nope', async () => ({ ok: false, status: 404 }));
  assert.equal(r, null);
  assert.equal(pb.getPlaybook(), null);
});

await TA('⭐⭐fail-open：JSON 壞掉回 null，不 throw', async () => {
  pb.clearPlaybook();
  const r = await pb.loadPlaybook('bad', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
  assert.equal(r, null);
});

await TA('⭐⭐fail-open：fetch 直接拋（離線）回 null，不 throw', async () => {
  pb.clearPlaybook();
  const r = await pb.loadPlaybook('offline', async () => { throw new Error('network down'); });
  assert.equal(r, null);
});

await TA('⭐fail-open：版本不符的表不會被套用', async () => {
  pb.clearPlaybook();
  const r = await pb.loadPlaybook('old', async () => ({ ok: true, json: async () => ({ ...real, schemaVersion: 999 }) }));
  assert.equal(r, null, '版本不符應視為沒有表');
});

await TA('載入成功後 getPlaybook 讀得到', async () => {
  pb.clearPlaybook();
  const r = await pb.loadPlaybook('n-zoroark-ex', async () => ({ ok: true, json: async () => real }));
  assert.ok(r, '應載入成功');
  assert.equal(pb.getPlaybook()?.archetypeKey, 'n-zoroark-ex');
});

T('⭐適用判定用「卡名」比對，且必須全部滿足', () => {
  pb.setPlaybook(real);
  const need = real.detect.requireAll;
  assert.equal(pb.playbookApplies(real, new Set(need)), true, '條件齊全應適用');
  assert.equal(pb.playbookApplies(real, new Set(['隨便一張卡'])), false, '條件不符不應適用');
  assert.equal(pb.playbookApplies(null, new Set(need)), false, '沒有表就不適用');
  // 沒有 detect 條件的表不該被「預設套用到所有牌組」
  assert.equal(pb.playbookApplies({ schemaVersion: 1, archetypeKey: 'k' }, new Set(['x'])), false);
});

T('查詢 helper 對「表裡沒列到」的輸入要有安全預設', () => {
  assert.equal(pb.benchScoreOf(real, '不存在的卡'), 0, '沒列到＝0 分，交回通用邏輯排');
  assert.equal(pb.benchScoreOf(null, 'N的捷克羅姆'), 0, '沒有表也要能問');
  assert.equal(pb.copyAttackScoreOf(real, 'N的捷克羅姆', '亂暴閃電') > 0, true);
  assert.equal(pb.copyAttackScoreOf(real, 'N的捷克羅姆', '不存在的招'), 0);
  assert.equal(pb.discardRankOf(real, '不存在的卡'), Infinity, '沒列到＝最後才丟');
  assert.equal(pb.isNeverDiscard(null, 'x'), false);
});

T('⭐表內容真的被讀出來（不是空殼通過）', () => {
  assert.ok(pb.benchScoreOf(real, 'N的捷克羅姆') >= 90,
    '捷克羅姆是 250 傷害的唯一來源，備戰分數應很高');
  assert.equal(pb.isNeverDiscard(real, 'N的捷克羅姆'), true, '它應在「絕不丟棄」清單');
  assert.equal(pb.discardRankOf(real, '基本【惡】能量'), 0, '惡能量應是最優先丟的（可用ＰＰ提升劑撿回）');
});

T('⭐⭐本批次零消費點：ai.ts 尚未引用打法表（行為必須與先前完全一致）', () => {
  const ai = readFileSync(join(ROOT, 'src/lib/game/ai.ts'), 'utf8');
  assert.ok(!/ai-playbook/.test(ai),
    '批次 4a 是 Foundation，ai.ts 不得引用 —— 接線是批次 4b，屆時請把這條改成'
    + '「引用了，但必須 try/catch 且無表時走原路徑」');
});

T('⭐載入模組不可反向 import engine／effects（module-init 循環相依會讓對戰頁白屏）', () => {
  // v5.985 事故：engine.ts 反向 import 卡檔造成 rollup 初始化順序 TDZ，
  //   完整 npm test 全綠、deploy 全綠，只有瀏覽器實際載入才炸。方向永遠是單向的。
  const src = readFileSync(join(ROOT, 'src/lib/game/ai-playbook.ts'), 'utf8');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const bad = imports.filter((i) => /game\/(engine|effects)/.test(i));
  assert.deepEqual(bad, [], 'ai-playbook.ts 應是葉子模組，不可 import engine／effects：' + bad.join('、'));
  console.log('   imports: ' + imports.join('、'));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
