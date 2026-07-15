/** 설정 화면에서 사용하는 RisuAI 테마 색상만 추린다. */
export type ThemeColors = Pick<
  ColorScheme,
  'bgcolor' | 'darkbg' | 'borderc' | 'selected' | 'textcolor' |
  'textcolor2' | 'darkBorderc' | 'darkbutton'
>;
