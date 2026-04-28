import {nextTick, ws, wsData, wsError} from './shared';
import type {
  Dialog,
  DirectCallPayload,
  DirectCallPhase,
  DirectCallSignalPayload,
  DirectCallUser,
  User,
} from './shared';

const CALL_RESET_DELAY_MS = 1600;

function toPositiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function normalizeCallUser(raw: any): DirectCallUser {
  return {
    id: toPositiveNumber(raw?.id),
    nickname: stringValue(raw?.nickname),
    name: stringValue(raw?.name || raw?.nickname || 'Пользователь'),
    avatarUrl: raw?.avatarUrl || null,
    nicknameColor: raw?.nicknameColor || null,
    donationBadgeUntil: raw?.donationBadgeUntil || null,
  };
}

function normalizeCallPayload(raw: any): DirectCallPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const callId = stringValue(raw.callId);
  const roomId = toPositiveNumber(raw.roomId);
  const callerUserId = toPositiveNumber(raw.callerUserId);
  const calleeUserId = toPositiveNumber(raw.calleeUserId);
  const status = stringValue(raw.status) as DirectCallPayload['status'];
  if (!callId || !roomId || !callerUserId || !calleeUserId) return null;
  if (status !== 'ringing' && status !== 'accepted' && status !== 'ended') return null;

  return {
    callId,
    roomId,
    status,
    callerUserId,
    calleeUserId,
    caller: normalizeCallUser(raw.caller),
    createdAt: stringValue(raw.createdAt),
    updatedAt: stringValue(raw.updatedAt),
    expiresAt: raw.expiresAt ? stringValue(raw.expiresAt) : null,
    acceptedAt: raw.acceptedAt ? stringValue(raw.acceptedAt) : null,
    endedAt: raw.endedAt ? stringValue(raw.endedAt) : null,
    endReason: raw.endReason ? stringValue(raw.endReason) as DirectCallPayload['endReason'] : null,
  };
}

function normalizeCallSignal(raw: any): DirectCallSignalPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const callId = stringValue(raw.callId);
  const roomId = toPositiveNumber(raw.roomId);
  const fromUserId = toPositiveNumber(raw.fromUserId);
  const toUserId = toPositiveNumber(raw.toUserId);
  const type = stringValue(raw.type) as DirectCallSignalPayload['type'];
  if (!callId || !roomId || !fromUserId || !toUserId) return null;
  if (type !== 'offer' && type !== 'answer' && type !== 'ice-candidate') return null;
  return {
    callId,
    roomId,
    fromUserId,
    toUserId,
    type,
    payload: raw.payload,
  };
}

function hasWebRtcSupport() {
  return typeof window !== 'undefined'
    && typeof RTCPeerConnection !== 'undefined'
    && !!navigator?.mediaDevices?.getUserMedia;
}

function formatPeerName(user: DirectCallUser | User | null | undefined) {
  return stringValue(user?.name || user?.nickname || 'Собеседник') || 'Собеседник';
}

function candidateToInit(candidate: RTCIceCandidate | RTCIceCandidateInit) {
  if (candidate && typeof (candidate as RTCIceCandidate).toJSON === 'function') {
    return (candidate as RTCIceCandidate).toJSON();
  }
  return candidate as RTCIceCandidateInit;
}

