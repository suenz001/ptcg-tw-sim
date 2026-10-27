// 賽季是管理員手動/排程切換的時間線，並非曆法季度；歷史戰績不改寫。
export type Season = { id: string; year: number; number: number; startAt: number; name: string };
export type SeasonState = { revision: number; seasons: Season[]; pending: null | { next: Season; requestId: string }; operations?: {id:string;actor:string}[]; lastRequestId?: string; lastActor?: string };
export const FIRST_SEASON: Season = { id: '2026-1', year: 2026, number: 1, startAt: 0, name: '2026 年第一季' };
export function taipeiYear(at: number) { return new Date(at + 480 * 60000).getUTCFullYear(); }
export function nextSeason(seasons: Season[], at: number): Season {
  const year = taipeiYear(at);
  const number = Math.max(0, ...seasons.filter(s => s.year === year).map(s => s.number)) + 1;
  return { id: `${year}-${number}`, year, number, startAt: at, name: `${year} 年第${number === 1 ? '一' : number === 2 ? '二' : number === 3 ? '三' : number === 4 ? '四' : number}季` };
}
export function seasonDate(value: string, now: number): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('請選擇開始日期');
  const [y,m,d] = value.split('-').map(Number);
  const at = Date.UTC(y,m-1,d) - 480 * 60000;
  if (new Date(at + 480*60000).toISOString().slice(0,10) !== value || at <= now || y > taipeiYear(now) + 10) throw new Error('開始日期必須是未來十年內的台灣日期（00:00）');
  return at;
}
export function seasonWindow(state: SeasonState, id?: string) {
  const index = id ? state.seasons.findIndex(s => s.id === id) : state.seasons.length - 1;
  if (index < 0) throw new Error('找不到賽季，請重新載入');
  return { season: state.seasons[index], endAt: state.seasons[index + 1]?.startAt ?? null };
}
// 老資料缺開賽時間才用建立時間；兩者皆未知永遠歸初季，不使用會變動的finishedAt。
export function seasonArchiveQuery(startAt: number, endAt: number | null) {
  if (startAt===0 && endAt===null) return {};
  const valid = (field: string) => ({ [field]: { $type: 'number', $not:{$type:'array'}, $gt: 0, $lt:8640000000000000 } });
  const range = (field: string) => ({ [field]: { $type: 'number', $not:{$type:'array'}, ...(startAt===0?{$gt:0}:{$gte:startAt}), $lt:endAt ?? 8640000000000000 } });
  const cases: any[] = [range('startedAt'), { $and: [{ $nor: [valid('startedAt')] }, range('createdAt')] }];
  if (startAt === 0) cases.push({ $nor: [valid('startedAt'), valid('createdAt')] });
  return { $or: cases };
}
export function seasonHostQuery(startAt: number, endAt: number | null) {
  if(startAt===0 && endAt===null)return {createdByPlayer:true};
  const range = { createdAt: { $type:'number', $not:{$type:'array'}, ...(startAt===0?{$gt:0}:{$gte:startAt}), $lt:endAt ?? 8640000000000000 } };
  return { createdByPlayer:true, ...(startAt === 0 ? {$or:[range,{$nor:[{createdAt:{$type:'number',$not:{$type:'array'},$gt:0,$lt:8640000000000000}}]}]} : range) };
}
export function createSeasonService(collection: any, clock = Date.now) {
  let cache: { at:number; doc:SeasonState } | null = null;
  let flight: Promise<SeasonState> | null = null;
  async function readState(fresh = false): Promise<SeasonState> {
    const now=clock();
    if (!fresh && cache && now-cache.at < 5000 && (!cache.doc.pending || cache.doc.pending.next.startAt>now)) return cache.doc;
    let doc = await collection.findOne({_id:'state'});
    if (!doc) {
      try {await collection.updateOne({_id:'state'},{$setOnInsert:{revision:1,seasons:[FIRST_SEASON],pending:null}},{upsert:true});}
      catch(e:any){if(e?.code!==11000)throw e;}
      doc=await collection.findOne({_id:'state'});
    }
    if (!doc || !Array.isArray(doc.seasons) || doc.seasons.length===0 || !Number.isInteger(doc.revision)) throw new Error('賽季資料尚未就緒');
    if (doc.pending && doc.pending.next.startAt <= now) {
      const next=doc.pending.next;
      if (next.startAt <= doc.seasons.at(-1).startAt) throw new Error('賽季生效時間異常');
      const r=await collection.updateOne({_id:'state',revision:doc.revision},{$set:{seasons:[...doc.seasons,next],pending:null,revision:doc.revision+1,appliedAt:now}});
      cache=null;
      if(r.modifiedCount!==1)return load(true);
      doc={...doc,seasons:[...doc.seasons,next],pending:null,revision:doc.revision+1};
    }
    if (!cache || doc.revision >= cache.doc.revision) cache={at:now,doc};
    return doc;
  }
  async function load(fresh = false): Promise<SeasonState> {
    if (fresh) return readState(true);
    if (flight) return flight;
    const next=readState(false); flight=next;
    try { return await next; } finally { if (flight===next) flight=null; }
  }
  async function preview(input:any) {
    const doc=await load(true);const now=clock();
    if (!['next','schedule','cancel'].includes(input.action)) throw new Error('操作不支援');
    if (input.action!=='cancel' && doc.seasons.length>=500) throw new Error('賽季數量已達上限，請先維護資料結構');
    if (input.action==='next' && doc.pending) throw new Error('請先取消已設定的換季日期');
    if (input.action==='cancel' && !doc.pending) throw new Error('目前沒有排程');
    const next=input.action==='cancel'?doc.pending!.next:nextSeason(doc.seasons,input.action==='schedule'?seasonDate(input.date,now):now);
    return {seasonApi:1,revision:doc.revision,current:doc.seasons.at(-1),next,pending:doc.pending,action:input.action,date:input.date || null};
  }
  async function commit(input:any,actor:string) {
    const doc=await load(true);
    if(typeof input.requestId!=='string'||!/^[\w-]{8,80}$/.test(input.requestId))throw new Error('操作識別碼錯誤');
    if ((doc.operations || []).some(o=>o.id===input.requestId && o.actor===actor)) return doc;
    if(input.revision!==doc.revision)throw new Error('賽季已變更，請重新確認');
    const plan=await preview(input);
    if(plan.revision!==doc.revision || plan.next.id!==input.expectedId)throw new Error('生效年度或賽季已變更，請重新確認');
    const now=clock();
    if(input.action==='next' && plan.next.startAt<=doc.seasons.at(-1)!.startAt)throw new Error('請稍後再試');
    const changed=input.action==='next'?{seasons:[...doc.seasons,plan.next],pending:null}:input.action==='schedule'?{pending:{next:plan.next,requestId:input.requestId}}:{pending:null};
    const operations=[...(doc.operations || []),{id:input.requestId,actor,action:input.action,at:now,from:{seasonId:doc.seasons.at(-1)!.id,pending:doc.pending},to:{seasonId:input.action==='next'?plan.next.id:doc.seasons.at(-1)!.id,pending:input.action==='schedule'?plan.next:null}}].slice(-32);
    const r=await collection.updateOne({_id:'state',revision:doc.revision},{$set:{...changed,revision:doc.revision+1,operations,lastRequestId:input.requestId,lastActor:actor,updatedAt:now}});
    cache=null;if(r.modifiedCount!==1)throw new Error('賽季已變更，請重新確認');
    return load(true);
  }
  return {load,preview,commit};
}
