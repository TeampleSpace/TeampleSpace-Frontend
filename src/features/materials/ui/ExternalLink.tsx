import type { ReactNode } from 'react'
import styles from './Links.module.css'

// 새 탭으로 여는 링크. 글자만 들어도 새 탭에서 열린다는 것을 알 수 있게 숨은 안내를 붙인다
export function ExternalLink({ href, title, className, children }: { href: string; title?: string; className?: string; children: ReactNode }) {
  return <a href={href} title={title} className={className} target="_blank" rel="noopener noreferrer">
    {children}<span className={styles.hidden}> (새 탭에서 열림)</span>
  </a>
}

// 링크 자료의 원본 링크. 주소 대신 어느 사이트의 원본을 여는지 글자로 알린다
export function SourceLink({ url }: { url: string }) {
  let host = url
  try { host = new URL(url).host || url } catch { /* 주소 그대로 쓴다 */ }
  return <ExternalLink href={url}>{host} 원본 페이지 열기</ExternalLink>
}