export const chatMethodsCalls = {
    normalizeDirectCallPayload(this: any, payload: any) {
      return normalizeCallPayload(payload);
    },

    getCurrentUserId(this: any) {
      return toPositiveNumber(this.me?.id);
    },

    isCallActive(this: any) {
      return !!this.activeCall && this.callPhase !== 'idle' && this.callPhase !== 'ended';
    },

    getOtherCallUserId(this: any, callRaw?: DirectCallPayload | null) {
      const call = callRaw || this.activeCall;
      const meId = this.getCurrentUserId();
      if (!call || !meId) return 0;
      return Number(call.callerUserId) === meId ? Number(call.calleeUserId) : Number(call.callerUserId);
    },

    getCallPeerUser(this: any, callRaw?: DirectCallPayload | null) {
      const call = callRaw || this.activeCall;
      if (!call) return null;
      const peerUserId = this.getOtherCallUserId(call);
      if (Number(call.callerUserId) === peerUserId) return call.caller;
      const activeTarget = this.activeDialog?.kind === 'direct' ? this.activeDialog?.targetUser : null;
      if (toPositiveNumber(activeTarget?.id) === peerUserId) return activeTarget;
      const direct = Array.isArray(this.directDialogs)
        ? this.directDialogs.find((dialog: any) => toPositiveNumber(dialog?.targetUser?.id) === peerUserId)
        : null;
      if (direct?.targetUser) return direct.targetUser;
      const user = Array.isArray(this.users)
        ? this.users.find((item: User) => toPositiveNumber(item?.id) === peerUserId)
        : null;
      return user || null;
    },

    setCallState(this: any, callRaw: DirectCallPayload | null, phase: DirectCallPhase, direction: 'incoming' | 'outgoing' | null) {
      if (this.callResetTimer) {
        clearTimeout(this.callResetTimer);
        this.callResetTimer = null;
      }
      this.activeCall = callRaw;
      this.callPhase = phase;
      this.callDirection = direction;
      if (phase !== 'ended') {
        this.callError = '';
      }
      if (phase === 'outgoing') {
        void this.playOutgoingCallMusic?.();
      } else {
        this.stopOutgoingCallMusic?.();
      }
      if (phase === 'connected') {
        this.startCallDurationTicker();
      }
    },

    async fetchCallIceServers(this: any) {
      if (Array.isArray(this.callIceServers)) return this.callIceServers;
      const result = await ws.request('call:ice-config');
      if (!(result as any)?.ok) {
        this.callIceServers = [];
        return [];
      }
      const data = wsData<Record<string, any>>(result, {});
      const iceServers = Array.isArray(data.iceServers) ? data.iceServers : [];
      this.callIceServers = iceServers.filter((server: any) => server && typeof server === 'object' && server.urls);
      return this.callIceServers;
    },

    async ensureCallPeerConnection(this: any) {
      if (this.callPeerConnection) return this.callPeerConnection as RTCPeerConnection;
      if (!hasWebRtcSupport()) {
        throw new Error('webrtc_not_supported');
      }

      const iceServers = await this.fetchCallIceServers();
      const pc = new RTCPeerConnection({iceServers});
      this.callPeerConnection = pc;

      pc.onicecandidate = (event) => {
        if (!event.candidate || !this.activeCall) return;
        void this.sendCallSignal('ice-candidate', candidateToInit(event.candidate));
      };

      pc.ontrack = (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        this.callRemoteStream = stream;
        this.attachRemoteCallAudio();
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          this.markCallConnected();
          return;
        }
        if (state === 'failed') {
          this.callError = 'Соединение не удалось установить.';
          void this.hangupCall('failed');
          return;
        }
        if (state === 'disconnected') {
          this.callError = 'Соединение временно прервано.';
        }
      };

      const localStream = this.callLocalStream;
      if (localStream) {
        localStream.getTracks().forEach((track: MediaStreamTrack) => pc.addTrack(track, localStream));
      }
      return pc;
    },

    async ensureLocalCallStream(this: any) {
      if (this.callLocalStream) return this.callLocalStream as MediaStream;
      if (!hasWebRtcSupport()) {
        throw new Error('webrtc_not_supported');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.callLocalStream = stream;
      stream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = !this.callMuted;
      });
      if (this.callPeerConnection) {
        const senders = this.callPeerConnection.getSenders();
        stream.getTracks().forEach((track: MediaStreamTrack) => {
          const alreadyAdded = senders.some((sender: RTCRtpSender) => sender.track === track);
          if (!alreadyAdded) {
            this.callPeerConnection.addTrack(track, stream);
          }
        });
      }
      return stream;
    },

    attachRemoteCallAudio(this: any) {
      const audio = this.callRemoteAudioEl as HTMLAudioElement | null;
      if (!audio || !this.callRemoteStream) return;
      if (audio.srcObject !== this.callRemoteStream) {
        audio.srcObject = this.callRemoteStream;
      }
      const playPromise = audio.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Браузер может заблокировать автоплей до явного действия пользователя.
        });
      }
    },

    setCallRemoteAudioEl(this: any, el: HTMLAudioElement | null) {
      this.callRemoteAudioEl = el;
      this.attachRemoteCallAudio();
    },

    async startDirectCall(this: any) {
      if (this.wsOffline) {
        this.pushToast('Звонок', 'Нет соединения с сервером.');
        return;
      }
      if (this.isCallActive()) {
        this.pushToast('Звонок', 'Уже есть активный звонок.');
        return;
      }
      if (this.activeDialog?.kind !== 'direct') {
        this.pushToast('Звонок', 'Звонки доступны только в директе.');
        return;
      }
      const roomId = toPositiveNumber(this.activeDialog?.id);
      if (!roomId) return;

      this.hapticTap?.();
      const result = await ws.request('call:start', {roomId});
      if (!(result as any)?.ok) {
        this.callError = this.resolveCallError(wsError(result, 'call_start_failed'));
        this.pushToast('Звонок', this.callError);
        this.hapticError?.();
        return;
      }
      const call = normalizeCallPayload(wsData(result, null));
      if (!call) return;
      this.setCallState(call, 'outgoing', 'outgoing');
      this.pushToast('Звонок', `Звоним ${this.callPeerName || 'собеседнику'}...`);
    },

    async answerIncomingCall(this: any) {
      const call = this.activeCall as DirectCallPayload | null;
      if (!call || this.callPhase !== 'incoming') return;
      this.hapticConfirm?.();
      void this.playCallOnSound?.();
      this.setCallState(call, 'connecting', 'incoming');

      try {
        await this.ensureLocalCallStream();
        await this.ensureCallPeerConnection();
      } catch (error: any) {
        this.callError = this.resolveCallRuntimeError(error);
        this.pushToast('Звонок', this.callError);
        await this.hangupCall('failed');
        return;
      }

      const result = await ws.request('call:accept', {callId: call.callId});
      if (!(result as any)?.ok) {
        this.callError = this.resolveCallError(wsError(result, 'call_accept_failed'));
        this.pushToast('Звонок', this.callError);
        this.cleanupCallPeerResources();
        this.resetCallStateSoon();
        return;
      }
      const accepted = normalizeCallPayload(wsData(result, call));
      if (accepted) {
        this.activeCall = accepted;
      }
      this.callPhase = 'connecting';
    },

    async rejectIncomingCall(this: any) {
      const call = this.activeCall as DirectCallPayload | null;
      if (!call) return;
      this.hapticTap?.();
      void this.playCallOffSound?.();
      await ws.request('call:reject', {callId: call.callId});
      this.finishCallLocally({...call, status: 'ended', endReason: 'reject'}, 'ended');
    },

    async hangupCall(this: any, reasonRaw?: string) {
      const call = this.activeCall as DirectCallPayload | null;
      if (!call) {
        this.cleanupCallPeerResources();
        this.resetCallState();
        return;
      }
      const reason = reasonRaw === 'failed' ? 'failed' : 'hangup';
      if (reason === 'hangup') {
        this.hapticTap?.();
      }
      void this.playCallOffSound?.();
      await ws.request('call:hangup', {callId: call.callId, reason});
      this.finishCallLocally({...call, status: 'ended', endReason: reason}, 'ended');
    },

    async sendCallSignal(this: any, type: 'offer' | 'answer' | 'ice-candidate', payload: unknown) {
      const call = this.activeCall as DirectCallPayload | null;
      if (!call) return {ok: false, error: 'no_active_call'};
      return ws.request('call:signal', {
        callId: call.callId,
        type,
        payload,
      });
    },

    async createAndSendCallOffer(this: any) {
      const pc = await this.ensureCallPeerConnection();
      await this.ensureLocalCallStream();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.sendCallSignal('offer', pc.localDescription?.toJSON?.() || offer);
      this.callPhase = 'connecting';
    },

    async handleCallOffer(this: any, signal: DirectCallSignalPayload) {
      try {
        const pc = await this.ensureCallPeerConnection();
        await this.ensureLocalCallStream();
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
        await this.flushPendingRemoteCallCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.sendCallSignal('answer', pc.localDescription?.toJSON?.() || answer);
        this.callPhase = 'connecting';
      } catch (error: any) {
        this.callError = this.resolveCallRuntimeError(error);
        this.pushToast('Звонок', this.callError);
        await this.hangupCall('failed');
      }
    },

    async handleCallAnswer(this: any, signal: DirectCallSignalPayload) {
      try {
        const pc = await this.ensureCallPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
        await this.flushPendingRemoteCallCandidates();
        this.callPhase = 'connecting';
      } catch (error: any) {
        this.callError = this.resolveCallRuntimeError(error);
        this.pushToast('Звонок', this.callError);
        await this.hangupCall('failed');
      }
    },

    async handleCallIceCandidate(this: any, signal: DirectCallSignalPayload) {
      const candidatePayload = signal.payload as RTCIceCandidateInit;
      if (!candidatePayload) return;
      const pc = this.callPeerConnection as RTCPeerConnection | null;
      if (!pc || !pc.remoteDescription) {
        this.callPendingRemoteCandidates = [...this.callPendingRemoteCandidates, candidatePayload];
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidatePayload));
      } catch {
        // stale ICE candidates are safe to ignore during reconnect/race windows
      }
    },

    async flushPendingRemoteCallCandidates(this: any) {
      const pc = this.callPeerConnection as RTCPeerConnection | null;
      if (!pc || !pc.remoteDescription || !Array.isArray(this.callPendingRemoteCandidates)) return;
      const candidates = this.callPendingRemoteCandidates;
      this.callPendingRemoteCandidates = [];
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore stale candidate
        }
      }
    },

    async onCallSignal(this: any, payload: any) {
      const signal = normalizeCallSignal(payload);
      if (!signal) return;
      const call = this.activeCall as DirectCallPayload | null;
      if (!call || call.callId !== signal.callId) return;
      if (toPositiveNumber(signal.toUserId) !== this.getCurrentUserId()) return;

      if (signal.type === 'offer') {
        await this.handleCallOffer(signal);
        return;
      }
      if (signal.type === 'answer') {
        await this.handleCallAnswer(signal);
        return;
      }
      await this.handleCallIceCandidate(signal);
    },

    async onCallAccepted(this: any, payload: any) {
      const call = normalizeCallPayload(payload);
      if (!call || call.status !== 'accepted') return;
      const current = this.activeCall as DirectCallPayload | null;
      if (current && current.callId !== call.callId) return;

      const meId = this.getCurrentUserId();
      const direction = call.callerUserId === meId ? 'outgoing' : 'incoming';
      this.setCallState(call, 'connecting', direction);
      if (direction !== 'outgoing') return;

      try {
        await this.ensureLocalCallStream();
        await this.ensureCallPeerConnection();
        await this.createAndSendCallOffer();
      } catch (error: any) {
        this.callError = this.resolveCallRuntimeError(error);
        this.pushToast('Звонок', this.callError);
        await this.hangupCall('failed');
      }
    },

    onCallEnded(this: any, payload: any) {
      const call = normalizeCallPayload(payload);
      if (!call) return;
      const current = this.activeCall as DirectCallPayload | null;
      if (current && current.callId !== call.callId) return;
      if (this.callPhase !== 'idle' && this.callPhase !== 'ended') {
        void this.playCallOffSound?.();
      }
      this.finishCallLocally(call, 'ended');
    },

    async onCallIncoming(this: any, payload: any) {
      const call = normalizeCallPayload(payload);
      if (!call || call.status !== 'ringing') return;
      if (call.calleeUserId !== this.getCurrentUserId()) return;

      if (this.isCallActive()) {
        await ws.request('call:reject', {callId: call.callId});
        return;
      }

      this.setCallState(call, 'incoming', 'incoming');
      this.callError = '';
      this.playIncomingCallSound?.();
      this.hapticConfirm?.();
      this.showIncomingCallBrowserNotification(call);
    },

    showIncomingCallBrowserNotification(this: any, call: DirectCallPayload) {
      if (typeof window === 'undefined') return;
      if (!this.isBrowserNotificationsSupported?.()) return;
      if (!this.browserNotificationsEnabled || this.browserNotificationPermission !== 'granted') return;
      if (!this.isWindowInactive?.()) return;

      const callerName = formatPeerName(call.caller);
      const notification = new Notification('MARX · Входящий звонок', {
        body: `${callerName} звонит вам`,
        icon: call.caller.avatarUrl || '/favicon-alert.png',
        tag: `marx-call-${call.callId}`,
        data: {
          callId: call.callId,
          roomId: call.roomId,
        },
      });
      notification.onclick = () => {
        try {
          window.focus();
        } catch {}
        void this.openCallRoom(call.roomId, call.callId);
        notification.close();
      };
      this.activeBrowserNotifications = [...(this.activeBrowserNotifications || []), notification];
      this.closeOldBrowserNotifications?.();
    },

    async openCallRoom(this: any, roomIdRaw: unknown, callIdRaw?: unknown) {
      const roomId = toPositiveNumber(roomIdRaw);
      if (!roomId) return;
      if (Number(this.activeDialog?.id || 0) !== roomId) {
        const dialog = this.buildDialogFromRoomRoute?.(roomId) as Dialog | null;
        if (dialog) {
          await this.selectDialog(dialog, {routeMode: 'none'});
        }
      }
      const query: Record<string, string> = {room: String(roomId)};
      const callId = stringValue(callIdRaw);
      if (callId) query.callId = callId;
      if (this.router && this.route?.path === '/chat') {
        await this.router.replace({path: '/chat', query});
      }
    },

    async handleCallRouteIntent(this: any) {
      if (typeof window === 'undefined') return;
      const query = this.route?.query || {};
      const callId = stringValue(Array.isArray(query.callId) ? query.callId[0] : query.callId);
      if (!callId) return;
      const action = stringValue(Array.isArray(query.callAction) ? query.callAction[0] : query.callAction).toLowerCase();
      const intentKey = `${callId}:${action || 'open'}:${String(this.route?.fullPath || '')}`;
      if (this.handledCallRouteIntent === intentKey) return;
      this.handledCallRouteIntent = intentKey;

      const result = await ws.request('call:get', {callId});
      if (!(result as any)?.ok) {
        this.pushToast('Звонок', this.resolveCallError(wsError(result, 'call_not_found')));
        return;
      }
      const call = normalizeCallPayload(wsData(result, null));
      if (!call) return;
      if (Number(this.activeDialog?.id || 0) !== Number(call.roomId)) {
        await this.openCallRoom(call.roomId, call.callId);
      }
      if (call.status === 'ended') {
        this.finishCallLocally(call, 'ended');
        return;
      }
      const meId = this.getCurrentUserId();
      const direction = call.callerUserId === meId ? 'outgoing' : 'incoming';
      if (!this.activeCall || this.activeCall.callId !== call.callId) {
        this.setCallState(call, call.status === 'accepted' ? 'connecting' : direction === 'incoming' ? 'incoming' : 'outgoing', direction);
      }
      if (action === 'reject' && direction === 'incoming') {
        await this.rejectIncomingCall();
        return;
      }
      if (action === 'answer' && direction === 'incoming' && this.callPhase === 'incoming') {
        await nextTick();
        await this.answerIncomingCall();
      }
    },

    markCallConnected(this: any) {
      if (!this.activeCall || this.callPhase === 'connected') return;
      this.callPhase = 'connected';
      this.stopOutgoingCallMusic?.();
      const acceptedAt = Date.parse(this.activeCall.acceptedAt || '') || Date.now();
      this.callStartedAt = acceptedAt;
      this.startCallDurationTicker();
    },

    startCallDurationTicker(this: any) {
      if (typeof window === 'undefined') return;
      if (!this.callStartedAt) {
        this.callStartedAt = Date.now();
      }
      this.callDurationNow = Date.now();
      if (this.callDurationTimer) return;
      this.callDurationTimer = window.setInterval(() => {
        this.callDurationNow = Date.now();
      }, 1000);
    },

    stopCallDurationTicker(this: any) {
      if (!this.callDurationTimer) return;
      clearInterval(this.callDurationTimer);
      this.callDurationTimer = null;
    },

    finishCallLocally(this: any, callRaw: DirectCallPayload | null, phase: DirectCallPhase = 'ended') {
      const call = callRaw || this.activeCall;
      this.activeCall = call;
      this.callPhase = phase;
      this.callDirection = null;
      this.stopOutgoingCallMusic?.();
      this.cleanupCallPeerResources();
      this.stopCallDurationTicker();
      this.callError = this.resolveCallEndText(call?.endReason || null);
      this.resetCallStateSoon();
    },

    resetCallStateSoon(this: any) {
      if (typeof window === 'undefined') {
        this.resetCallState();
        return;
      }
      if (this.callResetTimer) clearTimeout(this.callResetTimer);
      this.callResetTimer = window.setTimeout(() => {
        this.resetCallState();
      }, CALL_RESET_DELAY_MS);
    },

    resetCallState(this: any) {
      if (this.callResetTimer) {
        clearTimeout(this.callResetTimer);
        this.callResetTimer = null;
      }
      this.stopOutgoingCallMusic?.();
      this.activeCall = null;
      this.callPhase = 'idle';
      this.callDirection = null;
      this.callError = '';
      this.callMuted = false;
      this.callStartedAt = null;
      this.callDurationNow = Date.now();
      this.callPendingRemoteCandidates = [];
      this.callRemoteStream = null;
    },

    cleanupCallPeerResources(this: any) {
      const pc = this.callPeerConnection as RTCPeerConnection | null;
      if (pc) {
        try {
          pc.onicecandidate = null;
          pc.ontrack = null;
          pc.onconnectionstatechange = null;
          pc.close();
        } catch {}
      }
      const localStream = this.callLocalStream as MediaStream | null;
      if (localStream) {
        localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
      const audio = this.callRemoteAudioEl as HTMLAudioElement | null;
      if (audio) {
        audio.srcObject = null;
      }
      this.callPeerConnection = null;
      this.callLocalStream = null;
      this.callRemoteStream = null;
      this.callPendingRemoteCandidates = [];
    },

    disposeCallRuntime(this: any, notifyServer = true) {
      if (notifyServer && this.activeCall && this.callPhase !== 'idle' && this.callPhase !== 'ended') {
        void ws.request('call:hangup', {callId: this.activeCall.callId, reason: 'hangup'});
      }
      this.stopOutgoingCallMusic?.();
      this.cleanupCallPeerResources();
      this.stopCallDurationTicker();
      this.resetCallState();
    },

    toggleCallMute(this: any) {
      this.hapticTap?.();
      this.callMuted = !this.callMuted;
      const localStream = this.callLocalStream as MediaStream | null;
      if (!localStream) return;
      localStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = !this.callMuted;
      });
    },

    onCallWsDisconnected(this: any) {
      if (!this.activeCall || this.callPhase === 'idle' || this.callPhase === 'ended') return;
      void this.playCallOffSound?.();
      this.callError = 'Соединение с сервером потеряно. Звонок завершён.';
      this.finishCallLocally({...this.activeCall, status: 'ended', endReason: 'disconnect'}, 'ended');
    },

    resolveCallRuntimeError(this: any, errorRaw: unknown) {
      const text = String((errorRaw as any)?.message || errorRaw || '').trim();
      if (text === 'webrtc_not_supported') return 'Этот браузер не поддерживает WebRTC-звонки.';
      if (text.includes('Permission') || text.includes('NotAllowedError')) return 'Нет доступа к микрофону.';
      if (text.includes('NotFoundError')) return 'Микрофон не найден.';
      return 'Не удалось запустить звонок.';
    },

    resolveCallError(this: any, errorRaw: unknown) {
      const error = String(errorRaw || '').trim();
      const map: Record<string, string> = {
        unauthorized: 'Нужно войти в аккаунт.',
        not_authenticated: 'Нужно войти в аккаунт.',
        room_not_found: 'Директ не найден.',
        calls_only_direct: 'Звонки доступны только в директе.',
        invalid_direct_room: 'Некорректный direct-чат.',
        forbidden: 'Нет доступа к этому звонку.',
        call_busy: 'Собеседник уже в звонке.',
        invalid_call: 'Некорректный звонок.',
        call_not_found: 'Звонок уже завершён или не найден.',
        call_ended: 'Звонок уже завершён.',
        call_not_ringing: 'На этот звонок уже ответили.',
        call_not_ready: 'Звонок ещё не готов к передаче WebRTC-сигналов.',
        invalid_signal_type: 'Некорректный WebRTC-сигнал.',
        disconnected: 'Нет соединения с сервером.',
      };
      return map[error] || 'Не удалось выполнить действие со звонком.';
    },

    resolveCallEndText(this: any, reasonRaw: unknown) {
      const reason = String(reasonRaw || '').trim();
      const map: Record<string, string> = {
        hangup: 'Звонок завершён.',
        reject: 'Звонок отклонён.',
        timeout: 'Пропущенный звонок.',
        busy: 'Собеседник занят.',
        failed: 'Звонок завершился с ошибкой.',
        disconnect: 'Соединение потеряно.',
      };
      return map[reason] || 'Звонок завершён.';
    },
};
