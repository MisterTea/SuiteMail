package com.suitemail.app;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Private durable inbox cache. Acknowledgments cannot delete a newer version of the same thread. */
final class BackgroundMailStore {
    private static final Object LOCK=new Object();
    private final File directory;
    BackgroundMailStore(Context context) { this(new File(context.getFilesDir(),"background-mail")); }
    BackgroundMailStore(File directory) { this.directory=directory; }
    private File file(String accountId,String threadId) {
        if (!accountId.matches("[A-Za-z0-9_-]+") || !threadId.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("Invalid mail identifier");
        return new File(directory,accountId+"_"+threadId+".json");
    }
    void put(String accountId,String threadId,JSONObject thread) throws Exception { synchronized(LOCK) {
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Cannot create private mail cache");
        JSONObject value = new JSONObject().put("accountId",accountId).put("threadId",threadId)
            .put("version",UUID.randomUUID().toString()).put("thread",thread==null?JSONObject.NULL:thread);
        File destination=file(accountId,threadId);
        File temporary=File.createTempFile("mail-",".tmp",directory);
        try {
            try(FileOutputStream stream=new FileOutputStream(temporary)) {
                stream.write(value.toString().getBytes(StandardCharsets.UTF_8));stream.getFD().sync();
            }
            Files.move(temporary.toPath(),destination.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        } finally { temporary.delete(); }
    }
    }
    private JSONObject read(File file) throws Exception {
        return new JSONObject(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));
    }
    JSONArray list(int limit) throws Exception { synchronized(LOCK) {
        JSONArray result=new JSONArray();File[] files=directory.listFiles((dir,name)->name.endsWith(".json"));
        if(files==null)return result;
        Arrays.sort(files,Comparator.comparingLong(File::lastModified).reversed());
        for(File file:files){if(result.length()>=limit)break;result.put(read(file));}
        return result;
    }
    }
    boolean acknowledge(String accountId,String threadId,String version) throws Exception { synchronized(LOCK) {
        File file=file(accountId,threadId);
        if(!file.exists())return false;
        if(!version.equals(read(file).optString("version")))return false;
        return file.delete();
    }
    }
    int count(){File[] files=directory.listFiles((dir,name)->name.endsWith(".json"));return files==null?0:files.length;}
}
