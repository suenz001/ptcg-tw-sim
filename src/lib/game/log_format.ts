/**
 * v2.88 戰鬥 log 著色 tokenizer
 *
 * 目的：把單行 message 切成多個 segment，每段帶 class，UI 端 render 為
 *      <span class={cls}>{text}</span> 達成不同類別不同顏色 / 粗體效果。
 *
 * 設計：
 *   - 純 render-side：不動 LogEntry / addLog API，不需修改任何 effects.ts
 *     的 1000+ call sites
 *   - 偵測順序：bracket -> ko/prize -> damage/heal -> status -> evolve -> coin
 *     -> secondary（次要動作不要遮蔽主要訊息）
 *   - lineClass(message)：判斷整行類別（如「回合結束，換 X 行動」整行套
 *     turn-marker 樣式，作為視覺分隔器）
 *
 * v3.02 擴充：在 RULES tokenize 完成後，再對 cls === '' 的純文字 token
 *      做卡名子掃描 — 把卡片名稱拆成 cls='log-card-link' 可點 token，
 *      UI 端 render 成 <button> 開啟 zoom modal。
 */

export interface LogToken {
  cls: string;  // CSS class name；空字串 = 預設 .log-line 顏色；'log-card-link' = 可點按鈕
  text: string;
}

interface PatternRule {
  re: RegExp;
  cls: string;
}

// -- 偵測規則（順序很重要：愈具體的規則放前面）-----------------------------
//
// 取捨：每個 pattern 都用 global、且只匹配字面詞素，避免吃到上下文。
// 例如「擊倒」單獨用，但「被擊倒」優先匹配（更精確）。
const RULES: PatternRule[] = [
  // 招式 / 特性 / 重點短語：【XX】
  { re: /【[^】]+】/g, cls: 'log-bracket' },
  // 擊倒：被擊倒 / 擊倒！ / KO
  { re: /被擊倒[!！]?|擊倒[!！]|KO/g, cls: 'log-ko' },
  // 獎勵牌：+N 張獎勵牌 / 取得 N 張獎勵牌
  { re: /\+\d+\s*張獎勵牌|取得\s*\d+\s*張獎勵牌|取走\s*\d+\s*張獎勵牌/g, cls: 'log-prize' },
  // 傷害數字：N 點傷害 / +N 傷害 / 造成 N 點 / -N 傷害
  { re: /[+\-]?\d+\s*點傷害|造成\s*\d+\s*點|[+\-]\d+\s*傷害/g, cls: 'log-damage' },
  // 回血：回 N HP / 恢復 N HP
  { re: /回\s*\d+\s*HP|恢復\s*\d+\s*HP|回復\s*\d+\s*HP/g, cls: 'log-heal' },
  // 狀態異常
  { re: /中毒|灼傷|麻痺|睡眠|混亂/g, cls: 'log-status' },
  // 進化
  { re: /進化成|進化為|進化到/g, cls: 'log-evolve' },
  // 擲硬幣 / 結果
  { re: /擲硬幣|正面|反面/g, cls: 'log-coin' },
  // 次要動作（淡化）：抽 N 張 / 重洗 / 搜尋牌庫 / 從牌庫剩 N 張
  { re: /抽\s*\d+\s*張|重洗(?:牌庫)?|搜尋牌庫|從牌庫剩\s*\d+\s*張|牌庫剩\s*\d+\s*張/g, cls: 'log-secondary' },
];

interface Match {
  pos: number;
  len: number;
  cls: string;
  text: string;
}

