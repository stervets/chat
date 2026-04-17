export {nextTick} from 'vue';
export {ws} from '@/composables/classes/ws';
export {on, off} from '@/composables/event-bus';
export {getApiBase} from '@/composables/api';
export {
  getSessionToken,
  restoreSession,
  setWsReconnectDialogResolver,
  wsConnectionState,
  wsChangePassword,
  wsLogout,
  wsUpdateProfile,
} from '@/composables/ws-rpc';
export {
  BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  HANDLED_MESSAGE_IDS_LIMIT,
  SOUND_ENABLED_STORAGE_KEY,
  SOUND_OVERLAY_SKIP_ONCE_KEY,
  consumeSessionFlagOnce,
  getHandledMessageIdsStorageKey,
  loadBooleanSetting,
  loadHandledMessageIds,
  normalizeHandledMessageIdsMap,
  persistBooleanSetting,
  persistHandledMessageIds,
} from '../helpers/storage';
export * from '../chat-page.constants';
export type {Dialog, Message, MessageReaction, User} from '@/composables/types';
