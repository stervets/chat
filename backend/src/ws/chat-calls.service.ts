import {randomUUID} from 'node:crypto';
import type {RoomRow} from '../common/rooms.js';
import type {SocketUser} from './protocol.js';

export type CallStatus = 'ringing' | 'accepted' | 'ended';
export type CallEndReason = 'hangup' | 'reject' | 'timeout' | 'busy' | 'failed' | 'disconnect';
export type CallSignalType = 'offer' | 'answer' | 'ice-candidate';

export type CallUserPayload = {
  id: number;
  nickname: string;
  name: string;
  avatarUrl: string | null;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
};

export type CallPublicPayload = {
  callId: string;
  roomId: number;
  status: CallStatus;
  callerUserId: number;
  calleeUserId: number;
  caller: CallUserPayload;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  endedAt: string | null;
  endReason: CallEndReason | null;
};

export type CallSignalPayload = {
  callId: string;
  roomId: number;
  fromUserId: number;
  toUserId: number;
  type: CallSignalType;
  payload: unknown;
};

type CallInternalState = {
  callId: string;
  roomId: number;
  callerUserId: number;
  calleeUserId: number;
  caller: CallUserPayload;
  status: CallStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  endedAt: number | null;
  endReason: CallEndReason | null;
};

type CallResult<T> = {ok: true; data: T} | {ok: false; error: string};

type ChatCallsServiceOptions = {
  ringTimeoutMs?: number;
  endedRetentionMs?: number;
};

const DEFAULT_RING_TIMEOUT_MS = 45_000;
const DEFAULT_ENDED_RETENTION_MS = 5 * 60_000;

