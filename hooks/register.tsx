import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { ClaudeTodo, MyTodo, OutlineTurn, TodoCandidate } from '../types'
import { applyClaude, isClaudeTool } from './claude-tasks'
import type { ClaudeTool } from './claude-tasks'
import {
  NOT_A_PROMPT,
  cleanUser,
  extractTodos,
  fit,
  hashOf,
  keyOf,
  normalize,
  summarize,
} from './text'

const PANE = 'chat-outline'
const TITLE = '대화 목차'
const MAX_TURNS = 300
const MAX_CANDIDATES = 40
const MAX_MINE = 200
const MAX_DISMISSED = 200
// 번호 칸 폭("  1 ")과 답변 요약의 들여쓰기 폭.
const NUMBER_WIDTH = 4
const ANSWER_INDENT = 4

// 화면 상태. 대화 기록에서 다시 만들 수 있는 것은 캐시일 뿐이다.
// 값의 모양을 바꾸면 shape 이름도 바꾼다(이전 값은 버려진다).
const turns = atom({ plugin: 'chat-outline', key: 'turns' } as const, [], {
  shape: 'turns-1',
})
const tab = atom({ plugin: 'chat-outline', key: 'tab' } as const, 'outline')
// 내가 적은 할 일과 치워 둔 후보는 프로젝트별로 $.store에도 저장한다.
const mine = atom({ plugin: 'chat-outline', key: 'mine' } as const, [], {
  shape: 'mine-1',
})
const claude = atom({ plugin: 'chat-outline', key: 'claude' } as const, [], {
  shape: 'claude-1',
})
const candidates = atom({ plugin: 'chat-outline', key: 'candidates' } as const, [], {
  shape: 'candidates-1',
})
const dismissed = atom({ plugin: 'chat-outline', key: 'dismissed' } as const, [], {
  shape: 'dismissed-1',
})

// ---------- 대화 기록 → 목차, 후보, Claude 작업 ----------

type Built = {
  turns: OutlineTurn[]
  candidates: TodoCandidate[]
  claude: ClaudeTodo[]
}

const buildOutline = (
  messages: readonly SessionMessage[],
  finalAnswer: string | undefined,
): Built => {
  const result: OutlineTurn[] = []
  // 요청마다 최종 답변 원문(할 일 후보를 뽑을 글). result와 같은 순서다.
  const finals: string[] = []
  let tasks: ClaudeTodo[] = []
  let current: OutlineTurn | undefined

  for (const message of messages) {
    if (message.role === 'user') {
      const text = cleanUser(message.text)

      // 도구 결과뿐인 기록과 사람이 쓰지 않은 기록은 건너뛴다.
      if (text === '' || NOT_A_PROMPT.test(text)) continue
      current = { user: text.slice(0, 300), userKey: keyOf(text), answer: '', answerKey: '' }
      result.push(current)
      finals.push('')
      continue
    }

    for (const use of message.toolUses) {
      if (isClaudeTool(use.tool)) tasks = applyClaude(tasks, use.tool, use.input, use.result)
    }

    const text = message.text.trim()

    // 한 요청에 답변 글이 여러 번 나오면 마지막 것이 최종 답변이다.
    if (current !== undefined && text !== '') {
      current.answer = summarize(text)
      current.answerKey = keyOf(text)
      finals[finals.length - 1] = text
    }
  }

  const last = result.at(-1)

  if (last !== undefined && last.answer === '' && finalAnswer !== undefined && finalAnswer.trim() !== '') {
    last.answer = summarize(finalAnswer)
    last.answerKey = keyOf(finalAnswer)
    finals[finals.length - 1] = finalAnswer
  }

  // 최근 50개 요청의 답변에서만 후보를 뽑는다. 같은 글은 가장 최근 것 하나만 남긴다.
  const found = new Map<string, TodoCandidate>()

  for (let i = Math.max(0, result.length - 50); i < result.length; i += 1) {
    for (const text of extractTodos(finals[i] ?? '').slice(0, 5)) {
      const id = hashOf(normalize(text))

      found.delete(id)
      found.set(id, { id, text, answerKey: result[i]?.answerKey ?? '' })
    }
  }

  return {
    turns: result,
    candidates: [...found.values()].slice(-MAX_CANDIDATES),
    claude: tasks.slice(-50),
  }
}

