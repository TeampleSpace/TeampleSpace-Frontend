// 구글 문서, 스프레드시트, 프레젠테이션, 드라이브 파일 주소를 페이지 안에 넣을 수 있는 미리보기 주소로 바꾼다
const docs: Record<string, string> = { document: '구글 문서', spreadsheets: '구글 스프레드시트', presentation: '구글 프레젠테이션' }

export function sharedPreview(url: string): { src: string; label: string } | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname === 'docs.google.com') {
    const match = parsed.pathname.match(/^\/(document|spreadsheets|presentation)(?:\/u\/\d+)?\/d\/([\w-]{10,})/)
    if (match) return { src: `https://docs.google.com/${match[1]}/d/${match[2]}/preview`, label: docs[match[1]!]! }
  }
  if (parsed.hostname === 'drive.google.com') {
    const match = parsed.pathname.match(/^\/file(?:\/u\/\d+)?\/d\/([\w-]{10,})/)
    if (match) return { src: `https://drive.google.com/file/d/${match[1]}/preview`, label: '구글 드라이브 파일' }
  }
  return null
}
