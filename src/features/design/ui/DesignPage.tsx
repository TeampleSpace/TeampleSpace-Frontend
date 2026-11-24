import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, TransportError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { UnsavedGuard } from '../../../shared/ui/UnsavedGuard.tsx'
import { designApi, designColor } from '../api.ts'
import { needsApproval, requestsApi, useRequestApproved } from '../../../entities/request/api.ts'
import { DesignFontField } from './DesignFontField.tsx'
import type { CustomDesign, DesignCatalog, DesignInput, DesignSettings, DesignTemplate, TemplateSelection } from '../api.ts'
import { DesignPreview } from './DesignPreview.tsx'
import { TemplateCover } from './TemplateCover.tsx'
import { templateCovers, templatePurposes as purposes } from './templateCovers.ts'
import { TemplateGallery } from './TemplateGallery.tsx'
import { StudioPreview } from './StudioPreview.tsx'
import { studioPreview } from './studioPreviews.ts'
import type { PreviewStyle, SlideExample } from './DesignPreview.tsx'
import styles from './DesignPage.module.css'

type Mode = 'template' | 'custom'
type Drafts = { template: TemplateSelection | null; custom: CustomDesign }
type PageData = { settings: DesignSettings; catalog: DesignCatalog }
type InputField = Exclude<keyof CustomDesign, 'fontAssetId'> | 'template'
type InputErrors = Partial<Record<InputField, string>>
// request는 팀원 승인을 받아 저장하는지다. 정하기 전이면 비워 둔다
type SaveAttempt = { body: DesignInput; key: string; request?: boolean }
type AccessError = (reason: unknown) => void

const fields = { name: '템플릿 이름', font: '폰트', primaryColor: '대표 색상', guidelines: '디자인 지침', template: '템플릿' }
const layoutNames: Record<string, string> = {
  title: '제목', agenda: '목차', content: '본문', compare: '비교', chart: '차트', summary: '요약',
}
const defaultPreview: PreviewStyle = { backgroundColor: '#FFFFFF', headingColor: '#20242D' }
const defaultCustomColor = '#2864E8'
const palette = [
  { name: '블루', color: defaultCustomColor }, { name: '네이비', color: '#2F4D8E' },
  { name: '포레스트', color: '#34705C' }, { name: '테라코타', color: '#B35439' },
  { name: '플럼', color: '#835379' }, { name: '차콜', color: '#363C46' },
]
const same = (left: object | null, right: object | null) => JSON.stringify(left) === JSON.stringify(right)
const modeOf = ({ mode }: DesignSettings): Mode => mode === 'custom' ? mode : 'template'
const selectionOf = ({ id, version }: DesignTemplate): TemplateSelection => ({ templateId: id, templateVersion: version })
const previewOf = (template: DesignTemplate): PreviewStyle => ({
  ...template.preview, font: template.fonts[0], templateKey: template.key,
})

function makeDrafts(settings: DesignSettings, catalog: DesignCatalog): Drafts {
  return {
    template: settings.mode === 'template' ? { templateId: settings.templateId, templateVersion: settings.templateVersion } : null,
    custom: settings.custom ?? { name: '', font: catalog.allowedFonts[0] ?? '', primaryColor: defaultCustomColor, guidelines: '' },
  }
}

function validDraft(body: DesignInput, allowedFonts: string[]): InputErrors {
  if (body.mode === 'template') return {}
  const { name, font, primaryColor, guidelines } = body.custom
  const errors: InputErrors = {}
  if (!name || name.length > 80) errors.name = '이름을 1자에서 80자로 입력해 주세요'
  if (!allowedFonts.includes(font)) errors.font = '사용 가능한 글꼴을 선택해 주세요'
  if (!designColor.test(primaryColor)) errors.primaryColor = '색상 코드를 6자리로 입력해 주세요. 예시 #2563EB'
  if (guidelines.length > 2000) errors.guidelines = '디자인 지침은 2000자까지 입력할 수 있어요'
  return errors
}

