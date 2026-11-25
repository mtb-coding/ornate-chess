// Apply the saved theme before first paint to avoid a flash of the default theme.
try {
  const saved = JSON.parse(localStorage.getItem('ornate-chess:settings') || '{}');
  if (saved.theme) document.documentElement.dataset.theme = saved.theme;
  if (saved.boardStyle) document.documentElement.dataset.boardStyle = saved.boardStyle;
} catch { /* Storage can be blocked. The default theme remains. */ }
