// ⭐v6.481 卡片搜尋語法（卡牌資料庫與牌組編輯器找卡共用的**唯一實作**）。
//
// 玩家提議：「資料庫搜尋能不能支援正則，或者可以使用更多的關鍵字交叉搜尋」。
//
// 語法（全部可以混用；只打一個詞時行為與改版前完全相同）：
//   ・空白分隔＝「而且」（AND）：`雷 ex` ⇒ 同時含「雷」與「ex」。全形空白也算。
//   ・`|`＝「或」（OR）：`皮卡丘|雷丘` ⇒ 含其中一個就算。
//   ・開頭 `-`＝「排除」（NOT）：`ex -超級` ⇒ 含 ex、但不含「超級」。
//   ・引號＝整段當一個詞（可以含空白）：`"抽 2 張"`、`「抽 2 張」`。
//   ・`/…/`＝正規表示式（一律不分大小寫）：`/^超級.*ex$/`、`/抽\d張/`。寫錯的正規表示式當一般文字搜尋。
//
// 比對對象（haystack）由 cardSearchFields 依搜尋模式決定，與改版前逐欄相同：
//   ・一般搜尋：卡名、卡號、招式名、特性名。
//   ・關鍵字（全部）：再加上進化來源、規則文字、招式／特性效果、特性種類；（招式）只看招式；（特性）只看特性。
//   ・一個詞只要在「任一欄」找到就算命中（跟改版前「整串字在任一欄找到」相同）。
//   ・唯一的行為差異：一般搜尋的卡號比對改成不分大小寫（舊版打 sv 找不到 SV-P 的卡號），只會多找到、不會少。
//
// ⚠ 效能：查詢字串只在輸入改變時編譯一次（compileCardQuery），每張卡只做字串比對 ⇒ 5000 張卡一樣即時。
// ⚠ 正規表示式長度上限 REGEX_MAX_LEN；超過就當一般文字（避免貼上超長樣式卡住分頁）。

import type { Card } from './types';

export type SearchMode = 'normal' | 'keyword' | 'evolution';
export type KeywordScope = 'all' | 'attacks' | 'abilities';

export const REGEX_MAX_LEN = 120;

/** 依搜尋模式取出要比對的欄位（與 v6.480 以前兩頁的內嵌邏輯逐欄相同）。 */
export function cardSearchFields(c: Card, mode: SearchMode, scope: KeywordScope): string[] {
  if (mode === 'keyword') {
    if (scope === 'attacks') return (c.attacks ?? []).flatMap((a) => [a.name, a.effect ?? '']);
    if (scope === 'abilities') return (c.abilities ?? []).flatMap((a) => [a.label ?? '', a.name, a.effect ?? '']);
    return [
      c.name,
      c.collectorNumber,
      c.evolvesFrom ?? '',
      c.rulesText ?? '',
      ...(c.attacks ?? []).flatMap((a) => [a.name, a.effect ?? '']),
      ...(c.abilities ?? []).flatMap((a) => [a.label ?? '', a.name, a.effect ?? '']),
    ];
  }
  return [c.name, c.collectorNumber, ...(c.attacks ?? []).map((a) => a.name), ...(c.abilities ?? []).map((a) => a.name)];
}

type Atom = { re: RegExp } | { text: string };
type Term = { neg: boolean; any: Atom[] };

export type CompiledQuery = {
  /** 沒有任何有效條件（空字串、只有空白） */
  empty: boolean;
  /** 有寫成 /…/ 但不是合法正規表示式（已退回一般文字搜尋），給畫面提示用 */
  regexError: boolean;
  /** 傳入欄位清單，回傳是否命中 */
  test: (fields: readonly string[]) => boolean;
};

