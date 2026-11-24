// Inline SVG ornaments: filigree corners, dividers, cartouche and frames.

export const CORNER = `<svg class="corner" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
<path stroke-width="1.8" d="M3 62 V11 Q3 3 11 3 H62"/>
<path stroke-width="1" d="M9 62 V17 Q9 9 17 9 H62"/>
<path stroke-width="1.4" d="M15 15 C27 13 33 22 27 29 C22 34 15 29 20 24 C22 22 25 23 25 26"/>
<path stroke-width="1.4" d="M15 15 C13 27 22 33 29 27 C34 22 29 15 24 20 C22 22 23 25 26 25"/>
<path stroke-width="1.1" d="M31 9 C35 16 41 17 47 13 C51 10 55 11 57 14"/>
<path stroke-width="1.1" d="M9 31 C16 35 17 41 13 47 C10 51 11 55 14 57"/>
<path fill="currentColor" stroke="none" d="M34 30 Q43 29 48 21 Q40 23 34 30 Z M30 34 Q29 43 21 48 Q23 40 30 34 Z"/>
<circle cx="15" cy="15" r="2.6" fill="currentColor" stroke="none"/>
<circle cx="57" cy="14" r="1.6" fill="currentColor" stroke="none"/><circle cx="14" cy="57" r="1.6" fill="currentColor" stroke="none"/>
</g></svg>`;

export function framed(inner = '', cls = '') {
  return `<div class="frame ${cls}"><span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span><div class="frame-inner">${inner}</div></div>`;
}

export const DIVIDER = `<div class="divider" role="presentation"><svg viewBox="0 0 400 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-linecap="round">
<path stroke-width="1.2" d="M10 12 H160 M240 12 H390"/>
<path stroke-width="0.8" d="M40 16 H150 M250 16 H360"/>
<path stroke-width="1.3" d="M160 12 C170 2 182 4 182 12 C182 18 174 18 174 13 M240 12 C230 2 218 4 218 12 C218 18 226 18 226 13"/>
<path stroke-width="1.3" d="M160 12 C170 22 182 20 186 14 M240 12 C230 22 218 20 214 14"/>
<path fill="currentColor" stroke="none" d="M200 3 L208 12 L200 21 L192 12 Z"/>
<circle cx="200" cy="12" r="2.2" fill="var(--bg-1)" stroke="none"/>
<circle cx="10" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="390" cy="12" r="2" fill="currentColor" stroke="none"/>
</g></svg></div>`;

export const CARTOUCHE_BG = `<svg class="cartouche-bg" viewBox="0 0 460 96" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<path d="M40 6 H420 Q430 6 434 16 Q440 30 454 30 V66 Q440 66 434 80 Q430 90 420 90 H40 Q30 90 26 80 Q20 66 6 66 V30 Q20 30 26 16 Q30 6 40 6 Z" fill="var(--cartouche-fill)" stroke="var(--gold)" stroke-width="2.4"/>
<path d="M46 13 H414 Q422 13 426 22 Q431 35 446 37 V59 Q431 61 426 74 Q422 83 414 83 H46 Q38 83 34 74 Q29 61 14 59 V37 Q29 35 34 22 Q38 13 46 13 Z" fill="none" stroke="var(--gold)" stroke-width="1"/>
<g fill="var(--gold)"><path d="M6 48 L16 42 L16 54 Z"/><path d="M454 48 L444 42 L444 54 Z"/><circle cx="230" cy="8" r="3"/><circle cx="230" cy="88" r="3"/></g>
</svg>`;

export const CROWN_EMBLEM = `<svg class="emblem" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
<path d="M10 34 L6 14 L17 24 L24 8 L31 24 L42 14 L38 34 Z" fill="currentColor" fill-opacity=".25"/><path d="M10 40 H38"/><circle cx="24" cy="6" r="2" fill="currentColor"/></g></svg>`;

// Small line icons used on buttons. All decorative; buttons carry text labels.
const I = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICONS = {
  flip: I('M7 4 V18 M7 18 L4 15 M7 18 L10 15 M17 20 V6 M17 6 L14 9 M17 6 L20 9'),
  redo: I('M15 7 L20 12 L15 17 M20 12 H9 A5 5 0 0 0 9 22'),
  undo: I('M9 7 L4 12 L9 17 M4 12 H15 A5 5 0 0 1 15 22'),
  hint: I('M9 18 H15 M10 21 H14 M12 3 A6 6 0 0 1 16 13.5 V16 H8 V13.5 A6 6 0 0 1 12 3 Z'),
  flag: I('M5 21 V4 M5 4 H17 L14 8 L17 12 H5'),
  handshake: I('M3 12 L7 8 L11 10 L14 7 L21 12 M7 14 L10 17 M10 13 L13 16 M13 12 L16 15'),
  save: I('M5 3 H16 L20 7 V21 H4 V3 Z M8 3 V8 H15 V3 M8 21 V14 H16 V21'),
  first: I('M6 5 V19 M18 5 L10 12 L18 19'),
  prev: I('M15 5 L8 12 L15 19'),
  next: I('M9 5 L16 12 L9 19'),
  last: I('M18 5 V19 M6 5 L14 12 L6 19'),
  play: I('M7 4 L19 12 L7 20 Z'),
  trash: I('M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 21 H17 L18 7'),
  pen: I('M4 20 L5 15 L16 4 L20 8 L9 19 Z'),
  copy: I('M8 8 H20 V20 H8 Z M4 16 V4 H16'),
  download: I('M12 3 V15 M7 10 L12 15 L17 10 M4 20 H20'),
  upload: I('M12 15 V3 M7 8 L12 3 L17 8 M4 20 H20'),
  retry: I('M4 12 A8 8 0 1 0 7 6 M4 3 V8 H9'),
  menu: I('M4 7 H20 M4 12 H20 M4 17 H20'),
  close: I('M6 6 L18 18 M18 6 L6 18'),
  stop: I('M6 6 H18 V18 H6 Z'),
  // Time-control paces. Gold comes from currentColor, the same as the other button icons.
  bullet: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1.8 9.2 H4.2 M1.8 12 H5 M1.8 14.8 H4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6.3 7.3 H12.2 L21.2 12 L12.2 16.7 H6.3 Z" fill="currentColor"/></svg>`,
  blitz: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 1.8 L5.6 13 H10.8 L8.2 22.2 L19.6 9.2 H14 L16.2 1.8 Z" fill="currentColor" fill-opacity=".9" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  rapid: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.2" r="7" fill="currentColor" fill-opacity=".14"/><path d="M12 13.2 V8.2 M12 13.2 L15.7 15.4 M9.2 3.1 H14.8 M12 3.1 V6.2"/></g></svg>`,
};
