package ru.core5.marx;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Iterator;
import java.util.Map;

public final class RuStorePushBridge {
    public static final String MESSAGE_CHANNEL_ID = "marx-messages";
    public static final String CALL_CHANNEL_ID = "marx-calls";

    private static final String PREFS_NAME = "marx_rustore_push";
    private static final String PREF_TOKEN = "token";
    private static final String PREF_PROJECT_ID = "project_id";
    private static final String PREF_LAUNCH_PAYLOAD = "launch_payload";
    private static final String EXTRA_PAYLOAD = "marx_rustore_push_payload";

    private static WeakReference<RuStorePushPlugin> pluginRef = new WeakReference<>(null);
    private static boolean appActive = false;

    private RuStorePushBridge() {
    }

    public static void setPlugin(@Nullable RuStorePushPlugin plugin) {
        pluginRef = new WeakReference<>(plugin);
    }

    public static void setAppActive(boolean active) {
        appActive = active;
    }

    public static boolean isAppActive() {
        return appActive;
    }

    public static void dispatchToken(Context context, String token) {
        storeToken(context, token);
        RuStorePushPlugin plugin = pluginRef.get();
        if (plugin != null) {
            plugin.notifyToken(token);
        }
    }

    public static void dispatchPushReceived(Context context, JSObject payload) {
        RuStorePushPlugin plugin = pluginRef.get();
        if (plugin != null) {
            plugin.notifyPushReceived(payload);
        }
    }

    public static void dispatchPushAction(Context context, JSObject payload) {
        storeLaunchPayload(context, payload);
        RuStorePushPlugin plugin = pluginRef.get();
        if (plugin != null) {
            plugin.notifyPushAction(payload);
        }
    }

    public static void dispatchError(Context context, String code, String message) {
        RuStorePushPlugin plugin = pluginRef.get();
        if (plugin != null) {
            plugin.notifyPushError(code == null ? "" : code, message == null ? "" : message);
        }
    }

    public static String getStoredToken(Context context) {
        return prefs(context).getString(PREF_TOKEN, "");
    }

    public static void storeProjectId(Context context, String projectId) {
        prefs(context).edit().putString(PREF_PROJECT_ID, projectId == null ? "" : projectId.trim()).apply();
    }

    public static String getStoredProjectId(Context context) {
        return prefs(context).getString(PREF_PROJECT_ID, "");
    }

    public static JSObject consumeLaunchPayload(Context context) {
        SharedPreferences preferences = prefs(context);
        String raw = preferences.getString(PREF_LAUNCH_PAYLOAD, "");
        preferences.edit().remove(PREF_LAUNCH_PAYLOAD).apply();
        return jsonStringToJsObject(raw);
    }

    public static void handleLaunchIntent(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        JSObject payload = jsonStringToJsObject(intent.getStringExtra(EXTRA_PAYLOAD));
        if (payload.length() == 0) {
            return;
        }
        dispatchPushAction(context, payload);
    }

    public static Intent createLaunchIntent(Context context, Class<?> activityClass, JSObject payload) {
        Intent intent = new Intent(context, activityClass);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(EXTRA_PAYLOAD, payload.toString());
        return intent;
    }

    public static JSObject payloadToJsObject(Map<String, String> data) {
        JSObject payload = new JSObject();
        putIfNotEmpty(payload, "provider", data.get("provider"));
        putIfNotEmpty(payload, "platform", data.get("platform"));
        putIfNotEmpty(payload, "type", data.get("type"));
        putIfNotEmpty(payload, "title", data.get("title"));
        putIfNotEmpty(payload, "body", data.get("body"));
        putIfNotEmpty(payload, "roomId", data.get("roomId"));
        putIfNotEmpty(payload, "messageId", data.get("messageId"));
        putIfNotEmpty(payload, "callId", data.get("callId"));
        putIfNotEmpty(payload, "channelId", data.get("channelId"));
        return payload;
    }

    private static void storeToken(Context context, String token) {
        prefs(context).edit().putString(PREF_TOKEN, token == null ? "" : token).apply();
    }

    private static void storeLaunchPayload(Context context, JSObject payload) {
        prefs(context).edit().putString(PREF_LAUNCH_PAYLOAD, payload == null ? "" : payload.toString()).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static JSObject jsonStringToJsObject(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSObject();
        }
        try {
            JSONObject source = new JSONObject(raw);
            JSObject result = new JSObject();
            Iterator<String> iterator = source.keys();
            while (iterator.hasNext()) {
                String key = iterator.next();
                result.put(key, source.opt(key));
            }
            return result;
        } catch (JSONException ignored) {
            return new JSObject();
        }
    }

    private static void putIfNotEmpty(JSObject object, String key, @Nullable String value) {
        if (value == null) {
            return;
        }
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            return;
        }
        object.put(key, normalized);
    }
}
