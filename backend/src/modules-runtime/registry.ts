import {kingModule} from '../modules/king/module.js';
import type {GameModule} from './types.js';

export const runtimeModules = {
  king: kingModule,
};

export function getGameModule(moduleKeyRaw: unknown): GameModule | null {
  const moduleKey = String(moduleKeyRaw || '').trim().toLowerCase();
  if (!moduleKey) return null;
  const module = (runtimeModules as Record<string, GameModule | undefined>)[moduleKey];
  if (!module || module.kind !== 'game' || !module.enabled) return null;
  return module;
}