/**
 * 把 message 切成 token 陣列。
 * 演算法：每輪掃描所有 RULES，挑「位置最早 + 長度最長」的 match 作為下一個 token；
 *         match 之前的純文字也成為一個 token（cls=''）。
 *
 * v3.02：可選參數 cardNamesByLength — 卡名清單（必須由長到短排序）。若有給，
 *        在主 RULES 跑完後再對 cls === '' 的純文字 token 做第二輪卡名掃描，
 *        匹配到的卡名拆成 cls='log-card-link' token，UI 端 render 為按鈕。
 *        - 必須由長到短排序：避免「搗蛋小妖」遮蔽到「瑪俐的搗蛋小妖」
 *        - 名稱長度 < 2 字一律忽略，避免吃到「水」「火」這類短匹配
 *        - 已是 bracket / damage / status 等 token 不再拆（卡名不會在【】內）
 */
export function tokenizeLogMessage(msg: string, cardNamesByLength?: string[]): LogToken[] {
  if (!msg) return [];
  const tokens: LogToken[] = [];
  let cursor = 0;
  while (cursor < msg.length) {
    // 對每個 rule 找下一個 match（>= cursor）
    const matches: Match[] = [];
    for (const rule of RULES) {
      rule.re.lastIndex = cursor;
      const m = rule.re.exec(msg);
      if (m && m.index >= cursor) {
        matches.push({ pos: m.index, len: m[0].length, cls: rule.cls, text: m[0] });
      }
    }
    if (matches.length === 0) {
      tokens.push({ cls: '', text: msg.slice(cursor) });
      break;
    }
    // 挑最早出現的；同位置選最長
    matches.sort((a, b) => a.pos - b.pos || b.len - a.len);
    const next = matches[0];
    if (next.pos > cursor) {
      tokens.push({ cls: '', text: msg.slice(cursor, next.pos) });
    }
    tokens.push({ cls: next.cls, text: next.text });
    cursor = next.pos + next.len;
  }

  // v3.02：卡名子掃描 — 只對 cls === '' 的純文字 token 做 longest-match-first
  if (cardNamesByLength && cardNamesByLength.length > 0) {
    return tokens.flatMap(tok => tok.cls === ''
      ? splitCardNames(tok.text, cardNamesByLength)
      : [tok]);
  }
  return tokens;
}

/**
 * 對純文字做卡名 longest-match-first 掃描，把命中的卡名抽成 cls='log-card-link' token。
 * 必須由長到短排序：避免「瑪俐的搗蛋小妖」被切成「瑪俐的」+「搗蛋小妖」link。
 * 名稱長度 < 2 字一律忽略。
 */
function splitCardNames(text: string, cardNamesByLength: string[]): LogToken[] {
  if (!text) return [];
  const out: LogToken[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let hitName: string | null = null;
    let hitPos = -1;
    // 對每個卡名找最早出現位置（已長到短排序，相同位置時長者優先）
    for (const name of cardNamesByLength) {
      if (name.length < 2) continue;  // 過短卡名（極少見，保險過濾）
      const idx = text.indexOf(name, cursor);
      if (idx < 0) continue;
      if (hitPos < 0 || idx < hitPos || (idx === hitPos && name.length > (hitName?.length ?? 0))) {
        hitPos = idx;
        hitName = name;
      }
    }
    if (!hitName || hitPos < 0) {
      out.push({ cls: '', text: text.slice(cursor) });
      break;
    }
    if (hitPos > cursor) {
      out.push({ cls: '', text: text.slice(cursor, hitPos) });
    }
    out.push({ cls: 'log-card-link', text: hitName });
    cursor = hitPos + hitName.length;
  }
  return out;
}

/**
 * 整行 class — 用於回合分隔器、勝利訊息等需要整行加底色 / 邊框的訊息。
 * 回傳 '' 表示套用預設 .log-line。
 */
export function lineClass(msg: string): string {
  if (!msg) return '';
  // 回合結束 / 換 X 行動 -> turn-marker（醒目的橫向分隔）
  if (/^回合結束/.test(msg) || /換.*行動。?$/.test(msg)) return 'log-turn-marker';
  // 勝負揭曉
  if (/獲得勝利|取得所有獎勵牌|沒有可上場的寶可夢|遊戲結束/.test(msg)) return 'log-victory';
  return '';
}
