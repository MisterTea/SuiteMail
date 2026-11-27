import {Capacitor,registerPlugin} from '@capacitor/core';
import {getAccount} from '../db/accounts';
import {deleteThread} from '../db/threads';
import {getPendingOpsForResource} from '../db/pendingOperations';
import {storeBackgroundGmailThread} from './sync';
import type {GmailThread} from './client';
export interface BackgroundMailStatus {
  enabled:boolean; intervalMinutes:number; lastAttempt:number; lastSuccess:number; lastError:string; queuedThreads:number;
  batteryOptimizationIgnored?:boolean; backfillLastSuccess?:number; backfillLastError?:string;
}
interface CachedThread {accountId:string;threadId:string;version:string;thread:GmailThread|null}
interface BackgroundMailPlugin {
  status():Promise<BackgroundMailStatus>;
  configure(options:{enabled:boolean}):Promise<BackgroundMailStatus>;
  requestUnrestrictedBattery():Promise<void>;
  pending():Promise<{entries:CachedThread[]}>;
  acknowledge(entry:{accountId:string;threadId:string;version:string}):Promise<{removed:boolean}>;
}
const native=registerPlugin<BackgroundMailPlugin>('BackgroundMail');
export const hasAndroidBackgroundSync=()=>Capacitor.getPlatform()==='android';
export const getBackgroundMailStatus=()=>native.status();
export const setBackgroundMailEnabled=(enabled:boolean)=>native.configure({enabled});
export const requestUnrestrictedBattery=()=>native.requestUnrestrictedBattery();
let importing:Promise<number>|null=null;
export async function importBackgroundMail():Promise<number>{
  if(!hasAndroidBackgroundSync())return 0;
  if(importing)return importing;
  importing=(async()=>{
    const {entries}=await native.pending();let imported=0;
    for(const entry of entries){
      try{
        const account=await getAccount(entry.accountId);
        if(account?.is_active && account.provider==='gmail_api'){
          // Preserve queued local edits; the version stays available for the next foreground check.
          if((await getPendingOpsForResource(entry.accountId,entry.threadId)).length)continue;
          if(entry.thread===null)await deleteThread(entry.accountId,entry.threadId);
          else{
            if(entry.thread.id!==entry.threadId)throw new Error('Background mail identifier mismatch');
            await storeBackgroundGmailThread(entry.accountId,entry.thread);
          }
          imported++;
        }
        await native.acknowledge({accountId:entry.accountId,threadId:entry.threadId,version:entry.version});
      }catch(error){console.warn('Could not import a background mail download:',error);}
    }
    if(imported)window.dispatchEvent(new Event('suitemail-sync-progress'));
    return imported;
  })().finally(()=>{importing=null;});
  return importing;
}
