/**
 * LGP:ERR:NNN의 첫 자리는 책임 레이어, 뒤 두 자리는 층 내 01부터의 순번이다
 * (0xx 플러그인 내부·설정, 1xx RisuAI 브릿지·전송, 2xx Gateway HTTP, 3xx Gateway 응답 내용·스트림).
 * 배포된 오류 코드는 옛 제보도 계속 식별해야 하므로 추가만 허용하며,
 * 기존 항목을 삭제·재번호·재사용하지 않는다.
 */
export const USER_ERROR_CODES = {
  missingApiKey: 'LGP:ERR:001',
  unexpectedPluginFailure: 'LGP:ERR:002',
  bridgeTransportFailure: 'LGP:ERR:101',
  gatewayRequestValidationFailure: 'LGP:ERR:201',
  gatewayHttpFailure: 'LGP:ERR:202',
  gatewayInBandFailure: 'LGP:ERR:301',
  emptyStreamReasoningLimit: 'LGP:ERR:302',
  emptyStreamWithoutEvents: 'LGP:ERR:303',
  emptyStreamWithoutText: 'LGP:ERR:304',
} as const;

export type UserErrorCode = (typeof USER_ERROR_CODES)[keyof typeof USER_ERROR_CODES];
