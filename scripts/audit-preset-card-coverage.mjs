#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-audit-preset-card-coverage-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-audit-preset-card-coverage-entry.ts');
function safeUnlink(p) { try { unlinkSync(p); } catch {} }
process.on('exit', () => { safeUnlink(OUT); safeUnlink(ENTRY); });

writeFileSync(ENTRY, `
export { PRESET_DECKS } from './src/lib/decks/presets';
export {
  TRAINER_EFFECTS, TRAINER_GUARDS, ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS,
  ATTACK_PRE_DISCARD_CHOICE, BENCH_PLACE_TRIGGERS,
  SPECIAL_ENERGY_ATTACH, SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD,
  SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED,
  JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS, BENCH_PROTECTION_STADIUMS, PASSIVE_STADIUMS,
  PASSIVE_DAMAGE_REDUCE, PASSIVE_IMMUNITY, PASSIVE_RETALIATION, PASSIVE_ATTACK_BONUS,
  ON_PLAY_FROM_HAND_ABILITIES, ON_EVOLVE_FROM_HAND_ABILITIES,
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE,
  TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY, TOOL_PREVENT_KO, TOOL_ON_KO,
  TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED, TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_ATTACH_GATE, TOOL_END_TURN_DISCARD,
} from './src/lib/game/effects';
`);

await build({
  entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(REPO_ROOT, 'src/lib'), '$app/paths': join(REPO_ROOT, 'scripts/shim-app-paths.mjs') },
  logLevel: 'silent'
});
const m = await import(new URL(OUT, 'file://').href);

const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  const cards = JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'));
  for (const c of cards) pool.set(String(c.id), { ...c, __file: f });
}

const sources = [];
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(ts|svelte|mjs)$/.test(f.name)) sources.push({ path: relative(REPO_ROOT, p), text: readFileSync(p, 'utf8') });
  }
}
walk(join(REPO_ROOT, 'src/lib/game'));
walk(join(REPO_ROOT, 'src/routes/game'));

function srcHits(term) {
  if (!term) return [];
  const hits = [];
  for (const s of sources) {
    const count = s.text.split(term).length - 1;
    if (count > 0) hits.push({ path: s.path, count });
  }
  return hits.sort((a,b)=>b.count-a.count).slice(0, 8);
}
function hasText(x) { return !!(x && String(x).trim() && !/^[-—–]?$/.test(String(x).trim())); }
function textOfCard(c) { return c.text || c.effect || c.rules || c.description || ''; }
function cardKey(c) { return `${c.id}|${c.name}`; }

const presetUse = new Map();
for (const d of m.PRESET_DECKS) {
  for (const e of d.entries) {
    const id = String(e.cardId);
    if (!presetUse.has(id)) presetUse.set(id, { count: 0, decks: [] });
    presetUse.get(id).count += e.count ?? 1;
    presetUse.get(id).decks.push(d.name);
  }
}
const cards = [...presetUse.keys()].map(id => pool.get(id)).filter(Boolean)
  .sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));

const trainerMaps = [
  'TRAINER_EFFECTS','TRAINER_GUARDS',
  'TOOL_HP_BONUS','TOOL_ATTACK_BONUS','TOOL_DEFENSE_REDUCE_BY_TYPE','TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY',
  'TOOL_PREVENT_KO','TOOL_ON_KO','TOOL_PRIZE_BONUS','TOOL_ON_DAMAGED','TOOL_RETREAT_MOD','TOOL_BOTH_SIDES_RETREAT_PLUS','TOOL_ATTACH_GATE','TOOL_END_TURN_DISCARD',
  'SPECIAL_ENERGY_ATTACH','SPECIAL_ENERGY_HP_BONUS','SPECIAL_ENERGY_RETREAT_MOD','SPECIAL_ENERGY_STATUS_IMMUNE','SPECIAL_ENERGY_ON_DAMAGED',
  'JAMMING_TOWER_STADIUMS','ROCKET_WATCHTOWER_STADIUMS','BENCH_PROTECTION_STADIUMS','PASSIVE_STADIUMS'
];
const trainerImpl = new Map();
for (const mapName of trainerMaps) {
  for (const k of m[mapName].keys()) {
    if (!trainerImpl.has(k)) trainerImpl.set(k, []);
    trainerImpl.get(k).push(mapName);
  }
}

