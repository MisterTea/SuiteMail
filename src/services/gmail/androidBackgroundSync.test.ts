import{afterEach,beforeEach,describe,it,expect,vi}from'vitest';
import{importBackgroundMail}from'./androidBackgroundSync';
const m=vi.hoisted(()=>({pending:vi.fn(),ack:vi.fn(),account:vi.fn(),ops:vi.fn(),store:vi.fn(),remove:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>({pending:m.pending,acknowledge:m.ack})}));
vi.mock('../db/accounts',()=>({getAccount:m.account}));vi.mock('../db/threads',()=>({deleteThread:m.remove}));
vi.mock('../db/pendingOperations',()=>({getPendingOpsForResource:m.ops}));vi.mock('./sync',()=>({storeBackgroundGmailThread:m.store}));
const entry={accountId:'a',threadId:'t',version:'v1',thread:{id:'t',messages:[{id:'m'}]}};
beforeEach(()=>{vi.clearAllMocks();m.pending.mockResolvedValue({entries:[entry]});m.account.mockResolvedValue({provider:'gmail_api',is_active:1});m.ops.mockResolvedValue([]);m.store.mockResolvedValue(undefined);m.ack.mockResolvedValue({removed:true});});
afterEach(()=>vi.restoreAllMocks());
describe('background Gmail import',()=>{
 it('stores a downloaded thread through the shared pipeline before acknowledging its exact version',async()=>{
  const events=vi.spyOn(window,'dispatchEvent');expect(await importBackgroundMail()).toBe(1);
  expect(m.store).toHaveBeenCalledWith('a',entry.thread);expect(m.ack).toHaveBeenCalledWith({accountId:'a',threadId:'t',version:'v1'});
  expect(m.store.mock.invocationCallOrder[0]).toBeLessThan(m.ack.mock.invocationCallOrder[0]);expect(events).toHaveBeenCalledWith(expect.objectContaining({type:'suitemail-sync-progress'}));
 });
 it('keeps a failed download import queued for recovery',async()=>{
  m.store.mockRejectedValue(new Error('disk busy'));expect(await importBackgroundMail()).toBe(0);expect(m.ack).not.toHaveBeenCalled();
 });
 it('preserves pending local changes and leaves the server snapshot queued',async()=>{
  m.ops.mockResolvedValue([{id:'local-edit'}]);await importBackgroundMail();expect(m.store).not.toHaveBeenCalled();expect(m.ack).not.toHaveBeenCalled();
 });
 it('drops cache entries for removed accounts without recreating their mail',async()=>{
  m.account.mockResolvedValue(null);await importBackgroundMail();expect(m.store).not.toHaveBeenCalled();expect(m.ack).toHaveBeenCalledOnce();
 });
 it('imports a confirmed remote deletion through normal local deletion handling',async()=>{
  m.pending.mockResolvedValue({entries:[{...entry,thread:null}]});await importBackgroundMail();expect(m.remove).toHaveBeenCalledWith('a','t');expect(m.ack).toHaveBeenCalledOnce();
 });
 it('shares concurrent imports so the same cache entry cannot be applied twice',async()=>{
  await Promise.all([importBackgroundMail(),importBackgroundMail()]);expect(m.store).toHaveBeenCalledOnce();expect(m.ack).toHaveBeenCalledOnce();
 });
});
