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

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

@CapacitorPlugin(name = "MaxNativeTransport")
public class MaxNativeTransportPlugin extends Plugin {
    private static final String TAG = "MaxNativeTransport";

    private static final String DEFAULT_WS_URL = "wss://ws-api.oneme.ru/websocket";
    private static final String DEFAULT_ORIGIN = "https://web.max.ru";
    private static final String DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    private static final String DEFAULT_DEVICE_ID = "4af2d638-3d77-47dd-abe6-9812f5147a90";

    private static final int MAX_RECONNECT_DELAY_MS = 15000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();

    private OkHttpClient client;
    private WebSocket socket;
    private String state = "idle";
    private boolean shouldReconnect = false;
    private int reconnectAttempt = 0;

    private int seq = 2;
    private long cidNonce = 0;

    private boolean waitOpcode6 = false;
    private boolean waitOpcode19 = false;

    private final List<PluginCall> pendingConnectCalls = new ArrayList<>();

    private String wsUrl = DEFAULT_WS_URL;
    private String origin = DEFAULT_ORIGIN;
    private String userAgentHeader = DEFAULT_USER_AGENT;
    private String token = "";
    private int chatId = 0;

    private final JSONObject userAgentPayload = new JSONObject();
    private String deviceId = DEFAULT_DEVICE_ID;

    @Override
    public void load() {
        super.load();
        client = new OkHttpClient.Builder().build();
        resetUserAgentPayload();
    }

