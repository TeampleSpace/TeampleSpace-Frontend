import { Link, useSearchParams } from 'react-router'
import exampleImage from '../../../contracts/examples/assets/0193a000-0000-7000-8000-0000000000c1.png'
import type { Element, Presentation } from '../../entities/presentation/schema.ts'
import { SlideRenderer } from '../../features/editor/SlideRenderer.tsx'
import { exampleImageFileId, exampleSnapshot } from '../../mocks/example.ts'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import styles from './RenderReference.module.css'

// 읽기 응답처럼 이미지에 임시 주소를 붙인 예제 문서
function loadExample(): Presentation | undefined {
  const source = exampleSnapshot.presentation
  if (!source) return undefined
  return {
    ...source,
    slides: source.slides.map((slide) => ({
      ...slide,
      elements: slide.elements.map((element) =>
        element.type === 'image' && element.content.fileObjectId === exampleImageFileId
          ? { ...element, content: { ...element.content, assetUrl: exampleImage } }
          : element,
      ),
    })),
  }
}

const presentation = loadExample()

// 글꼴이 설치돼 있지 않으면 대체 글꼴과 글자 폭이 같게 나온다
function hasFont(family: string): boolean {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return false
  const sample = '가나다라 ABC 123'
  const width = (font: string) => {
    context.font = font
    return context.measureText(sample).width
  }
  return width(`40px '${family}', monospace`) !== width('40px monospace')
}

function summary(element: Element): string {
  if (element.type === 'text') {
    const { fontFamily, fontSize, fontWeight, color, align, lineHeight } = element.style
    return `${fontFamily} ${fontSize} 굵기 ${fontWeight} ${color} ${align} 줄 간격 ${lineHeight}`
  }
  if (element.type === 'shape') {
    const { fill, stroke, strokeWidth, cornerRadius } = element.style
    const corner = cornerRadius ? ` 모서리 ${cornerRadius}` : ''
    return `${element.content.shape} 채움 ${fill ?? '없음'} 선 ${stroke ?? '없음'} ${strokeWidth}${corner}`
  }
  const crop = element.content.crop
  const cropText = crop ? ` 자르기 ${crop.x}, ${crop.y}, ${crop.width}, ${crop.height}` : ''
  return `파일 ${element.content.fileObjectId}${cropText}`
}

function content(element: Element): string {
  if (element.type === 'text') return element.content.text
  if (element.type === 'image') return element.content.alt
  return ''
}

const checkItems = [
  '한글 글꼴이 문서에 적힌 글꼴로 나오는지, 대체 글꼴로 바뀌었는지',
  '긴 문장의 줄바꿈 위치가 같은지',
  '직접 넣은 줄바꿈이 그대로 줄을 나누는지',
  '글자 크기, 굵기, 색, 정렬, 줄 간격이 같은지',
  '도형의 위치, 크기, 채움 색, 선 색과 두께, 둥근 모서리가 같은지',
  '이미지의 위치와 크기, 자른 영역, 가로세로 비율이 같은지',
  '회전한 요소가 가운데를 기준으로 같은 각도로 도는지',
  '요소가 겹치는 순서가 같은지',
  '출처 문구가 보이고 출처 연결 정보가 정해진 방식으로 표시되는지',
  '슬라이드 순서와 크기가 같은지',
]

// 백엔드의 PPTX, PDF 출력과 비교할 기준 화면. 문서 좌표 그대로 100%로 그린다
export default function RenderReference() {
  const [params] = useSearchParams()
  if (!presentation) {
    return <StatusPanel kind="empty" title="예제 문서가 없어요" />
  }

  // 화면 캡처용. 주소에 slide 번호를 주면 그 슬라이드만 왼쪽 위에 그린다
  const only = presentation.slides[Number(params.get('slide')) - 1]
  if (only) {
    return (
      <div className={styles.bare}>
        <SlideRenderer canvas={presentation.canvas} slide={only} scale={1} />
      </div>
    )
  }

  const fonts = [...new Set(
    presentation.slides.flatMap((slide) =>
      slide.elements.flatMap((element) =>
        element.type === 'text' ? [element.style.fontFamily] : [],
      ),
    ),
  )]

  return (
    <>
      <Link to="/">홈으로</Link>
      <h1>파일 출력 비교 기준</h1>
      <p className={styles.notice}>
        백엔드의 파일 출력 실험과 같은 예제 문서를 문서 좌표 그대로 100%로 그린 화면입니다.
        캔버스는 {presentation.canvas.width} x {presentation.canvas.height}{' '}
        {presentation.canvas.unit}입니다
      </p>

      <section className={styles.section}>
        <h2>글꼴</h2>
        <ul>
          {fonts.map((family) => (
            <li key={family}>
              {family}:{' '}
              {hasFont(family)
                ? '이 브라우저에서 사용할 수 있어요'
                : '이 브라우저에 없어 대체 글꼴로 표시돼요. 줄바꿈 위치가 달라질 수 있어요'}
            </li>
          ))}
        </ul>
      </section>

      {presentation.slides.map((slide, index) => (
        <section key={slide.id} className={styles.section}>
          <h2>슬라이드 {index + 1}</h2>
          <Link to={`?slide=${index + 1}`}>이 슬라이드만 보기</Link>
          <div className={styles.scroll}>
            <SlideRenderer canvas={presentation.canvas} slide={slide} scale={1} />
          </div>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption>슬라이드 {index + 1}의 요소. 좌표와 크기는 캔버스 단위</caption>
              <thead>
                <tr>
                  <th scope="col">순서</th>
                  <th scope="col">종류</th>
                  <th scope="col">x</th>
                  <th scope="col">y</th>
                  <th scope="col">너비</th>
                  <th scope="col">높이</th>
                  <th scope="col">회전</th>
                  <th scope="col">스타일</th>
                  <th scope="col">내용</th>
                  <th scope="col">출처</th>
                </tr>
              </thead>
              <tbody>
                {slide.elements.map((element) => (
                  <tr key={element.id}>
                    <td>{element.geometry.z}</td>
                    <td>{element.type}</td>
                    <td>{element.geometry.x}</td>
                    <td>{element.geometry.y}</td>
                    <td>{element.geometry.width}</td>
                    <td>{element.geometry.height}</td>
                    <td>{element.geometry.rotation}</td>
                    <td>{summary(element)}</td>
                    <td className={styles.content}>{content(element)}</td>
                    <td>
                      {element.sourceRefs
                        .map((source) =>
                          [
                            `개정 ${source.sourceVersion}`,
                            source.page ? `${source.page}쪽` : '',
                            source.sourceDeleted ? '삭제된 자료' : '',
                          ]
                            .filter(Boolean)
                            .join(' '),
                        )
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className={styles.section}>
        <h2>비교할 항목</h2>
        <ol>
          {checkItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    </>
  )
}
