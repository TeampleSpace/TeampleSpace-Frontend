import ReactMarkdown from 'react-markdown'
import { ExternalLink } from './ExternalLink.tsx'
import styles from './Materials.module.css'

// 원시 HTML은 그리지 않는다. 링크는 새 탭에서 열고 그 사실을 알린다
export default function Markdown({ children }: { children: string }) {
  return <div className={styles.markdown}>
    <ReactMarkdown components={{ a: ({ href, title, children }) => <ExternalLink href={href ?? ''} title={title}>{children}</ExternalLink> }}>
      {children}
    </ReactMarkdown>
  </div>
}
