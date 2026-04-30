const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/lib/game/effects/cards/abra_mawile_deck.ts');
let content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split(/\r?\n/);

let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('瑪俐的長毛巨魔ex｜龐克練肌')) {
    startIdx = i;
  }
  if (lines[i].includes('瑪俐的長毛巨魔ex｜暗影子彈')) {
    endIdx = i;
    break;
  }
}

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find bounds', startIdx, endIdx);
  process.exit(1);
}

const newBlock = `// ── 瑪俐的長毛巨魔ex｜龐克練肌（特性）─ 進化當回合可用 1 次
//    從牌庫選最多 5 張基本【惡】能量，以任意方式附於自己的「瑪俐的」寶可夢身上（重洗牌庫）
regA('瑪俐的長毛巨魔ex', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const allPokes = [...(p.active ? [p.active] : []), ...p.bench];
  const src = cardInst ? allPokes.find(c => c.iid === cardInst.iid) : p.active;
  if (!src) return addLog(st, '龐克練肌：找不到該寶可夢', idx);

  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Darkness');
  });
  if (cand.length === 0) return addLog(st, '龐克練肌：牌庫沒有基本【惡】能量', idx);
  const maxN = Math.min(5, cand.length);
  // 找場上所有「瑪俐的」寶可夢
  const mariPokes = allPokes.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
  if (mariPokes.length === 0) return addLog(st, '龐克練肌：場上沒有「瑪俐的」寶可夢', idx);
  const s = addLog(st, \`龐克練肌：從牌庫選最多 \${maxN} 張基本【惡】能量，以任意方式附於自己的「瑪俐的」寶可夢身上\`, idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Darkness', minCount: 0, maxCount: maxN,
    effectKey: 'punk-training-attach',
    params: { label: '龐克練肌', validIids: cand.map(c => c.iid) },
  });
});
regR('punk-training-attach', (st, idx, iids, params, pool) => {
  const label = (params?.label) ?? '龐克練肌';
  const p = st.players[idx];

  const picked = p.deck.filter(c => iids.includes(c.iid));
  // 無論是否選了能量，先重洗牌庫，並將選取的能量暫存 discard（分配時再移入寶可夢）
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !iids.includes(c.iid))),
    discard: [...pl.discard, ...picked],
  }));
  if (picked.length === 0) return addLog(s, \`\${label}：未選擇能量（重洗牌庫）\`, idx);

  // 找場上所有「瑪俐的」寶可夢 iids 作為可附加目標
  const allPokes = [...(s.players[idx].active ? [s.players[idx].active] : []), ...s.players[idx].bench];
  const mariPokes = allPokes.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
  if (mariPokes.length === 0) {
    return addLog(s, \`\${label}：場上無「瑪俐的」寶可夢，能量留在棄牌區\`, idx);
  }

  // 只有 1 隻瑪俐的寶可夢 → 全部直接附上
  if (mariPokes.length === 1) {
    const targetIid = mariPokes[0].iid;
    const tName = pool.get(mariPokes[0].cardId)?.name ?? '?';
    s = addLog(s, \`\${label}：將 \${picked.length} 張【惡】能量全部附於 \${tName}（重洗牌庫）\`, idx);
    return updatePlayer(s, idx, pl => {
      const energyCards = pl.discard.filter(c => iids.includes(c.iid));
      const rest = pl.discard.filter(c => !iids.includes(c.iid));
      if (pl.active?.iid === targetIid) {
        return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energyCards] } };
      }
      return { ...pl, discard: rest, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, energyAttached: [...c.energyAttached, ...energyCards] } : c) };
    });
  }

  // 多隻瑪俐的寶可夢 → 逐張選附加目標
  s = addLog(s, \`\${label}：請選擇每張【惡】能量的附加目標（重洗牌庫完成）\`, idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'punk-training-distribute',
    params: {
      label,
      energyIids: picked.map(c => c.iid),
      validIids: mariPokes.map(c => c.iid),
      totalCount: picked.length, placedCount: 0,
    },
  });
});
regR('punk-training-distribute', (st, idx, iids, params, pool) => {
  const label = (params?.label) ?? '龐克練肌';
  const energyIids = (params?.energyIids) ?? [];
  const totalCount = (params?.totalCount) ?? energyIids.length;
  const placedCount = (params?.placedCount) ?? 0;
  if (energyIids.length === 0) return st;

  const currentEnergyIid = energyIids[0];
  const restIids = energyIids.slice(1);
  const targetIid = iids[0];
  const p = st.players[idx];

  // 能量暫存在 discard 中（punk-training-attach 導入）
  const energy = p.discard.find(c => c.iid === currentEnergyIid);
  if (!energy) {
    if (restIids.length === 0) return st;
    const ap2 = [...(st.players[idx].active ? [st.players[idx].active] : []), ...st.players[idx].bench];
    const mn2 = ap2.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
    return withPending(st, {
      type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1, effectKey: 'punk-training-distribute',
      params: { label, energyIids: restIids, validIids: mn2.map(c => c.iid), totalCount, placedCount: placedCount + 1 },
    });
  }

  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  const tCard = target ? pool.get(target.cardId) : null;
  if (!target || !tCard?.name?.startsWith('瑪俐的')) {
    return addLog(st, \`\${label}：目標不是「瑪俐的」寶可夢，取消附加\`, idx);
  }

  const tName = tCard.name;
  let s = addLog(st, \`\${label}：第 \${placedCount + 1}/\${totalCount} 張【惡】能量附於 \${tName}\`, idx);
  s = updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => c.iid !== currentEnergyIid);
    if (pl.active?.iid === targetIid) {
      return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } };
    }
    return { ...pl, discard: rest, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, energyAttached: [...c.energyAttached, energy] } : c) };
  });

  if (restIids.length === 0) return s;

  const ap = [...(s.players[idx].active ? [s.players[idx].active] : []), ...s.players[idx].bench];
  const mn = ap.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
  if (mn.length === 0) return addLog(s, \`\${label}：場上已無「瑪俐的」寶可夢，剩餘能量留在棄牌區\`, idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'punk-training-distribute',
    params: {
      label, energyIids: restIids,
      validIids: mn.map(c => c.iid),
      totalCount, placedCount: placedCount + 1,
    },
  });
});
`;

lines.splice(startIdx, endIdx - startIdx, newBlock);
fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
console.log('Successfully patched.');