function responseFields(error: ApiError): InputErrors {
  const errors: InputErrors = {}
  for (const { field, message } of error.fieldErrors) {
    const property = field === 'templateId' || field === 'templateVersion' ? 'template' : field.replace(/^custom\./, '')
    const name = property === 'fontAssetId' ? 'font' : property
    if (name === 'name' || name === 'font' || name === 'primaryColor' || name === 'guidelines' || name === 'template') {
      errors[name] ??= message
    }
  }
  return errors
}

function accessLost(reason: unknown): reason is ApiError {
  return reason instanceof ApiError && (reason.status === 401 || reason.status === 403 || reason.status === 404 || reason.status === 410)
}

export default function DesignPage({ projectId, projectName, fromOutline = false, onAccessError }: {
  projectId: string; projectName?: string; fromOutline?: boolean; onAccessError?: AccessError
}) {
  const back = {
    path: `/projects/${projectId}${fromOutline ? '/outline' : ''}`,
    label: fromOutline ? '발표 구성으로 돌아가기' : '프로젝트 개요로 돌아가기',
  }
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<{ projectId: string; value: PageData }>()
  const [failure, setFailure] = useState<{ projectId: string; reason: unknown }>()
  const error = failure?.projectId === projectId ? failure.reason : undefined

  useEffect(() => {
    const controller = new AbortController()
    const report = (reason: unknown, projectScoped: boolean) => {
      if (controller.signal.aborted) return
      if (accessLost(reason) && (projectScoped || reason.status === 401)) onAccessError?.(reason)
    }
    const settingsRequest = designApi.get(projectId, controller.signal).catch((reason) => { report(reason, true); throw reason })
    const catalogRequest = designApi.catalog(controller.signal).catch((reason) => { report(reason, false); throw reason })
    void Promise.all([settingsRequest, catalogRequest])
      .then(([settings, catalog]) => {
        if (!controller.signal.aborted) setData({ projectId, value: { settings, catalog } })
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setFailure({ projectId, reason })
      })
    return () => controller.abort()
  }, [projectId, revision, onAccessError])

  function retry() {
    setData(undefined)
    setFailure(undefined)
    setRevision((value) => value + 1)
  }

  return <section className={styles.page} aria-labelledby="design-title">
    {projectName && <p className={styles.project}>{projectName}</p>}
    {error ? <>
      <h1 id="design-title">디자인 설정</h1>
      <RequestError error={error} action={<Button onClick={retry}>다시 불러오기</Button>} />
      <Link to={back.path}>{back.label}</Link>
    </> : data?.projectId === projectId ? <DesignSettingsForm key={projectId} {...data.value} projectId={projectId} projectName={projectName} back={back} onAccessError={(reason) => {
      setFailure({ projectId, reason })
      onAccessError?.(reason)
    }} /> : <>
      <h1 id="design-title">디자인 설정</h1>
      <StatusPanel kind="loading" title="디자인 설정을 불러오고 있어요" />
    </>}
  </section>
}

