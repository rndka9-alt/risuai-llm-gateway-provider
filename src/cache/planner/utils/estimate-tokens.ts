// 문자수/4 단일 근사는 한국어(≈2자/토큰)에서 토큰을 과소평가해 캐시 가능한
// 지점의 breakpoint가 생략된다. ASCII와 비ASCII를 나눠 추정하고, role framing
// 몫으로 메시지당 4토큰을 더한다.
export function estimateTokens(text: string): number {
  let asciiCount = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) asciiCount += 1;
  }
  const nonAsciiCount = text.length - asciiCount;
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 2);
}
