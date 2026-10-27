// 管理預組：伺服器使用的純邏輯；不更動玩家匯入器的寬鬆行為。
import type { Card } from '$lib/cards/types';
import type { Deck } from './types';
import { validateDeck } from './validation';

export function parsePresetText(name: string, text: string, pool: Map<string, Card>): Deck {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('請填寫 1～100 字的牌組名稱');
  if (typeof text !== 'string' || text.length > 20000) throw new Error('牌表文字過長');
  const entries = new Map<string, number>();
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const exact = line.match(/^(\d+)\s+(.+?)\s+#(\d+)$/);
    const full = exact ? null : line.match(/^(\d+)\s+(.+?)\s+([A-Za-z0-9-]+)\s+(\S+)$/);
    const simple = (exact || full) ? null : line.match(/^(\d+)\s*[x×]?\s+(.+?)$/);
    const count = Number((exact || full || simple)?.[1]);
    if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error(`第 ${i + 1} 行張數或格式錯誤`);
    let cards: Card[];
    if (exact) cards = [...pool.values()].filter(c => c.id === exact[3] && c.name === exact[2].trim());
    else if (full) cards = [...pool.values()].filter(c => c.name === full[2].trim() && c.setCode === full[3] && c.collectorNumber === full[4]);
    else cards = [...pool.values()].filter(c => c.name === simple![2].trim());
    if (cards.length !== 1) throw new Error(`第 ${i + 1} 行${cards.length ? '有多個版本' : '找不到精確卡片'}，請使用「張數 卡名 #卡片ID」`);
    entries.set(cards[0].id, (entries.get(cards[0].id) || 0) + count);
  }
  const deck: Deck = { id: '', name: name.trim(), entries: [...entries].map(([cardId, count]) => ({ cardId, count })), createdAt: '', updatedAt: '' };
  const result = validateDeck(deck, pool);
  if (!result.legal) throw new Error(result.issues.join('；'));
  return deck;
}

// 以單一文件 CAS 保存整份目錄；初始化與刪除是同一條原子資料鏈。
export function createPresetService(collection: any, seeds: Deck[]) {
  async function read() {
    let doc = await collection.findOne({ _id: 'catalog' });
    if (!doc) {
      try { await collection.updateOne({ _id: 'catalog' }, { $setOnInsert: { revision: 1, decks: seeds.map(d => ({ ...d, deleted: false })) } }, { upsert: true }); }
      catch (e: any) { if (e?.code !== 11000) throw e; }
      doc = await collection.findOne({ _id: 'catalog' });
    }
    if (!doc || !Number.isInteger(doc.revision) || !Array.isArray(doc.decks)) throw new Error('預組目錄尚未就緒');
    return doc;
  }
  async function mutate(input: any, actor: string, parse: () => Deck) {
    const doc = await read();
    if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId)) throw new Error('操作識別碼錯誤');
    if (doc.lastRequestId === input.requestId && doc.lastActor === actor) return doc;
    if (input.revision !== doc.revision) throw new Error('目錄已變更，請重新載入');
    const decks = doc.decks.map((d: any) => ({ ...d }));
    if (input.action === 'add') {
      if (decks.length >= 300) throw new Error('預組目錄已達 300 套上限');
      const deck = parse();
      if (decks.some((d: any) => d.id === '__preset_admin_' + input.requestId)) throw new Error('此匯入識別碼已使用，請重新載入');
      if (decks.some((d: any) => d.name === deck.name && !d.deleted)) throw new Error('已有同名預組，請改名或先下架');
      decks.push({ ...deck, id: '__preset_admin_' + input.requestId, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    } else {
      if (!['delete', 'restore'].includes(input.action)) throw new Error('操作不支援');
      const deck = decks.find((d: any) => d.id === input.id);
      if (!deck) throw new Error('找不到預組');
      if (input.action === 'restore' && decks.some((d: any) => !d.deleted && d.id !== deck.id && d.name === deck.name)) throw new Error('已有同名預組，無法復原');
      deck.deleted = input.action === 'delete';
    }
    const r = await collection.updateOne({ _id: 'catalog', revision: doc.revision }, { $set: { decks, revision: doc.revision + 1, lastRequestId: input.requestId, lastActor: actor, updatedAt: Date.now() } });
    if (r.modifiedCount !== 1) throw new Error('目錄已變更，請重新載入');
    return read();
  }
  return { read, mutate };
}

export function presetPublicCatalog(doc: any) {
  return { presetsApi: 1, revision: doc.revision, decks: doc.decks.filter((d: any) => !d.deleted).map((d: any) => ({
    id: d.id, name: d.name, entries: d.entries, createdAt: d.createdAt, updatedAt: d.updatedAt,
    ...(d.notes ? { notes: d.notes } : {}), ...(d.coinPref ? { coinPref: d.coinPref } : {})
  })) };
}
