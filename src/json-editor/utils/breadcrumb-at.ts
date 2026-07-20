import { getLocation } from 'jsonc-parser';
import type { BreadcrumbSegment } from '../types';

/** 커서 offset이 속한 JSON 경로. 구문 오류가 있는 문서에서도 동작한다 */
export function breadcrumbAt(text: string, offset: number): BreadcrumbSegment[] {
  return getLocation(text, offset).path.map((segment): BreadcrumbSegment =>
    typeof segment === 'number'
      ? { label: String(segment), kind: 'index' }
      : { label: segment, kind: 'key' },
  );
}
