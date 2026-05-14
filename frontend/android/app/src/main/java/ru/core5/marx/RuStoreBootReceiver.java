package ru.core5.marx;

import android.app.Application;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import ru.rustore.sdk.pushclient.RuStorePushClient;
import ru.rustore.sdk.pushclient.common.logger.DefaultLogger;

public class RuStoreBootReceiver extends BroadcastReceiver {
    private static final String TAG = "RuStoreBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        String action = String.valueOf(intent.getAction());
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            return;
        }

        String projectId = RuStorePushBridge.getStoredProjectId(context).trim();
        if (projectId.isEmpty()) {
            Log.i(TAG, "Skip boot init: empty projectId");
            return;
        }

        try {
            Application application = (Application) context.getApplicationContext();
            RuStorePushClient.INSTANCE.init(application, projectId, new DefaultLogger());
            Log.i(TAG, "RuStore SDK init on boot completed");

            RuStorePushClient.INSTANCE.getToken()
                .addOnSuccessListener(token -> {
                    String normalized = token == null ? "" : token.trim();
                    RuStorePushBridge.dispatchToken(context, normalized);
                    Log.i(TAG, "RuStore token refreshed on boot");
                })
                .addOnFailureListener(error -> {
                    String reason = String.valueOf(error == null ? "unknown_error" : error.getMessage());
                    Log.w(TAG, "RuStore token refresh on boot failed: " + reason);
                });
        } catch (Throwable error) {
            Log.w(TAG, "RuStore boot init failed: " + String.valueOf(error.getMessage()));
        }
    }
}
