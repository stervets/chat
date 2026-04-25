import {ImagePlus, MessageCircleMore, Save, UserRoundMinus, UserRoundPlus} from 'lucide-vue-next';

function modelComputed(propName: string, eventName: string) {
  return {
    get(this: any) {
      return this[propName];
    },
    set(this: any, value: any) {
      this.$emit(eventName, value);
    },
  };
}

export default {
  components: {
    ImagePlus,
    MessageCircleMore,
    Save,
    UserRoundMinus,
    UserRoundPlus,
  },

  props: {
    browserNotificationPermission: {type: String, default: 'default'},
    browserNotificationsEnabled: Boolean,
    canSendWebPushTest: Boolean,
    contactBusy: Boolean,
    hasDonationBadge: Boolean,
    isContact: Boolean,
    isDevMode: Boolean,
    isOwnProfile: Boolean,
    isStandaloneApp: Boolean,
    newPassword: {type: String, default: ''},
    profile: Object,
    profileColorPicker: {type: String, default: '#61afef'},
    profileDisplayAvatarUrl: {type: String, default: ''},
    profileDisplayName: {type: String, default: ''},
    profileDisplayNicknameColor: String,
    profileInfo: {type: String, default: ''},
    profileName: {type: String, default: ''},
    profileNicknameColor: {type: String, default: ''},
    pushDisableAllMentions: Boolean,
    saveError: {type: String, default: ''},
    saveSuccess: {type: String, default: ''},
    saving: Boolean,
    soundEnabled: Boolean,
    vibrationEnabled: Boolean,
    webPushAvailable: Boolean,
    webPushBusy: Boolean,
    webPushError: {type: String, default: ''},
    webPushRequiresIosInstall: Boolean,
    webPushSettingEnabled: Boolean,
    webPushStatusText: {type: String, default: ''},
    webPushSupported: Boolean,
    webPushTestBusy: Boolean,
    webPushTestStatus: {type: String, default: ''},
    isSystemNickname: {type: Function, required: true},
    userAvatarFallback: {type: Function, required: true},
  },

  emits: [
    'avatar-change',
    'browser-notifications-change',
    'clear-nickname-color',
    'color-picked',
    'media-open',
    'request-browser-permission',
    'save-profile',
    'send-web-push-test',
    'sound-change',
    'toggle-contact',
    'update:browserNotificationsEnabled',
    'update:newPassword',
    'update:profileColorPicker',
    'update:profileInfo',
    'update:profileName',
    'update:pushDisableAllMentions',
    'update:soundEnabled',
    'update:vibrationEnabled',
    'update:webPushSettingEnabled',
    'vibration-change',
    'web-push-change',
    'write-to-user',
  ],

  computed: {
    localBrowserNotificationsEnabled: modelComputed('browserNotificationsEnabled', 'update:browserNotificationsEnabled'),
    localNewPassword: modelComputed('newPassword', 'update:newPassword'),
    localProfileColorPicker: modelComputed('profileColorPicker', 'update:profileColorPicker'),
    localProfileInfo: modelComputed('profileInfo', 'update:profileInfo'),
    localProfileName: modelComputed('profileName', 'update:profileName'),
    localPushDisableAllMentions: modelComputed('pushDisableAllMentions', 'update:pushDisableAllMentions'),
    localSoundEnabled: modelComputed('soundEnabled', 'update:soundEnabled'),
    localVibrationEnabled: modelComputed('vibrationEnabled', 'update:vibrationEnabled'),
    localWebPushSettingEnabled: modelComputed('webPushSettingEnabled', 'update:webPushSettingEnabled'),
  },

  methods: {
    openMediaViewer(this: any, src: string, alt?: string) {
      this.$emit('media-open', src, alt);
    },

    onProfileAvatarInputChange(this: any, event: Event) {
      this.$emit('avatar-change', event);
    },

    onColorPicked(this: any) {
      this.$emit('color-picked');
    },

    clearNicknameColor(this: any) {
      this.$emit('clear-nickname-color');
    },

    onSoundEnabledChange(this: any) {
      this.$emit('sound-change');
    },

    onVibrationEnabledChange(this: any) {
      this.$emit('vibration-change');
    },

    onBrowserNotificationsEnabledChange(this: any) {
      this.$emit('browser-notifications-change');
    },

    requestBrowserNotificationPermission(this: any) {
      this.$emit('request-browser-permission');
    },

    onWebPushEnabledChange(this: any) {
      this.$emit('web-push-change');
    },

    sendWebPushTest(this: any) {
      this.$emit('send-web-push-test');
    },

    onSaveProfile(this: any) {
      this.$emit('save-profile');
    },

    onWriteToUser(this: any) {
      this.$emit('write-to-user');
    },

    toggleContact(this: any) {
      this.$emit('toggle-contact');
    },
  },
};