function DesignSettingsForm({ settings, catalog, projectId, projectName, back, onAccessError }: PageData & {
  projectId: string; projectName?: string; back: { path: string; label: string }; onAccessError: AccessError
}) {
  const { items, allowedFonts, projectFontsEnabled = false } = catalog
  const [base, setBase] = useState(settings)
  const [initial, setInitial] = useState(() => makeDrafts(settings, catalog))
  const [drafts, setDrafts] = useState(initial)
  const [mode, setMode] = useState<Mode>(modeOf(settings))
  const [saving, setSaving] = useState(false)
  const [uploadingFont, setUploadingFont] = useState(false)
  const [pending, setPending] = useState<SaveAttempt | null>(null)
  // 저장할 때마다 안내를 새로 보여 준다
  const [saved, setSaved] = useState<{ id: number; text: string }>()
  const [error, setError] = useState<unknown>()
  const [inputErrors, setInputErrors] = useState<InputErrors>({})
  const [invalid, setInvalid] = useState(false)
  const [detail, setDetail] = useState<DesignTemplate | null>(null)
  const [latest, setLatest] = useState<DesignSettings>()
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [latestError, setLatestError] = useState<unknown>()
  const [waitingUntil, setWaitingUntil] = useState(0)
  const [previewFont, setPreviewFont] = useState<string>()
  const formId = useId()
  const operation = useRef<AbortController | null>(null)
  // 입력을 바꿀 때마다 늘린다. 다시 읽는 동안 바뀐 입력을 응답으로 덮어쓰지 않는다
  const edits = useRef(0)
  const fieldToFocus = useRef<InputField | undefined>(undefined)
  const template = items.find((item) => same(selectionOf(item), drafts.template))
  const { custom } = drafts
  const configuredCustom = { ...custom, name: custom.name.trim(), primaryColor: custom.primaryColor.trim().toUpperCase() }
  const hasActiveChange = mode === 'template'
    ? !same(drafts.template, makeDrafts(base, catalog).template)
    : base.mode !== 'custom' || !same(configuredCustom, base.custom)
  const activeSelection = mode === 'template' ? drafts.template !== null : !!configuredCustom.name
  const dirty = !same(drafts, initial) || (hasActiveChange && activeSelection)
  const conflict = error instanceof ApiError && error.code === 'VERSION_CONFLICT'
  const readyToSave = mode === 'template' ? !!template && hasActiveChange : hasActiveChange
  const inputLocked = saving || !!pending
  const modeLocked = inputLocked || uploadingFont
  const customColor = designColor.test(configuredCustom.primaryColor)
    ? configuredCustom.primaryColor
    : base.custom?.primaryColor ?? defaultCustomColor
  const preview = mode === 'template' ? (template ? previewOf(template) : defaultPreview) : {
    ...defaultPreview,
    headingColor: customColor,
    font: previewFont ?? (allowedFonts.includes(custom.font) ? custom.font : undefined),
  }

  useEffect(() => () => operation.current?.abort(), [])
  const reportFontError = useCallback((reason: unknown) => {
    if (accessLost(reason)) onAccessError(reason)
  }, [onAccessError])

  useEffect(() => {
    if (!waitingUntil) return
    const timer = window.setTimeout(() => setWaitingUntil(0), Math.max(0, waitingUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [waitingUntil])

  useEffect(() => {
    if (invalid || !fieldToFocus.current) return
    const field = fieldToFocus.current
    fieldToFocus.current = undefined
    document.getElementById(`${formId}-${field}`)?.focus()
  }, [invalid, formId])

  function chooseMode(value: Mode) {
    edits.current += 1
    setMode(value)
    setInputErrors({})
    setSaved(undefined)
  }

  // 템플릿은 누르면 바로 저장한다. 이미 저장된 템플릿이면 다시 보내지 않는다
  function chooseTemplate(value: DesignTemplate) {
    setDetail(null)
    if (operation.current || uploadingFont || pending || conflict || waitingUntil) return
    const selection = selectionOf(value)
    setDrafts((draft) => ({ ...draft, template: selection }))
    chooseMode('template')
    if (base.mode === 'template' && same(selection, makeDrafts(base, catalog).template)) return
    void save({ expectedVersion: base.version, mode: 'template', ...selection })
  }

  function changeCustom(field: keyof CustomDesign, value: string) {
    edits.current += 1
    setDrafts((draft) => ({ ...draft, custom: { ...draft.custom, [field]: value } }))
    setInputErrors((current) => ({ ...current, [field]: undefined }))
    setSaved(undefined)
  }

  function changeFont({ font, fontAssetId }: Pick<CustomDesign, 'font' | 'fontAssetId'>) {
    edits.current += 1
    setPreviewFont(undefined)
    setDrafts((draft) => ({ ...draft, custom: { ...draft.custom, font, fontAssetId } }))
    setInputErrors((current) => ({ ...current, font: undefined }))
    setSaved(undefined)
  }

  function showInvalid(errors: InputErrors) {
    setInputErrors(errors)
    fieldToFocus.current = (Object.keys(errors) as InputField[])[0]
    setInvalid(true)
  }

  async function save(chosen?: DesignInput) {
    if (operation.current || uploadingFont || (!pending && !chosen && !readyToSave) || conflict || waitingUntil) return
    const body: DesignInput | null = pending?.body ?? chosen ?? (mode === 'template'
      ? drafts.template && { expectedVersion: base.version, mode, ...drafts.template }
      : { expectedVersion: base.version, mode, custom: configuredCustom })
    if (!body) return
    setError(undefined)
    const errors = pending ? {} : validDraft(body, allowedFonts)
    if (Object.keys(errors).length) {
      showInvalid(errors)
      return
    }
    setInputErrors({})
    let attempt: SaveAttempt = pending ?? { body, key: crypto.randomUUID() }
    const controller = new AbortController()
    operation.current = controller
    setSaving(true)
    setSaved(undefined)
    try {
      if (attempt.request === undefined) attempt = { ...attempt, request: await needsApproval(projectId) }
      if (attempt.request) {
        await requestsApi.create(projectId, 'design_change', attempt.body, attempt.key)
        if (controller.signal.aborted) return
        setPending(null)
        // 승인 전까지는 저장된 템플릿을 그대로 보여 준다
        if (attempt.body.mode === 'template') setDrafts((current) => ({ ...current, template: makeDrafts(base, catalog).template }))
        const sent = attempt.body
        const requested = sent.mode === 'template' ? items.find((item) => item.id === sent.templateId)?.name : undefined
        setSaved({ id: Date.now(), text: `${requested ? `${requested} 템플릿으로 ` : '디자인 '}변경을 요청했어요. 다른 팀원 한 명이 승인하면 적용돼요` })
        return
      }
      const updated = await designApi.save(projectId, attempt.body, attempt.key, controller.signal)
      if (controller.signal.aborted) return
      setPending(null)
      const canonical = makeDrafts(updated, catalog)
      const savedMode = attempt.body.mode
      setBase(updated)
      setInitial((current) => ({ ...current, [savedMode]: canonical[savedMode] }))
      setDrafts((current) => ({ ...current, [savedMode]: canonical[savedMode] }))
      const name = updated.mode === 'template' ? items.find((item) => item.id === updated.templateId)?.name : undefined
      setSaved({ id: Date.now(), text: name ? `${name} 템플릿으로 저장했어요` : '디자인을 저장했어요' })
    } catch (reason) {
      if (controller.signal.aborted) return
      // 승인 요청의 REQUEST_IN_PROGRESS는 같은 종류의 요청이 이미 기다린다는 뜻이라 결과가 정해진 것이다
      const uncertain = reason instanceof TransportError || (reason instanceof ApiError && (reason.status >= 500 || (reason.code === 'REQUEST_IN_PROGRESS' && !attempt.request)))
      setPending(uncertain ? attempt : null)
      // 저장하지 못한 템플릿 선택은 저장된 템플릿으로 되돌린다. 충돌은 확인 뒤에 고를 수 있게 남긴다
      if (!uncertain && attempt.body.mode === 'template' && !(reason instanceof ApiError && reason.code === 'VERSION_CONFLICT')) {
        setDrafts((current) => ({ ...current, template: makeDrafts(base, catalog).template }))
      }
      if (accessLost(reason)) {
        onAccessError(reason)
        return
      }
      if (reason instanceof ApiError) {
        if (reason.retryAfterSeconds) setWaitingUntil(Date.now() + reason.retryAfterSeconds * 1000)
        const errors = responseFields(reason)
        if (Object.keys(errors).length) showInvalid(errors)
      }
      setError(reason)
    } finally {
      if (operation.current === controller) operation.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  // 다른 팀원이 디자인 변경을 승인하면 최신 디자인을 다시 읽는다. 승인된 것과 다른 입력이 남아 있으면 저장할 때 충돌로 알린다
  useRequestApproved(projectId, 'design_change', (request) => {
    if (operation.current) return
    const requested = request.payload as DesignInput
    if (dirty && !(requested.mode === 'custom' && mode === 'custom' && same(requested.custom, configuredCustom))) return
    const at = edits.current
    void designApi.get(projectId).then((updated) => {
      if (operation.current || edits.current !== at) return
      const canonical = makeDrafts(updated, catalog)
      setBase(updated)
      setInitial(canonical)
      setDrafts(canonical)
      setMode(modeOf(updated))
      const name = updated.mode === 'template' ? items.find((item) => item.id === updated.templateId)?.name : undefined
      setSaved({ id: Date.now(), text: name ? `${name} 템플릿이 적용됐어요` : '승인된 디자인이 적용됐어요' })
    }).catch(() => {
      // 다음 저장에서 충돌로 최신 디자인을 확인한다
    })
  })

  async function loadLatest() {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setLoadingLatest(true)
    setLatestError(undefined)
    try {
      const updated = await designApi.get(projectId, controller.signal)
      if (!controller.signal.aborted) setLatest(updated)
    } catch (reason) {
      if (controller.signal.aborted) return
      if (accessLost(reason)) onAccessError(reason)
      else setLatestError(reason)
    } finally {
      if (operation.current === controller) operation.current = null
      if (!controller.signal.aborted) setLoadingLatest(false)
    }
  }

  function resolveConflict(keepDraft: boolean) {
    if (!latest || uploadingFont) return
    setBase(latest)
    const canonical = makeDrafts(latest, catalog)
    setInitial(canonical)
    if (keepDraft) {
      setDrafts({
        template: mode === 'template' || !same(drafts.template, initial.template) ? drafts.template : canonical.template,
        custom: mode === 'custom' || !same(drafts.custom, initial.custom) ? drafts.custom : canonical.custom,
      })
    } else {
      setDrafts(canonical)
      setMode(modeOf(latest))
    }
    setError(undefined)
    setLatest(undefined)
  }

  const newestLabel = latest?.mode === 'template'
    ? items.find((item) => item.id === latest.templateId && item.version === latest.templateVersion)?.name ?? '저장된 템플릿'
    : latest?.mode === 'custom' ? `${latest.custom.name}, ${latest.custom.font}, ${latest.custom.primaryColor}` : '선택한 디자인 없음'
  const previewName = mode === 'template' ? template?.name : configuredCustom.name || '직접 입력'
  const modes = <div className={styles.modes} role="group" aria-label="디자인 입력 방식">
    <Button variant={mode === 'template' ? 'secondary' : 'text'} aria-pressed={mode === 'template'} disabled={modeLocked} onClick={() => chooseMode('template')}>템플릿 선택</Button>
    <Button variant={mode === 'custom' ? 'secondary' : 'text'} aria-pressed={mode === 'custom'} disabled={modeLocked} onClick={() => chooseMode('custom')}>직접 입력</Button>
  </div>

  // 템플릿 선택에서는 선택 막대 오른쪽에, 직접 입력에서는 머리글 오른쪽에 둔다
  const saveButton = <Button type="submit" form={formId} loading={saving} disabled={uploadingFont || (!pending && !readyToSave) || conflict || !!waitingUntil}>
    {pending ? '저장 다시 시도' : '디자인 저장'}
  </Button>

  return <>
    <header className={styles.header}>
      <div><h1 id="design-title">디자인 설정</h1><p>{mode === 'template'
        ? '발표에 어울리는 디자인을 고르세요. 템플릿을 누르면 바로 적용돼요.'
        : '글꼴과 색상, 지침을 직접 입력해 발표 디자인을 정하세요.'}</p></div>
      {mode === 'custom' && saveButton}
    </header>
    {saved && <p key={saved.id} className={`${styles.notice} motion-feedback`} role="status">{saved.text}</p>}
    {conflict ? <div className={styles.notice} role="status">
      <p>다른 곳에서 디자인을 저장했어요. 입력한 내용은 그대로 있어요.</p>
      {latest ? <>
        <p>서버의 디자인은 {newestLabel}이에요.</p>
        <div className={styles.actions}>
          <Button variant="secondary" disabled={uploadingFont} onClick={() => resolveConflict(true)}>내 입력 유지하기</Button>
          <Button variant="text" disabled={uploadingFont} onClick={() => resolveConflict(false)}>서버 디자인 사용하기</Button>
        </div>
      </> : <Button variant="secondary" loading={loadingLatest} onClick={() => void loadLatest()}>최신 디자인 확인</Button>}
      <RequestError error={latestError} />
    </div> : <RequestError error={error} action={error && !pending && readyToSave && !Object.values(inputErrors).some(Boolean)
      ? <Button variant="secondary" disabled={uploadingFont || !!waitingUntil} onClick={() => void save()}>저장 다시 시도</Button> : undefined} />}
    {pending && <p className={styles.notice} role="status">저장 결과를 확인하면 디자인을 다시 수정할 수 있어요.</p>}
    <div className={mode === 'template' ? styles.galleryLayout : styles.columns}>
      <form id={formId} className={styles.controls} noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
        {mode === 'custom' && modes}
        {mode === 'template' ? <>
          {drafts.template && !template && <p className={styles.notice}>버전 {drafts.template.templateVersion} 템플릿이 저장되어 있어요. 현재 목록에서 해당 버전을 미리 볼 수 없어요.</p>}
          {!items.length && <p className={styles.notice}>선택할 수 있는 템플릿이 없어요. 직접 입력으로 디자인을 설정할 수 있어요.</p>}
          <div id={`${formId}-template`} tabIndex={-1} role="group" aria-label="템플릿 선택">
            <TemplateGallery items={items} selected={template} disabled={inputLocked || uploadingFont || conflict || !!waitingUntil}
              projectName={projectName} modes={modes} onSelect={chooseTemplate} onDetail={setDetail}
              action={pending || readyToSave ? saveButton : null} />
          </div>
          {inputErrors.template && <p className={styles.fieldError}>{inputErrors.template}</p>}
          <Link className={styles.returnLink} to={back.path}>{back.label}</Link>
        </> : <fieldset className={styles.custom} disabled={inputLocked}>
          <legend className={styles.visuallyHidden}>직접 디자인 입력</legend>
          <Field label={fields.name} id={`${formId}-name`} value={custom.name} maxLength={80} required error={inputErrors.name}
            onChange={(event) => changeCustom('name', event.target.value)} />
          <DesignFontField projectId={projectId} uploadsEnabled={projectFontsEnabled} fonts={allowedFonts} font={custom.font}
            fontAssetId={custom.fontAssetId} fieldId={`${formId}-font`} error={inputErrors.font} disabled={inputLocked}
            uploading={uploadingFont} onUploadingChange={setUploadingFont} onChange={changeFont}
            onPreviewChange={setPreviewFont} onError={reportFontError} />
          <div className={styles.colorField}>
            <label htmlFor={`${formId}-primaryColor`}>{fields.primaryColor}</label>
            <div className={styles.colorEntry}>
              <input className={styles.colorPicker} type="color" value={customColor} aria-label="색상 선택" title="색상 선택"
                onChange={(event) => changeCustom('primaryColor', event.target.value.toUpperCase())} />
              <input id={`${formId}-primaryColor`} type="text" value={custom.primaryColor} maxLength={7} required
                placeholder={defaultCustomColor} autoComplete="off" spellCheck={false}
                aria-invalid={!!inputErrors.primaryColor} aria-describedby={inputErrors.primaryColor ? `${formId}-colorError` : undefined}
                onChange={(event) => changeCustom('primaryColor', event.target.value)} />
              <span aria-hidden="true">HEX</span>
            </div>
            <div className={styles.palette} role="group" aria-label="추천 색상">
              {palette.map(({ name, color }) => <button key={color} type="button" aria-label={name} title={name}
                aria-pressed={configuredCustom.primaryColor === color} style={{ color }}
                onClick={() => changeCustom('primaryColor', color)} />)}
            </div>
            {inputErrors.primaryColor && <p className={styles.fieldError} id={`${formId}-colorError`}>{inputErrors.primaryColor}</p>}
          </div>
          <Field label={fields.guidelines} id={`${formId}-guidelines`} multiline rows={3} maxLength={2000} value={custom.guidelines}
            error={inputErrors.guidelines} onChange={(event) => changeCustom('guidelines', event.target.value)} />
        </fieldset>}
      </form>
      {mode === 'custom' && <section className={styles.preview} aria-labelledby={`${formId}-preview`}>
        <h2 id={`${formId}-preview`}>슬라이드 미리보기</h2>
        {previewName && <p className={styles.previewName}>{previewName}</p>}
        <DesignPreview projectName={projectName} preview={preview} />
        <p className={styles.previewCaption}>색상, 글꼴과 레이아웃 스타일을 미리 볼 수 있어요.</p>
        <Link className={styles.returnLink} to={back.path}>{back.label}</Link>
      </section>}
    </div>
    {detail && <Modal open title={detail.name} size="preview" onClose={() => setDetail(null)}
      footer={<Button disabled={inputLocked || conflict || !!waitingUntil} onClick={() => chooseTemplate(detail)}>이 템플릿 선택</Button>}>
      <div className={styles.detailPreviews}>
        {studioPreview(detail.key)?.map(({ label, document }) =>
          <StudioPreview key={document.id} slide={document} label={label} />) ?? <>
        {templateCovers[detail.key] ? <TemplateCover templateKey={detail.key} />
          : <DesignPreview projectName={projectName} preview={previewOf(detail)} variant="detail" />}
        <div className={styles.detailsGrid}>
          <DesignPreview projectName={projectName} preview={previewOf(detail)} variant="detail" />
          <DesignPreview projectName={projectName} preview={previewOf(detail)} variant="detail" slide={secondExample} />
        </div>
        </>}
      </div>
      <div className={styles.detailInfo}>
        <div className={styles.detailAbout}>
          <p>{purposes[detail.key] ? `${purposes[detail.key]} / ` : ''}프레젠테이션 16:9</p>
          <p>{detail.preview.description}</p>
        </div>
        <div className={styles.detailIncluded}>
          {!!detail.layouts.length && <h3>{detail.layouts.map((layout) => layoutNames[layout] ?? layout).join(', ')} 구성</h3>}
          {!!detail.fonts.length && <p>기본 글꼴 {detail.fonts.join(', ')}</p>}
        </div>
      </div>
    </Modal>}
    <Modal open={invalid} title="디자인 설정을 확인해 주세요" size="confirm" onClose={() => setInvalid(false)}
      footer={<Button onClick={() => setInvalid(false)}>설정으로 돌아가기</Button>}>
      <ul className={styles.issues}>{(Object.keys(inputErrors) as InputField[]).map((field) => inputErrors[field] && <li key={field}>
        <strong>{fields[field]}</strong><p>{inputErrors[field]}</p>
      </li>)}</ul>
    </Modal>
    <UnsavedGuard dirty={dirty || modeLocked} />
  </>
}

const secondExample: SlideExample = { title: '조사 결과와 다음 제안', lines: ['자료에서 확인한 내용을 정리합니다.', '조사 결과를 바탕으로 다음 방향을 제안합니다.'] }
