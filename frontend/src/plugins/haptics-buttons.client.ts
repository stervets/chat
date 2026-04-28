import {VIBRATION_ENABLED_STORAGE_KEY} from '@/pages/chat/helpers/storage';
import {vibrateTap} from '@/utils/vibrate';

function isVibrationEnabled() {
  if (typeof window === 'undefined') return false;
  const raw = window.localStorage.getItem(VIBRATION_ENABLED_STORAGE_KEY);
  if (raw === null) return true;
  return raw !== '0';
}

function resolveButtonTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return null;
  if (button.disabled) return null;
  return button;
}

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;

  const onDocumentClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    const button = resolveButtonTarget(event.target);
    if (!button) return;
    if (!isVibrationEnabled()) return;
    vibrateTap();
  };

  document.addEventListener('click', onDocumentClick, {capture: true});
});
