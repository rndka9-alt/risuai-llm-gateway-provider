// 동등성 비교 용도라 암호학적 강도가 필요 없다. 충돌 시 손해는 breakpoint
// 위치가 한 번 어긋나는 것(고아 세그먼트 1개)뿐이다.
export function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