function normalizePositiveMs(valueRaw: unknown, fallback: number, min: number, max: number) {
  const value = Number(valueRaw || 0);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function toIsoOrNull(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toISOString();
}

function normalizeCallUser(user: SocketUser): CallUserPayload {
  return {
    id: Number(user.id || 0),
    nickname: String(user.nickname || '').trim(),
    name: String(user.name || user.nickname || '').trim(),
    avatarUrl: user.avatarUrl || null,
    nicknameColor: user.nicknameColor || null,
    donationBadgeUntil: user.donationBadgeUntil || null,
  };
}

export class ChatCallsService {
  private readonly calls = new Map<string, CallInternalState>();
  private readonly ringTimeoutMs: number;
  private readonly endedRetentionMs: number;

  constructor(options?: ChatCallsServiceOptions) {
    this.ringTimeoutMs = normalizePositiveMs(
      options?.ringTimeoutMs,
      DEFAULT_RING_TIMEOUT_MS,
      10_000,
      5 * 60_000,
    );
    this.endedRetentionMs = normalizePositiveMs(
      options?.endedRetentionMs,
      DEFAULT_ENDED_RETENTION_MS,
      30_000,
      30 * 60_000,
    );
  }

  getRingTimeoutMs() {
    return this.ringTimeoutMs;
  }

  startDirectCall(room: RoomRow | null, caller: SocketUser | null): CallResult<CallPublicPayload> {
    this.expireTimedOutCalls();
    if (!caller?.id) return {ok: false, error: 'unauthorized'};
    if (!room) return {ok: false, error: 'room_not_found'};
    if (room.kind !== 'direct') return {ok: false, error: 'calls_only_direct'};

    const callerUserId = Number(caller.id || 0);
    const memberUserIds = Array.from(new Set(
      (room.member_user_ids || [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    ));
    if (!memberUserIds.includes(callerUserId)) return {ok: false, error: 'forbidden'};

    const callees = memberUserIds.filter((userId) => userId !== callerUserId);
    if (callees.length !== 1) return {ok: false, error: 'invalid_direct_room'};
    const calleeUserId = callees[0];

    if (this.findActiveCallForUser(callerUserId) || this.findActiveCallForUser(calleeUserId)) {
      return {ok: false, error: 'call_busy'};
    }

    const now = Date.now();
    const call: CallInternalState = {
      callId: randomUUID(),
      roomId: room.id,
      callerUserId,
      calleeUserId,
      caller: normalizeCallUser(caller),
      status: 'ringing',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.ringTimeoutMs,
      acceptedAt: null,
      endedAt: null,
      endReason: null,
    };

    this.calls.set(call.callId, call);
    return {ok: true, data: this.toPublicCall(call)};
  }

  getCallForUser(callIdRaw: unknown, userIdRaw: unknown): CallResult<CallPublicPayload> {
    this.expireTimedOutCalls();
    const callId = String(callIdRaw || '').trim();
    const userId = Number(userIdRaw || 0);
    if (!callId) return {ok: false, error: 'invalid_call'};
    if (!Number.isFinite(userId) || userId <= 0) return {ok: false, error: 'unauthorized'};

    const call = this.calls.get(callId);
    if (!call) return {ok: false, error: 'call_not_found'};
    if (!this.isParticipant(call, userId)) return {ok: false, error: 'forbidden'};

    return {ok: true, data: this.toPublicCall(call)};
  }

  acceptCall(callIdRaw: unknown, userIdRaw: unknown): CallResult<CallPublicPayload> {
    this.expireTimedOutCalls();
    const call = this.findCallOrError(callIdRaw, userIdRaw);
    if (!call.ok) return {ok: false, error: (call as {ok: false; error: string}).error};

    if (call.data.calleeUserId !== Number(userIdRaw || 0)) {
      return {ok: false, error: 'forbidden'};
    }
    if (call.data.status === 'ended') return {ok: false, error: 'call_ended'};
    if (call.data.status !== 'ringing') return {ok: false, error: 'call_not_ringing'};

    const now = Date.now();
    call.data.status = 'accepted';
    call.data.acceptedAt = now;
    call.data.updatedAt = now;
    call.data.expiresAt = 0;
    return {ok: true, data: this.toPublicCall(call.data)};
  }

  rejectCall(callIdRaw: unknown, userIdRaw: unknown): CallResult<CallPublicPayload> {
    this.expireTimedOutCalls();
    const call = this.findCallOrError(callIdRaw, userIdRaw);
    if (!call.ok) return {ok: false, error: (call as {ok: false; error: string}).error};

    if (call.data.calleeUserId !== Number(userIdRaw || 0)) {
      return {ok: false, error: 'forbidden'};
    }

    return {ok: true, data: this.endCall(call.data, 'reject')};
  }

  hangupCall(callIdRaw: unknown, userIdRaw: unknown, reasonRaw?: unknown): CallResult<CallPublicPayload> {
    this.expireTimedOutCalls();
    const call = this.findCallOrError(callIdRaw, userIdRaw);
    if (!call.ok) return {ok: false, error: (call as {ok: false; error: string}).error};

    const reasonText = String(reasonRaw || '').trim().toLowerCase();
    const reason: CallEndReason = reasonText === 'failed' ? 'failed' : 'hangup';
    return {ok: true, data: this.endCall(call.data, reason)};
  }

  buildSignal(callIdRaw: unknown, fromUserIdRaw: unknown, typeRaw: unknown, payload: unknown, toUserIdRaw?: unknown): CallResult<CallSignalPayload> {
    this.expireTimedOutCalls();
    const call = this.findCallOrError(callIdRaw, fromUserIdRaw);
    if (!call.ok) return {ok: false, error: (call as {ok: false; error: string}).error};
    if (call.data.status === 'ended') return {ok: false, error: 'call_ended'};
    if (call.data.status !== 'accepted') return {ok: false, error: 'call_not_ready'};

    const type = this.normalizeSignalType(typeRaw);
    if (!type) return {ok: false, error: 'invalid_signal_type'};

    const fromUserId = Number(fromUserIdRaw || 0);
    const toUserId = call.data.callerUserId === fromUserId
      ? call.data.calleeUserId
      : call.data.callerUserId;
    const requestedToUserId = Number(toUserIdRaw || 0);
    if (Number.isFinite(requestedToUserId) && requestedToUserId > 0 && requestedToUserId !== toUserId) {
      return {ok: false, error: 'invalid_signal_target'};
    }

    call.data.updatedAt = Date.now();
    return {
      ok: true,
      data: {
        callId: call.data.callId,
        roomId: call.data.roomId,
        fromUserId,
        toUserId,
        type,
        payload,
      },
    };
  }

  expireTimedOutCalls(now = Date.now()) {
    const ended: CallPublicPayload[] = [];
    for (const call of this.calls.values()) {
      if (call.status === 'ringing' && call.expiresAt > 0 && call.expiresAt <= now) {
        ended.push(this.endCall(call, 'timeout', now));
      }
    }
    this.cleanupEndedCalls(now);
    return ended;
  }

  endCallsForUser(userIdRaw: unknown, reason: CallEndReason) {
    const userId = Number(userIdRaw || 0);
    if (!Number.isFinite(userId) || userId <= 0) return [] as CallPublicPayload[];

    const ended: CallPublicPayload[] = [];
    for (const call of this.calls.values()) {
      if (call.status === 'ended') continue;
      if (!this.isParticipant(call, userId)) continue;
      ended.push(this.endCall(call, reason));
    }
    return ended;
  }

  getParticipantUserIds(callRaw: CallPublicPayload | CallInternalState) {
    const call = callRaw as Pick<CallInternalState, 'callerUserId' | 'calleeUserId'>;
    return [call.callerUserId, call.calleeUserId]
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  private findCallOrError(callIdRaw: unknown, userIdRaw: unknown): CallResult<CallInternalState> {
    const callId = String(callIdRaw || '').trim();
    const userId = Number(userIdRaw || 0);
    if (!callId) return {ok: false, error: 'invalid_call'};
    if (!Number.isFinite(userId) || userId <= 0) return {ok: false, error: 'unauthorized'};

    const call = this.calls.get(callId);
    if (!call) return {ok: false, error: 'call_not_found'};
    if (!this.isParticipant(call, userId)) return {ok: false, error: 'forbidden'};
    return {ok: true, data: call};
  }

  private findActiveCallForUser(userId: number) {
    for (const call of this.calls.values()) {
      if (call.status === 'ended') continue;
      if (this.isParticipant(call, userId)) return call;
    }
    return null;
  }

  private isParticipant(call: CallInternalState, userId: number) {
    return call.callerUserId === userId || call.calleeUserId === userId;
  }

  private endCall(call: CallInternalState, reason: CallEndReason, now = Date.now()) {
    if (call.status !== 'ended') {
      call.status = 'ended';
      call.endedAt = now;
      call.endReason = reason;
      call.updatedAt = now;
      call.expiresAt = 0;
    }
    return this.toPublicCall(call);
  }

  private cleanupEndedCalls(now: number) {
    for (const [callId, call] of this.calls.entries()) {
      if (call.status !== 'ended') continue;
      const endedAt = Number(call.endedAt || 0);
      if (!endedAt || now - endedAt < this.endedRetentionMs) continue;
      this.calls.delete(callId);
    }
  }

  private normalizeSignalType(typeRaw: unknown): CallSignalType | null {
    const type = String(typeRaw || '').trim().toLowerCase();
    if (type === 'offer' || type === 'answer' || type === 'ice-candidate') return type;
    return null;
  }

  private toPublicCall(call: CallInternalState): CallPublicPayload {
    return {
      callId: call.callId,
      roomId: call.roomId,
      status: call.status,
      callerUserId: call.callerUserId,
      calleeUserId: call.calleeUserId,
      caller: {...call.caller},
      createdAt: new Date(call.createdAt).toISOString(),
      updatedAt: new Date(call.updatedAt).toISOString(),
      expiresAt: toIsoOrNull(call.expiresAt),
      acceptedAt: toIsoOrNull(call.acceptedAt),
      endedAt: toIsoOrNull(call.endedAt),
      endReason: call.endReason,
    };
  }
}
