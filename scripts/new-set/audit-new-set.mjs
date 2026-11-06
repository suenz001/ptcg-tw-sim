#!/usr/bin/env node
/**
 * 新卡包工具組 ②：新卡包資料與實裝的一次性檢查（只讀，不改任何檔）
 *
 * 由來（2026-11-07，站長：「官方預計在11月底推出新的擴充包 波導探求者……務必抓取推出的新卡和卡包，
 *   並且完成卡牌功能實裝，並符合官方的規則與判例，降低錯誤」）：把過去補卡包踩過的坑寫成可重跑的檢查，
 *   新卡包一抓回來（還沒併表、或剛併表）就跑一次，紅的地方先處理再實裝。
 *
 * 用法：
 *   node scripts/new-set/audit-new-set.mjs M7 --staging .new-set/M7/cards.json   爬蟲暫存檔（還沒併表）
 *   node scripts/new-set/audit-new-set.mjs M6                                     已併表的卡包（讀 static/cards）
 *   node scripts/new-set/audit-new-set.mjs M6 --src-root /tmp/old                 用另一份 src（例如歷史版本）判斷「有沒有實裝」
 *   --md 檔案   另存 Markdown 報告
 *
 * 【A】資料（每一條都是踩過的坑，出處寫在旁邊）
 *   A1 規則標記：只收 H／I／J（站長裁定）。出現**新標記**（例如 K）⇒ ⛔ 停下來問站長，不可自己決定收不收
 *   A2 卡片 id 一律字串、不可與站上既有 id 撞號（v6.616 數字 id 讓前端卡池一直全量重載；v6.328 自造 id 撞官方 id）
 *   A3 進化：1／2 階一定有 evolvesFrom、基礎沒有；來源卡存在且剛好低一階；ex 不可從「去掉 ex／超級」的同名卡進化（站長多次提醒）
 *   A4 兩張合一的競技場（collectorNumber 含逗號）⇒ 要拆出 `<id>-1` 右半（M6 傳說競技場）
 *   A5 欄位完整：寶可夢有 hp／pokemonType／attacks 或 abilities；訓練家有 rulesText（訓練家卡面在 rulesText，不在 effect）
 *   A6 超級進化 ex（含名字有 Z／X 的）：isMegaExCard 同一判準（卡名以「超級」開頭且 subtype ex）⇒ 被擊倒給 3 張
 * 【B】實裝（用 esbuild 讀「真實註冊表」，不是 regex 猜）
 *   B1 招式：`卡名|招式名` 有沒有 handler；沒有的話列出「卡面逐字相同、已實裝」的範本
 *      ⚠ 範本可能本身是錯的（v6.064 好啦魷｜拍落照抄到既有 bug）⇒ 範本只是線索，要先查有沒有裁定註解
 *   B2 ⛔ 同名同招、卡面不同：ATTACK_PRE 的 key 沒有印刷維度，舊印刷的 handler 會套到新卡上（skill ptcg-guard-hygiene）
 *   B3 特性：特性名在程式裡完全沒出現 ⇒ 一定沒實裝；有出現但站上同名特性卡面不同 ⇒ ⛔ 名稱撞號（被動特性多以特性名為 key）
 *   B4 訓練家：TRAINER_EFFECTS 有沒有同名 handler；同名但 rulesText 不同 ⇒ ⛔ 撞號（舊卡的效果會直接套上來）
 *      沒有 handler 的物品／支援者／道具會自動 fail-closed（v6.066），競技場要另外登記 PENDING_STADIUMS
 * 【C】官方判例：scripts/data/official-qa.json 裡跟這個卡包有關、而規則書還沒收錄的條數（先跑 fetch-official-qa.mjs）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rulesQuestions, normQ } from './fetch-official-qa.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const ALLOWED_MARKS = new Set(['H', 'I', 'J']);
const KNOWN_OLD_MARKS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const PREV = { Stage1: 'Basic', Stage2: 'Stage1' };

export function parseArgs(argv) {
  const a = { set: null, staging: null, srcRoot: null, md: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--staging') a.staging = argv[++i];
    else if (k === '--src-root') a.srcRoot = argv[++i];
    else if (k === '--md') a.md = argv[++i];
    else if (k.startsWith('--')) throw new Error('未知參數：' + k);
    else if (!a.set) a.set = k;
    else throw new Error('多餘參數：' + k);
  }
  if (!a.set) throw new Error('用法：node scripts/new-set/audit-new-set.mjs <卡包代號> [--staging 暫存.json] [--src-root 目錄] [--md 報告.md]');
  return a;
}

/** 站上 live 卡池（index.json 有列的卡包；同一卡包按標拆檔也算） */
export function loadSitePool(root = ROOT) {
  const dir = join(root, 'static/cards');
  const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || f.includes('_')) continue;
    const code = f.slice(0, -5);
    if (!live.has(code)) continue;
    let d; try { d = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (Array.isArray(d)) for (const c of d) if (c && c.name) out.push({ ...c, _file: f });
  }
  return out;
}

