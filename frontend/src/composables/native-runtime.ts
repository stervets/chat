import {Capacitor} from '@capacitor/core';

function platformName() {
  try {
    return String(Capacitor.getPlatform() || '').trim().toLowerCase();
  } catch {
    return 'web';
  }
}

export function isNativeRuntime() {
  try {
    return !!Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isNativeAndroidApp() {
  return isNativeRuntime() && platformName() === 'android';
}
