const fs = require('fs');
const txt = fs.readFileSync('C:/Users/suenz/.gemini/antigravity/brain/a63955c5-8f4c-4e74-9c56-1c2eab9151de/.system_generated/logs/overview.txt', 'utf8');
const lines = txt.split('\n');
for (const line of lines) {
  if (line.includes('1: import type { GameState }') && line.includes('"ENVIRONMENT"')) {
    fs.writeFileSync('recover.txt', line, 'utf8');
    console.log('Recovered!');
    break;
  }
}
