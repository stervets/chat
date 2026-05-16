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
    private long lastNegativeCid = 0;

    private boolean waitOpcode6 = false;
    private boolean waitOpcode19 = false;
    private long socketEpoch = 0;
    @Nullable
    private Runnable reconnectRunnable = null;

    private final List<PluginCall> pendingConnectCalls = new ArrayList<>();

    private String wsUrl = DEFAULT_WS_URL;
    private String origin = DEFAULT_ORIGIN;
    private String userAgentHeader = DEFAULT_USER_AGENT;
    private String token = "";
    private long chatId = 0L;

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
                chatId = parseChatId(stringOrDefault(call.getString("chatId"), "0"), 0L);

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
    public void setChatId(PluginCall call) {
        String rawChatId = stringOrDefault(call.getString("chatId"), "");
        if (rawChatId.isEmpty()) {
            call.reject("max_chat_id_required");
            return;
        }

        long nextChatId = parseChatId(rawChatId, 0L);
        if (nextChatId == 0L) {
            call.reject("max_chat_id_invalid");
            return;
        }

        synchronized (lock) {
            chatId = nextChatId;
        }
        Log.i(TAG, "setChatId chatId=" + nextChatId);

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
            if (chatId == 0L) {
                call.reject("max_chat_not_ready");
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
        cancelReconnectLocked();
        closeSocketLocked(1000, "reconnect");
        updateStateLocked("connecting");
        final long openEpoch = ++socketEpoch;

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
                    if (!isCurrentSocketLocked(webSocket, openEpoch)) return;
                    seq = 2;
                    lastNegativeCid = 0;
                    waitOpcode6 = true;
                    waitOpcode19 = false;
                }

                Log.i(TAG, "onOpen http=" + response.code());

                boolean sent = webSocket.send(buildOpcode6());
                if (!sent) {
                    onFatalError(webSocket, openEpoch, "max_send_opcode6_failed");
                    return;
                }
                Log.i(TAG, "sent opcode6");
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                synchronized (lock) {
                    if (!isCurrentSocketLocked(webSocket, openEpoch)) return;
                }

                try {
                    JSONObject parsed = new JSONObject(text);
                    int opcode = parsed.optInt("opcode", 0);
                    int cmd = parsed.optInt("cmd", 0);

                    if (cmd == 3 && isHandshakePendingLocked(webSocket, openEpoch)) {
                        JSONObject payload = parsed.optJSONObject("payload");
                        String error = payload == null
                            ? "reserve_opcode_error"
                            : stringOrDefault(payload.optString("message", payload.optString("error", "reserve_opcode_error")), "reserve_opcode_error");
                        onFatalError(webSocket, openEpoch, error);
                        return;
                    }

                    if (cmd == 3 && opcode == 64) {
                        JSONObject payload = parsed.optJSONObject("payload");
                        String error = payload == null
                            ? "reserve_opcode64_error"
                            : stringOrDefault(payload.optString("message", payload.optString("error", "reserve_opcode64_error")), "reserve_opcode64_error");
                        Log.e(TAG, "opcode64 error=" + error);
                        synchronized (lock) {
                            if (!isCurrentSocketLocked(webSocket, openEpoch)) return;
                            emitError(error);
                        }
                        return;
                    }

                    if (opcode == 6 && consumeOpcode6Locked(webSocket, openEpoch)) {
                        synchronized (lock) {
                            waitOpcode19 = true;
                        }
                        Log.i(TAG, "opcode6 ok");
                        boolean sent = webSocket.send(buildOpcode19());
                        if (!sent) {
                            onFatalError(webSocket, openEpoch, "max_send_opcode19_failed");
                            return;
                        }
                        Log.i(TAG, "sent opcode19");
                        return;
                    }

                    if (opcode == 19 && consumeOpcode19Locked(webSocket, openEpoch)) {
                        long syncChatId = findSyncChatId(parsed.optJSONObject("payload"));
                        if (syncChatId != 0L) {
                            synchronized (lock) {
                                chatId = syncChatId;
                            }
                            Log.i(TAG, "resolved sync chatId=" + syncChatId + " from opcode19");
                        } else {
                            long currentChatId;
                            synchronized (lock) {
                                currentChatId = chatId;
                            }
                            if (currentChatId == 0L) {
                                onFatalError(webSocket, openEpoch, "max_sync_chat_not_found");
                                return;
                            }
                            Log.w(TAG, "sync chat not found in opcode19 payload, keep configured chatId=" + currentChatId);
                        }

                        synchronized (lock) {
                            reconnectAttempt = 0;
                            updateStateLocked("online");
                            resolvePendingConnectLocked();
                            cancelReconnectLocked();
                        }
                        Log.i(TAG, "opcode19 ok");
                        return;
                    }

                    if (opcode == 64 || opcode == 128) {
                        String messageText = extractMessageText(parsed.optJSONObject("payload"));
                        if (!messageText.isEmpty()) {
                            JSObject event = new JSObject();
                            event.put("text", messageText);
                            notifyListeners("message", event);
                            Log.i(TAG, "received opcode" + opcode + " text");
                        }
                    }
                } catch (Throwable error) {
                    synchronized (lock) {
                        if (!isCurrentSocketLocked(webSocket, openEpoch)) return;
                        emitError("max_message_parse_error");
                    }
                }
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                String message = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
                int httpCode = response == null ? 0 : response.code();
                Log.e(TAG, "onFailure error=" + message + " httpCode=" + httpCode);
                handleDisconnectWithError(webSocket, openEpoch, message);
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                Log.i(TAG, "onClosed code=" + code + " reason=" + reason);
                handleSocketClosed(webSocket, openEpoch, "closed:" + code);
            }
        });
    }

    private void onFatalError(@NonNull WebSocket sourceSocket, long sourceEpoch, String messageRaw) {
        String message = stringOrDefault(messageRaw, "max_error");
        Log.e(TAG, "fatal error=" + message);
        synchronized (lock) {
            if (!isCurrentSocketLocked(sourceSocket, sourceEpoch)) return;
            emitError(message);
            clearPendingConnectLocked(message);
            closeSocketLocked(1002, message);
            updateStateLocked("disconnected");
            scheduleReconnectLocked();
        }
    }

    private void handleDisconnectWithError(@NonNull WebSocket sourceSocket, long sourceEpoch, String messageRaw) {
        String message = stringOrDefault(messageRaw, "max_disconnect");
        synchronized (lock) {
            if (!isCurrentSocketLocked(sourceSocket, sourceEpoch)) return;
            emitError(message);
            clearPendingConnectLocked(message);
            closeSocketLocked(1002, "failure");
            updateStateLocked("disconnected");
            scheduleReconnectLocked();
        }
    }

    private void handleSocketClosed(@NonNull WebSocket sourceSocket, long sourceEpoch, String reasonRaw) {
        synchronized (lock) {
            if (!isCurrentSocketLocked(sourceSocket, sourceEpoch)) return;
            clearPendingConnectLocked(reasonRaw);
            closeSocketLocked(1000, "closed");
            updateStateLocked("disconnected");
            scheduleReconnectLocked();
        }
    }

    private void scheduleReconnectLocked() {
        if (!shouldReconnect) return;
        if ("connecting".equals(state) || "online".equals(state)) return;
        if (reconnectRunnable != null) return;

        int delay = Math.min(500 * (1 << Math.min(reconnectAttempt, 5)), MAX_RECONNECT_DELAY_MS);
        reconnectAttempt += 1;

        Runnable nextReconnect = () -> {
            synchronized (lock) {
                reconnectRunnable = null;
                if (!shouldReconnect) return;
                if ("connecting".equals(state) || "online".equals(state)) return;
                openSocketLocked();
            }
        };
        reconnectRunnable = nextReconnect;
        mainHandler.postDelayed(nextReconnect, delay);
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
        cancelReconnectLocked();
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

    private void cancelReconnectLocked() {
        if (reconnectRunnable == null) return;
        mainHandler.removeCallbacks(reconnectRunnable);
        reconnectRunnable = null;
    }

    private boolean isCurrentSocketLocked(@NonNull WebSocket sourceSocket, long sourceEpoch) {
        return sourceSocket == socket && sourceEpoch == socketEpoch;
    }

    private boolean isHandshakePendingLocked(@NonNull WebSocket sourceSocket, long sourceEpoch) {
        if (!isCurrentSocketLocked(sourceSocket, sourceEpoch)) return false;
        return waitOpcode6 || waitOpcode19;
    }

    private boolean consumeOpcode6Locked(@NonNull WebSocket sourceSocket, long sourceEpoch) {
        synchronized (lock) {
            if (!isCurrentSocketLocked(sourceSocket, sourceEpoch)) return false;
            if (!waitOpcode6) return false;
            waitOpcode6 = false;
            return true;
        }
    }

    private boolean consumeOpcode19Locked(@NonNull WebSocket sourceSocket, long sourceEpoch) {
        synchronized (lock) {
            if (!isCurrentSocketLocked(sourceSocket, sourceEpoch)) return false;
            if (!waitOpcode19) return false;
            waitOpcode19 = false;
            return true;
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

    private long findSyncChatId(@Nullable JSONObject payload) {
        return findSyncChatIdAny(payload, 0);
    }

    private long findSyncChatIdAny(@Nullable Object node, int depth) {
        if (node == null) return 0L;
        if (depth > 6) return 0L;

        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            long direct = extractSyncChatIdFromChatLike(object);
            if (direct != 0L) return direct;

            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object child = object.opt(key);
                long nested = findSyncChatIdAny(child, depth + 1);
                if (nested != 0L) return nested;
            }
            return 0L;
        }

        if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i += 1) {
                Object child = array.opt(i);
                long nested = findSyncChatIdAny(child, depth + 1);
                if (nested != 0L) return nested;
            }
        }

        return 0L;
    }

    private long extractSyncChatIdFromChatLike(@Nullable JSONObject object) {
        if (object == null) return 0L;

        String title = stringOrDefault(object.optString("title", ""), "");
        if (title.isEmpty()) return 0L;
        if (!title.toLowerCase(Locale.ROOT).startsWith("sync-")) return 0L;

        long id = 0L;
        if (object.has("id")) {
            id = parseChatId(String.valueOf(object.opt("id")), 0L);
        }
        if (id == 0L && object.has("chatId")) {
            id = parseChatId(String.valueOf(object.opt("chatId")), 0L);
        }
        if (id == 0L && object.has("chat_id")) {
            id = parseChatId(String.valueOf(object.opt("chat_id")), 0L);
        }
        return id;
    }

    private long nextNegativeCid() {
        long nowNegative = -System.currentTimeMillis();
        if (nowNegative < lastNegativeCid) {
            lastNegativeCid = nowNegative;
            return lastNegativeCid;
        }
        lastNegativeCid -= 1;
        return lastNegativeCid;
    }

    private String extractMessageText(@Nullable JSONObject payload) {
        if (payload == null) return "";

        JSONObject message = payload.optJSONObject("message");
        String direct = message == null ? "" : stringOrDefault(message.optString("text", ""), "");
        if (!direct.isEmpty()) return direct;

        JSONArray messages = payload.optJSONArray("messages");
        if (messages != null && messages.length() > 0) {
            JSONObject first = messages.optJSONObject(0);
            if (first != null) {
                String text = stringOrDefault(first.optString("text", ""), "");
                if (!text.isEmpty()) return text;
            }
        }

        JSONObject chat = payload.optJSONObject("chat");
        if (chat != null) {
            JSONObject chatMessage = chat.optJSONObject("message");
            String text = chatMessage == null ? "" : stringOrDefault(chatMessage.optString("text", ""), "");
            if (!text.isEmpty()) return text;
        }

        JSONObject event = payload.optJSONObject("event");
        if (event != null) {
            JSONObject eventMessage = event.optJSONObject("message");
            String text = eventMessage == null ? "" : stringOrDefault(eventMessage.optString("text", ""), "");
            if (!text.isEmpty()) return text;
        }

        JSONArray events = payload.optJSONArray("events");
        if (events != null && events.length() > 0) {
            JSONObject firstEvent = events.optJSONObject(0);
            if (firstEvent != null) {
                JSONObject eventMessage = firstEvent.optJSONObject("message");
                String text = eventMessage == null ? "" : stringOrDefault(eventMessage.optString("text", ""), "");
                if (!text.isEmpty()) return text;
            }
        }

        return "";
    }

    private static String stringOrDefault(String valueRaw, String fallbackRaw) {
        String value = String.valueOf(valueRaw == null ? "" : valueRaw).trim();
        if (!value.isEmpty()) return value;
        return String.valueOf(fallbackRaw == null ? "" : fallbackRaw).trim();
    }

    private static long parseChatId(String rawChatId, long fallback) {
        String value = stringOrDefault(rawChatId, "");
        if (value.isEmpty()) return fallback;
        try {
            return Long.parseLong(value);
        } catch (Throwable ignored) {
            return fallback;
        }
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
