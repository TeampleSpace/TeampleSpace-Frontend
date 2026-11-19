import { ApiError } from '../../shared/api/client.ts'
import type { MaterialsApi } from './api.ts'
import { isUncertain } from './errors.ts'
import { formatBytes } from './model.ts'
import type { Material, UploadTicket } from './model.ts'

export type UploadStep = 'hashing' | 'preparing' | 'sending' | 'registering'
export const uploadSteps: { step: UploadStep; label: string }[] = [
  { step: 'hashing', label: '파일 확인' },
  { step: 'preparing', label: '업로드 준비' },
  { step: 'sending', label: '파일 전송' },
  { step: 'registering', label: '자료 등록' },
]

// 다시 시도할 때 이어 쓰는 진행 상태. 파일을 바꾸면 새로 만든다
export type UploadProgress = {
  ticket?: UploadTicket
  sent?: boolean
  // 결과를 모르는 등록 요청. 같은 키와 본문으로 다시 보낸다
  register?: { key: string; body: { uploadId: string; title?: string } }
}

export type UploadRule = { mimeType: string; maxBytes: number }

// 올리기 전에 기능 지원 정보의 형식과 크기로 확인한다. 최종 판단은 서버가 한다
export function checkFile(file: File, rule: UploadRule | undefined): string | null {
  if (!rule) return '지금은 파일을 올릴 수 없어요. 잠시 뒤 다시 시도해 주세요'
  const pdf = file.type === rule.mimeType || (!file.type && file.name.toLowerCase().endsWith('.pdf'))
  if (!pdf) return 'PDF 파일만 올릴 수 있어요'
  if (file.size === 0) return '빈 파일은 올릴 수 없어요'
  if (file.size > rule.maxBytes) return `파일이 ${formatBytes(rule.maxBytes)}를 넘어요`
  return null
}

export async function sha256Hex(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// 업로드 준비, 파일 전송, 자료 등록을 차례로 한다. 실패한 단계부터 다시 이어 간다
export async function addPdf(
  api: MaterialsApi, projectId: string, file: File, title: string, rule: UploadRule,
  progress: UploadProgress, onStep: (step: UploadStep) => void, signal?: AbortSignal,
): Promise<Material> {
  try {
    // 응답을 잃은 등록은 티켓이 만료됐어도 먼저 같은 요청으로 확인한다
    if (progress.register) {
      onStep('registering')
      return (await api.createFile(projectId, progress.register.body, progress.register.key)).material
    }
    if (!progress.ticket || new Date(progress.ticket.expiresAt).getTime() <= Date.now()) {
      onStep('hashing')
      const checksumSha256 = await sha256Hex(file)
      signal?.throwIfAborted()
      onStep('preparing')
      progress.ticket = await api.prepareUpload(projectId, { fileName: file.name, mimeType: rule.mimeType, sizeBytes: file.size, checksumSha256 }, signal)
      progress.sent = false; progress.register = undefined
    }
    if (!progress.sent) {
      onStep('sending')
      await api.sendFile(progress.ticket, file, signal)
      progress.sent = true
    }
    onStep('registering')
    progress.register ??= { key: crypto.randomUUID(), body: { uploadId: progress.ticket.uploadId, ...(title ? { title } : {}) } }
    const result = await api.createFile(projectId, progress.register.body, progress.register.key)
    return result.material
  } catch (reason) {
    // 결과를 모르는 등록만 같은 키로 다시 보낸다
    if (!isUncertain(reason)) progress.register = undefined
    if (reason instanceof ApiError) {
      // 전송이 끝나지 않았으면 전송부터, 업로드를 못 쓰게 됐으면 준비부터 다시 한다
      if (reason.code === 'UPLOAD_INCOMPLETE') progress.sent = false
      if (['UPLOAD_EXPIRED', 'UPLOAD_REJECTED', 'UPLOAD_ALREADY_USED', 'FILE_URL_EXPIRED', 'NOT_FOUND'].includes(reason.code)) {
        progress.ticket = undefined; progress.sent = false
      }
    }
    throw reason
  }
}

// 업로드 단계의 실패를 사용자 문구로 바꾼다
export function uploadErrorMessage(reason: unknown, rule: UploadRule | undefined): string | null {
  if (!(reason instanceof ApiError)) return null
  const detail = reason.fieldErrors[0]?.code
  const messages: Record<string, string> = {
    UPLOAD_TYPE_NOT_ALLOWED: 'PDF 파일만 올릴 수 있어요',
    UPLOAD_TOO_LARGE: rule ? `파일이 ${formatBytes(rule.maxBytes)}를 넘어요` : '파일이 허용 크기를 넘어요',
    UPLOAD_EXPIRED: '업로드 시간이 지났어요. 다시 시도하면 파일을 처음부터 올려요',
    UPLOAD_INCOMPLETE: '파일 전송이 끝나지 않았어요. 다시 시도하면 파일을 다시 보내요',
    UPLOAD_ALREADY_USED: '이미 등록한 업로드예요. 자료 목록을 확인해 주세요',
    UPLOAD_REJECTED: detail === 'NOT_PDF' ? 'PDF 형식이 아니에요. 다른 파일을 선택해 주세요' : '전송한 파일을 확인하지 못했어요. 다시 시도하면 파일을 처음부터 올려요',
    FILE_URL_EXPIRED: '업로드 주소가 만료됐어요. 다시 시도하면 파일을 처음부터 올려요',
  }
  return messages[reason.code] ?? null
}