    @PluginMethod
    public void init(PluginCall call) {
        try {
            synchronized (lock) {
                wsUrl = stringOrDefault(call.getString("wsUrl"), DEFAULT_WS_URL);
                origin = stringOrDefault(call.getString("origin"), DEFAULT_ORIGIN);
                userAgentHeader = stringOrDefault(call.getString("userAgent"), DEFAULT_USER_AGENT);
                token = stringOrDefault(call.getString("token"), "");
                deviceId = stringOrDefault(call.getString("deviceId"), DEFAULT_DEVICE_ID);
                chatId = Math.max(0, call.getInt("chatId", 0));

                JSONObject raw = call.getObject("userAgentPayload", null);
                resetUserAgentPayload();
                if (raw != null) {
                    copyUserAgentField(raw, "deviceType");
                    copyUserAgentField(raw, "locale");
                    copyUserAgentField(raw, "deviceLocale");
                    copyUserAgentField(raw, "osVersion");
                    copyUserAgentField(raw, "deviceName");
                    copyUserAgentField(raw, "headerUserAgent");
                    copyUserAgentField(raw, "appVersion");
                    copyUserAgentField(raw, "screen");
                    copyUserAgentField(raw, "timezone");
                }

                if (token.isEmpty()) {
                    call.reject("max_token_required");
                    return;
                }

                Log.i(TAG, "init wsUrl=" + wsUrl + " origin=" + origin + " token=" + maskToken(token));
                JSObject ok = new JSObject();
                ok.put("ok", true);
                call.resolve(ok);
            }
        } catch (Throwable error) {
            call.reject(String.valueOf(error.getMessage()));
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        synchronized (lock) {
            if (token.isEmpty()) {
                call.reject("max_token_required");
                return;
            }

            if (isOnline()) {
                JSObject ok = new JSObject();
                ok.put("ok", true);
                call.resolve(ok);
                return;
            }

            pendingConnectCalls.add(call);
            shouldReconnect = true;

            if ("connecting".equals(state)) {
                return;
            }

            openSocketLocked();
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        synchronized (lock) {
            shouldReconnect = false;
            reconnectAttempt = 0;
            updateStateLocked("disconnected");
            clearPendingConnectLocked("max_disconnected");
            closeSocketLocked(1000, "manual_disconnect");
        }
        JSObject ok = new JSObject();
        ok.put("ok", true);
        call.resolve(ok);
    }

    @PluginMethod
    public void sendText(PluginCall call) {
        String text = stringOrDefault(call.getString("text"), "");
        if (text.isEmpty()) {
            call.reject("max_text_required");
            return;
        }

        WebSocket localSocket;
        int localSeq;
        synchronized (lock) {
            localSocket = socket;
            if (localSocket == null || !isOnline()) {
                call.reject("max_not_connected");
                return;
            }
            localSeq = seq;
            seq += 1;
        }

        boolean sent = localSocket.send(buildOpcode64(localSeq, text));
        if (!sent) {
            call.reject("max_send_failed");
            return;
        }

        Log.i(TAG, "send opcode64");

        JSObject ok = new JSObject();
        ok.put("ok", true);
        call.resolve(ok);
    }

    private void openSocketLocked() {
        closeSocketLocked(1000, "reconnect");
        updateStateLocked("connecting");

        Request request = new Request.Builder()
            .url(wsUrl)
            .addHeader("Origin", origin)
            .addHeader("User-Agent", userAgentHeader)
            .build();

        waitOpcode6 = false;
        waitOpcode19 = false;

        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                synchronized (lock) {
                    seq = 2;
                    cidNonce = 0;
                    waitOpcode6 = true;
                    waitOpcode19 = false;
                }

                Log.i(TAG, "onOpen http=" + response.code());

                boolean sent = webSocket.send(buildOpcode6());
                if (!sent) {
                    onFatalError("max_send_opcode6_failed");
                    return;
                }
                Log.i(TAG, "sent opcode6");
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                try {
                    JSONObject parsed = new JSONObject(text);
                    int opcode = parsed.optInt("opcode", 0);
                    int cmd = parsed.optInt("cmd", 0);

                    if (cmd == 3 && (waitOpcode6 || waitOpcode19)) {
                        JSONObject payload = parsed.optJSONObject("payload");
                        String error = payload == null
                            ? "reserve_opcode_error"
                            : stringOrDefault(payload.optString("message", payload.optString("error", "reserve_opcode_error")), "reserve_opcode_error");
                        onFatalError(error);
                        return;
                    }

                    if (waitOpcode6 && opcode == 6) {
                        synchronized (lock) {
                            waitOpcode6 = false;
                            waitOpcode19 = true;
                        }
                        Log.i(TAG, "opcode6 ok");
                        boolean sent = webSocket.send(buildOpcode19());
                        if (!sent) {
                            onFatalError("max_send_opcode19_failed");
                            return;
                        }
                        Log.i(TAG, "sent opcode19");
                        return;
                    }

                    if (waitOpcode19 && opcode == 19) {
                        synchronized (lock) {
                            waitOpcode19 = false;
                            reconnectAttempt = 0;
                            updateStateLocked("online");
                            resolvePendingConnectLocked();
                        }
                        Log.i(TAG, "opcode19 ok");
                        return;
                    }

                    if (opcode == 64 || opcode == 128) {
                        JSONObject payload = parsed.optJSONObject("payload");
                        JSONObject message = payload == null ? null : payload.optJSONObject("message");
                        String messageText = message == null ? "" : stringOrDefault(message.optString("text", ""), "");
                        if (!messageText.isEmpty()) {
                            JSObject event = new JSObject();
                            event.put("text", messageText);
                            notifyListeners("message", event);
                            Log.i(TAG, "received opcode" + opcode + " text");
                        }
                    }
                } catch (Throwable error) {
                    emitError("max_message_parse_error");
                }
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                String message = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
                int httpCode = response == null ? 0 : response.code();
                Log.e(TAG, "onFailure error=" + message + " httpCode=" + httpCode);
                handleDisconnectWithError(message);
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                Log.i(TAG, "onClosed code=" + code + " reason=" + reason);
                handleSocketClosed("closed:" + code);
            }
        });
    }

    private void onFatalError(String messageRaw) {
        String message = stringOrDefault(messageRaw, "max_error");
        Log.e(TAG, "fatal error=" + message);
        synchronized (lock) {
            emitError(message);
            clearPendingConnectLocked(message);
            closeSocketLocked(1002, message);
            updateStateLocked("disconnected");
            scheduleReconnectLocked();
        }
    }

    private void handleDisconnectWithError(String messageRaw) {
        String message = stringOrDefault(messageRaw, "max_disconnect");
        synchronized (lock) {
            emitError(message);
            clearPendingConnectLocked(message);
            closeSocketLocked(1002, "failure");
            updateStateLocked("disconnected");
            scheduleReconnectLocked();
        }
    }

    private void handleSocketClosed(String reasonRaw) {
        synchronized (lock) {
            clearPendingConnectLocked(reasonRaw);
            closeSocketLocked(1000, "closed");
            updateStateLocked("disconnected");
            scheduleReconnectLocked();
        }
    }

    private void scheduleReconnectLocked() {
        if (!shouldReconnect) return;
        if ("connecting".equals(state) || "online".equals(state)) return;

        int delay = Math.min(500 * (1 << Math.min(reconnectAttempt, 5)), MAX_RECONNECT_DELAY_MS);
        reconnectAttempt += 1;

        mainHandler.postDelayed(() -> {
            synchronized (lock) {
                if (!shouldReconnect) return;
                if ("connecting".equals(state) || "online".equals(state)) return;
                openSocketLocked();
            }
        }, delay);
    }

    private void resolvePendingConnectLocked() {
        if (pendingConnectCalls.isEmpty()) return;
        JSObject ok = new JSObject();
        ok.put("ok", true);
        Iterator<PluginCall> iterator = pendingConnectCalls.iterator();
        while (iterator.hasNext()) {
            PluginCall call = iterator.next();
            iterator.remove();
            call.resolve(ok);
        }
    }

    private void clearPendingConnectLocked(String errorCodeRaw) {
        if (pendingConnectCalls.isEmpty()) return;
        String errorCode = stringOrDefault(errorCodeRaw, "max_connect_error");
        Iterator<PluginCall> iterator = pendingConnectCalls.iterator();
        while (iterator.hasNext()) {
            PluginCall call = iterator.next();
            iterator.remove();
            call.reject(errorCode);
        }
    }

    private boolean isOnline() {
        return "online".equals(state);
    }

    private void updateStateLocked(String nextStateRaw) {
        String nextState = stringOrDefault(nextStateRaw, "disconnected").toLowerCase(Locale.ROOT);
        if (nextState.equals(state)) return;
        state = nextState;

        JSObject payload = new JSObject();
        payload.put("state", state);
        notifyListeners("state", payload);
    }

    private void emitError(String messageRaw) {
        String message = stringOrDefault(messageRaw, "max_error");
        JSObject payload = new JSObject();
        payload.put("message", message);
        notifyListeners("error", payload);
    }

    private void closeSocketLocked(int code, String reason) {
        WebSocket local = socket;
        socket = null;
        waitOpcode6 = false;
        waitOpcode19 = false;

        if (local == null) return;
        try {
            local.close(code, reason);
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private String buildOpcode6() {
        try {
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

    private String buildOpcode19() {
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

    private String buildOpcode64(int seqValue, String text) {
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
            packet.put("seq", seqValue);
            packet.put("opcode", 64);
            packet.put("payload", payload);
            return packet.toString();
        } catch (Throwable error) {
            return "{}";
        }
    }

    private long nextNegativeCid() {
        cidNonce += 1;
        return -((System.currentTimeMillis() * 1000L) + cidNonce);
    }

    private static String stringOrDefault(String valueRaw, String fallbackRaw) {
        String value = String.valueOf(valueRaw == null ? "" : valueRaw).trim();
        if (!value.isEmpty()) return value;
        return String.valueOf(fallbackRaw == null ? "" : fallbackRaw).trim();
    }

    private static String maskToken(String tokenRaw) {
        String tokenValue = stringOrDefault(tokenRaw, "");
        if (tokenValue.length() <= 12) return "***";
        return tokenValue.substring(0, 6) + "..." + tokenValue.substring(tokenValue.length() - 6);
    }

    private void resetUserAgentPayload() {
        try {
            userAgentPayload.put("deviceType", "WEB");
            userAgentPayload.put("locale", "ru");
            userAgentPayload.put("deviceLocale", "ru");
            userAgentPayload.put("osVersion", "Linux");
            userAgentPayload.put("deviceName", "Chrome");
            userAgentPayload.put("headerUserAgent", DEFAULT_USER_AGENT);
            userAgentPayload.put("appVersion", "26.5.8");
            userAgentPayload.put("screen", "1440x2560 1.0x");
            userAgentPayload.put("timezone", "Europe/Moscow");
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private void copyUserAgentField(JSONObject source, String key) {
        try {
            if (!source.has(key)) return;
            String value = stringOrDefault(source.optString(key, ""), "");
            if (value.isEmpty()) return;
            userAgentPayload.put(key, value);
        } catch (Throwable ignored) {
            // ignore
        }
    }
}
