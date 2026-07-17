import type { MessageFingerprint } from '../../state/schema';

export function fingerprintsEqual(left: MessageFingerprint, right: MessageFingerprint): boolean {
  return left.role === right.role && left.hash === right.hash;
}
