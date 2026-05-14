package ru.core5.marx;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import ru.rustore.sdk.core.exception.RuStoreException;
import ru.rustore.sdk.core.feature.model.FeatureAvailabilityResult;
import ru.rustore.sdk.pushclient.RuStorePushClient;
import ru.rustore.sdk.pushclient.common.logger.DefaultLogger;
import ru.rustore.sdk.pushclient.messaging.exception.RuStorePushClientException;
import ru.rustore.sdk.pushclient.utils.PushRuStoreExceptionExtKt;

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

        RuStorePushClient.INSTANCE.checkPushAvailability(getContext())
            .addOnSuccessListener(result -> {
                if (result instanceof FeatureAvailabilityResult.Available) {
                    resolveToken(call);
                    return;
                }

                if (result instanceof FeatureAvailabilityResult.Unavailable unavailable) {
                    RuStoreException cause = unavailable.getCause();
                    String reason = cause == null
                        ? "unknown_unavailable"
                        : cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage());
                    Log.w(TAG, "RuStore Push unavailable: " + reason);
                    resolveRuStoreError(cause);
                    call.reject("rustore_push_unavailable", reason);
                    return;
                }

                call.reject("rustore_push_unavailable", "unexpected_availability_result");
            })
            .addOnFailureListener(error -> {
                String reason = String.valueOf(error == null ? "unknown_error" : error.getMessage());
                Log.w(TAG, "RuStore checkPushAvailability failed: " + reason);
                if (error instanceof RuStoreException) {
                    resolveRuStoreError((RuStoreException) error);
                }
                if (error instanceof Exception) {
                    call.reject("rustore_check_availability_failed", (Exception) error);
                    return;
                }
                call.reject("rustore_check_availability_failed", new Exception(String.valueOf(error)));
            });
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

    @PluginMethod
    public void resolveError(PluginCall call) {
        String code = String.valueOf(call.getString("code", "")).trim();
        String message = String.valueOf(call.getString("message", "")).trim();
        if (code.isEmpty()) {
            call.reject("rustore_error_code_empty");
            return;
        }

        RuStoreException error = mapRuStoreError(code, message);
        if (error == null) {
            call.resolve();
            return;
        }

        resolveRuStoreError(error);
        call.resolve();
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

    void notifyPushError(@NonNull String code, @NonNull String message) {
        JSObject result = new JSObject();
        result.put("code", code);
        result.put("message", message);
        notifyListeners("pushError", result, true);
    }

    private void ensureClientInitialized(@NonNull String projectId) {
        if (projectId.equals(initializedProjectId)) {
            return;
        }
        Application application = getActivity().getApplication();
        RuStorePushClient.INSTANCE.init(application, projectId, new DefaultLogger());
        initializedProjectId = projectId;
        RuStorePushBridge.storeProjectId(getContext(), projectId);
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
                String reason = String.valueOf(error == null ? "unknown_error" : error.getMessage());
                Log.w(TAG, "RuStore getToken failed: " + reason);
                if (error instanceof RuStoreException) {
                    resolveRuStoreError((RuStoreException) error);
                }
                if (error instanceof Exception) {
                    call.reject("rustore_get_token_failed", (Exception) error);
                    return;
                }
                call.reject("rustore_get_token_failed", new Exception(error));
            });
    }

    private void resolveRuStoreError(RuStoreException error) {
        if (error == null) return;
        try {
            Log.i(TAG, "Resolve RuStore error: " + error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
            if (getActivity() != null) {
                Log.i(TAG, "Resolve RuStore error via activity context");
                getActivity().runOnUiThread(() -> PushRuStoreExceptionExtKt.resolveForPush(error, getActivity()));
                return;
            }
            Log.i(TAG, "Resolve RuStore error via app context");
            new Handler(Looper.getMainLooper()).post(() -> PushRuStoreExceptionExtKt.resolveForPush(error, getContext()));
        } catch (Throwable resolveError) {
            Log.w(TAG, "Resolve RuStore error failed: " + String.valueOf(resolveError.getMessage()));
        }
    }

    private RuStoreException mapRuStoreError(String codeRaw, String messageRaw) {
        String code = String.valueOf(codeRaw).trim();
        String message = String.valueOf(messageRaw).trim();
        String normalizedMessage = message.isEmpty() ? code : message;

        if ("HostAppBackgroundWorkPermissionNotGranted".equals(code)) {
            return new RuStorePushClientException.HostAppBackgroundWorkPermissionNotGranted(normalizedMessage);
        }
        if ("HostAppNotInstalledException".equals(code)) {
            return new RuStorePushClientException.HostAppNotInstalledException(normalizedMessage);
        }
        if ("UnauthorizedException".equals(code)) {
            return new RuStorePushClientException.UnauthorizedException(normalizedMessage);
        }

        return null;
    }
}
