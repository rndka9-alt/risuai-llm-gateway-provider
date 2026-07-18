import { useEffect, useState } from 'preact/hooks';

export interface SettingsSignals {
  reloadNeeded: boolean;
  saveFailed: boolean;
}

type SettingsSignalsListener = () => void;

const settingsSignalsListeners = new Set<SettingsSignalsListener>();
let settingsSignals: SettingsSignals = {
  reloadNeeded: false,
  saveFailed: false,
};

export function getSettingsSignals(): SettingsSignals {
  return settingsSignals;
}

export function subscribeSettingsSignals(listener: SettingsSignalsListener): () => void {
  settingsSignalsListeners.add(listener);
  return () => settingsSignalsListeners.delete(listener);
}

function publishSettingsSignals(nextSignals: SettingsSignals): void {
  settingsSignals = nextSignals;
  for (const listener of settingsSignalsListeners) listener();
}

export function initializeSettingsSignals(initialSignals?: Partial<SettingsSignals>): void {
  publishSettingsSignals({ reloadNeeded: false, saveFailed: false, ...initialSignals });
}

export function setSettingsReloadNeeded(reloadNeeded: boolean): void {
  publishSettingsSignals({ ...settingsSignals, reloadNeeded });
}

export function setSettingsSaveFailed(saveFailed: boolean): void {
  publishSettingsSignals({ ...settingsSignals, saveFailed });
}

export function useSettingsSignals(): SettingsSignals {
  const [signals, setSignals] = useState<SettingsSignals>(getSettingsSignals);
  useEffect(() => subscribeSettingsSignals(() => setSignals(getSettingsSignals())), []);
  return signals;
}