const stripEx = (n) => String(n).replace(/^超級/, '').replace(/\s*(ex|EX)$/, '').replace(/[XYZ]$/, '');
export const isMegaName = (c) => c?.supertype === 'Pokemon' && c.subtype === 'ex' && String(c.name).startsWith('超級');
const norm = (s) => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, '');

/** 【A】資料檢查。setCards＝新卡包的卡；pool＝站上 live 卡池（不含新卡包本身時也可以） */
export function auditData(setCards, pool) {
  const out = { stop: [], warn: [], info: [] };
  const marks = new Map();
  for (const c of setCards) marks.set(c.regulationMark ?? '（無）', (marks.get(c.regulationMark ?? '（無）') || 0) + 1);
  out.info.push('規則標記分佈：' + [...marks].map(([k, v]) => `${k}×${v}`).join('、'));
  for (const [m, n] of marks) {
    if (ALLOWED_MARKS.has(m)) continue;
    if (KNOWN_OLD_MARKS.has(m) || m === '（無）') out.warn.push(`A1 有 ${n} 張標記為「${m}」：不在 H／I／J，依站長裁定不收（基本能量沒有標記屬正常）——仍要看卡圖確認官網沒標錯`);
    else out.stop.push(`A1 ⛔ 出現新的規則標記「${m}」（${n} 張）：站上只維護 H／I／J。收不收、要不要把「${m}」加進標準賽，必須先問站長，不可自己決定`);
  }
  const siteIds = new Map(pool.map((c) => [String(c.id), c]));
  const seen = new Set();
  for (const c of setCards) {
    if (typeof c.id !== 'string') out.stop.push(`A2 ⛔ ${c.name} 的 id 不是字串（${JSON.stringify(c.id)}）：前端卡池以字串查，數字 id 會讓卡池一直全量重載`);
    if (seen.has(String(c.id))) out.stop.push(`A2 ⛔ 卡包內 id 重複：${c.id}`);
    seen.add(String(c.id));
    const old = siteIds.get(String(c.id));
    if (old && old._file && !old._file.startsWith(c.setCode ?? '')) out.stop.push(`A2 ⛔ id ${c.id}（${c.name}）與站上 ${old._file} 的「${old.name}」撞號`);
  }
  const byName = new Map();
  for (const c of [...pool, ...setCards]) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  for (const c of setCards) {
    if (c.supertype !== 'Pokemon') continue;
    const stage = c.stage ?? (['Basic', 'Stage1', 'Stage2'].includes(c.subtype) ? c.subtype : null);
    if (!stage) { out.stop.push(`A3 ⛔ ${c.name}（${c.id}）沒有 stage`); continue; }
    if (stage === 'Basic' && c.evolvesFrom) out.stop.push(`A3 ⛔ 基礎寶可夢 ${c.name}（${c.id}）卻有 evolvesFrom「${c.evolvesFrom}」`);
    if (stage !== 'Basic') {
      if (!c.evolvesFrom) { out.stop.push(`A3 ⛔ ${stage} ${c.name}（${c.id}）沒有 evolvesFrom（化石系 1 階要補「陳舊的○○化石」）`); continue; }
      const src = byName.get(c.evolvesFrom) ?? [];
      const okStage = src.some((s) => (s.supertype === 'Trainer' && /化石/.test(s.name) && stage === 'Stage1')
        || (s.stage ?? s.subtype) === PREV[stage]);
      if (!src.length) out.stop.push(`A3 ⛔ ${c.name}（${c.id}）的進化來源「${c.evolvesFrom}」站上與新卡包都沒有`);
      else if (!okStage) out.stop.push(`A3 ⛔ ${c.name}（${c.id}，${stage}）← 「${c.evolvesFrom}」階段不是剛好低一階`);
      if (/ex$/i.test(c.name) && c.evolvesFrom && stripEx(c.name) === stripEx(c.evolvesFrom) && !/ex$/i.test(c.evolvesFrom))
        out.stop.push(`A3 ⛔ ${c.name} ← ${c.evolvesFrom}：ex 是平行的一張卡，從**前一階**進化，不是從同名非 ex 卡`);
    }
  }
  for (const c of setCards) {
    if (/,/.test(String(c.collectorNumber ?? ''))) {
      const hasRight = setCards.some((x) => String(x.id) === `${c.id}-1`);
      (hasRight ? out.info : out.warn).push(`A4 兩張合一的卡：${c.name}（${c.collectorNumber}）${hasRight ? '已有右半' : '⇒ 要拆出 `' + c.id + '-1` 右半（比照 M6 傳說競技場；自造 id 不可是純數字）'}`);
    }
    if (c.supertype === 'Pokemon') {
      if (!(Number(c.hp) > 0)) out.stop.push(`A5 ⛔ ${c.name}（${c.id}）沒有 HP`);
      if (!c.pokemonType) out.warn.push(`A5 ${c.name}（${c.id}）沒有屬性（pokemonType）`);
      if (!(c.attacks?.length) && !(c.abilities?.length)) out.warn.push(`A5 ${c.name}（${c.id}）沒有招式也沒有特性`);
      for (const ab of c.abilities ?? []) if (!String(ab.effect ?? '').trim()) out.stop.push(`A5 ⛔ ${c.name} 的特性「${ab.name}」沒有 effect（特性卡面在 abilities[].effect）`);
    } else if (c.supertype === 'Trainer' && !String(c.rulesText ?? '').trim()) out.stop.push(`A5 ⛔ 訓練家 ${c.name}（${c.id}）沒有 rulesText`);
  }
  const megas = setCards.filter(isMegaName);
  if (megas.length) out.info.push(`A6 超級進化 ex ${megas.length} 張（被擊倒給 3 張獎賞，卡面「超級進化寶可夢ex」判準相同）：` + [...new Set(megas.map((c) => c.name))].join('、'));
  const oddMega = setCards.filter((c) => c.supertype === 'Pokemon' && String(c.name).startsWith('超級') && c.subtype !== 'ex');
  for (const c of oddMega) out.stop.push(`A6 ⛔ ${c.name}（${c.id}）名字以「超級」開頭但 subtype 不是 ex（${c.subtype}）⇒ 不會被當成超級進化 ex`);
  return out;
}

