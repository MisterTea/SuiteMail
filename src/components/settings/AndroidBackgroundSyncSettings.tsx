import {useEffect,useState} from 'react';
import {getBackgroundMailStatus,setBackgroundMailEnabled,hasAndroidBackgroundSync,type BackgroundMailStatus} from '@/services/gmail/androidBackgroundSync';
export function AndroidBackgroundSyncSettings(){
  const [status,setStatus]=useState<BackgroundMailStatus|null>(null);
  const [saving,setSaving]=useState(false);const[error,setError]=useState('');
  const android=hasAndroidBackgroundSync();
  useEffect(()=>{if(android)getBackgroundMailStatus().then(setStatus).catch(()=>setError('Could not read background sync settings.'));},[android]);
  if(!android)return null;
  return <section className="mb-6 space-y-3">
    <h3 className="font-semibold text-text-primary">Background Gmail sync</h3>
    <label className="flex min-h-12 items-center gap-3 text-sm text-text-primary">
      <input type="checkbox" checked={status?.enabled??true} disabled={!status||saving} onChange={async event=>{
        setSaving(true);setError('');try{setStatus(await setBackgroundMailEnabled(event.target.checked));}catch{setError('Could not change background sync.');}finally{setSaving(false);}
      }}/><span>Check for mail when SuiteMail is closed</span>
    </label>
    <p className="text-sm text-text-secondary">Checks about every 15 minutes with an internet connection. Android may delay checks to save battery. Downloaded mail is ready to load when you reopen SuiteMail.</p>
    {status?.lastSuccess ? <p className="text-sm text-text-secondary">Last background check: {new Date(status.lastSuccess).toLocaleString()}</p>:null}
    {status?.lastError&&<p role="status" className="text-sm text-text-secondary">{status.lastError==='reconnect'?'Reconnect your Google account below to resume background checks.':'The last background check could not finish. It will retry when possible.'}</p>}
    {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
