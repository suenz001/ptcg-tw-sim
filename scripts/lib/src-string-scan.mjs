// ⭐v6.572 「src 字串掃描」單一來源（IRON_RULES Rule 38）：test-v6571（擊倒／KO → 昏厥）、test-v6572（戰鬥位 → 戰鬥場）共用。
//   用 TypeScript 自己的 scanner 切出字串字面（含模板字串每一段文字），不會被巢狀模板、註解裡的引號、regex 打亂；
//   順便收集 regex lookbehind（Safari 16.3 以下不支援，見 test-v6571 B1）。
//   ⚠ .svelte 的 <script> 走 scanner；畫面上的文字（模板）用 markupText() 另外看（剝掉 <script>／<style>／<!-- -->）。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');
const K = ts.SyntaxKind;
const STRINGY = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail]);
// 前一個 token 是值（識別字、數字、字串、右括號…）⇒ 這個 / 是除號，不是 regex
const VALUE_END = new Set([K.Identifier, K.NumericLiteral, K.StringLiteral, K.CloseParenToken, K.CloseBracketToken, K.ThisKeyword,
  K.NoSubstitutionTemplateLiteral, K.TemplateTail, K.PlusPlusToken, K.MinusMinusToken, K.TrueKeyword, K.FalseKeyword, K.NullKeyword]);

/** 掃一份原始碼：每一段字串呼叫 onString(text, line)；每一個含 lookbehind 的 regex／字串呼叫 onLookbehind(line)。 */
export function scanStrings(src, label, onString, onLookbehind = () => {}) {
  const code = /\.svelte$/.test(label) ? [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') : src;
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, code);
  const lineOf = () => code.slice(0, sc.getTokenPos()).split('\n').length;
  let tok = sc.scan(), depth = 0, prev = K.Unknown;
  const stack = [];
  while (tok !== K.EndOfFileToken) {
    if (tok === K.OpenBraceToken) depth++;
    if (tok === K.CloseBraceToken) {
      if (stack.length && stack[stack.length - 1] === depth) { stack.pop(); tok = sc.reScanTemplateToken(false); }
      else depth--;
    }
    if (tok === K.TemplateHead || tok === K.TemplateMiddle) stack.push(depth);
    if (STRINGY.has(tok)) {
      const t = sc.getTokenValue();
      if (/\(\?<[!=]/.test(t)) onLookbehind(lineOf());
      onString(t, lineOf());
    }
    if ((tok === K.SlashToken || tok === K.SlashEqualsToken) && !VALUE_END.has(prev)) {
      tok = sc.reScanSlashToken();
      if (tok === K.RegularExpressionLiteral && /\(\?<[!=]/.test(sc.getTokenText())) onLookbehind(lineOf());
    }
    prev = tok;
    tok = sc.scan();
  }
}

/** .svelte 畫面上的文字：剝掉 <script>／<style>／HTML 註解之後剩下的模板（含屬性值）。非 .svelte 回空字串。 */
export function markupText(src, label) {
  if (!/\.svelte$/.test(label)) return '';
  return src.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
}

/** src 底下所有 .ts／.svelte。 */
export function walkSrc(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkSrc(p, acc);
    else if (/\.(ts|svelte)$/.test(f)) acc.push(p);
  }
  return acc;
}