/** 拆詞：空白（含全形）分隔；"…"、「…」、/…/ 內的空白不拆。 */
export function tokenizeQuery(q: string): string[] {
  const out: string[] = [];
  let i = 0;
  const s = String(q ?? '');
  const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '　';
  while (i < s.length) {
    while (i < s.length && isSpace(s[i])) i++;
    if (i >= s.length) break;
    let tok = '';
    // 開頭的排除符號先收進來，後面可以接引號或正規表示式（例：-"抽 2 張"、-/ex$/）
    if (s[i] === '-' || s[i] === '－') { tok += '-'; i++; }
    const open = s[i];
    const close = open === '"' ? '"' : open === '「' ? '」' : open === '/' ? '/' : '';
    if (close) {
      const end = s.indexOf(close, i + 1);
      if (end > i) {
        const body = s.slice(i + 1, end);
        if (open === '/') {
          // 正規表示式：保留斜線，並吃掉緊接的旗標字母
          let j = end + 1;
          while (j < s.length && /[a-z]/i.test(s[j])) j++;
          tok += s.slice(i, j);
          i = j;
        } else {
          tok += '\u0000' + body;   // \0 標記「引號包起來的整段文字」：不再拆 |、不當正規表示式
          i = end + 1;
        }
        out.push(tok);
        continue;
      }
    }
    while (i < s.length && !isSpace(s[i])) tok += s[i++];
    if (tok && tok !== '-') out.push(tok);
  }
  return out;
}

function atomOf(raw: string, flagErr: { v: boolean }): Atom | null {
  const m = raw.match(/^\/(.+)\/([a-z]*)$/is);
  if (m && raw.length <= REGEX_MAX_LEN + 2 + 8) {
    try {
      const flags = Array.from(new Set((m[2].toLowerCase().replace(/[^imsu]/g, '') + 'i').split(''))).join('');
      return { re: new RegExp(m[1], flags) };
    } catch {
      flagErr.v = true;   // 寫錯 ⇒ 下面當一般文字
    }
  }
  const t = raw.toLowerCase();
  return t ? { text: t } : null;
}

/** 把搜尋字串編譯成比對函式。 */
export function compileCardQuery(q: string): CompiledQuery {
  const err = { v: false };
  const terms: Term[] = [];
  for (let tok of tokenizeQuery(q)) {
    let neg = false;
    if (tok.startsWith('-') && tok.length > 1) { neg = true; tok = tok.slice(1); }
    let atoms: Atom[];
    if (tok.startsWith('\u0000')) {
      const t = tok.slice(1).toLowerCase();
      atoms = t ? [{ text: t }] : [];
    } else if (/^\/.+\/[a-z]*$/is.test(tok)) {
      const a = atomOf(tok, err);
      atoms = a ? [a] : [];
    } else {
      atoms = tok.split('|').map((p) => atomOf(p, err)).filter((a): a is Atom => !!a);
    }
    if (atoms.length) terms.push({ neg, any: atoms });
  }
  const hit = (a: Atom, lowered: readonly string[], raw: readonly string[]) => {
    if ('re' in a) { for (const s of raw) { a.re.lastIndex = 0; if (s && a.re.test(s)) return true; } return false; }
    for (const s of lowered) if (s && s.includes(a.text)) return true;
    return false;
  };
  return {
    empty: terms.length === 0,
    regexError: err.v,
    test(fields) {
      if (terms.length === 0) return true;
      const lowered = fields.map((s) => (s ? s.toLowerCase() : ''));
      for (const t of terms) {
        const any = t.any.some((a) => hit(a, lowered, fields));
        if (t.neg ? any : !any) return false;
      }
      return true;
    },
  };
}

/** 搜尋框的說明文字（title 提示用，兩頁共用）。 */
export const SEARCH_SYNTAX_HINT =
  '搜尋語法：空白＝而且（雷 ex）｜ | ＝或（皮卡丘|雷丘）｜ 開頭 - ＝排除（ex -超級）｜ "引號"＝整段（"抽 2 張"）｜ /…/＝正規表示式（/^超級.*ex$/）';
