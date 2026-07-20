import { findNodeAtLocation, getNodeValue } from 'jsonc-parser';
import type { Node } from 'jsonc-parser';
import type { ZodType } from 'zod';
import type { TextIndex } from '../utils/text-index';
import type { JsonDiagnostic } from '../types';

/** zod issue path에 해당하는 노드가 없으면(예: 누락된 필수 키)
 *  가장 가까운 조상 노드로 폴백해 최소한 위치는 짚어준다 */
function nodeForPath(root: Node, path: (string | number)[]): Node {
  for (let depth = path.length; depth > 0; depth -= 1) {
    const node = findNodeAtLocation(root, path.slice(0, depth));
    if (node) return node;
  }
  return root;
}

/** object 노드에서 key 문자열 노드("key" 따옴표 포함 구간)를 찾는다 */
function propertyKeyNode(objectNode: Node, key: string): Node | undefined {
  if (objectNode.type !== 'object' || !objectNode.children) return undefined;
  for (const property of objectNode.children) {
    const keyNode = property.children?.[0];
    if (keyNode?.value === key) return keyNode;
  }
  return undefined;
}

function formatPath(path: (string | number)[]): string {
  let formatted = '$';
  for (const segment of path) {
    formatted += typeof segment === 'number' ? `[${segment}]` : `.${segment}`;
  }
  return formatted;
}

export function schemaDiagnostics(
  schema: ZodType,
  root: Node,
  textIndex: TextIndex,
  unrecognizedKeyMessages?: Record<string, string>,
): JsonDiagnostic[] {
  const result = schema.safeParse(getNodeValue(root));
  if (result.success) return [];

  return result.error.issues.flatMap((issue): JsonDiagnostic[] => {
    const path = issue.path.filter(
      (segment): segment is string | number => typeof segment !== 'symbol',
    );

    // 정의되지 않은 키는 이슈 하나에 여러 키가 묶여 오므로, 키마다 쪼개서 키 위치를 직접 짚는다
    if (issue.code === 'unrecognized_keys') {
      const objectNode = nodeForPath(root, path);
      return issue.keys.map((key): JsonDiagnostic => {
        const keyNode = propertyKeyNode(objectNode, key) ?? objectNode;
        return {
          range: textIndex.rangeAt(keyNode.offset, keyNode.length),
          // 의도적으로 세트에서 뺀 키는 "정의 안 됨"이 아니라 대체 수단을 안내한다
          message: `${formatPath([...path, key])}: ${
            unrecognizedKeyMessages?.[key] ?? '스키마에 정의되지 않은 키예요'
          }`,
          // 스키마는 강제 규칙이 아닌 '권장 세트'이므로, 구문 오류와 달리 warning으로 낮춘다
          severity: 'warning',
          source: 'schema',
        };
      });
    }

    const node = nodeForPath(root, path);
    return [
      {
        range: textIndex.rangeAt(node.offset, node.length),
        message: `${formatPath(path)}: ${issue.message}`,
        severity: 'warning',
        source: 'schema',
      },
    ];
  });
}
