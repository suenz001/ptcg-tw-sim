// ⭐⭐ v6.384：把 test-v6167 的 svelte if-chain 求值器抽成**共用模組**。
//
// 為什麼要抽出來：v6.384 的休閒版本閘與 v6.160/v6.167 的錦標賽報到閘是**同一個失敗模式**
//   —— 提示視窗被寫進互斥的版面分支 ⇒ 在另一個分支永遠畫不出來 ⇒ 玩家只看到「按了沒反應」。
//   兩支守衛都需要同一個判準去證明「視窗真的畫得出來」。各自複製一份＝兩份判準會各自漂移
//   （Rule 38：同一個判準只能有一份）⇒ 逐字搬到這裡，兩邊 import 同一支。
//
// ⚠ 這支東西自己也可能有 bug ⇒ **使用它的守衛必須附掃描器自我驗證**：
//   一個已知互斥的樣本必須抓到、一個已知不互斥的樣本必須放過（否則就是恆真斷言）。
import { parse } from 'svelte/compiler';

/** 會讓「裡面的東西可能畫不出來」的區塊／元件包裝：一律計入深度（v6.384 Fable 5 複審 Y2）。 */
const WRAPPERS = Object.freeze({
  EachBlock: 'each', KeyBlock: 'key', AwaitBlock: 'await', SnippetBlock: 'snippet',
  Component: 'component', SvelteComponent: 'component', SvelteSelf: 'component',
});

/**
 * 算出某些字元位置所在節點的「if-chain」。
 * @param {string} src   完整的 .svelte 原始碼
 * @param {Record<string, number>} targets  key → 字元位置（-1 代表找不到，會被略過）
 * @returns {Record<string, Array<{cond: string, branch: 'then'|'else'}>>}
 *   每一層記下條件字面量與走 then／else；空陣列 ＝ 就在 fragment 最外層。
 *
 * ⚠⚠ v6.384（Fable 5 複審 Y2）：原本只計 {#if}，所以把節點包進 {#each}／{#key}／
 *   {#await}／{#snippet}／<Component> 都還是回報「深度 1」—— 而「包進一個從來沒有
 *   被 @render 的 snippet」「包進 {#each [] as _}」正是「畫面上永遠看不到它」的形狀，
 *   與 v6.167 事故等價。⇒ 這些包裝一律也記一層，深度斷言才名副其實。
 */
export function ifChains(src, targets) {
  const ast = parse(src, { modern: true });
  const out = {};
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, path); return; }
    if (node.type === 'IfBlock' && node.test) {
      const cond = src.slice(node.test.start, node.test.end).replace(/\s+/g, ' ').trim();
      walk(node.consequent, path.concat([{ cond, branch: 'then' }]));
      if (node.alternate) walk(node.alternate, path.concat([{ cond, branch: 'else' }]));
      return;
    }
    // ⚠ 非 {#if} 的區塊包裝也算一層（它們一樣能讓節點永遠畫不出來）。
    if (WRAPPERS[node.type]) {
      const kind = WRAPPERS[node.type];
      const label = (node.type === 'Component' || node.type === 'SvelteComponent')
        ? ('<' + (node.name || 'Component') + '>')
        : ('{#' + kind + '}');
      const next = path.concat([{ cond: label, branch: kind }]);
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'parent' || k === 'name') continue;
        walk(node[k], next);
      }
      return;
    }
    if (typeof node.start === 'number' && typeof node.end === 'number') {
      for (const k of Object.keys(targets)) {
        const i = targets[k];
        if (i >= 0 && node.start <= i && i < node.end) out[k] = path;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'parent') continue;
      walk(node[k], path);
    }
  };
  walk(ast.fragment, []);
  return out;
}

/** 兩條 if-chain 若對同一個條件各走 then / else ⇒ 兩個節點**永遠不可能同時在畫面上**。 */
export function exclusiveCond(a, b) {
  for (const x of (a || [])) for (const y of (b || [])) {
    if (x.cond === y.cond && x.branch !== y.branch) return x.cond;
  }
  return null;
}
