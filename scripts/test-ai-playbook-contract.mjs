// 守衛：AI 打法表（static/ai-playbooks/*.json）的資料契約。
//
// 打法表是「離線分析 → 靜態 JSON → ai.ts 讀」這條路的產物。它有三個
// 「寫錯了不會報錯、只會安靜地整條規則失效」的地方，本檔逐一釘住：
//
//   ① **卡名／招式名必須與 static/cards 的台灣官方中文卡面逐字一致**。
//      打錯一個字（或用了陸譯、用了 cardId），比對就永遠不中 —— AI 只會表現成
//      「這條規則好像沒作用」，不會有任何錯誤訊息。這是本專案反覆踩過的坑
//      （reg key 卡名不符 → handler 靜默失效）。
//   ② **每條規則都必須有 why**（卡面依據或統計數字）。沒有 why 的規則，就是
//      「我覺得應該這樣打」混進了「高手是這樣打」—— 樣本只有 38 場，這個界線
//      一旦破了，整份表的可信度就沒了。
//   ③ **不得含玩家可識別資訊**。這份 JSON 會被打包成公開 static 檔，而資料來源
//      是特定玩家的對局。Wilson 已裁定不對玩家公告，更不該把暱稱寫進公開檔案。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const PB_DIR = join(ROOT, 'static/ai-playbooks');

// ── 官方卡面（唯一權威）──────────────────────────────────────────────────
const cardsDir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(cardsDir, 'index.json'), 'utf8')).map((e) => e.code));
const cardNames = new Set();
const attacksByName = new Map();
for (const f of readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(cardsDir, f), 'utf8'))) {
    // ⚠只認 H/I/J（現役標準賽），與全站「只維護 H/I/J」的規則一致
    if (!c || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    cardNames.add(c.name);
    for (const a of (c.attacks || [])) {
      if (!attacksByName.has(c.name)) attacksByName.set(c.name, new Set());
      attacksByName.get(c.name).add(a.name);
    }
  }
}

const files = existsSync(PB_DIR)
  ? readdirSync(PB_DIR).filter((f) => f.endsWith('.json')).map((f) => join(PB_DIR, f))
  : [];

T('前提：找得到打法表（找不到就是這份守衛在空轉）', () => {
  assert.ok(files.length > 0, 'static/ai-playbooks/ 下應有 .json');
  console.log('   ' + files.map((p) => p.slice(ROOT.length)).join('、'));
});

/** 遞迴收集所有「卡名」欄位（card / from / cards[] / 幾個具名清單）。 */
function collectCardRefs(o, out = new Set()) {
  if (Array.isArray(o)) { for (const x of o) collectCardRefs(x, out); return out; }
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    if ((k === 'card' || k === 'from') && typeof v === 'string') out.add(v);
    if ((k === 'requireAll' || k === 'priority' || k === 'avoid' || k === 'cards') && Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') out.add(x);
    }
    collectCardRefs(v, out);
  }
  return out;
}

for (const p of files) {
  const rel = p.slice(ROOT.length);
  const raw = readFileSync(p, 'utf8');
  let pb;

  T(`${rel}：JSON 可解析且有 schemaVersion / archetypeKey`, () => {
    pb = JSON.parse(raw);
    assert.equal(typeof pb.schemaVersion, 'number', '應有 schemaVersion（之後改格式要靠它擋舊檔）');
    assert.ok(pb.archetypeKey, '應有 archetypeKey');
  });

  T(`⭐⭐${rel}：每個卡名都要與 static/cards 官方中文卡面逐字一致`, () => {
    const refs = [...collectCardRefs(pb)];
    assert.ok(refs.length > 0, '應至少引用一張卡');
    const bad = refs.filter((n) => !cardNames.has(n));
    assert.deepEqual(bad, [],
      '這些名稱在 H/I/J 現役卡面裡查不到（打錯字／陸譯／寫成 cardId 都會讓規則永遠比不中，且不會報錯）：'
      + bad.join('、'));
    console.log(`   引用 ${refs.length} 個卡名，全部對得上`);
  });

  T(`⭐⭐${rel}：招式名要真的屬於它宣稱的那張卡`, () => {
    for (const e of (pb.darkCardAttackPriority || [])) {
      const set = attacksByName.get(e.from);
      assert.ok(set, `${e.from} 查不到招式資料`);
      assert.ok(set.has(e.attack),
        `「${e.from}」沒有招式「${e.attack}」—— 實際招式：${[...set].join('／')}`);
    }
  });

  T(`⭐⭐${rel}：每條規則都必須附 why（沒有證據的規則不得入表）`, () => {
    const missing = [];
    (function walk(o, path) {
      if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
      if (!o || typeof o !== 'object') return;
      const isRule = 'card' in o || 'attack' in o || 'target' in o || 'name' in o;
      const hasWhy = Object.keys(o).some((k) => k === 'why' || k.endsWith('Why'));
      if (isRule && !hasWhy) missing.push(`${path} → ${o.card ?? o.attack ?? o.target ?? o.name}`);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}/${k}`);
    })(pb, '');
    assert.deepEqual(missing, [], '這些規則沒有 why：\n  ' + missing.join('\n  '));
  });

  T(`⭐${rel}：不得含玩家可識別資訊（這是會被打包的公開檔）`, () => {
    // 資料來源是特定玩家的對局，但產物是公開的策略表 —— 兩者必須切乾淨。
    assert.ok(!/@/.test(raw), '不可出現 email');
    // 玩家暱稱難以窮舉，改用「來源區塊只准出現統計數字」的結構性約束
    const src = pb.source || {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string') {
        assert.ok(!/[A-Za-z0-9_]{2,}$/.test(v.trim()) || v.length > 20,
          `source.${k} 看起來像玩家識別字串：${v}`);
      }
    }
    assert.ok(!('players' in src) || typeof src.playerCount === 'number',
      'source 只該記玩家「人數」，不記是誰');
  });

  T(`⭐${rel}：載入端必須 fail-open（表壞掉不可讓對戰掛掉）`, () => {
    // 這條在 ai.ts 接線（批次 4）之前先立著：一旦有 consumer，它就必須是 fail-open。
    const aiPath = join(ROOT, 'src/lib/game/ai.ts');
    const ai = readFileSync(aiPath, 'utf8');
    if (!/ai-playbooks/.test(ai)) {
      console.log('   （ai.ts 尚未接線，此條先記錄；接線時必須是 fail-open）');
      return;
    }
    const i = ai.indexOf('ai-playbooks');
    const around = ai.slice(Math.max(0, i - 1500), i + 1500);
    assert.ok(/catch/.test(around), '讀取打法表必須包 try/catch，失敗時退回通用 AI');
  });
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
