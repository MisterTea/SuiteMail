package com.suitemail.app;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/** Runs with an application Context only: no Activity, WebView, password, or refresh token. */
public class BackgroundMailWorker extends Worker {
    private final Context context;
    private final SharedPreferences prefs;
    private final BackgroundMailStore store;
    private long nextRequest=0;
    private String currentAccount="";
    private String token;
    private String email;
    private static final String GMAIL_URL="https://gmail.googleapis.com/gmail/v1/users/me";
    private static class Paused extends Exception {}
    private static class Reconnect extends Exception {}
    private static class HttpError extends IOException {
        final int status;
        HttpError(int status){super("Google HTTP "+status);this.status=status;}
    }
    public BackgroundMailWorker(@NonNull Context context,@NonNull WorkerParameters parameters){
        super(context,parameters);this.context=context;this.prefs=BackgroundMailScheduler.prefs(context);this.store=new BackgroundMailStore(context);
    }
    private void check() throws Paused {
        if(isStopped() || BackgroundMailScheduler.foreground || !BackgroundMailScheduler.enabled(context))throw new Paused();
    }
    private void save(String key,JSONObject state) throws IOException {
        if(!prefs.edit().putString(key,state.toString()).commit())throw new IOException("Cannot save sync progress");
    }
    static final String DEBUG_GMAIL_URL="debug_background_gmail_url";
    static final String DEBUG_ACCESS_TOKEN="debug_background_access_token";
    private boolean debuggable(){return (context.getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0;}
    private void authorize() throws Exception {
        // Debug builds only: lets an emulator test run against a local Gmail stand-in.
        if(debuggable() && prefs.contains(DEBUG_ACCESS_TOKEN)){token=prefs.getString(DEBUG_ACCESS_TOKEN,"");return;}
        AuthorizationRequest request=AuthorizationRequest.builder().setAccount(new Account(email,"com.google"))
            .setRequestedScopes(GoogleAccountsPlugin.SCOPES.stream().map(Scope::new).collect(Collectors.toList())).build();
        AuthorizationResult result=Tasks.await(Identity.getAuthorizationClient(context).authorize(request),30,TimeUnit.SECONDS);
        // Never launch a resolution/consent UI from background work.
        if(result.hasResolution() || result.getAccessToken()==null || !result.getGrantedScopes().contains(GoogleAccountsPlugin.SCOPES.get(0)))throw new Reconnect();
        token=result.getAccessToken();
    }
    private JSONObject request(String resource,int cost) throws Exception {return request(resource,cost,false);}
    private JSONObject request(String resource,int cost,boolean retried) throws Exception {
        check();long until=Math.max(nextRequest,prefs.getLong("cooldown:"+currentAccount,0));
        if(until-System.currentTimeMillis()>10_000)throw new HttpError(429);
        while(System.currentTimeMillis()<until){check();Thread.sleep(Math.max(1,Math.min(200,until-System.currentTimeMillis())));}
        nextRequest=System.currentTimeMillis()+cost*25L; // Same conservative 2,400-unit/minute budget as foreground.
        String base=debuggable()?prefs.getString(DEBUG_GMAIL_URL,GMAIL_URL):GMAIL_URL;
        HttpURLConnection connection=(HttpURLConnection)new URL(base+resource).openConnection();
        connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setRequestProperty("Authorization","Bearer "+token);
        connection.setInstanceFollowRedirects(false);
        int status;String body;
        try {
            status=connection.getResponseCode();
            InputStream stream=status<400?connection.getInputStream():connection.getErrorStream();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(stream!=null){try(InputStream input=stream){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);}}
            body=bytes.toString("UTF-8");
            if(status==429 || (status==403 && (body.contains("rateLimitExceeded") || body.contains("userRateLimitExceeded") || body.contains("RATE_LIMIT_EXCEEDED")))){
                long delay=60000;String retry=connection.getHeaderField("Retry-After");
                try{if(retry!=null)delay=Math.max(delay,Long.parseLong(retry)*1000);}catch(NumberFormatException ignored){}
                prefs.edit().putLong("cooldown:"+currentAccount,System.currentTimeMillis()+delay).commit();throw new HttpError(429);
            }
        } finally {connection.disconnect();}
        if(status==401 && !retried){
            Tasks.await(Identity.getAuthorizationClient(context).clearToken(ClearTokenRequest.builder().setToken(token).build()),20,TimeUnit.SECONDS);
            authorize();return request(resource,cost,true);
        }
        if(status<200 || status>=300)throw new HttpError(status);
        return new JSONObject(body);
    }
    private String frontendCursor(String accountId,String historyId){
        // Read the more recent foreground-backfill cursor if the account's initial download is unfinished.
        if(historyId!=null && !historyId.isEmpty())return historyId;
        try{
            JSONArray rows=AppDatabase.select(context,"SELECT value FROM settings WHERE key=$1","gmail_initial_sync:"+accountId);
            if(rows.length()>0)return new JSONObject(rows.getJSONObject(0).getString("value")).optString("historyId","");
        }catch(Exception ignored){}
        return "";
    }
    private JSONObject bootstrap(String cursor) throws Exception {
        if(cursor.isEmpty())cursor=request("/profile?fields=historyId",1).getString("historyId");
        JSONObject state=new JSONObject().put("cursor",cursor).put("bootstrap",true);
        JSONArray threads=request("/threads?labelIds=INBOX&maxResults=5&fields=threads(id)",10).optJSONArray("threads");
        JSONArray pending=new JSONArray();if(threads!=null)for(int i=0;i<threads.length();i++)pending.put(threads.getJSONObject(i).getString("id"));
        return state.put("pending",pending);
    }
    private boolean syncAccount(String id,String accountEmail,String historyId) throws Exception {
        currentAccount=id;email=accountEmail;authorize();
        String key="state:"+id;JSONObject state;
        try{state=new JSONObject(prefs.getString(key,"{}"));}catch(JSONException e){state=new JSONObject();}
        if(!state.has("cursor")){state=bootstrap(frontendCursor(id,historyId));save(key,state);}
        long deadline=System.currentTimeMillis()+75_000;int downloaded=0;
        while(System.currentTimeMillis()<deadline){
            check();JSONArray pending=state.optJSONArray("pending");
            if(pending!=null && pending.length()>0){
                if(downloaded>=15)return false;
                String threadId=pending.getString(0);JSONObject thread;
                try{thread=request("/threads/"+URLEncoder.encode(threadId,"UTF-8")+"?format=full",120);}
                catch(HttpError error){if(error.status==404)thread=null;else throw error;}
                check();store.put(id,threadId,thread);
                pending.remove(0);downloaded++;save(key,state);continue;
            }
            if(state.optBoolean("bootstrap")){state.put("bootstrap",false);save(key,state);}
            else if(state.optBoolean("pageLoaded")){
                String next=state.optString("nextPageToken","");
                if(next.isEmpty()){
                    state.put("cursor",state.getString("targetCursor"));state.remove("pageToken");state.remove("pageLoaded");state.remove("targetCursor");save(key,state);return true;
                }
                state.put("pageToken",next);state.remove("pageLoaded");save(key,state);
            }
            String resource="/history?maxResults=100&startHistoryId="+URLEncoder.encode(state.getString("cursor"),"UTF-8");
            if(state.has("pageToken"))resource+="&pageToken="+URLEncoder.encode(state.getString("pageToken"),"UTF-8");
            JSONObject changes;
            try{changes=request(resource,2);}
            catch(HttpError error){
                if(error.status==404){save(key,bootstrap(""));return false;} // Expired cursor: bootstrap newest mail on retry.
                throw error;
            }
            LinkedHashSet<String> ids=new LinkedHashSet<>();JSONArray history=changes.optJSONArray("history");
            if(history!=null)for(int i=0;i<history.length();i++){
                JSONObject item=history.getJSONObject(i);JSONArray messages=item.optJSONArray("messages");
                if(messages!=null)for(int j=0;j<messages.length();j++)ids.add(messages.getJSONObject(j).getString("threadId"));
            }
            List<String> recent=new ArrayList<>(ids);Collections.reverse(recent);
            state.put("pending",new JSONArray(recent)).put("pageLoaded",true).put("targetCursor",changes.getString("historyId"))
                .put("nextPageToken",changes.optString("nextPageToken",""));save(key,state);
        }
        return false;
    }
    @NonNull @Override public Result doWork(){
        if(!BackgroundMailScheduler.enabled(context) || BackgroundMailScheduler.foreground)return Result.success();
        prefs.edit().putLong("last_attempt",System.currentTimeMillis()).commit();
        boolean retry=false;String failure="";
        File file=new File(context.getFilesDir(),"suitemail.db");
        if(!file.exists())return Result.success();
        try{
            // Through the app's own Rust connection (initialized here if WorkManager cold-started the process).
            JSONArray accounts=AppDatabase.select(context,"SELECT id,email,history_id FROM accounts WHERE is_active=1 AND provider='gmail_api'");
            for(int i=0;i<accounts.length();i++){
                JSONObject account=accounts.getJSONObject(i);
                try{if(!syncAccount(AppDatabase.string(account,"id"),AppDatabase.string(account,"email"),AppDatabase.string(account,"history_id")))retry=true;}
                catch(Paused e){return Result.success();}
                catch(Reconnect e){failure="reconnect";}
                catch(Exception e){
                    Throwable cause=e.getCause();
                    ApiException api=e instanceof ApiException?(ApiException)e:cause instanceof ApiException?(ApiException)cause:null;
                    int code=api==null?-1:api.getStatusCode();
                    if(code==4 || code==10 || code==16 || code==12500 || code==12501 || (e instanceof HttpError && (((HttpError)e).status==401 || ((HttpError)e).status==403)))failure="reconnect";
                    else {failure="network";retry=true;}
                }
            }
            prefs.edit().putString("last_error",failure).putLong("last_success",failure.isEmpty()?System.currentTimeMillis():prefs.getLong("last_success",0)).commit();
            return retry?Result.retry():Result.success();
        }catch(Exception e){prefs.edit().putString("last_error","storage").commit();return Result.retry();}
    }
}