const refresh = async ($: EngineInterface, finalAnswer?: string): Promise<void> => {
  const built = buildOutline(await $.session.messages(), finalAnswer)

  await update($, turns, () => built.turns.slice(-MAX_TURNS))
  await update($, candidates, () => built.candidates)
  await update($, claude, () => built.claude)
}

// 목차 갱신이 실패해도 대화는 막지 않는다.
const safely = async (work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch {
    // 다음 갱신에서 다시 시도한다.
  }
}

// ---------- 내 할 일 (프로젝트별 저장) ----------

const storeKey = async ($: EngineInterface, name: 'mine' | 'dismissed'): Promise<string> =>
  `${name}:${await $.session.root()}`

const isMyTodo = (value: unknown): value is MyTodo =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as MyTodo).id === 'string' &&
  typeof (value as MyTodo).text === 'string' &&
  typeof (value as MyTodo).isDone === 'boolean'

const loadSaved = async ($: EngineInterface): Promise<void> => {
  const savedMine = await $.store.get(await storeKey($, 'mine'))
  const savedDismissed = await $.store.get(await storeKey($, 'dismissed'))

  await update($, mine, () => (Array.isArray(savedMine) ? savedMine.filter(isMyTodo) : []))
  await update($, dismissed, () =>
    Array.isArray(savedDismissed)
      ? savedDismissed.filter((one): one is string => typeof one === 'string')
      : [],
  )
}

// 목록을 바꾸고, 바뀐 목록을 저장소에도 적는다.
const changeMine = async (
  $: EngineInterface,
  change: (list: MyTodo[]) => MyTodo[],
): Promise<void> => {
  let saved: MyTodo[] = []

  await update($, mine, list => {
    saved = change([...list]).slice(-MAX_MINE)

    return saved
  })
  await $.store.set(await storeKey($, 'mine'), saved)
}

const addMine = async ($: EngineInterface, raw: string): Promise<void> => {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 200)

  if (text === '') return

  const id = `${(await $.clock.now()).toString(36)}${Math.random().toString(36).slice(2, 6)}`

  await changeMine($, list =>
    list.some(one => normalize(one.text) === normalize(text))
      ? list
      : [...list, { id, text, isDone: false }],
  )
}

const dismiss = async ($: EngineInterface, id: string): Promise<void> => {
  let saved: string[] = []

  await update($, dismissed, list => {
    saved = [...list.filter(one => one !== id), id].slice(-MAX_DISMISSED)

    return saved
  })
  await $.store.set(await storeKey($, 'dismissed'), saved)
}

// ---------- 화면에 그려진 대화 줄의 id ----------

// 대화 화면의 줄은 id로만 찾아갈 수 있다. 줄이 그려질 때 앞부분 열쇠와 id를 기억해 둔다.
// 같은 열쇠(예: "계속")가 여러 번 나올 수 있어 id를 나온 순서대로 쌓는다.
type Seen = Map<string, string[]>
const seenUser: Seen = new Map()
const seenAnswer: Seen = new Map()

const remember = (seen: Seen, key: string, id: string): void => {
  if (key === '') return
  const ids = seen.get(key) ?? []

  if (!ids.includes(id)) ids.push(id)
  seen.set(key, ids.slice(-50))
  if (seen.size > 3000) {
    const oldest = seen.keys().next().value

    if (oldest !== undefined) seen.delete(oldest)
  }
}

// 눌린 자리에서 곧바로 화면을 옮긴다(앞에 await를 두지 않는다).
const jumpToId = async ($: EngineInterface, id: string | undefined): Promise<void> => {
  if (id === undefined) {
    $.ui.toast('아직 이 위치를 찾지 못했어요. 그 대화가 화면에 한 번 나온 뒤에 이동할 수 있어요.')

    return
  }

  const moved = await $.ui.scroll({ to: { requestId: id }, block: 'start' })

  if (moved.deny !== undefined) {
    $.ui.toast(`이동하지 못했어요: ${moved.deny}`)
  }
}

type Target = 'user' | 'answer'

