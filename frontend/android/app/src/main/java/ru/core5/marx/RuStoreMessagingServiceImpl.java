package ru.core5.marx;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import java.util.List;
import java.util.Map;

import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage;
import ru.rustore.sdk.pushclient.messaging.exception.RuStorePushClientException;
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService;

public class RuStoreMessagingServiceImpl extends RuStoreMessagingService {
    private static final String TAG = "RuStorePushService";

    @Override
    public void onNewToken(String token) {
        RuStorePushBridge.dispatchToken(this, token == null ? "" : token.trim());
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message == null ? null : message.getData();
        if (data == null || data.isEmpty()) {
            return;
        }

        JSObject payload = RuStorePushBridge.payloadToJsObject(data);
        RuStorePushBridge.dispatchPushReceived(this, payload);

        if (!RuStorePushBridge.isAppActive()) {
            showSystemNotification(payload);
        }
    }

    @Override
    public void onDeletedMessages() {
        Log.w(TAG, "RuStore deleted one or more messages before delivery");
    }

    @Override
    public void onError(List<? extends RuStorePushClientException> errors) {
        int count = errors == null ? 0 : errors.size();
        Log.w(TAG, "RuStore push error count=" + count);
    }

    private void showSystemNotification(JSObject payload) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            int permission = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS);
            if (permission != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        String title = payload.optString("title", "").trim();
        String body = payload.optString("body", "").trim();
        String type = payload.optString("type", "").trim();
        String channelId = payload.optString("channelId", "").trim();

        if (title.isEmpty()) {
            title = "call".equals(type) ? "Входящий звонок" : "MARX";
        }
        if (body.isEmpty()) {
            body = "call".equals(type) ? "Открой MARX" : "Новое сообщение";
        }
        if (channelId.isEmpty()) {
            channelId = "call".equals(type) ? RuStorePushBridge.CALL_CHANNEL_ID : RuStorePushBridge.MESSAGE_CHANNEL_ID;
        }

        ensureNotificationChannel(channelId, "call".equals(type));

        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            notificationId(payload),
            RuStorePushBridge.createLaunchIntent(this, MainActivity.class, payload),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority("call".equals(type) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(contentIntent);

        NotificationManagerCompat.from(this).notify(notificationId(payload), builder.build());
    }

    private void ensureNotificationChannel(String channelId, boolean call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        if (manager.getNotificationChannel(channelId) != null) {
            return;
        }

        String name = call
            ? getString(R.string.rustore_push_channel_calls)
            : getString(R.string.rustore_push_channel_messages);
        int importance = call ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT;
        NotificationChannel channel = new NotificationChannel(channelId, name, importance);
        manager.createNotificationChannel(channel);
    }

    private int notificationId(JSObject payload) {
        String source = payload.optString("callId", "").trim();
        if (source.isEmpty()) {
            source = payload.optString("messageId", "").trim();
        }
        if (source.isEmpty()) {
            source = payload.optString("roomId", "").trim();
        }
        if (source.isEmpty()) {
            source = String.valueOf(System.currentTimeMillis());
        }
        return Math.abs(source.hashCode());
    }
}