const attackImpl = new Map();
for (const mapName of ['ATTACK_PRE','ATTACK_POST','ATTACK_PRE_DISCARD_CHOICE']) {
  for (const k of m[mapName].keys()) {
    if (!attackImpl.has(k)) attackImpl.set(k, []);
    attackImpl.get(k).push(mapName);
  }
}
const abilityImpl = new Map();
for (const mapName of ['ABILITY_EFFECTS','BENCH_PLACE_TRIGGERS','ON_PLAY_FROM_HAND_ABILITIES','ON_EVOLVE_FROM_HAND_ABILITIES']) {
  for (const k of m[mapName].keys()) {
    if (!abilityImpl.has(k)) abilityImpl.set(k, []);
    abilityImpl.get(k).push(mapName);
  }
}
for (const mapName of ['PASSIVE_DAMAGE_REDUCE','PASSIVE_IMMUNITY','PASSIVE_RETALIATION','PASSIVE_ATTACK_BONUS']) {
  for (const k of m[mapName].keys()) {
    if (!abilityImpl.has(k)) abilityImpl.set(k, []);
    abilityImpl.get(k).push(mapName);
  }
}

const rows = [];
function addRow(row) { rows.push(row); }

for (const c of cards) {
  const use = presetUse.get(String(c.id));
  if (c.supertype === 'Trainer') {
    const txt = textOfCard(c);
    const maps = trainerImpl.get(c.name) || [];
    const hits = srcHits(c.name);
    const needsEffect = hasText(txt) || c.subtype === 'Pokemon Tool' || c.subtype === 'Stadium' || c.subtype === 'Supporter' || c.subtype === 'Item';
    addRow({ kind:'trainer', id:c.id, name:c.name, set:c.__file, subtype:c.subtype, text:txt, use, maps, hits,
      status: !needsEffect ? 'generic/no-text' : maps.length ? 'explicit-hook' : hits.length ? 'source-mentioned' : 'missing-suspect' });
  }
  if (c.supertype === 'Energy' && c.subtype !== 'Basic') {
    const maps = trainerImpl.get(c.name) || [];
    const hits = srcHits(c.name);
    addRow({ kind:'special-energy', id:c.id, name:c.name, set:c.__file, subtype:c.subtype, text:textOfCard(c), use, maps, hits,
      status: maps.length ? 'explicit-hook' : hits.length ? 'source-mentioned' : 'missing-suspect' });
  }
  if (c.supertype === 'Pokemon') {
    for (let i=0; i<(c.abilities || []).length; i++) {
      const a = c.abilities[i];
      const key = `${c.name}|${i}`;
      const byName = abilityImpl.get(a.name) || [];
      const byKey = abilityImpl.get(key) || [];
      const hits = [...srcHits(a.name), ...srcHits(c.name)].slice(0,8);
      addRow({ kind:'ability', id:c.id, name:c.name, set:c.__file, ability:a.name, index:i, text:a.text || a.effect || '', use,
        maps:[...byKey, ...byName], hits,
        status: byKey.length || byName.length ? 'explicit-hook' : hits.length ? 'source-mentioned' : 'missing-suspect' });
    }
    for (const atk of (c.attacks || [])) {
      const txt = atk.text || atk.effect || '';
      if (!hasText(txt)) continue;
      const key = `${c.name}|${atk.name}`;
      const maps = attackImpl.get(key) || [];
      const hits = [...srcHits(key), ...srcHits(atk.name), ...srcHits(c.name)].slice(0,8);
      addRow({ kind:'attack-text', id:c.id, name:c.name, set:c.__file, attack:atk.name, damage:atk.damage || '', text:txt, use, maps, hits,
        status: maps.length ? 'explicit-hook' : hits.length ? 'source-mentioned' : 'missing-suspect' });
    }
  }
}

const summary = {};
for (const r of rows) {
  const k = `${r.kind}:${r.status}`;
  summary[k] = (summary[k] || 0) + 1;
}
const highRisk = rows.filter(r => r.status === 'missing-suspect');
const sourceMentioned = rows.filter(r => r.status === 'source-mentioned');
const explicit = rows.filter(r => r.status === 'explicit-hook');
console.log(JSON.stringify({
  presetDecks: m.PRESET_DECKS.length,
  uniquePresetCards: cards.length,
  rows: rows.length,
  summary,
  highRisk,
  sourceMentioned,
  explicitCount: explicit.length,
}, null, 2));
