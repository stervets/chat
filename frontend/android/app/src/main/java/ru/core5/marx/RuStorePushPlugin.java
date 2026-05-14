package ru.core5.marx;

import android.app.Application;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import ru.rustore.sdk.pushclient.RuStorePushClient;
import ru.rustore.sdk.pushclient.common.logger.DefaultLogger;

@CapacitorPlugin(name = "RuStorePush")
public class RuStorePushPlugin extends Plugin {
    private static final String TAG = "RuStorePushPlugin";
    private static String initializedProjectId = "";

    @Override
    public void load() {
        super.load();
        RuStorePushBridge.setPlugin(this);
        RuStorePushBridge.handleLaunchIntent(getContext(), getActivity() == null ? null : getActivity().getIntent());
    }

    @PluginMethod
    public void register(PluginCall call) {
        String projectId = call.getString("projectId", "").trim();
        if (projectId.isEmpty()) {
            call.reject("rustore_project_id_empty");
            return;
        }

        try {
            ensureClientInitialized(projectId);
        } catch (Exception error) {
            call.reject("rustore_init_failed", error);
            return;
        } catch (Throwable error) {
            call.reject("rustore_init_failed", new Exception(error));
            return;
        }

        resolveToken(call);
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        String token = RuStorePushBridge.getStoredToken(getContext());
        if (!token.isEmpty()) {
            JSObject result = new JSObject();
            result.put("token", token);
            call.resolve(result);
            return;
        }
        resolveToken(call);
    }

    @PluginMethod
    public void getLaunchNotification(PluginCall call) {
        JSObject result = new JSObject();
        JSObject payload = RuStorePushBridge.consumeLaunchPayload(getContext());
        result.put("notification", payload.length() == 0 ? null : payload);
        call.resolve(result);
    }

    void notifyToken(@NonNull String token) {
        JSObject payload = new JSObject();
        payload.put("token", token);
        notifyListeners("token", payload, true);
    }

    void notifyPushReceived(@NonNull JSObject payload) {
        JSObject result = new JSObject();
        result.put("notification", payload);
        notifyListeners("pushReceived", result, true);
    }

    void notifyPushAction(@NonNull JSObject payload) {
        JSObject result = new JSObject();
        result.put("notification", payload);
        notifyListeners("pushActionPerformed", result, true);
    }

    private void ensureClientInitialized(@NonNull String projectId) {
        if (projectId.equals(initializedProjectId)) {
            return;
        }
        Application application = getActivity().getApplication();
        RuStorePushClient.INSTANCE.init(application, projectId, new DefaultLogger());
        initializedProjectId = projectId;
        Log.i(TAG, "RuStore Push SDK initialized");
    }

    private void resolveToken(PluginCall call) {
        RuStorePushClient.INSTANCE.getToken()
            .addOnSuccessListener(token -> {
                String normalized = token == null ? "" : token.trim();
                RuStorePushBridge.dispatchToken(getContext(), normalized);
                JSObject result = new JSObject();
                result.put("token", normalized);
                call.resolve(result);
            })
            .addOnFailureListener(error -> {
                if (error instanceof Exception) {
                    call.reject("rustore_get_token_failed", (Exception) error);
                    return;
                }
                call.reject("rustore_get_token_failed", new Exception(error));
            });
    }
}
