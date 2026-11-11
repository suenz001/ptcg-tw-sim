// Rule 54：只釘版本真正守護的函式；不再把整份引擎綁在顯示功能的舊版。
import assert from 'node:assert/strict';
import ts from 'typescript';
export function assertFunctionsMatchBase(source, baseline, names) {
  const parse = text => {
    assert.ok(typeof text === 'string' && text.trim(), '函式來源不可空白');
    const ast = ts.createSourceFile('engine.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal(ast.parseDiagnostics.length, 0, '函式來源解析失敗');
    return ast;
  };
  const current = parse(source), before = parse(baseline);
  for (const name of names) {
    const get = ast => {
      const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
      assert.equal(nodes.length, 1, '函式缺失或重複：' + name);
      return nodes[0].getText(ast);
    };
    assert.equal(get(current), get(before), '原函式行為變動：' + name);
  }
}
