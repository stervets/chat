package ru.core5.marx;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RuStorePushPlugin.class);
        super.onCreate(savedInstanceState);
        RuStorePushBridge.handleLaunchIntent(this, getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        RuStorePushBridge.setAppActive(true);
    }

    @Override
    public void onPause() {
        RuStorePushBridge.setAppActive(false);
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        RuStorePushBridge.handleLaunchIntent(this, intent);
    }
}
