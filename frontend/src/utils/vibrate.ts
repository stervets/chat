const MIN_VIBRATION_GAP_MS = 45;
let lastVibrationAt = 0;

function canVibrateNow() {
  const now = Date.now();
  if (now - lastVibrationAt < MIN_VIBRATION_GAP_MS) return false;
  lastVibrationAt = now;
  return true;
}

export function vibrateTap() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && canVibrateNow()) {
    navigator.vibrate(15);
  }
}

export function vibrateConfirm() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && canVibrateNow()) {
    navigator.vibrate(25);
  }
}

export function vibrateError() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && canVibrateNow()) {
    navigator.vibrate([40, 30, 40]);
  }
}
