export interface CaretRect {
  top: number;
  left: number;
  height: number;
}

/** 미러 요소에 복사해야 줄바꿈·글자 폭이 textarea와 동일해지는 스타일 속성들 */
const MIRRORED_STYLE_PROPERTIES = [
  'box-sizing',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'tab-size',
  'text-indent',
  'text-transform',
  'word-spacing',
] as const;

/** textarea에는 caret 좌표 API가 없어서, 동일 스타일의 미러 요소에
 *  marker span을 심어 caret의 픽셀 위치를 계산한다 */
export function measureCaretRect(textarea: HTMLTextAreaElement, offset: number): CaretRect {
  const mirror = document.createElement('div');
  const computedStyle = window.getComputedStyle(textarea);
  for (const property of MIRRORED_STYLE_PROPERTIES) {
    mirror.style.setProperty(property, computedStyle.getPropertyValue(property));
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, offset);

  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const caretRect = {
    top: marker.offsetTop - textarea.scrollTop,
    left: marker.offsetLeft - textarea.scrollLeft,
    height: marker.offsetHeight,
  };
  mirror.remove();
  return caretRect;
}
