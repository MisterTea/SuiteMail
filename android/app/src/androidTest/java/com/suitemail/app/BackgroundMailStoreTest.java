package com.suitemail.app;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.File;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class BackgroundMailStoreTest {
    File directory;BackgroundMailStore store;
    @Before public void setup(){directory=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"mail-store-test-"+UUID.randomUUID());store=new BackgroundMailStore(directory);}
    @After public void cleanup(){File[] files=directory.listFiles();if(files!=null)for(File f:files)f.delete();directory.delete();}
    @Test public void durableThreadRoundTrip()throws Exception{
        store.put("account","thread",new JSONObject().put("id","thread"));
        assertEquals("thread",store.list(20).getJSONObject(0).getJSONObject("thread").getString("id"));
        assertEquals(1,new BackgroundMailStore(directory).count());
    }
    @Test public void staleAcknowledgmentCannotDeleteAnUpdatedDownload()throws Exception{
        store.put("account","thread",new JSONObject().put("id","thread"));String old=store.list(20).getJSONObject(0).getString("version");
        BackgroundMailStore worker=new BackgroundMailStore(directory);worker.put("account","thread",new JSONObject().put("id","thread").put("newer",true));
        assertFalse(store.acknowledge("account","thread",old));assertEquals(1,store.count());
        String latest=store.list(20).getJSONObject(0).getString("version");assertTrue(store.acknowledge("account","thread",latest));assertEquals(0,store.count());
    }
    @Test public void deletionMarkerSurvivesRestart()throws Exception{
        store.put("account","gone",null);assertTrue(new BackgroundMailStore(directory).list(20).getJSONObject(0).isNull("thread"));
    }
    @Test(expected=IllegalArgumentException.class)public void rejectsPathTraversal()throws Exception{store.put("../account","thread",new JSONObject());}
}
