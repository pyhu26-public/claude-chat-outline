// 글을 다듬고 자르는 도우미. 화면이나 엔진을 쓰지 않는 순수한 함수만 둔다.

// 화면 칸 폭: 한글·한자·이모지는 2칸, 나머지는 1칸.
export const cells = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0
  const isWide =
    c >= 0x1100 &&
    (c <= 0x115f ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd))

  return isWide ? 2 : 1
}

const widthOf = (text: string): number =>
  Array.from(text).reduce((sum, ch) => sum + cells(ch), 0)

// 글을 폭에 맞춰 최대 maxLines줄로 나눈다. 넘치면 마지막 줄 끝을 …로 닫는다.
export const fit = (text: string, width: number, maxLines: number): string[] => {
  const lines: string[] = []
  let line = ''
  let used = 0
  let isCut = false

  for (const ch of text) {
    const w = cells(ch)

    if (used + w > width) {
      if (lines.length === maxLines - 1) {
        isCut = true
        break
      }
      lines.push(line)
      line = ''
      used = 0
    }
    line += ch
    used += w
  }

  if (isCut) {
    // 말줄임표 한 칸을 비운다.
    let head = line

    while (head !== '' && widthOf(head) > width - 1) {
      head = Array.from(head).slice(0, -1).join('')
    }
    line = `${head}…`
  }
  if (line !== '') lines.push(line)

  return lines
}

const SYSTEM_NOTE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
// 사람이 직접 쓴 요청이 아닌 기록(명령 실행 흔적, 중단 표시 등).
export const NOT_A_PROMPT =
  /^(<command-|<local-command-|<task-notification|\[Request interrupted)/

export const cleanUser = (raw: string): string =>
  raw.replace(SYSTEM_NOTE, ' ').replace(/\s+/g, ' ').trim()

// 화면 위치를 찾을 때 쓰는 열쇠: 공백을 정리한 앞 40자.
export const keyOf = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, 40)

// 비교용: 소문자로 바꾸고 공백을 하나로 모은다.
export const normalize = (raw: string): string => raw.toLowerCase().replace(/\s+/g, ' ').trim()

// 짧은 글에서 짧은 이름표를 만든다(FNV-1a).
export const hashOf = (raw: string): string => {
  let hash = 0x811c9dc5

  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(36)
}

// 한 줄에서 마크다운 기호를 걷어낸다.
const stripMarks = (line: string): string =>
  line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .replace(/[*_`|]/g, '')
    .trim()

// 답변 요약: 마크다운 기호를 걷어내고 첫 문장(짧으면 다음 줄까지)을 쓴다.
export const summarize = (raw: string): string => {
  const lines = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map(stripMarks)
    .filter(line => line !== '' && !/^[-=:| ]+$/.test(line))
  const first = lines[0] ?? ''
  const summary = first.length < 24 && lines[1] !== undefined ? `${first} ${lines[1]}` : first

  return summary.slice(0, 200)
}

// ---------- 답변에서 할 일 후보 뽑기 ----------

const SECTION =
  /(다음\s*단계|다음\s*작업|남은\s*(작업|일)|할\s*일|후속\s*(작업|조치)|해야\s*할\s*일|todo|to-do|next\s*steps?|follow-?ups?)/i
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/
const CHECKBOX = /^\s*[-*+]\s*\[ \]\s+(.+)$/
const TODO_PREFIX = /^\s*(?:[-*+]\s+)?(?:TODO|할\s*일)\s*[:：]\s*(.+)$/i

const cleanItem = (raw: string): string =>
  stripMarks(raw).replace(/\s+/g, ' ').trim().slice(0, 120)

// 답변 글에서 "할 일처럼 보이는 줄"만 고른다. 세 경우만 본다.
//  1) 체크박스 목록의 빈 칸:  - [ ] 문서 정리
//  2) "TODO:" 또는 "할 일:" 로 시작하는 줄
//  3) "다음 단계", "남은 작업" 같은 제목 아래의 목록
// 코드 블록 안은 건너뛴다.
export const extractTodos = (raw: string): string[] => {
  const found: string[] = []
  let isInSection = false
  let hasBullet = false

  for (const line of raw.replace(/```[\s\S]*?```/g, ' ').split('\n')) {
    const trimmed = line.trim()
    const checkbox = CHECKBOX.exec(line)
    const prefixed = TODO_PREFIX.exec(line)

    if (checkbox?.[1] !== undefined) {
      found.push(checkbox[1])
      continue
    }
    if (prefixed?.[1] !== undefined) {
      found.push(prefixed[1])
      continue
    }

    const isHeading =
      /^#{1,6}\s/.test(trimmed) ||
      /^\*\*[^*]+\*\*\s*[:：]?$/.test(trimmed) ||
      (/[:：]$/.test(trimmed) && !BULLET.test(line))

    if (isHeading) {
      isInSection = SECTION.test(trimmed.replace(/[*_`#:：]/g, ''))
      hasBullet = false
      continue
    }
    if (!isInSection) continue

    const bullet = BULLET.exec(line)

    if (bullet?.[1] !== undefined) {
      found.push(bullet[1])
      hasBullet = true
    } else if (trimmed !== '' && hasBullet) {
      // 목록이 끝나고 다른 글이 나왔다.
      isInSection = false
    }
  }

  return found.map(cleanItem).filter(item => item.length >= 3)
}
