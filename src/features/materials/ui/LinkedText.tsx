import { ExternalLink } from './ExternalLink.tsx'

// 웹 주소와 메일 주소. 끝의 문장부호와 괄호는 주소에 넣지 않는다
// ponytail: 괄호가 든 주소는 괄호 앞에서 끊긴다. 필요해지면 짝 맞춤으로 바꾼다
const address = /((?:https?:\/\/|mailto:)[^\s<>"'()[\]]*[^\s<>"'()[\].,;:!?])/

// 본문 글자 속 주소를 새 탭으로 여는 링크로 바꾼다
export function LinkedText({ text }: { text: string }) {
  return <>{text.split(address).map((part, index) => index % 2
    ? <ExternalLink key={index} href={part}>{part}</ExternalLink>
    : part)}</>
}
