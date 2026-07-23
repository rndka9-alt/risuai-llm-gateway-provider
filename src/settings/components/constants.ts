export const INPUT_CLASS =
  'touch-input-text h-[38px] w-full rounded-lg border border-ui-frame bg-ui-control px-3 text-sm text-ui-content outline-none focus:border-ui-accent focus:ring-2 focus:ring-ui-accent/30';
export const NOTICE_CLASS =
  'm-0 rounded-lg border border-ui-accent px-2.5 py-2 text-xs text-ui-content';
// 네이티브 select 화살표는 우측에 딱 붙어 여백을 줄 수 없어, CSS 그라디언트
// 셰브런 + pr-[34px]로 교체한다 (CSP상 외부/data 이미지 대신 그라디언트 사용).
export const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer appearance-none pr-[34px] bg-no-repeat [background-image:linear-gradient(45deg,transparent_50%,var(--text2)_50%),linear-gradient(135deg,var(--text2)_50%,transparent_50%)] [background-position:calc(100%_-_19px)_55%,calc(100%_-_14px)_55%] [background-size:5px_5px]`;
export const FIELD_CLASS = 'flex min-w-0 flex-col gap-1.5';
export const FIELD_CAPTION_CLASS =
  'text-xs font-medium leading-tight tracking-[0.01em] text-ui-muted';
