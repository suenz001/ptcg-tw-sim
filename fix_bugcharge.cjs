const fs = require('fs');
const path = require('path');

// ── 1. 修改 v155_attacks.ts ────────────────────────────────────────────────
const attacksPath = path.join(__dirname, 'src/lib/game/effects/cards/v155_attacks.ts');
let attacks = fs.readFileSync(attacksPath, 'utf8');

// 找到並替換電電充能那整段（從 section header 到 });）
const oldStart = '// ══════════════════════════════════════════════════════════════════════════════\r\n// (9) 電電充能（電電蟲）—';
const oldEnd = '  });\r\n});\r\n\r\n// ══════════════════════════════════════════════════════════════════════════════\r\n// (10)';

const startIdx = attacks.indexOf(oldStart);
const endIdx = attacks.indexOf(oldEnd);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find Bug Charge block! startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

// We need to add the import for startEnergyChain at the top too
const newBlock = `// ══════════════════════════════════════════════════════════════════════════════
// (9) 電電充能（電電蟲）— 0 傷 + 從牌庫搜【草】最多 2 張、再搜【雷】最多 2 張
// ══════════════════════════════════════════════════════════════════════════════
// v2.305 升級：兩段式——先選草（≤2），再選雷（≤2），確實符合「各最多 2 張」卡面規則
regPre('電電蟲|電電充能', (state) => ({ state, damage: 0 }));
regPost('電電蟲|電電充能', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '電電充能：牌庫為空', aIdx);
  const maxGrass = Math.min(2, player.deck.length);
  const s = addLog(state, \`電電充能：選最多 \${maxGrass} 張基本【草】能量（接著選最多 2 張基本【雷】）\`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:Grass',
    minCount: 0, maxCount: maxGrass,
    effectKey: 'v155-bugcharge-grass',
    params: { label: '電電充能' },
  });
});

// 電電充能 第一段 resolver：草選完 → 開第二段選雷
regR('v155-bugcharge-grass', (st, aIdx, grassIids, params, pool) => {
  const label = String(params?.label ?? '電電充能');
  const player = st.players[aIdx];
  const maxLightning = Math.min(2, player.deck.length);
  if (maxLightning === 0) {
    if (grassIids.length === 0) {
      st = updatePlayerInline(st, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
      return addLog(st, \`\${label}：未選擇任何能量\`, aIdx);
    }
    return startEnergyChain(st, aIdx, grassIids, {
      label, source: 'deck', scope: 'any-own', filterType: 'Any',
    }, pool);
  }
  const s = addLog(st, \`\${label}：已選 \${grassIids.length} 張【草】，接著選最多 \${maxLightning} 張基本【雷】能量\`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:Lightning',
    minCount: 0, maxCount: maxLightning,
    effectKey: 'v155-bugcharge-lightning',
    params: { label, grassIids },
  });
});

// 電電充能 第二段 resolver：雷選完 → 合併草+雷 → 進 startEnergyChain
regR('v155-bugcharge-lightning', (st, aIdx, lightningIids, params, pool) => {
  const label = String(params?.label ?? '電電充能');
  const grassIids = (params?.grassIids as string[]) ?? [];
  const allIids = [...grassIids, ...lightningIids];
  if (allIids.length === 0) {
    st = updatePlayerInline(st, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(st, \`\${label}：未選擇任何能量\`, aIdx);
  }
  const s = addLog(st, \`\${label}：共選 \${grassIids.length} 張【草】+ \${lightningIids.length} 張【雷】，開始附能\`, aIdx);
  return startEnergyChain(s, aIdx, allIids, {
    label, source: 'deck', scope: 'any-own', filterType: 'Any',
  }, pool);
});

`;

attacks = attacks.slice(0, startIdx) + newBlock + attacks.slice(endIdx + oldEnd.indexOf('\r\n\r\n// ══════════════════════════════════════════════════════════════════════════════\r\n// (10)') + 4);

// ── 也要加 import startEnergyChain ───────────────────────────────────────────
const oldImportSection = "import { getEnergyUnits } from '../../engine';";
const newImportSection = "import { getEnergyUnits } from '../../engine';\nimport { startEnergyChain } from './v158_energy_chain';";

if (!attacks.includes('startEnergyChain')) {
  attacks = attacks.replace(oldImportSection, newImportSection);
  console.log('Added startEnergyChain import');
} else {
  console.log('startEnergyChain import already exists');
}

fs.writeFileSync(attacksPath, attacks, 'utf8');
console.log('✅ v155_attacks.ts updated');

// ── 2. 修改 v158_energy_chain.ts — 加 titleOverride 顯示能量名稱 ──────────────
const chainPath = path.join(__dirname, 'src/lib/game/effects/cards/v158_energy_chain.ts');
let chain = fs.readFileSync(chainPath, 'utf8');

// 在 startEnergyChain 的多目標 withPending 中加 titleOverride
const oldMultiTarget = `  st = addLog(st, \`\${label}：選擇要附第 1 張能量的目標寶可夢（共 \${energyIids.length} 張待附）\`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: firstEnergy,
      remainingEnergies,
    },
  });`;

const newMultiTarget = `  // 查出第 1 張能量的卡名，用於 UI 標頭
  const firstEnergyCard = pool.get(st.players[aIdx].discard.find(c => c.iid === firstEnergy)?.cardId ?? '');
  const firstEnergyName = firstEnergyCard?.name ?? '能量';
  st = addLog(st, \`\${label}：選擇要附第 1 張能量的目標寶可夢（共 \${energyIids.length} 張待附）\`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: firstEnergy,
      remainingEnergies,
      titleOverride: \`\${label}：將「\${firstEnergyName}」附到哪一隻寶可夢？\`,
    },
  });`;

if (chain.includes(oldMultiTarget)) {
  chain = chain.replace(oldMultiTarget, newMultiTarget);
  console.log('✅ startEnergyChain: added titleOverride for first picker');
} else {
  console.error('❌ Could not find multi-target withPending in startEnergyChain');
}

// 在 v158-energy-chain-attach 的遞迴 withPending 中加 titleOverride
const oldChainStep = `  // 多目標 → 對下一張開 picker（chain）
  const next = remainingEnergies[0];
  const rest = remainingEnergies.slice(1);
  st = addLog(st, \`\${label}：選擇下一張能量目標（剩 \${remainingEnergies.length} 張待附）\`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: next,
      remainingEnergies: rest,
    },
  });`;

const newChainStep = `  // 多目標 → 對下一張開 picker（chain）
  const next = remainingEnergies[0];
  const rest = remainingEnergies.slice(1);
  // 查出下一張能量的卡名，用於 UI 標頭
  const nextEnergyCard = pool.get(st.players[aIdx].discard.find(c => c.iid === next)?.cardId ?? '');
  const nextEnergyName = nextEnergyCard?.name ?? '能量';
  st = addLog(st, \`\${label}：選擇下一張能量目標（剩 \${remainingEnergies.length} 張待附）\`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: next,
      remainingEnergies: rest,
      titleOverride: \`\${label}：將「\${nextEnergyName}」附到哪一隻寶可夢？\`,
    },
  });`;

if (chain.includes(oldChainStep)) {
  chain = chain.replace(oldChainStep, newChainStep);
  console.log('✅ v158-energy-chain-attach: added titleOverride for chain step');
} else {
  console.error('❌ Could not find chain-step withPending in v158-energy-chain-attach');
}

fs.writeFileSync(chainPath, chain, 'utf8');
console.log('✅ v158_energy_chain.ts updated');

console.log('\nAll done! Run npm run build to verify.');
