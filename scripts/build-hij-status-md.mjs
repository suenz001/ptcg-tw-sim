import fs from 'node:fs';

const audit = JSON.parse(fs.readFileSync('/tmp/hij_audit.json', 'utf8'));

// 已知 false negatives（audit raw match 找不到，但實際已實裝）
const fixedFalseNeg = new Set([
  '寶可夢中心的姐姐',  // ZWNJ U+200C 前綴在 JSON 內，pool.ts 已 strip
]);
// 把 ZWNJ 從顯示用名字 strip
function cleanName(n) { return n.replace(/[‌​]/g, '').trim(); }

// 修正並 normalize
for (const r of audit) {
  const cleaned = cleanName(r.name);
  if (fixedFalseNeg.has(cleaned)) r.implemented = true;
  r.displayName = cleaned;
}

// 「需新引擎機制」註記表
const missingNote = {
  '巴貝娜與荷蓮娜': '複雜場上特定寶可夢條件 + 招式 KO 後 +3 獎賞',
  '泰姆': '對手 yes/no（HP 猜測）互動',
  '琵魯': '玩家自選棄手牌張數 → 抽到 5（hand-discard 串接）',
  '馬志士的交易': '對手 yes/no 互動',
  '奇異時鐘': '進化退化（玩家選 Stage1/2 移除）',
  '火箭隊的妨礙機器人': '互換對手手牌 ↔ 對手獎賞（互動 picker）',
  '變化之書': '棄牌寶可夢 ↔ 場上寶可夢互換（保留所有附加），且需 2 張同時使用',
  '豐收漁網': '混合 filter（【水】寶可夢 + 基本【水】能量各 ≤3）',
  '配樂之笛': '對手牌庫頂 5 張任意基礎 → 對手備戰（互動 picker）',
  '重新啟動箱': 'tag 偵測（未來）+ 多目標分配',
  '除蟲噴霧': '對手選擇換哪隻備戰上場',
  '陳舊的根狀化石': 'Item-as-Pokemon（化石機制）',
  '陳舊的羽毛化石': 'Item-as-Pokemon（化石機制）',
  '陳舊的背蓋化石': 'Item-as-Pokemon（化石機制）',
  '陳舊的顎之化石': 'Item-as-Pokemon（化石機制）',
  '陳舊的鰭之化石': 'Item-as-Pokemon（化石機制）',
  '鬼之假面': '棄牌厄鬼椪ex ↔ 場上厄鬼椪ex 互換',
  '力之沙漏': '回合結束 pending（從棄牌選 1 基本能量附加）',
  '手持循環扇': '受傷時對手能量改附其備戰（互動 picker）',
  '招式學習器 螢石': 'Tool 提供額外招式（attack-injection）',
  '核心記憶碟': '為「超級基格爾德ex」提供額外招式',
  '壯偉碩木': '牌庫鏈式進化（基礎→1階→2階）',
  '燃料【火】能量': '招式效果丟棄能量時放回手牌（需新 energy-discard hook）',
};

const implemented = audit.filter(r => r.implemented);
const missing = audit.filter(r => !r.implemented);

const total = audit.length;
const yes = implemented.length;
const no = missing.length;
const pct = ((yes/total)*100).toFixed(1);

const subOrder = ['Supporter', 'Item', 'PokemonTool', 'Stadium', 'Special'];
const subLabel = {
  Supporter: 'Supporter（支援者）',
  Item: 'Item（物品）',
  PokemonTool: 'PokemonTool（寶可夢道具）',
  Stadium: 'Stadium（競技場）',
  Special: 'Special Energy（特殊能量）',
};

function cmp(a, b) {
  if (a.marks !== b.marks) return a.marks.localeCompare(b.marks);
  return a.displayName.localeCompare(b.displayName);
}

const today = new Date().toISOString().slice(0, 10);

let md = `# H/I/J 標卡牌實裝清單（Trainer + Special Energy）

> 自動產生 + 人工註記，最後更新：${today}（v2.177）
> Scope：所有 H/I/J 標的 **訓練家卡（Supporter/Item/PokemonTool/Stadium）+ 特殊能量**。
> 不含寶可夢卡的招式/特性 — 那些由 preset 牌組驅動，列在另外的 preset audit 流程。

## 統計總覽

| 類別 | 已實裝 | 未實裝 | 合計 |
|------|------:|------:|----:|
`;

for (const sub of subOrder) {
  const allInSub = audit.filter(r => r.subtype === sub);
  const okInSub = allInSub.filter(r => r.implemented).length;
  const missInSub = allInSub.length - okInSub;
  md += `| ${subLabel[sub]} | ${okInSub} | ${missInSub} | ${allInSub.length} |\n`;
}
md += `| **總計** | **${yes}** | **${no}** | **${total}** |\n`;
md += `\n實裝率：**${pct}%**（${yes}/${total}）\n\n---\n\n`;

md += `## ✗ 未實裝（${no} 張）\n\n依需新引擎機制分組，可作為下一波實裝候選。\n\n`;
for (const sub of subOrder) {
  const list = missing.filter(r => r.subtype === sub).sort(cmp);
  if (!list.length) continue;
  md += `### ${subLabel[sub]}（${list.length} 張）\n\n`;
  for (const r of list) {
    const note = missingNote[r.displayName] || '（待補註記）';
    md += `- **[${r.marks}] ${r.displayName}** — ${note}\n`;
    if (r.rulesText) {
      const txt = r.rulesText.replace(/\n+/g, ' ').slice(0, 180);
      md += `  - 卡面：${txt}${r.rulesText.length > 180 ? '…' : ''}\n`;
    }
  }
  md += '\n';
}

md += `---\n\n## ✓ 已實裝（${yes} 張）\n\n依類別 + regulation mark 分組。每張對應 \`reg/regR/regG/regA/regPost/regPre\` 或 \`TOOL_*/SPECIAL_ENERGY_*/PASSIVE_STADIUMS\` map 命中。\n\n`;
for (const sub of subOrder) {
  const list = implemented.filter(r => r.subtype === sub).sort(cmp);
  if (!list.length) continue;
  md += `### ${subLabel[sub]}（${list.length} 張）\n\n`;
  let cur = [];
  let curMark = '';
  const lines = [];
  for (const r of list) {
    if (r.marks !== curMark) {
      if (cur.length) lines.push(`- **[${curMark}]** ${cur.join('、')}`);
      cur = [];
      curMark = r.marks;
    }
    cur.push(r.displayName);
  }
  if (cur.length) lines.push(`- **[${curMark}]** ${cur.join('、')}`);
  md += lines.join('\n') + '\n\n';
}

md += `---\n\n## 重新產生

\`\`\`bash
cd <repo>
node scripts/audit-hij-cards.mjs           # 步驟 1: 抓出所有 H/I/J Trainer + Special Energy → /tmp/hij_targets.json
node scripts/audit-hij-impl.mjs            # 步驟 2: 對 source grep 每張卡名 → /tmp/hij_audit.json
node scripts/build-hij-status-md.mjs       # 步驟 3: 產出本 markdown
\`\`\`

註：raw-match 比對可能有 false positive（卡名出現在 source 但效果未實裝）和 false negative（命名 normalize 後改寫，audit 比對失敗）。已知例外整理在 \`fixedFalseNeg\` set；新增類似情況時擴充該 set。
`;

fs.writeFileSync('HIJ_IMPLEMENTATION_STATUS.md', md);
console.log(`Wrote HIJ_IMPLEMENTATION_STATUS.md — ${total} entries (${yes} done, ${no} missing)`);
