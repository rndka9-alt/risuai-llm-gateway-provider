import { useEffect, useState } from 'preact/hooks';
import type { SettingsValues } from './storage';

export interface SettingsSnapshot extends SettingsValues {
  registrationSignature: string;
}

type SettingsSnapshotListener = () => void;

const settingsSnapshotListeners = new Set<SettingsSnapshotListener>();
let settingsSnapshot: SettingsSnapshot | undefined;

export function getSettingsSnapshot(): SettingsSnapshot {
  if (settingsSnapshot === undefined) {
    throw new Error('Settings snapshot read before initialization');
  }
  return settingsSnapshot;
}

export function subscribeSettingsSnapshot(listener: SettingsSnapshotListener): () => void {
  settingsSnapshotListeners.add(listener);
  return () => settingsSnapshotListeners.delete(listener);
}

function publishSettingsSnapshot(snapshot: SettingsSnapshot): void {
  settingsSnapshot = snapshot;
  for (const listener of settingsSnapshotListeners) listener();
}

export function initializeSettingsSnapshot(snapshot: SettingsSnapshot): void {
  publishSettingsSnapshot(snapshot);
}

export function updateSettingsSnapshot(update: Partial<SettingsValues>): void {
  publishSettingsSnapshot({ ...getSettingsSnapshot(), ...update });
}

export function useSettingsSnapshot(): SettingsSnapshot {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(getSettingsSnapshot);
  // pluginStorage는 변경 알림이 없으므로 필드가 공유하는 동기 snapshot의 publish를
  // 구독해 낙관적으로 반영한 최신 설정값만 렌더링한다.
  useEffect(() => subscribeSettingsSnapshot(() => setSnapshot(getSettingsSnapshot())), []);
  return snapshot;
}
