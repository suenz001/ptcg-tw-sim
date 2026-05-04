import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cardsDir = path.join(root, 'static', 'cards');
const codeFiles = [
  path.join(root, 'src', 'lib', 'game', 'effects.ts'),
  path.join(root, 'src', 'lib', 'game', 'effects', '_shared.ts'),
  path.join(root, 'src', 'lib', 'game', 'engine.ts'),
].filter((p) => fs.existsSync(p));

const codeText = codeFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.cards ?? []);
}

function hasSpecialDamage(damage = '') {
  return /[+×x\-]/.test(String(damage));
}

function implementationEvidence(cardName, effectName, kind) {
  const exactCandidates = [
    `${cardName}|${effectName}`,
    `${cardName}｜${effectName}`,
    `regPre('${cardName}|${effectName}'`,
    `regPost('${cardName}|${effectName}'`,
    `regPre('${cardName}｜${effectName}'`,
    `regPost('${cardName}｜${effectName}'`,
    `regA('${cardName}|${effectName}'`,
    `regA('${cardName}｜${effectName}'`,
  ];
  const exactMatches = exactCandidates.filter((s) => s && codeText.includes(s));

  const nameOnlyCandidates = [
    `|${effectName}'`,
    `｜${effectName}'`,
    effectName,
  ];
  const nameOnlyMatches = nameOnlyCandidates.filter((s) => s && codeText.includes(s));

  return {
    exact: exactMatches.length > 0,
    nameOnly: nameOnlyMatches.length > 0,
    exactMatches,
    nameOnlyMatches: nameOnlyMatches.slice(0, 5),
    kind,
  };
}

function statusFor(category, evidence) {
  if (category === 'pure-damage' || category === 'no-structured-effect') return 'not-needed';
  if (evidence.exact) return 'implemented';
  if (evidence.nameOnly) return 'needs-review';
  return 'missing';
}

function categorize(kind, damage, text) {
  const t = text || '';
  if (kind === 'Ability') {
    if (/受到招式的傷害.*[-「0-9]/.test(t)) return 'passive-damage-reduce';
    if (/最大HP/.test(t)) return 'passive-max-hp';
    if (/在自己的回合時可使用/.test(t)) return 'active-ability';
    if (/只要這隻寶可夢在場上/.test(t)) return 'field-passive';
    return 'ability-other';
  }
  if (!t.trim() && !hasSpecialDamage(damage)) return 'pure-damage';
  if (/中毒|睡眠|麻痺|灼傷|混亂/.test(t)) return 'status-condition';
  if (/無法撤退/.test(t)) return 'cannot-retreat';
  if (/擲.*硬幣|硬幣/.test(t)) return 'coin-flip';
  if (/恢復/.test(t)) return 'heal';
  if (/牌庫/.test(t)) return 'deck-search-or-deck-op';
  if (/棄牌區/.test(t)) return 'discard-pile-op';
  if (/手牌/.test(t)) return 'hand-op';
  if (/備戰/.test(t) && /受到[0-9]+點傷害/.test(t)) return 'bench-damage';
  if (/能量/.test(t) && /丟棄|改附|附於|附加/.test(t)) return 'energy-op';
  if (hasSpecialDamage(damage)) return 'variable-damage';
  if (/下個.*回合|無法使用|受到招式的傷害時/.test(t)) return 'cross-turn-effect';
  return 'attack-other';
}

function priorityFor(category) {
  if (category === 'pure-damage') return 'P0-none';
  if (['status-condition', 'cannot-retreat', 'coin-flip', 'heal', 'bench-damage', 'variable-damage'].includes(category)) return 'P1';
  if (['deck-search-or-deck-op', 'discard-pile-op', 'hand-op', 'energy-op'].includes(category)) return 'P2';
  if (['active-ability'].includes(category)) return 'P3';
  if (['passive-damage-reduce', 'passive-max-hp', 'field-passive', 'cross-turn-effect'].includes(category)) return 'P3';
  return 'P4';
}

function makeRecord(base, fields) {
  const evidence = implementationEvidence(base.name, fields.effectName, fields.kind);
  const implementationStatus = statusFor(fields.category, evidence);
  return {
    ...base,
    ...fields,
    implementedGuess: implementationStatus === 'implemented',
    implementationStatus,
    implementationEvidence: evidence,
  };
}

