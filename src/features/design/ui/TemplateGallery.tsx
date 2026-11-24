import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DesignTemplate } from '../api.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { DesignPreview } from './DesignPreview.tsx'
import { TemplateCover } from './TemplateCover.tsx'
import { StudioPreview } from './StudioPreview.tsx'
import { studioPreview } from './studioPreviews.ts'
import { templateCovers, templatePurposes as purposes } from './templateCovers.ts'
import styles from './TemplateGallery.module.css'

const categories = ['전체', '보고서', '제안서', '수업 발표', '세미나']

// 카드를 누르면 바로 그 템플릿으로 바꾸고, 미리보기 버튼으로 자세히 본다
export function TemplateGallery({ items, selected, disabled, projectName, modes, action, onSelect, onDetail }: {
  items: DesignTemplate[]
  selected?: DesignTemplate
  disabled: boolean
  projectName?: string
  modes: ReactNode
  action: ReactNode
  onSelect: (item: DesignTemplate) => void
  onDetail: (item: DesignTemplate) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('전체')
  const term = query.trim().toLocaleLowerCase()
  // 아는 템플릿은 정해 둔 순서로, 모르는 템플릿은 서버가 준 순서로 뒤에 둔다
  const order = Object.keys(purposes)
  const rank = (item: DesignTemplate) => { const index = order.indexOf(item.key); return index < 0 ? order.length : index }
  const visible = items.filter((item) => (category === '전체' || purposes[item.key] === category)
    && `${item.name} ${purposes[item.key] ?? ''} ${item.preview.description}`.toLocaleLowerCase().includes(term))
    .sort((left, right) => rank(left) - rank(right))

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
        const studioCover = studioPreview(item.key)?.[0]
        return <div key={`${item.id}:${item.version}`} className={styles.item}>
          <button type="button" className={styles.card} aria-pressed={active}
            aria-label={`${item.name} ${active ? '선택됨' : '선택'}`} disabled={disabled} onClick={() => onSelect(item)}>
            {studioCover ? <StudioPreview slide={studioCover.document} />
              : templateCovers[item.key] ? <TemplateCover templateKey={item.key} />
              : <DesignPreview preview={{ ...item.preview, font: item.fonts[0], templateKey: item.key }} projectName={projectName} variant="thumbnail" />}
            <span className={styles.name}>{item.name}{active && <span className={styles.selected}>선택됨</span>}</span>
            <span className={styles.caption}>{purposes[item.key] ?? item.preview.description} / 16:9</span>
          </button>
          <button type="button" className={styles.previewButton} aria-label={`${item.name} 미리보기`}
            onClick={() => onDetail(item)}>미리보기</button>
        </div>
      })}
    </div>
    {!!items.length && !visible.length && <div className={styles.empty}>
      <p>조건에 맞는 템플릿이 없어요.</p>
      <Button variant="text" onClick={() => { setQuery(''); setCategory('전체') }}>검색과 분류 초기화</Button>
    </div>}
    <div className={styles.selection}>
      <p><span>선택한 템플릿</span> <strong key={selected?.id ?? 'none'}>{selected?.name ?? '템플릿을 선택해 주세요'}</strong></p>
      {action}
    </div>
  </section>
}
