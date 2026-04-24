export const chatMethodsScriptableRuntime = {
  initScriptRuntimeManager(this: any) {
    this.scriptRuntimeManager = null;
    this.scriptMessageViewModels = {};
    this.activeRoomScriptViewModel = null;
  },

  disposeScriptRuntimeManager(this: any) {
    this.scriptRuntimeManager = null;
    this.scriptMessageViewModels = {};
    this.activeRoomScriptViewModel = null;
  },

  syncScriptableRuntimes() {
    // scriptable/runtime временно отключены
  },

  setActiveRoomScript(this: any, _roomRuntimeRaw: any | null) {
    this.activeRoomScript = null;
    this.activeRoomScriptViewModel = null;
  },

  async loadActiveRoomScript(this: any, _roomIdRaw: unknown) {
    this.setActiveRoomScript(null);
  },

  onScriptsState() {
    // runtime updates временно не обрабатываем
  },

  onMessageScriptAction(this: any) {
    this.error = 'Scriptable временно отключён.';
  },

  onScriptViewMounted() {
    // no-op
  },

  onScriptViewUnmounted() {
    // no-op
  },

  isPinnedScriptPassive() {
    return true;
  },

  getMessageScriptViewModel() {
    return null;
  },

  emitScriptHostRoomEvent() {
    // no-op
  },

  async createScriptableMessage(this: any) {
    this.error = 'Scriptable временно отключён.';
    return null;
  },

  async createScriptableDemoMessage(this: any) {
    this.error = 'Scriptable временно отключён.';
    return false;
  },

  async createDemoFartMessage(this: any) {
    this.error = 'Scriptable временно отключён.';
  },

  async createDemoGuessWordMessage(this: any) {
    this.error = 'Scriptable временно отключён.';
  },

  normalizeSurfaceTypeForSetup() {
    return 'custom';
  },

  async configureActiveRoomSurface(this: any) {
    this.error = 'Scriptable временно отключён.';
    return null;
  },

  async createSurfaceRoom(this: any) {
    this.error = 'Scriptable временно отключён.';
    return false;
  },

  async setupPollRoomSurfaceDemo(this: any) {
    this.error = 'Scriptable временно отключён.';
  },

  async setupBotControlRoomSurfaceDemo(this: any) {
    this.error = 'Scriptable временно отключён.';
  },

  async setupDashboardRoomSurfaceDemo(this: any) {
    this.error = 'Scriptable временно отключён.';
  },

  async disableCurrentRoomSurface(this: any) {
    this.error = 'Scriptable временно отключён.';
  },
};
