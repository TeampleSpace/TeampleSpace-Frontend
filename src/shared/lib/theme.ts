export type Theme = 'system' | 'light' | 'dark'

// 고른 테마는 브라우저에 저장하고 index.html 스크립트가 첫 화면 전에 다시 적용한다
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch { return 'system' }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    if (theme === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', theme)
  } catch { /* 저장할 수 없으면 이번 화면에만 적용한다 */ }
}