const records = [];
const files = fs.readdirSync(cardsDir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
for (const file of files) {
  const full = path.join(cardsDir, file);
  const cards = readJson(full);
  for (const card of cards) {
    if (card.regulationMark !== 'J') continue;
    const base = {
      id: card.id ?? null,
      setFile: file,
      setCode: card.setCode ?? path.basename(file, '.json'),
      name: card.name,
      regulationMark: card.regulationMark,
      cardType: card.cardType ?? null,
      hp: card.hp ?? null,
      pokemonType: card.pokemonType ?? null,
    };
    for (const ability of (card.abilities ?? [])) {
      const category = categorize('Ability', '', ability.effect ?? '');
      records.push(makeRecord(base, {
        kind: 'Ability',
        effectName: ability.name,
        label: ability.label ?? null,
        damage: '',
        cost: [],
        effectText: ability.effect ?? '',
        category,
        priority: priorityFor(category),
      }));
    }
    for (const attack of (card.attacks ?? [])) {
      const category = categorize('Attack', attack.damage ?? '', attack.effect ?? '');
      records.push(makeRecord(base, {
        kind: 'Attack',
        effectName: attack.name,
        label: null,
        damage: attack.damage ?? '',
        cost: attack.cost ?? [],
        effectText: attack.effect ?? '',
        category,
        priority: priorityFor(category),
      }));
    }
    if (!(card.abilities?.length) && !(card.attacks?.length)) {
      const category = card.effects ? 'trainer-or-card-effect' : 'no-structured-effect';
      records.push(makeRecord(base, {
        kind: 'Card',
        effectName: card.name,
        label: null,
        damage: '',
        cost: [],
        effectText: card.effects ?? '',
        category,
        priority: card.effects ? 'P2' : 'P4',
      }));
    }
  }
}

const missingRecords = records.filter((r) => r.implementationStatus === 'missing');
const summary = {
  generatedAt: new Date().toISOString(),
  jCards: new Set(records.map((r) => r.id)).size,
  totalRecords: records.length,
  abilities: records.filter((r) => r.kind === 'Ability').length,
  attacks: records.filter((r) => r.kind === 'Attack').length,
  cardOnly: records.filter((r) => r.kind === 'Card').length,
  implementedGuess: records.filter((r) => r.implementationStatus === 'implemented').length,
  missingCandidates: missingRecords.length,
  byStatus: {},
  byPriority: {},
  byCategory: {},
  bySet: {},
};
for (const r of records) {
  summary.byStatus[r.implementationStatus] = (summary.byStatus[r.implementationStatus] ?? 0) + 1;
  summary.byPriority[r.priority] = (summary.byPriority[r.priority] ?? 0) + 1;
  summary.byCategory[r.category] = (summary.byCategory[r.category] ?? 0) + 1;
  summary.bySet[r.setCode] = (summary.bySet[r.setCode] ?? 0) + 1;
}

const outDir = path.join(root, 'docs', 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'j-mark-effects-audit.json'), JSON.stringify({ summary, records }, null, 2));

const needsReview = records.filter((r) => r.implementationStatus === 'needs-review');
const md = [
  '# J 標效果實裝 Audit',
  '',
  `Generated: ${summary.generatedAt}`,
  '',
  '## Summary',
  '',
  `- J cards: ${summary.jCards}`,
  `- Total records: ${summary.totalRecords}`,
  `- Abilities: ${summary.abilities}`,
  `- Attacks: ${summary.attacks}`,
  `- Card-only/no structured attacks: ${summary.cardOnly}`,
  `- Implemented: ${summary.byStatus.implemented ?? 0}`,
  `- Needs review: ${summary.byStatus['needs-review'] ?? 0}`,
  `- Missing candidates: ${summary.missingCandidates}`,
  `- Not needed: ${summary.byStatus['not-needed'] ?? 0}`,
  '',
  '## By Status',
  '',
  ...Object.entries(summary.byStatus).sort().map(([k, v]) => `- ${k}: ${v}`),
  '',
  '## By Priority',
  '',
  ...Object.entries(summary.byPriority).sort().map(([k, v]) => `- ${k}: ${v}`),
  '',
  '## By Category',
  '',
  ...Object.entries(summary.byCategory).sort().map(([k, v]) => `- ${k}: ${v}`),
  '',
  '## First 100 Missing Candidates',
  '',
  '| Priority | Set | ID | Card | Kind | Name | Category | Text |',
  '|---|---:|---:|---|---|---|---|---|',
  ...missingRecords.slice(0, 100).map((r) => `| ${r.priority} | ${r.setCode} | ${r.id} | ${r.name} | ${r.kind} | ${r.effectName} | ${r.category} | ${(r.damage ? `${r.damage} ` : '')}${String(r.effectText).replaceAll('|', '\\|')} |`),
  '',
  '## First 50 Needs Review (same effect name exists; verify exact card behavior)',
  '',
  '| Priority | Set | ID | Card | Kind | Name | Category | Evidence |',
  '|---|---:|---:|---|---|---|---|---|',
  ...needsReview.slice(0, 50).map((r) => `| ${r.priority} | ${r.setCode} | ${r.id} | ${r.name} | ${r.kind} | ${r.effectName} | ${r.category} | ${r.implementationEvidence.nameOnlyMatches.join(', ').replaceAll('|', '\\|')} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'j-mark-effects-audit.md'), md);

console.log(`J cards: ${summary.jCards}`);
console.log(`Total records: ${summary.totalRecords}`);
console.log(`Implemented: ${summary.byStatus.implemented ?? 0}`);
console.log(`Needs review: ${summary.byStatus['needs-review'] ?? 0}`);
console.log(`Missing candidates: ${summary.missingCandidates}`);
console.log('Reports written:');
console.log('- docs/reports/j-mark-effects-audit.json');
console.log('- docs/reports/j-mark-effects-audit.md');
