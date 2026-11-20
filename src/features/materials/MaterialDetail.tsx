import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { formatBytes, jobErrorMessages, kindLine, statusLabels } from './model.ts'
import type { Material } from './model.ts'
import styles from './Materials.module.css'

export type ManageAction = 'rename' | 'delete'

// 선택한 자료의 상세. 처리 상태에 따라 본문 자리를 바꾼다
export function MaterialDetail({ material, retrying, retryError, onRetry, onManage, actions, extraMenu, jobControls, summary, children }: {
  material: Material; retrying: boolean; retryError: unknown
  onRetry: () => void; onManage: (action: ManageAction) => void
  // 제목 옆에 두는 동작과 관리 메뉴에 더하는 항목
  actions?: ReactNode; extraMenu?: (close: () => void) => ReactNode; jobControls?: ReactNode; summary?: ReactNode; children?: ReactNode
}) {
  const revision = material.currentRevision
  const source = material.source
  const error = material.job?.error
  return <>
    <header className={styles.detailHeader}>
      <div className={styles.titleRow}>
        <h2 className="motion-feedback" key={material.id}>{material.title}</h2>
        {actions}
        <ManageMenu material={material} onManage={onManage} extra={extraMenu} />
      </div>
      <p className={styles.meta}>
        <span>{kindLine(material)} · {material.createdBy.name} 님이 추가{revision && revision.sourceVersion > 1 ? ` · 개정 ${revision.sourceVersion}` : ''}</span>
        <span className={material.status === 'failed' ? styles.failed : styles.status}>{statusLabels[material.status]}</span>
      </p>
    </header>

    {(source.url || source.fileName || material.description) && <div className={styles.origin}>
      {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>}
      {source.fileName && <p>{source.fileName}{source.sizeBytes ? ` · ${formatBytes(source.sizeBytes)}` : ''}</p>}
      {material.description && <p>{material.description}</p>}
    </div>}

    {material.status === 'processing' && (material.job && jobControls
      ? jobControls
      : <p className={styles.jobFallback} role="status">분석 상태를 확인하고 있어요.</p>)}

    {material.status === 'failed' && <div className={styles.state}>
      <p>자료를 분석하지 못했어요</p>
      <p className={styles.stateMessage} role="alert">{material.job?.status === 'canceled' ? '분석을 취소했어요' : jobErrorMessages[error?.code ?? ''] ?? error?.message ?? '분석 중 문제가 생겼어요'}</p>
      <p className={styles.stateMessage}>{material.kind === 'file' ? '올린 파일은 그대로 있어요. 다시 분석할 수 있어요.' : '입력한 주소와 설명은 그대로 있어요.'}</p>
      <RequestError error={retryError} />
      <div className={styles.actions}>
        {error?.retryable === false && material.job?.status !== 'canceled'
          ? <p>다시 시도해도 같은 결과가 나와요. 자료를 삭제하고 다른 자료로 추가해 주세요</p>
          : <Button loading={retrying} onClick={onRetry}>다시 시도</Button>}
      </div>
    </div>}

    {summary}
    {children}
  </>
}

// 자료 관리 메뉴. Esc와 바깥 포커스로 닫고 닫으면 버튼으로 돌아간다
function ManageMenu({ material, onManage, extra }: {
  material: Material; onManage: (action: ManageAction) => void; extra?: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const reasonId = useId()
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const close = () => setOpen(false)
  const pick = (action: ManageAction) => { close(); onManage(action) }
  return <div className={styles.menu} ref={root}
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return
      event.stopPropagation(); close()
      root.current?.querySelector<HTMLElement>('button')?.focus()
    }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}>
    <Button variant="text" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>자료 관리</Button>
    {open && <div id={menuId} role="menu" className={styles.menuList}>
      {extra?.(close)}
      <Button variant="text" role="menuitem" onClick={() => pick('rename')}>이름 변경</Button>
      <Button variant="text" role="menuitem" className={styles.dangerText} aria-describedby={material.canDelete ? undefined : reasonId}
        disabled={!material.canDelete} onClick={() => pick('delete')}>삭제</Button>
      {!material.canDelete && <p id={reasonId}>소유자와 자료를 추가한 사람만 삭제할 수 있어요</p>}
    </div>}
  </div>
}
