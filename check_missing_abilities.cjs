const fs = require('fs');
const path = require('path');

const cardsDir = path.join(__dirname, 'static', 'cards');
const effectsDir = path.join(__dirname, 'src', 'lib', 'game', 'effects');

let registeredNames = new Set();
function scanEffectsDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanEffectsDir(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const regex = /(?:reg(?:Pre|Post|A|G|R|Item|Trainer|Stadium|Tool)?|ABILITY_EFFECTS\.set)\(\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const names = match[1].split('|');
        for (const name of names) {
          registeredNames.add(name);
        }
      }
    }
  }
}
scanEffectsDir(effectsDir);

let missingAbilities = [];
let missingDrawAttacks = [];

const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.json') && f !== 'index.json');
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(cardsDir, file), 'utf8'));
  for (const card of data) {
    if (card.supertype !== 'Pokemon') continue;
    const regulation = card.regulationMark;
    if (['H', 'I', 'J', 'G'].indexOf(regulation) === -1) continue; 
    
    const cleanedName = card.name ? card.name.replace(/[<>＜＞‌]/g, '') : '';
    
    if (card.abilities) {
      for (const ab of card.abilities) {
        if (!registeredNames.has(cleanedName) && !registeredNames.has(cleanedName + '|' + ab.name)) {
          if (ab.effect && (ab.effect.includes('抽') || ab.effect.includes('牌庫') || ab.effect.includes('選擇') || ab.effect.includes('加入手牌'))) {
            missingAbilities.push({
              name: cleanedName,
              abName: ab.name,
              effect: ab.effect,
              setId: file.replace('.json', '')
            });
          }
        }
      }
    }

    if (card.attacks) {
      for (const atk of card.attacks) {
        if (!registeredNames.has(cleanedName) && !registeredNames.has(atk.name) && !registeredNames.has(cleanedName + '|' + atk.name)) {
          if (atk.effect && (atk.effect.includes('抽') || atk.effect.includes('牌庫') || atk.effect.includes('選擇') || atk.effect.includes('加入手牌'))) {
            if (atk.effect.includes('加入手牌') || atk.effect.includes('抽') || atk.effect.includes('牌庫')) {
              missingDrawAttacks.push({
                name: cleanedName,
                atkName: atk.name,
                effect: atk.effect,
                setId: file.replace('.json', '')
              });
            }
          }
        }
      }
    }
  }
}

// Remove duplicates
function dedupe(arr, keyFn) {
  const seen = new Set();
  return arr.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

missingAbilities = dedupe(missingAbilities, x => x.abName);
missingDrawAttacks = dedupe(missingDrawAttacks, x => x.name + '|' + x.atkName);

const filteringAbilities = missingAbilities.filter(x => x.effect && (x.effect.includes('抽') || x.effect.includes('牌庫') || x.effect.includes('加入手牌')));

console.log(`Total missing filtering/draw abilities: ${filteringAbilities.length}`);
console.log(`Total missing filtering/draw attacks: ${missingDrawAttacks.length}`);

console.log('\n--- Missing Draw/Search Abilities ---');
for (let i = 0; i < Math.min(20, filteringAbilities.length); i++) {
  const c = filteringAbilities[i];
  console.log(`[${c.setId}] ${c.name} - 特性: ${c.abName}`);
  console.log(c.effect.substring(0, 80));
}

console.log('\n--- Missing Draw/Search Attacks ---');
for (let i = 0; i < Math.min(20, missingDrawAttacks.length); i++) {
  const c = missingDrawAttacks[i];
  console.log(`[${c.setId}] ${c.name} - 招式: ${c.atkName}`);
  console.log(c.effect.substring(0, 80));
}