/** 讀真實註冊表（esbuild 打包 effects.ts；srcRoot 可指向另一份 src，例如歷史版本） */
export async function loadRegistry(srcRoot = ROOT) {
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ENTRY = join(srcRoot, `.tmp-nsa-${tag}.ts`), OUT = join(srcRoot, `.tmp-nsa-${tag}.mjs`), SHIM = join(srcRoot, `.tmp-nsa-${tag}-shim.mjs`);
  const clean = () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } };
  process.on('exit', clean);
  writeFileSync(SHIM, 'export const base="";export const assets="";');
  writeFileSync(ENTRY, `export * as SH from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
  try {
    await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': SHIM, '$app/environment': SHIM }, logLevel: 'error' });
    const { SH } = await import(pathToFileURL(OUT).href);
    const keys = (m) => new Set(m && typeof m.keys === 'function' ? [...m.keys()] : []);
    const attack = new Set([...keys(SH.ATTACK_PRE), ...keys(SH.ATTACK_POST), ...keys(SH.ATTACK_PRE_DISCARD_CHOICE), ...keys(SH.ATTACK_AFTER_KO)]);
    // 每個招式 key 的 handler「長相」（函式原始碼）：卡面逐字相同的範本若有好幾種不同寫法 ⇒ 至少一種是錯的
    const fnSig = new Map();
    for (const [nm, mp] of [['PRE', SH.ATTACK_PRE], ['POST', SH.ATTACK_POST], ['DISC', SH.ATTACK_PRE_DISCARD_CHOICE], ['KO', SH.ATTACK_AFTER_KO]]) {
      if (!mp || typeof mp.entries !== 'function') continue;
      for (const [k, fn] of mp.entries()) fnSig.set(k, (fnSig.get(k) ?? '') + nm + ':' + String(fn).replace(/\s+/g, ' ') + '\n');
    }
    const trainer = keys(SH.TRAINER_EFFECTS);
    // 程式全文（特性多半散在各種以特性名為 key 的表裡，用字面出現與否當「一定沒實裝」的判準）
    let srcText = '';
    const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(ts|svelte)$/.test(n)) srcText += readFileSync(p, 'utf8') + '\n'; } };
    walk(join(srcRoot, 'src/lib/game'));
    const engineSrc = readFileSync(join(srcRoot, 'src/lib/game/engine.ts'), 'utf8');
    const nameHandled = new Set();
    const m = engineSrc.match(/BENCH_FILL_ATTACK_NAMES = new Set<string>\(\[([\s\S]*?)\]\)/);
    if (m) for (const mm of m[1].matchAll(/'([^']+)'/g)) nameHandled.add(mm[1]);
    return { attack, trainer, srcText, nameHandled, fnSig };
  } finally { clean(); }
}

/** 【B】實裝檢查 */
export function auditImpl(setCards, pool, reg) {
  const out = { stop: [], todo: [], ok: [], info: [] };
  const live = pool.filter((c) => ALLOWED_MARKS.has(c.regulationMark));
  const setIds = new Set(setCards.map((c) => String(c.id)));
  const others = live.filter((c) => !setIds.has(String(c.id)));
  // 卡面逐字相同的範本（招式 effect）：自我卡名替換成 <SELF> 再比
  const attackIndex = new Map();
  for (const c of others) for (const a of c.attacks ?? []) {
    const e = norm(a.effect); if (!e) continue;
    const k = norm(String(a.effect).split(c.name).join('<SELF>'));
    if (!attackIndex.has(k)) attackIndex.set(k, []);
    attackIndex.get(k).push({ key: `${c.name}|${a.name}`, reg: reg.attack.has(`${c.name}|${a.name}`) || reg.nameHandled.has(a.name) });
  }
  const byKeyText = new Map();
  for (const c of others) for (const a of c.attacks ?? []) { const k = `${c.name}|${a.name}`; if (!byKeyText.has(k)) byKeyText.set(k, new Set()); byKeyText.get(k).add(norm(a.effect) + '§' + String(a.damage ?? '')); }
  const abilityText = new Map();
  for (const c of others) for (const ab of c.abilities ?? []) { if (!abilityText.has(ab.name)) abilityText.set(ab.name, new Map()); abilityText.get(ab.name).set(norm(ab.effect), c.name); }
  const trainerText = new Map();
  for (const c of others) if (c.supertype === 'Trainer') { if (!trainerText.has(c.name)) trainerText.set(c.name, new Set()); trainerText.get(c.name).add(norm(c.rulesText)); }
  const done = new Set();
  for (const c of setCards) {
    if (!ALLOWED_MARKS.has(c.regulationMark)) continue;
    if (c.supertype === 'Pokemon') {
      for (const a of c.attacks ?? []) {
        const key = `${c.name}|${a.name}`;
        if (done.has('A' + key)) continue; done.add('A' + key);
        const eff = norm(a.effect);
        const prior = byKeyText.get(key);
        if (prior && ![...prior].includes(eff + '§' + String(a.damage ?? '')))
          out.stop.push(`B2 ⛔ ${key}：站上已有同名同招但卡面／傷害不同的印刷 ⇒ handler 會共用，要走 faceAttackDamage／faceAttackEffect 印刷閘並實跑兩張`);
        if (!eff) continue;
        if (reg.attack.has(key) || reg.nameHandled.has(a.name)) { out.ok.push(`招式 ${key}`); continue; }
        const twins = attackIndex.get(norm(String(a.effect).split(c.name).join('<SELF>'))) ?? [];
        const regTwins = [...new Set(twins.filter((t) => t.reg).map((t) => t.key))];
        // 範本之間的寫法是否一致（函式原始碼分組）。不一致 ⇒ 同一句卡面有兩種行為，照抄前要先找出哪一種才對
        const groups = new Map();
        for (const k of regTwins) { const sig = reg.fnSig?.get(k) ?? '（招式名層級 handler）'; if (!groups.has(sig)) groups.set(sig, []); groups.get(sig).push(k); }
        let line = `B1 招式未實裝 ${key}：${String(a.effect).slice(0, 60)}`;
        if (!regTwins.length) line += '\n      沒有卡面逐字相同的範本 ⇒ 新機制，先查官方判例';
        else if (groups.size > 1) line += `\n      ⚠ 卡面逐字相同的範本 ${regTwins.length} 個、但有 ${groups.size} 種不同寫法：` + [...groups.values()].map((g) => g.slice(0, 3).join('、') + (g.length > 3 ? `…共 ${g.length}` : '')).join('　｜　') + '\n         ⇒ 可能只是寫法不同，也可能有一種是錯的（v6.064 拍落就是這樣）：先找裁定紀錄、挑有註解說明的那份，必要時先收斂既有卡';
        else line += `\n      卡面逐字相同、已實裝的範本 ${regTwins.length} 個（寫法一致）：${regTwins.slice(0, 4).join('、')}（⚠ 一致也可能一起錯：先查該措辭有沒有裁定紀錄）`;
        out.todo.push(line);
      }
      for (const ab of c.abilities ?? []) {
        if (done.has('B' + ab.name)) continue; done.add('B' + ab.name);
        const prior = abilityText.get(ab.name);
        const eff = norm(ab.effect);
        if (prior && !prior.has(eff)) out.stop.push(`B3 ⛔ 特性「${ab.name}」（${c.name}）：站上已有同名特性但卡面不同（${[...prior.values()].join('、')}）⇒ 以特性名為 key 的被動效果會套錯`);
        const appears = reg.srcText.includes(`'${ab.name}'`) || reg.srcText.includes(`"${ab.name}"`) || reg.srcText.includes(`|${ab.name}'`) || reg.srcText.includes(`|${ab.name}"`);
        if (prior && prior.has(eff) && appears) out.ok.push(`特性 ${c.name}｜${ab.name}（與 ${prior.get(eff)} 同卡面，既有實作會自動套用——仍要寫實跑守衛）`);
        else if (!appears) out.todo.push(`B3 特性未實裝 ${c.name}｜${ab.name}：${String(ab.effect).slice(0, 60)}（程式裡完全沒有這個特性名）`);
        else if (!prior) out.ok.push(`特性 ${c.name}｜${ab.name}（特性名只屬於這張卡，程式裡有出現）`);
        else out.info.push(`B3 特性名「${ab.name}」程式裡有出現（${c.name}）⇒ 要人工確認是不是同一張卡的實作`);
      }
    } else if (c.supertype === 'Trainer') {
      if (done.has('T' + c.name)) continue; done.add('T' + c.name);
      const prior = trainerText.get(c.name);
      const eff = norm(c.rulesText);
      if (prior && !prior.has(eff)) out.stop.push(`B4 ⛔ 訓練家「${c.name}」：站上已有同名卡但卡面不同 ⇒ 既有 handler 會直接套到新卡上，先比對兩份卡面`);
      if (c.subtype === 'Stadium') {
        const appears = reg.srcText.includes(`'${c.name}'`) || reg.srcText.includes(`"${c.name}"`);
        (appears ? out.info : out.todo).push(`B4 競技場 ${c.name}：${appears ? '程式裡有出現，人工確認' : '未實裝 ⇒ 實裝前先登記 PENDING_STADIUMS（fail-closed）'}`);
      } else if (reg.trainer.has(c.name)) out.ok.push(`訓練家 ${c.name}${prior && prior.has(eff) ? '（與既有同名卡同卡面）' : ''}`);
      else out.todo.push(`B4 訓練家未實裝 ${c.name}（${c.subtype}）：${String(c.rulesText).slice(0, 60)}（物品／支援者／道具會自動 fail-closed）`);
    }
  }
  return out;
}

