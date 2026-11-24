const previewPaths = /^\/(?:account\/subscription(?:\/manage|\/preview\/(?:complete|interrupted))?|billing\/return)\/?$/
// 운영 빌드는 요금 안내 화면만 연다
const openPaths = /^\/account\/subscription\/?$/
const previewReturnKey = 'teamplespace.billing-preview.return'
const previewReturnLifetimeMs = 300_000

export function billingPreviewPath(pathname: string) {
  if (!(import.meta.env.DEV ? previewPaths : openPaths).test(pathname)) return undefined
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

export function setBillingPreviewReturn(returnTo?: string) {
  try {
    const path = billingPreviewPath(returnTo ?? '')
    if (path) sessionStorage.setItem(previewReturnKey, JSON.stringify({ path, expiresAt: Date.now() + previewReturnLifetimeMs }))
    else sessionStorage.removeItem(previewReturnKey)
  } catch {
    // 저장소를 사용할 수 없으면 계정으로 돌아간다
  }
}

export function takeBillingPreviewReturn() {
  try {
    const stored = sessionStorage.getItem(previewReturnKey)
    sessionStorage.removeItem(previewReturnKey)
    if (!stored) return undefined
    const { path, expiresAt } = JSON.parse(stored)
    if (typeof path === 'string' && typeof expiresAt === 'number' && expiresAt > Date.now()) {
      return billingPreviewPath(path)
    }
  } catch {
    return undefined
  }
}
