import ReactMarkdown from 'react-markdown'
import styles from './Materials.module.css'

// 원시 HTML은 그리지 않는다. 링크는 새 창에서 연다
export default function Markdown({ children }: { children: string }) {
  return <div className={styles.markdown}>
    <ReactMarkdown components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
      {children}
    </ReactMarkdown>
  </div>
}
