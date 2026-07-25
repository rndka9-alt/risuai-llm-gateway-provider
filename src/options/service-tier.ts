// Gateway 계약의 명시 티어 값. 'default'가 UI의 Standard다 — 계약 enum
// (auto/default/flex/priority)에 'standard'라는 값은 없다.
export type ServiceTier = 'flex' | 'default';

// service_tier는 항상 명시 전송한다. 생략하면 DevPass 조직의 `Default service tier`
// 대시보드 설정이 끼어들어 실제 처리 티어를 예측할 수 없어, 계정 추종(생략) 상태를
// 폐기했다. 구버전 저장값 ''(계정 추종)와 'default'(더 오래된 명시 Standard)는 모두
// Standard('default')로 읽는다 — 계정 추종을 쓰던 사용자는 이 버전부터 Standard 고정이 된다.
export function resolveServiceTier(value: string | undefined): ServiceTier {
  const trimmed = value?.trim();
  if (trimmed === 'flex') return 'flex';
  return 'default';
}
