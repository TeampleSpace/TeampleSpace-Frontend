import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DesignTemplate } from './api.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { DesignPreview } from './DesignPreview.tsx'
import styles from './TemplateGallery.module.css'

const purposes: Record<string, string> = {
  'clean-report': '보고서', 'blue-focus': '수업 발표', editorial: '세미나',
  'pitch-dark': '제안서', 'warm-story': '수업 발표', 'grid-analysis': '보고서', 'bold-cover': '제안서',
  'orange-pitch': '제안서', 'green-insight': '보고서', 'mono-editorial': '세미나', 'lilac-studio': '제안서',
  'data-briefing': '보고서', 'warm-seminar': '세미나', 'team-story': '수업 발표',
}
const categories = ['전체', '보고서', '제안서', '수업 발표', '세미나']

export function TemplateGallery({ items, selected, disabled, projectName, modes, onSelect, onDetail }: {
  items: DesignTemplate[]
  selected?: DesignTemplate
  disabled: boolean
  projectName?: string
  modes: ReactNode
  onSelect: (item: DesignTemplate) => void
  onDetail: (item: DesignTemplate) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('전체')
  const term = query.trim().toLocaleLowerCase()
  const visible = items.filter((item) => (category === '전체' || purposes[item.key] === category)
    && `${item.name} ${purposes[item.key] ?? ''} ${item.preview.description}`.toLocaleLowerCase().includes(term))

  return <section className={styles.gallery} aria-label="템플릿 갤러리">
    <div className={styles.toolbar}>
      {modes}
      <input className={styles.search} type="search" aria-label="템플릿 검색" placeholder="템플릿 이름, 용도로 검색"
        value={query} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} />
    </div>
    <div className={styles.filters}>
      <div className={styles.categories} role="group" aria-label="템플릿 용도">
        {categories.map((name) => <button key={name} type="button" aria-pressed={category === name}
          onClick={() => setCategory(name)}>{name}</button>)}
      </div>
      <p role="status">{query || category !== '전체' ? '검색 결과' : '전체'} {visible.length}개</p>
    </div>
    <div className={styles.grid}>
      {visible.map((item) => {
        const active = selected?.id === item.id && selected.version === item.version
        return <button key={`${item.id}:${item.version}`} type="button" className={styles.card} aria-pressed={active}
          aria-label={`${item.name} ${active ? '선택됨' : '선택'}`} disabled={disabled} onClick={() => onSelect(item)}>
          <DesignPreview preview={{ ...item.preview, font: item.fonts[0], templateKey: item.key }} projectName={projectName} variant="thumbnail" />
          <span className={styles.name}>{item.name}{active && <span className={styles.selected}>선택됨</span>}</span>
          <span className={styles.caption}>{purposes[item.key] ?? item.preview.description} / 16:9</span>
        </button>
      })}
    </div>
    {!!items.length && !visible.length && <div className={styles.empty}>
      <p>조건에 맞는 템플릿이 없어요.</p>
      <Button variant="text" onClick={() => { setQuery(''); setCategory('전체') }}>검색과 분류 초기화</Button>
    </div>}
    <div className={styles.selection}>
      <p><span>선택한 템플릿</span> <strong>{selected?.name ?? '템플릿을 선택해 주세요'}</strong></p>
      {selected && <Button variant="secondary" onClick={() => onDetail(selected)}>템플릿 자세히 보기</Button>}
    </div>
  </section>
}
