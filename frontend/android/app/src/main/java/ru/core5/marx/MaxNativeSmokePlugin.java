package ru.core5.marx;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

@CapacitorPlugin(name = "MaxNativeSmokeTest")
public class MaxNativeSmokePlugin extends Plugin {
    private static final String TAG = "MaxNativeSmoke";

    private static final String DEFAULT_WS_URL = "wss://ws-api.oneme.ru/websocket";
    private static final String DEFAULT_ORIGIN = "https://web.max.ru";
    private static final String DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    private static final String DEFAULT_DEVICE_ID = "4af2d638-3d77-47dd-abe6-9812f5147a90";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void run(PluginCall call) {
        String wsUrl = String.valueOf(call.getString("wsUrl", DEFAULT_WS_URL)).trim();
        String origin = String.valueOf(call.getString("origin", DEFAULT_ORIGIN)).trim();
        String userAgent = String.valueOf(call.getString("userAgent", DEFAULT_USER_AGENT)).trim();
        String token = String.valueOf(call.getString("token", "")).trim();
        String deviceId = String.valueOf(call.getString("deviceId", DEFAULT_DEVICE_ID)).trim();
        int chatId = call.getInt("chatId", 0);

        if (token.isEmpty()) {
            call.reject("max_token_required");
            return;
        }

        String tokenMasked = maskToken(token);
        Log.i(TAG, "start");
        Log.i(TAG, "request url=" + wsUrl);
        Log.i(TAG, "request headers origin=" + origin + " userAgent=" + userAgent);
        Log.i(TAG, "token=" + tokenMasked + " deviceId=" + deviceId + " chatId=" + chatId);

        OkHttpClient client = new OkHttpClient.Builder().build();
        Request request = new Request.Builder()
            .url(wsUrl)
            .addHeader("Origin", origin)
            .addHeader("User-Agent", userAgent)
            .build();

        AtomicBoolean finished = new AtomicBoolean(false);
        AtomicInteger stage = new AtomicInteger(0);
        JSONArray logs = new JSONArray();

        WebSocketListener listener = new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                addLog(logs, "onOpen", jsonObject("httpCode", response.code()));
                Log.i(TAG, "onOpen");

                stage.set(1);
                String packet = buildOpcode6(deviceId, userAgent);
                boolean sent = webSocket.send(packet);
                addLog(logs, "sent opcode 6", jsonObject("sent", sent));
                Log.i(TAG, "sent opcode 6");
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                JSONObject parsed = parseJsonObject(text);
                int opcode = parsed == null ? 0 : parsed.optInt("opcode", 0);
                int seq = parsed == null ? -1 : parsed.optInt("seq", -1);
                int cmd = parsed == null ? -1 : parsed.optInt("cmd", -1);

                addLog(logs, "onMessage", jsonObject("opcode", opcode, "seq", seq, "cmd", cmd, "raw", truncate(text, 420)));

                if (stage.get() == 1 && opcode == 6) {
                    Log.i(TAG, "received opcode 6 response");
                    stage.set(2);
                    String packet = buildOpcode19(token);
                    boolean sent = webSocket.send(packet);
                    addLog(logs, "sent opcode 19", jsonObject("sent", sent));
                    Log.i(TAG, "sent opcode 19");
                    return;
                }

                if (stage.get() == 2 && opcode == 19) {
                    Log.i(TAG, "received opcode 19 response");
                    stage.set(3);
                    String textMessage = "native smoke " + Instant.now().toString();
                    String packet = buildOpcode64(chatId, textMessage);
                    boolean sent = webSocket.send(packet);
                    addLog(logs, "sent opcode 64", jsonObject("sent", sent, "text", textMessage));
                    Log.i(TAG, "sent opcode 64");
                    return;
                }

                if (stage.get() == 3 && opcode == 64) {
                    Log.i(TAG, "received opcode 64 response");
                    stage.set(4);
                    addLog(logs, "received opcode 64 response", jsonObject("raw", truncate(text, 420)));
                    webSocket.close(1000, "done");
                }
            }

