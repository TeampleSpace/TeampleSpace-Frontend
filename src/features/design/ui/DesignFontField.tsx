import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { fontsApi, validateFontFile } from '../fontsApi.ts'
import type { ProjectFont } from '../fontsApi.ts'
import styles from './DesignFontField.module.css'

const emptyFonts: ProjectFont[] = []

type FontSelection = { font: string; fontAssetId?: string }

type Props = FontSelection & {
  projectId: string
  uploadsEnabled: boolean
  fonts: string[]
  fieldId: string
  error?: string
  disabled?: boolean
  uploading: boolean
  onUploadingChange: (uploading: boolean) => void
  onChange: (selection: FontSelection) => void
  onPreviewChange: (family?: string) => void
  onError?: (error: unknown) => void
}

export function DesignFontField({ projectId, uploadsEnabled, fonts, font, fontAssetId, fieldId, error, disabled,
  uploading, onUploadingChange, onChange, onPreviewChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<AbortController | null>(null)
  const [catalog, setCatalog] = useState<{ projectId: string; items: ProjectFont[]; reload: number }>()
  const [reload, setReload] = useState(0)
  const [listError, setListError] = useState<unknown>()
  const [uploadError, setUploadError] = useState<unknown>()
  const [validation, setValidation] = useState<string>()
  const [previewErrorFor, setPreviewErrorFor] = useState<string>()
  const items = uploadsEnabled && catalog?.projectId === projectId ? catalog.items : emptyFonts
  const selected = items.find((item) => item.id === fontAssetId)
  const loadingFonts = uploadsEnabled && catalog?.projectId !== projectId && !listError
  const uploadValue = fontAssetId ? `upload:${fontAssetId}` : undefined
  const notifyPreview = useEffectEvent((family?: string) => onPreviewChange(family))
  const reportError = useEffectEvent((reason: unknown) => onError?.(reason))
  const hasCurrentFonts = useEffectEvent(() => catalog?.projectId === projectId && catalog.reload === reload
    && (!fontAssetId || selected !== undefined))

  useEffect(() => {
    if (!uploadsEnabled || hasCurrentFonts()) return
    const controller = new AbortController()
    void fontsApi.list(projectId, controller.signal).then(({ items }) => {
      if (!controller.signal.aborted) {
        setCatalog({ projectId, items, reload })
        setListError(undefined)
      }
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setListError(reason)
        reportError(reason)
      }
    })
    return () => controller.abort()
  }, [projectId, reload, uploadsEnabled, fontAssetId])

  useEffect(() => () => uploadRef.current?.abort(), [projectId, uploadsEnabled])

  useEffect(() => {
    notifyPreview(undefined)
    if (!selected || !uploadsEnabled) return
    const controller = new AbortController()
    let loaded: FontFace | undefined
    const family = `ProjectFont-${selected.id}`
    void fontsApi.content(projectId, selected, controller.signal).then(async (bytes) => {
      if (controller.signal.aborted) return
      const face = await new FontFace(family, bytes).load()
      if (controller.signal.aborted) return
      document.fonts.add(face)
      loaded = face
      setPreviewErrorFor(undefined)
      notifyPreview(family)
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setPreviewErrorFor(selected.id)
        reportError(reason)
      }
    })
    return () => {
      controller.abort()
      if (loaded) document.fonts.delete(loaded)
      notifyPreview(undefined)
    }
  }, [projectId, selected, uploadsEnabled])

  async function upload(file: File) {
    if (uploadRef.current || disabled || !uploadsEnabled) return
    const validation = validateFontFile(file)
    setValidation(validation)
    setUploadError(undefined)
    if (validation) return

    const controller = new AbortController()
    uploadRef.current = controller
    onUploadingChange(true)
    try {
      const added = await fontsApi.upload(projectId, file, controller.signal)
      if (controller.signal.aborted) return
      setCatalog((previous) => {
        const previousItems = previous?.projectId === projectId ? previous.items : emptyFonts
        return { projectId, items: [added, ...previousItems.filter((item) => item.id !== added.id)], reload }
      })
      onChange({ font, fontAssetId: added.id })
    } catch (reason) {
      if (!controller.signal.aborted) {
        setUploadError(reason)
        onError?.(reason)
      }
    } finally {
      if (uploadRef.current === controller) {
        uploadRef.current = null
        onUploadingChange(false)
      }
    }
  }

  function choose(value: string) {
    const uploaded = items.find((item) => value === `upload:${item.id}`)
    onChange(uploaded ? { font, fontAssetId: uploaded.id } : { font: value })
  }

  return <div className={styles.field}>
    <label htmlFor={fieldId}>폰트</label>
    <select id={fieldId} value={uploadValue ?? font} disabled={disabled || uploading}
      aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined}
      onChange={(event) => choose(event.target.value)}>
      {!fonts.includes(font) && <option value={font} disabled>{font || '사용 가능한 글꼴 없음'}</option>}
      <optgroup label="기본 글꼴">
        {fonts.map((name) => <option key={name} value={name}>{name}</option>)}
      </optgroup>
      {uploadValue && !selected && <option value={uploadValue} disabled>{loadingFonts ? '저장된 글꼴 불러오는 중' : '저장된 프로젝트 글꼴'}</option>}
      {!!items.length && <optgroup label="프로젝트 글꼴">
        {items.map((item) => <option key={item.id} value={`upload:${item.id}`}>{item.fileName}</option>)}
      </optgroup>}
    </select>
    {error && <p className={styles.error} id={`${fieldId}-error`}>{error}</p>}
    {uploadsEnabled && <>
      <div className={styles.actions}>
        <input ref={inputRef} type="file" accept=".ttf,.otf" aria-label="글꼴 파일 선택" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }} />
        <Button variant="secondary" loading={uploading} disabled={disabled || loadingFonts}
          onClick={() => inputRef.current?.click()}>글꼴 업로드</Button>
        <p className={styles.hint}>TTF, OTF 파일 5MB 이하</p>
      </div>
      {validation && <p role="alert" className={styles.error}>{validation}</p>}
      <RequestError error={uploadError} />
      <RequestError error={listError} action={<Button variant="text" disabled={disabled || uploading}
        onClick={() => { setListError(undefined); setReload((value) => value + 1) }}>글꼴 목록 다시 불러오기</Button>} />
      {selected && previewErrorFor === selected.id && <p role="status" className={styles.hint}>미리보기에 글꼴을 불러오지 못했어요. 기본 글꼴을 표시합니다.</p>}
    </>}
  </div>
}
