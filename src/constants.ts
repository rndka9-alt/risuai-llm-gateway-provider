import type { ThemeColors } from './types';

// getColorScheme()이 없는 RisuAI 버전에서도 현재 프리셋과 같은 색을 사용한다.
export const PRESET_SCHEMES: Record<string, ThemeColors> = {
  'default':       { bgcolor: '#282a36', darkbg: '#21222c', borderc: '#6272a4', selected: '#44475a', textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151' },
  'dark':          { bgcolor: '#1a1a1a', darkbg: '#141414', borderc: '#525252', selected: '#3d3d3d', textcolor: '#f5f5f5', textcolor2: '#a3a3a3', darkBorderc: '#404040', darkbutton: '#2e2e2e' },
  'light':         { bgcolor: '#ffffff', darkbg: '#f0f0f0', borderc: '#0f172a', selected: '#e0e0e0', textcolor: '#0f172a', textcolor2: '#64748b', darkBorderc: '#d1d5db', darkbutton: '#e5e7eb' },
  'cherry':        { bgcolor: '#450a0a', darkbg: '#7f1d1d', borderc: '#ea580c', selected: '#d97706', textcolor: '#f8f8f2', textcolor2: '#fca5a5', darkBorderc: '#92400e', darkbutton: '#b45309' },
  'galaxy':        { bgcolor: '#0f172a', darkbg: '#1f2a48', borderc: '#8be9fd', selected: '#457b9d', textcolor: '#f8f8f2', textcolor2: '#8be9fd', darkBorderc: '#457b9d', darkbutton: '#1f2a48' },
  'nature':        { bgcolor: '#1b4332', darkbg: '#2d6a4f', borderc: '#a8dadc', selected: '#4d908e', textcolor: '#f8f8f2', textcolor2: '#4d908e', darkBorderc: '#457b9d', darkbutton: '#2d6a4f' },
  'realblack':     { bgcolor: '#000000', darkbg: '#000000', borderc: '#6272a4', selected: '#44475a', textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151' },
  'monokai-light': { bgcolor: '#f8f8f2', darkbg: '#e8e8e3', borderc: '#75715e', selected: '#d8d8d0', textcolor: '#272822', textcolor2: '#75715e', darkBorderc: '#c0c0b8', darkbutton: '#d0d0c8' },
  'monokai-black': { bgcolor: '#272822', darkbg: '#1e1f1a', borderc: '#75715e', selected: '#3e3d32', textcolor: '#f8f8f2', textcolor2: '#a6a68a', darkBorderc: '#3e3d32', darkbutton: '#3e3d32' },
  'lite':          { bgcolor: '#1f2937', darkbg: '#1c2533', borderc: '#475569', selected: '#475569', textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#030712', darkbutton: '#374151' },
};

export const STYLES = [
  '*, *::before, *::after { box-sizing:border-box; }',
  'html { background:transparent; }',
  'body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.55); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }',
  '#app { width:min(100%,420px); padding:20px; border:1px solid var(--border2); border-radius:12px; background:var(--background2); box-shadow:0 16px 48px rgba(0,0,0,.4); }',
  'form { display:flex; flex-direction:column; gap:14px; }',
  'input, select { width:100%; padding:11px 12px; border:1px solid var(--border); border-radius:7px; outline:none; background:var(--background); color:var(--text); font:inherit; }',
  'input:focus, select:focus { border-color:var(--accent); box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 35%,transparent); }',
  '.ledger { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:.85em; color:var(--text2); }',
  '.ledger button { min-width:0; padding:6px 10px; }',
  '.actions { display:flex; justify-content:flex-end; gap:8px; }',
  'button { min-width:72px; padding:8px 14px; border:1px solid var(--border2); border-radius:7px; background:var(--button); color:var(--text); font:inherit; cursor:pointer; }',
  'button:hover:not(:disabled) { border-color:var(--border); }',
  'button:disabled { cursor:wait; opacity:.7; }',
  '#save { background:var(--accent); border-color:var(--accent); color:var(--accent-text); }',
].join('\n');
