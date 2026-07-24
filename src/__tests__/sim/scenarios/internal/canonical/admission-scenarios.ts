import type { SimulationScenario } from '../scenario-contract';
import { makeBlock, makeMessage, request } from './fixture-builders';

// 2026-07-19 익명 실환경 trace의 89k·67k write 사건을 최소 구조로 번역한다.
// 2-strike가 latest frontier를 억제한 상태에서도, 다음 length-change가 만드는
// prefixLength-1 branch boundary는 중간 앵커가 되어 slice(0, -1)을 빠져나간다.
// 실로그의 신규 경계 추정치(51k~63k)에 맞춰 큰 안정 히스토리를 60k로 둔다.
export function createSuppressedFrontierBranchBoundaryScenario(): SimulationScenario {
  const stableHead = makeMessage('system', makeBlock('branch-bypass-head', 6_000));
  const stableSuffix = makeMessage('user', 'Stable request footer.');
  const largeStableHistory = makeMessage('user', makeBlock('branch-bypass-large-history', 240_000));
  const stableMiddle = makeMessage('system', makeBlock('branch-bypass-stable-middle', 1_000));

  return {
    id: '18-suppressed-frontier-branch-boundary',
    label: 'new branch boundary bypasses active frontier suppression',
    requests: [
      request(
        [
          stableHead,
          makeMessage('system', makeBlock('branch-bypass-bootstrap-A', 1_000)),
          stableSuffix,
        ],
        0,
      ),
      request([
        stableHead,
        makeMessage('system', makeBlock('branch-bypass-bootstrap-B', 1_000)),
        makeMessage('system', makeBlock('branch-bypass-bootstrap-growth', 800)),
        stableSuffix,
      ]),
      request([
        stableHead,
        largeStableHistory,
        stableMiddle,
        makeMessage('system', makeBlock('branch-bypass-volatile-A', 1_000)),
        stableSuffix,
      ]),
      request([
        stableHead,
        largeStableHistory,
        stableMiddle,
        makeMessage('system', makeBlock('branch-bypass-volatile-B', 1_000)),
        makeMessage('system', makeBlock('branch-bypass-new-frontier', 800)),
        stableSuffix,
      ]),
    ],
  };
}

// 16k는 즉시 write 허용선일 뿐 영구 상한이 아니다. 큰 안정 prefix의 승격
// 시점별 write와 이후 동일 요청에서의 read 회수 비용을 고정한다.
export function createLargeStablePrefixAdmissionScenario(): SimulationScenario {
  const messages = [
    makeMessage('system', makeBlock('large-stable-prefix', 80_000)),
    makeMessage('user', 'Large stable prefix admission input.'),
  ];

  return {
    id: '19-large-stable-prefix-admission',
    label: 'over-16k stable prefix admission across repeated requests',
    requests: [request(messages, 0), request(messages), request(messages), request(messages)],
  };
}

// 큰 prefix가 반복된 뒤 바로 교체되는 경계에서 admission 시점에 따라 첫 hit을
// 회수하거나 cold write만 남기는 차이를 고정한다.
export function createLargeStablePrefixInvalidatedAfterAdmissionScenario(): SimulationScenario {
  const stableMessages = [
    makeMessage('system', makeBlock('large-prefix-before-invalidation', 80_000)),
    makeMessage('user', 'Large prefix invalidation input.'),
  ];
  const invalidatedMessages = [
    makeMessage('system', makeBlock('large-prefix-after-invalidation', 80_000)),
    makeMessage('user', 'Large prefix invalidation input.'),
  ];

  return {
    id: '20-large-prefix-invalidated-after-admission',
    label: 'over-16k repeated prefix invalidated before the next request',
    requests: [
      request(stableMessages, 0),
      request(stableMessages),
      request(stableMessages),
      request(invalidatedMessages),
    ],
  };
}