const jump = (
  $: EngineInterface,
  list: readonly OutlineTurn[],
  index: number,
  target: Target,
): Promise<void> => {
  const keyOfTurn = (turn: OutlineTurn): string => (target === 'user' ? turn.userKey : turn.answerKey)
  const key = keyOfTurn(list[index] as OutlineTurn)
  const ids = (target === 'user' ? seenUser : seenAnswer).get(key) ?? []
  // 같은 열쇠가 앞에 몇 번 나왔는지로 몇 번째 줄인지 고른다.
  const nth = list.slice(0, index).filter(turn => keyOfTurn(turn) === key).length

  return jumpToId($, ids[nth] ?? ids.at(-1))
}

// 도구 호출 하나를 Claude 작업 목록에 반영한다. 하위 에이전트의 호출은 건너뛴다.
const trackClaude = async (
  $: EngineInterface,
  tool: ClaudeTool,
  event: unknown,
  ran: unknown,
): Promise<void> => {
  const input = event as Readonly<Record<string, unknown>>

  if (input.agentId !== undefined) return

  const result = (ran as { result?: unknown } | undefined)?.result

  await safely(() => update($, claude, list => applyClaude(list, tool, input, result)))
}

const CLAUDE_MARK = { completed: '[x] ', in_progress: '[>] ', pending: '[ ] ' } as const

