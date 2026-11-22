package com.suitemail.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SuiteMailPlugin.class);
        registerPlugin(AndroidUpdaterPlugin.class);
        registerPlugin(GoogleAccountsPlugin.class);
        registerPlugin(BackgroundMailPlugin.class);
        super.onCreate(savedInstanceState);
    }
    @Override public void onResume() {
        super.onResume();
        BackgroundMailScheduler.foreground = true;
    }
    @Override public void onPause() {
        BackgroundMailScheduler.foreground = false;
        super.onPause();
    }
}
