package com.suitemail.app;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.*;
import com.getcapacitor.JSObject;
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
        nextRequest=System.currentTimeMillis()+cost*40L/3; // 4,500 units/minute, the foreground budget (Gmail allows 6,000).
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
    static final String SINGLE_MESSAGE="m:";
    /**
     * Download entries for one history page, newest thread first. A thread whose only new message is its first
     * message (Gmail thread IDs equal their first message's ID) is a new conversation and is fetched as that one
     * message; any other thread with new mail is fetched whole.
     */
    static List<String> downloadsFor(JSONObject changes) throws JSONException {
        LinkedHashMap<String,LinkedHashSet<String>> added=new LinkedHashMap<>();
        JSONArray history=changes.optJSONArray("history");
        if(history!=null)for(int i=0;i<history.length();i++){
            JSONArray messages=history.getJSONObject(i).optJSONArray("messagesAdded");
            if(messages!=null)for(int j=0;j<messages.length();j++){
                JSONObject message=messages.getJSONObject(j).getJSONObject("message");
                String threadId=message.getString("threadId");
                LinkedHashSet<String> ids=added.remove(threadId);if(ids==null)ids=new LinkedHashSet<>();
                ids.add(message.getString("id"));added.put(threadId,ids); // Re-insert so the latest activity sorts last.
            }
        }
        List<String> result=new ArrayList<>();
        for(Map.Entry<String,LinkedHashSet<String>> thread:added.entrySet()){
            Set<String> ids=thread.getValue();
            result.add(ids.size()==1 && ids.contains(thread.getKey())?SINGLE_MESSAGE+thread.getKey():thread.getKey());
        }
        Collections.reverse(result);
        return result;
    }
    /** Shape one message like a threads.get result; `partial` tells the app not to replace a thread it already has. */
    static JSONObject singleMessageThread(JSONObject message) throws JSONException {
        return new JSONObject().put("id",message.getString("threadId")).put("historyId",message.optString("historyId",""))
            .put("partial",true).put("messages",new JSONArray().put(message));
    }
    static final class NotifiableMessage {
        final String messageId;
        final String threadId;
        final String fromName;
        final String fromAddress;
        final String subject;
        final String snippet;
        final long timestampMs;
        NotifiableMessage(String messageId,String threadId,String fromName,String fromAddress,String subject,String snippet,long timestampMs){
            this.messageId=messageId;this.threadId=threadId;this.fromName=fromName;this.fromAddress=fromAddress;
            this.subject=subject;this.snippet=snippet;this.timestampMs=timestampMs;
        }
    }
    private static final String PREFS_NOTIFIED_IDS="notified_message_ids";
    private static final int MAX_NOTIFIED_IDS=200;
    private static final int MAX_INDIVIDUAL_NOTIFICATIONS=3;

    static String[] parseSender(String fromHeader){
        if(fromHeader==null)return new String[]{"New mail",""};
        String trimmed=fromHeader.trim();
        int lt=trimmed.lastIndexOf('<');int gt=trimmed.lastIndexOf('>');
        if(lt>=0 && gt>lt){
            String address=trimmed.substring(lt+1,gt).trim().toLowerCase(Locale.US);
            String name=trimmed.substring(0,lt).trim();
            if(name.startsWith("\"") && name.endsWith("\"") && name.length()>=2)name=name.substring(1,name.length()-1).trim();
            return new String[]{name.isEmpty()?(address.isEmpty()?"New mail":address):name,address};
        }
        String address=trimmed.toLowerCase(Locale.US);
        return new String[]{trimmed.isEmpty()?"New mail":trimmed,address};
    }

    static boolean isWithinQuietHours(String start,String end,int hour,int minute){
        if(start==null || end==null || start.isEmpty() || end.isEmpty() || start.equals(end))return false;
        String now=String.format(Locale.US,"%02d:%02d",hour,minute);
        return start.compareTo(end)<0
            ?(now.compareTo(start)>=0 && now.compareTo(end)<0)
            :(now.compareTo(start)>=0 || now.compareTo(end)<0);
    }

    private static String headerValue(JSONObject message,String name){
        JSONObject payload=message.optJSONObject("payload");
        if(payload==null)return "";
        JSONArray headers=payload.optJSONArray("headers");
        if(headers==null)return "";
        for(int i=0;i<headers.length();i++){
            JSONObject h=headers.optJSONObject(i);
            if(h!=null && name.equalsIgnoreCase(h.optString("name","")))return h.optString("value","");
        }
        return "";
    }

    private static boolean hasLabel(JSONArray labels,String target){
        if(labels==null)return false;
        for(int i=0;i<labels.length();i++)if(target.equals(labels.optString(i,"")))return true;
        return false;
    }

    static NotifiableMessage extractNotifiableMessage(JSONObject threadOrMessage,String accountEmail){
        if(threadOrMessage==null)return null;
        JSONObject message=threadOrMessage;
        JSONArray messages=threadOrMessage.optJSONArray("messages");
        if(messages!=null && messages.length()>0){
            message=messages.optJSONObject(messages.length()-1);
        }
        if(message==null)return null;
        JSONArray labels=message.optJSONArray("labelIds");
        if(!hasLabel(labels,"INBOX") || !hasLabel(labels,"UNREAD"))return null;
        if(hasLabel(labels,"SENT") || hasLabel(labels,"DRAFT") || hasLabel(labels,"TRASH") || hasLabel(labels,"SPAM"))return null;
        String messageId=message.optString("id","");
        String threadId=message.optString("threadId",threadOrMessage.optString("id",""));
        if(messageId.isEmpty() || threadId.isEmpty())return null;
        String[] sender=parseSender(headerValue(message,"From"));
        if(accountEmail!=null && !accountEmail.isEmpty() && sender[1].equalsIgnoreCase(accountEmail.trim()))return null;
        String subject=headerValue(message,"Subject").trim();
        String snippet=message.optString("snippet","").replaceAll("\\s+"," ").trim();
        long timestampMs=-1L;
        try{timestampMs=Long.parseLong(message.optString("internalDate","-1"));}catch(NumberFormatException ignored){}
        return new NotifiableMessage(messageId,threadId,sender[0],sender[1],subject.isEmpty()?"(No subject)":subject,snippet,timestampMs);
    }

    private Set<String> loadNotifiedIds(){
        Set<String> ids=new LinkedHashSet<>();
        try{
            JSONArray array=new JSONArray(prefs.getString(PREFS_NOTIFIED_IDS,"[]"));
            for(int i=0;i<array.length();i++){String id=array.optString(i,"");if(!id.isEmpty())ids.add(id);}
        }catch(Exception ignored){}
        return ids;
    }

    private void saveNotifiedIds(Set<String> ids){
        List<String> list=new ArrayList<>(ids);
        if(list.size()>MAX_NOTIFIED_IDS)list=list.subList(list.size()-MAX_NOTIFIED_IDS,list.size());
        prefs.edit().putString(PREFS_NOTIFIED_IDS,new JSONArray(list).toString()).commit();
    }

    private boolean shouldNotifyForAccount(String accountId,String fromAddress){
        if(!MailNotifications.canPost(context))return false;
        try{
            JSONArray globalRows=AppDatabase.select(context,"SELECT value FROM settings WHERE key=$1","notifications_enabled");
            if(globalRows.length()>0 && "false".equals(AppDatabase.string(globalRows.getJSONObject(0),"value")))return false;
            JSONArray prefRows=AppDatabase.select(context,"SELECT value FROM settings WHERE key=$1","mail_notification_schedule:"+accountId);
            if(prefRows.length()>0){
                String raw=AppDatabase.string(prefRows.getJSONObject(0),"value");
                if(raw!=null && !raw.isEmpty()){
                    JSONObject pref=new JSONObject(raw);
                    if(!pref.optBoolean("enabled",true))return false;
                    if(pref.optBoolean("quiet",false)){
                        Calendar cal=Calendar.getInstance();
                        if(isWithinQuietHours(pref.optString("start","18:00"),pref.optString("end","09:00"),
                                cal.get(Calendar.HOUR_OF_DAY),cal.get(Calendar.MINUTE))){
                            if(!pref.optBoolean("vipBypass",true) || fromAddress==null || fromAddress.isEmpty())return false;
                            JSONArray vips=AppDatabase.select(context,
                                "SELECT 1 FROM notification_vips WHERE account_id=$1 AND LOWER(email)=$2 LIMIT 1",
                                accountId,fromAddress.toLowerCase(Locale.US));
                            if(vips.length()==0)return false;
                        }
                    }
                }
            }
        }catch(Exception ignored){}
        return true;
    }

    private void notifyNewMessages(String accountId,String accountEmail,List<NotifiableMessage> arrivals){
        if(arrivals.isEmpty() || !MailNotifications.canPost(context))return;
        Set<String> notified=loadNotifiedIds();
        List<NotifiableMessage> fresh=new ArrayList<>();
        for(NotifiableMessage item:arrivals){
            if(notified.contains(item.messageId))continue;
            if(!shouldNotifyForAccount(accountId,item.fromAddress))continue;
            fresh.add(item);
        }
        if(fresh.isEmpty())return;
        String group="mailbox:"+accountId;
        if(fresh.size()<=MAX_INDIVIDUAL_NOTIFICATIONS){
            for(NotifiableMessage item:fresh){
                String body=item.snippet.isEmpty()?item.subject:item.subject+" \u2014 "+item.snippet;
                String largeBody=item.snippet.isEmpty()?null:item.subject+"\n"+item.snippet;
                JSObject extra=new JSObject();
                extra.put("accountId",accountId);
                extra.put("threadId",item.threadId);
                if(!item.fromAddress.isEmpty())extra.put("fromAddress",item.fromAddress);
                extra.put("subject",item.subject);
                int notifId=Math.abs((accountId+":"+item.messageId).hashCode()&0x1fffffff);
                MailNotifications.show(context,notifId,item.fromName,body,largeBody,item.timestampMs,group,accountEmail,extra,null);
                notified.add(item.messageId);
            }
        }else{
            long newest=-1L;
            for(NotifiableMessage item:fresh){
                if(item.timestampMs>newest)newest=item.timestampMs;
                notified.add(item.messageId);
            }
            JSObject extra=new JSObject();
            extra.put("accountId",accountId);
            int notifId=Math.abs((accountId+":batch").hashCode()&0x1fffffff);
            MailNotifications.show(context,notifId,accountEmail,fresh.size()+" new emails",null,newest,group,accountEmail,extra,null);
        }
        saveNotifiedIds(notified);
    }

    private boolean syncAccount(String id,String accountEmail,String historyId) throws Exception {
        currentAccount=id;email=accountEmail;authorize();
        String key="state:"+id;JSONObject state;
        try{state=new JSONObject(prefs.getString(key,"{}"));}catch(JSONException e){state=new JSONObject();}
        if(!state.has("cursor")){state=bootstrap(frontendCursor(id,historyId));save(key,state);}
        long deadline=System.currentTimeMillis()+75_000;int downloaded=0;
        List<NotifiableMessage> arrivals=new ArrayList<>();
        try{
            while(System.currentTimeMillis()<deadline){
                check();JSONArray pending=state.optJSONArray("pending");
                if(pending!=null && pending.length()>0){
                    if(downloaded>=15)return false;
                    String entry=pending.getString(0);
                    boolean isBootstrap=state.optBoolean("bootstrap");
                    if(entry.startsWith(SINGLE_MESSAGE)){
                        // A new conversation's only message: messages.get costs 60 units, threads.get 120.
                        String messageId=entry.substring(SINGLE_MESSAGE.length());JSONObject message=null;
                        try{message=request("/messages/"+URLEncoder.encode(messageId,"UTF-8")+"?format=full",60);}
                        catch(HttpError error){if(error.status!=404)throw error;} // Gone already: the app's own sync settles it.
                        check();
                        if(message!=null){
                            JSONObject wrapped=singleMessageThread(message);
                            store.put(id,messageId,wrapped);
                            if(!isBootstrap){
                                NotifiableMessage note=extractNotifiableMessage(wrapped,accountEmail);
                                if(note!=null)arrivals.add(note);
                            }
                        }
                    }else{
                        JSONObject thread;
                        try{thread=request("/threads/"+URLEncoder.encode(entry,"UTF-8")+"?format=full",120);}
                        catch(HttpError error){if(error.status==404)thread=null;else throw error;}
                        check();store.put(id,entry,thread);
                        if(!isBootstrap && thread!=null){
                            NotifiableMessage note=extractNotifiableMessage(thread,accountEmail);
                            if(note!=null)arrivals.add(note);
                        }
                    }
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
                // Only new mail is downloaded here; label changes and deletions are applied by the app's own sync.
                String resource="/history?maxResults=100&historyTypes=messageAdded&startHistoryId="+URLEncoder.encode(state.getString("cursor"),"UTF-8");
                if(state.has("pageToken"))resource+="&pageToken="+URLEncoder.encode(state.getString("pageToken"),"UTF-8");
                JSONObject changes;
                try{changes=request(resource,2);}
                catch(HttpError error){
                    if(error.status==404){save(key,bootstrap(""));return false;} // Expired cursor: bootstrap newest mail on retry.
                    throw error;
                }
                state.put("pending",new JSONArray(downloadsFor(changes))).put("pageLoaded",true).put("targetCursor",changes.getString("historyId"))
                    .put("nextPageToken",changes.optString("nextPageToken",""));save(key,state);
            }
            return false;
        }finally{
            notifyNewMessages(id,accountEmail,arrivals);
        }
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