// ---------- mod 본체 ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'outline',
      description: '대화 목차 패널 열기',
    })
    await safely(() => loadSaved($))
    await safely(() => refresh($))
    if (e.isInteractive) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'outline' }, async $ => {
    await safely(() => refresh($))
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '대화 목차 패널을 열었어요.' }
  })

  // 내가 요청을 보내면 목차에 바로 올린다.
  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    const isTyped =
      e.isMeta !== true &&
      e.command === undefined &&
      (e.origin.kind === 'composer' || e.origin.kind === 'bridge')

    if (isTyped) {
      await safely(() => refresh($))
      await safely(() => $.ui.scroll({ in: PANE, to: 'end' }))
    }

    return ran
  })

  // 답변이 끝나면 요약과 할 일 후보를 채운다. 하위 에이전트의 턴은 건너뛴다.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await safely(() => refresh($, e.answer))
    }

    return next(e)
  })

  // Claude가 작업 목록을 바꾸는 즉시 패널에 반영한다.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)

    await trackClaude($, 'TodoWrite', e, ran)

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)

    await trackClaude($, 'TaskCreate', e, ran)

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)

    await trackClaude($, 'TaskUpdate', e, ran)

    return ran
  })

  // 대화 화면의 줄이 그려질 때 id를 기억만 하고, 그림은 그대로 둔다.
  on('ui.render', { component: 'UserMessage' }, (_$, e, next) => {
    remember(seenUser, keyOf(cleanUser(e.props.text)), e.requestId)

    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, (_$, e, next) => {
    remember(seenAnswer, keyOf(e.props.text), e.requestId)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const outline = await read($, turns)
    const current = await read($, tab)
    const myList = await read($, mine)
    const claudeList = await read($, claude)
    const found = await read($, candidates)
    const hidden = await read($, dismissed)
    const width = Math.max(12, e.props.bodyColumns - 1)

    const openCount =
      myList.filter(one => !one.isDone).length +
      claudeList.filter(one => one.status !== 'completed').length

    const tabs = (
      <Box marginBottom={1}>
        <Button
          key="tab:outline"
          variant={current === 'outline' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'outline' as const)}
        >
          목차
        </Button>
        <Text> </Text>
        <Button
          key="tab:todo"
          variant={current === 'todo' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'todo' as const)}
        >
          {openCount > 0 ? `할 일 ${openCount}` : '할 일'}
        </Button>
      </Box>
    )

    // ----- 목차 탭 -----
    const outlineView =
      outline.length === 0 ? (
        <Text dimColor>아직 대화가 없어요.</Text>
      ) : (
        <Box flexDirection="column">
          {outline.map((turn, index) => {
            const userLine = fit(turn.user, width - NUMBER_WIDTH, 1)[0] ?? ''
            const answerLines = fit(turn.answer, width - ANSWER_INDENT, 2)

            return (
              <Box flexDirection="column" marginBottom={1}>
                <Button key={`u${index}`} plain onPress={() => jump($, outline, index, 'user')}>
                  <Text dimColor>{String(index + 1).padStart(NUMBER_WIDTH - 1)} </Text>
                  <Text weight="bold">{userLine}</Text>
                </Button>
                {answerLines.length === 0 ? (
                  <Text dimColor>{' '.repeat(ANSWER_INDENT)}답변 기다리는 중…</Text>
                ) : (
                  answerLines.map((line, part) => (
                    <Button
                      key={`a${index}:${part}`}
                      plain
                      dimColor
                      onPress={() => jump($, outline, index, 'answer')}
                    >
                      {' '.repeat(ANSWER_INDENT)}
                      {line}
                    </Button>
                  ))
                )}
              </Box>
            )
          })}
        </Box>
      )

    // ----- 할 일 탭 -----
    const header = (title: string, note: string) => (
      <Box>
        <Text weight="bold">{title}</Text>
        <Text dimColor> {note}</Text>
      </Box>
    )

    const doneCount = myList.filter(one => one.isDone).length
    const taken = new Set(myList.map(one => normalize(one.text)))
    // 이미 내 할 일에 있거나 치워 둔 후보는 보이지 않는다. 최근 것이 위로 온다.
    const shown = found
      .filter(one => !hidden.includes(one.id) && !taken.has(normalize(one.text)))
      .slice(-15)
      .reverse()

    const todoView = (
      <Box flexDirection="column">
        {header('내 할 일', myList.length === 0 ? '' : `${doneCount}/${myList.length}`)}
        {myList.length === 0 && <Text dimColor>아직 없어요. 아래에 적어 보세요.</Text>}
        {myList.map(todo => {
          const lines = fit(todo.text, width - 4 - 2, 2)
          const toggle = () =>
            changeMine($, list =>
              list.map(one => (one.id === todo.id ? { ...one, isDone: !one.isDone } : one)),
            )

          return (
            <Box flexDirection="column">
              <Box>
                <Button key={`m:${todo.id}`} plain onPress={toggle}>
                  <Text dimColor={todo.isDone} strikethrough={todo.isDone}>
                    {todo.isDone ? '[x] ' : '[ ] '}
                    {lines[0] ?? ''}
                  </Text>
                </Button>
                <Button
                  key={`md:${todo.id}`}
                  plain
                  dimColor
                  onPress={() => changeMine($, list => list.filter(one => one.id !== todo.id))}
                >
                  {' x'}
                </Button>
              </Box>
              {lines[1] !== undefined && (
                <Button key={`m2:${todo.id}`} plain onPress={toggle}>
                  <Text dimColor={todo.isDone} strikethrough={todo.isDone}>
                    {'    '}
                    {lines[1]}
                  </Text>
                </Button>
              )}
            </Box>
          )
        })}
        {/* 추가할 때마다 key가 바뀌어 입력창이 비워진다. */}
        <Input
          key={`add:${myList.at(-1)?.id ?? 'first'}`}
          label="+ "
          placeholder="할 일 적고 Enter"
          submitLabel="추가"
          onSubmit={text => addMine($, text)}
        />

        <Box flexDirection="column" marginTop={1}>
          {header('Claude 작업', claudeList.length === 0 ? '' : `${claudeList.filter(one => one.status === 'completed').length}/${claudeList.length}`)}
          {claudeList.length === 0 && <Text dimColor>Claude가 만든 작업 목록이 없어요.</Text>}
          {claudeList.map(item => (
            <Text
              dimColor={item.status === 'completed'}
              weight={item.status === 'in_progress' ? 'bold' : 'regular'}
            >
              {CLAUDE_MARK[item.status]}
              {fit(item.text, width - 4, 1)[0] ?? ''}
            </Text>
          ))}
        </Box>

        {shown.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {header('대화에서 찾은 후보', `${shown.length}  (+ 추가, x 치우기)`)}
            {shown.map(item => (
              <Box>
                <Button key={`c+:${item.id}`} plain onPress={() => addMine($, item.text)}>
                  {'+ '}
                </Button>
                <Button
                  key={`cj:${item.id}`}
                  plain
                  dimColor
                  onPress={() => jumpToId($, seenAnswer.get(item.answerKey)?.at(-1))}
                >
                  {fit(item.text, width - 6, 1)[0] ?? ''}
                </Button>
                <Button key={`cx:${item.id}`} plain dimColor onPress={() => dismiss($, item.id)}>
                  {' x'}
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {tabs}
        {current === 'todo' ? todoView : outlineView}
      </Box>
    )
  })
}
