import {emit, on, off, receive, responses} from '@/composables/event-bus';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.mixin({
    created(this: any) {
      this._callbacks = {} as Record<string, Function[]>;
      this._responses = {} as Record<string, any>;
    },

    beforeUnmount(this: any) {
      Object.keys(this._callbacks).forEach((event) => {
        this._callbacks[event].slice().forEach((callback: Function) => {
          this.off(event, callback);
        });
      });

      Object.keys(this._responses).forEach((event) => this.stopTransmit(event));
    },

    methods: {
      emit,

      on(this: any, event: string, callback: Function) {
        !this._callbacks[event] && (this._callbacks[event] = []);
        this._callbacks[event].push(callback);
        on(event, callback);
      },

      off(this: any, event: string, callback: Function) {
        if (!this._callbacks[event]) return;
        this._callbacks[event].splice(this._callbacks[event].indexOf(callback), 1);
        off(event, callback);
      },

      transmit(this: any, event: string, value: any) {
        responses[event] = this._responses[event] = value;
      },

      stopTransmit(this: any, event: string) {
        this._responses[event] === responses[event] && (delete responses[event]);
      },

      receive
    }
  });
});
