import type { ITheme } from '@xterm/xterm';

/** Matches `.dark` in globals.css */
export const XTERM_THEME_DARK: ITheme = {
  background: '#111110',
  foreground: '#cdccca',
  cursor: '#4f98a3',
  cursorAccent: '#111110',
  selectionBackground: 'rgba(79, 152, 163, 0.3)',
  black: '#1a1918',
  red: '#d163a7',
  green: '#6daa45',
  yellow: '#bb653b',
  blue: '#4f98a3',
  magenta: '#a86fdf',
  cyan: '#4f98a3',
  white: '#cdccca',
  brightBlack: '#5a5957',
  brightRed: '#d163a7',
  brightGreen: '#6daa45',
  brightYellow: '#bb653b',
  brightBlue: '#5591c7',
  brightMagenta: '#a86fdf',
  brightCyan: '#4f98a3',
  brightWhite: '#f7f6f2',
};

/**
 * Light UI theme. Tuned for ncurses/TUI: ANSI “white” must stay light so text
 * stays readable on blue/cyan/magenta backgrounds (htop, apt, dialog, etc.).
 * Default text still uses `foreground` on `background`, not color 37 on default bg.
 */
export const XTERM_THEME_LIGHT: ITheme = {
  background: '#f7f6f2',
  foreground: '#1c1b17',
  cursor: '#01696f',
  cursorAccent: '#f7f6f2',
  selectionBackground: 'rgba(1, 105, 111, 0.22)',
  black: '#1a1814',
  red: '#9a1f4a',
  green: '#2f6510',
  yellow: '#8b4510',
  /** Dark enough for light labels on top (ncurses status bars) */
  blue: '#0a4a5c',
  magenta: '#5a2870',
  cyan: '#0a5559',
  /** Light fg for use on saturated ANSI backgrounds */
  white: '#f3f2ec',
  brightBlack: '#4a4944',
  brightRed: '#b0285c',
  brightGreen: '#3a7f14',
  brightYellow: '#a85612',
  brightBlue: '#0b5f73',
  brightMagenta: '#6b3285',
  brightCyan: '#0c6d72',
  brightWhite: '#ffffff',
};