            @Override
            public void onClosing(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                addLog(logs, "onClosing", jsonObject("code", code, "reason", reason));
                Log.i(TAG, "onClosing code=" + code + " reason=" + reason);
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                addLog(logs, "onClosed", jsonObject("code", code, "reason", reason));
                Log.i(TAG, "onClosed code=" + code + " reason=" + reason);
                resolveOnce(call, finished, true, logs, null, code, reason);
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                int httpCode = response == null ? 0 : response.code();
                String failure = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
                addLog(logs, "onFailure", jsonObject("error", failure, "httpCode", httpCode));
                Log.e(TAG, "onFailure error=" + failure + " httpCode=" + httpCode);
                resolveOnce(call, finished, false, logs, failure, httpCode, "");
            }
        };

        client.newWebSocket(request, listener);
    }

    private void resolveOnce(PluginCall call, AtomicBoolean finished, boolean ok, JSONArray logs, String error, int code, String reason) {
        if (!finished.compareAndSet(false, true)) return;

        JSObject result = new JSObject();
        result.put("ok", ok);
        result.put("error", error == null ? JSObject.NULL : error);
        result.put("closeCode", code);
        result.put("closeReason", reason == null ? "" : reason);
        result.put("logs", logs);

        mainHandler.post(() -> call.resolve(result));
    }

    private static String buildOpcode6(String deviceId, String userAgent) {
        try {
            JSONObject userAgentPayload = new JSONObject();
            userAgentPayload.put("deviceType", "WEB");
            userAgentPayload.put("locale", "ru");
            userAgentPayload.put("deviceLocale", "ru");
            userAgentPayload.put("osVersion", "Linux");
            userAgentPayload.put("deviceName", "Chrome");
            userAgentPayload.put("headerUserAgent", userAgent);
            userAgentPayload.put("appVersion", "26.5.8");
            userAgentPayload.put("screen", "1440x2560 1.0x");
            userAgentPayload.put("timezone", "Europe/Moscow");

            JSONObject payload = new JSONObject();
            payload.put("userAgent", userAgentPayload);
            payload.put("deviceId", deviceId);

            JSONObject packet = new JSONObject();
            packet.put("ver", 11);
            packet.put("cmd", 0);
            packet.put("seq", 0);
            packet.put("opcode", 6);
            packet.put("payload", payload);
            return packet.toString();
        } catch (Throwable error) {
            return "{}";
        }
    }

    private static String buildOpcode19(String token) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("token", token);
            payload.put("chatsCount", 40);
            payload.put("interactive", true);
            payload.put("chatsSync", 0);
            payload.put("contactsSync", 0);
            payload.put("presenceSync", -1);
            payload.put("draftsSync", 0);

            JSONObject packet = new JSONObject();
            packet.put("ver", 11);
            packet.put("cmd", 0);
            packet.put("seq", 1);
            packet.put("opcode", 19);
            packet.put("payload", payload);
            return packet.toString();
        } catch (Throwable error) {
            return "{}";
        }
    }

    private static String buildOpcode64(int chatId, String text) {
        try {
            JSONObject message = new JSONObject();
            message.put("text", text);
            message.put("cid", nextNegativeCid());
            message.put("elements", new JSONArray());
            message.put("attaches", new JSONArray());

            JSONObject payload = new JSONObject();
            payload.put("chatId", chatId);
            payload.put("message", message);
            payload.put("notify", true);

            JSONObject packet = new JSONObject();
            packet.put("ver", 11);
            packet.put("cmd", 0);
            packet.put("seq", 2);
            packet.put("opcode", 64);
            packet.put("payload", payload);
            return packet.toString();
        } catch (Throwable error) {
            return "{}";
        }
    }

    private static long nextNegativeCid() {
        long millis = System.currentTimeMillis();
        int randomTail = (int) (Math.random() * 1000);
        return -((millis * 1000L) + randomTail);
    }

    private static String truncate(String value, int maxLen) {
        if (value == null) return "";
        if (value.length() <= maxLen) return value;
        return value.substring(0, maxLen) + "...";
    }

    private static String maskToken(String tokenRaw) {
        String token = String.valueOf(tokenRaw == null ? "" : tokenRaw).trim();
        if (token.length() <= 12) return "***";
        return token.substring(0, 6) + "..." + token.substring(token.length() - 6);
    }

    private static JSONObject parseJsonObject(String raw) {
        try {
            return new JSONObject(raw);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static JSONObject jsonObject(Object... values) {
        JSONObject object = new JSONObject();
        if (values == null) return object;
        try {
            for (int i = 0; i + 1 < values.length; i += 2) {
                object.put(String.valueOf(values[i]), values[i + 1]);
            }
        } catch (Throwable ignored) {
            // ignore logging serialization failures
        }
        return object;
    }

    private static void addLog(JSONArray logs, String event, JSONObject data) {
        try {
            JSONObject row = new JSONObject();
            row.put("ts", System.currentTimeMillis());
            row.put("event", event);
            row.put("data", data == null ? new JSONObject() : data);
            logs.put(row);
        } catch (Throwable ignored) {
            // ignore logging serialization failures
        }
    }
}
