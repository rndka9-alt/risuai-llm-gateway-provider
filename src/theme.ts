import { PRESET_SCHEMES } from './constants';
import type { ThemeColors } from './types';

export function applyTheme(scheme: ThemeColors): void {
  const style = document.documentElement.style;
  style.setProperty('--background', scheme.bgcolor);
  style.setProperty('--background2', scheme.darkbg);
  style.setProperty('--border', scheme.borderc);
  style.setProperty('--border2', scheme.darkBorderc);
  style.setProperty('--text', scheme.textcolor);
  style.setProperty('--text2', scheme.textcolor2);
  style.setProperty('--button', scheme.darkbutton);
  style.setProperty('--accent', scheme.selected);
  style.setProperty('--accent-text', scheme.textcolor);
}

export async function resolveScheme(): Promise<ThemeColors> {
  try {
    const { scheme } = await risuai.getColorScheme();
    return scheme;
  } catch (error) {
    console.warn('[llm-gateway-provider] getColorScheme failed; using preset fallback', error);
    const database = await risuai.getDatabase(['colorSchemeName']);
    const schemeName = database?.colorSchemeName ?? 'default';
    return PRESET_SCHEMES[schemeName] ?? PRESET_SCHEMES['default'];
  }
}