/** 【C】官方判例 */
export function auditQa(setCards, qaSnap, rulesMd) {
  if (!qaSnap) return { text: 'C 沒有 scripts/data/official-qa.json ⇒ 先跑 node scripts/new-set/fetch-official-qa.mjs --set <代號> --write', missing: [] };
  const ids = new Set(setCards.map((c) => String(c.id).replace(/-\d+$/, '')));
  const rq = rulesQuestions(rulesMd);
  const rel = qaSnap.items.filter((it) => it.cards.some((c) => ids.has(String(c.id))));
  const missing = rel.filter((it) => !rq.has(normQ(it.q)));
  return { text: `C 官方判例：與本卡包有關 ${rel.length} 筆，規則書尚未收錄 ${missing.length} 筆（每一筆都要用 applyAction 實跑比對）`, missing };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = loadSitePool();
  let setCards;
  if (args.staging) setCards = JSON.parse(readFileSync(args.staging, 'utf8'));
  else setCards = pool.filter((c) => c._file === `${args.set}.json` || c._file.startsWith(`${args.set}-`));
  if (!setCards.length) throw new Error(`找不到 ${args.set} 的卡（站上沒有，也沒給 --staging）`);
  const poolNoSet = args.staging ? pool : pool.filter((c) => !setCards.includes(c));
  const A = auditData(setCards, poolNoSet.concat(args.staging ? [] : []));
  const reg = await loadRegistry(args.srcRoot ? resolve(args.srcRoot) : ROOT);
  const B = auditImpl(setCards, pool.concat(args.staging ? setCards.map((c) => ({ ...c, _file: '(staging)' })) : []), reg);
  const qaPath = join(ROOT, 'scripts/data/official-qa.json');
  const C = auditQa(setCards, existsSync(qaPath) ? JSON.parse(readFileSync(qaPath, 'utf8')) : null, readFileSync(join(ROOT, 'PTCG RULES/PTCG_RULES.md'), 'utf8'));
  const L = [];
  L.push(`# 新卡包檢查：${args.set}（${setCards.length} 張）`, '');
  const sec = (title, arr) => { L.push(`## ${title}（${arr.length}）`); for (const x of arr) L.push('- ' + x); L.push(''); };
  sec('⛔ 必須先處理（資料）', A.stop); sec('⚠ 注意（資料）', A.warn); sec('資料資訊', A.info);
  sec('⛔ 必須先處理（實裝撞號）', B.stop); sec('待實裝', B.todo); sec('需人工確認', B.info);
  L.push(`## 已實裝（${B.ok.length}）`, B.ok.length ? '- ' + B.ok.slice(0, 400).join('\n- ') : '', '');
  L.push('## 官方判例', C.text, '');
  for (const it of C.missing.slice(0, 200)) L.push(`- ${it.cards.map((c) => c.name).join('＋')}：${it.q}　⇒ ${it.a.replace(/\s+/g, ' ')}`);
  const text = L.join('\n');
  if (args.md) writeFileSync(args.md, text + '\n');
  console.log(`⛔ 資料 ${A.stop.length}／⚠ ${A.warn.length}／⛔ 撞號 ${B.stop.length}／待實裝 ${B.todo.length}／人工確認 ${B.info.length}／已實裝 ${B.ok.length}／${C.text}`);
  console.log(text.split('\n## 已實裝')[0]);
  process.exitCode = A.stop.length || B.stop.length ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
}
