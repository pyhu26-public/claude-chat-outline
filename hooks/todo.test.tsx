import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { extractTodos, hashOf, normalize } from './text'

const ANSWER = [
  '배포했어요.',
  '',
  '## 다음 단계',
  '- 모니터링 확인',
  '- 문서 정리',
  '',
  '이 아래는 그냥 설명이에요.',
  '- 이 줄은 후보가 아니에요',
  '',
  '- [ ] 롤백 절차 점검',
  '- [x] 이미 끝낸 일',
].join('\n')

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: '배포 준비해줘', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      {
        tool_use_id: 't1',
        tool: 'TodoWrite',
        input: {
          todos: [
            { content: '빌드 확인', status: 'completed', activeForm: '빌드 확인 중' },
            { content: '배포 실행', status: 'in_progress', activeForm: '배포 중' },
          ],
        },
      },
    ],
  },
  { role: 'assistant', text: ANSWER, toolUses: [] },
]

const PANE = {
  plugin: 'chat-outline',
  component: 'Pane',
  requestId: 'chat-outline',
  props: {
    title: '대화 목차',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// 엔진 대역과 저장소를 먼저 등록한다(on은 $를 처음 부르기 전에만 된다).
const setup = (
  on: On,
  messages: SessionMessage[] = MESSAGES,
  saved: Readonly<Record<string, unknown>> = {},
): { toolResult: unknown } => {
  // 도구가 돌려줄 결과. 시험이 중간에 바꿀 수 있다.
  const world = { toolResult: {} as unknown }

  on('command.register', () => ({ value: { command: 'outline' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/p' }))
  on('session.messages', () => ({ value: [...messages] }))
  on('tool.call', () => ({ result: world.toolResult }))
  mock.clock(on, { now: 1_000_000 })
  mock.store(on, saved)

  return world
}

const begin = ($: Engine) =>
  $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('답변에서 할 일 후보를 뽑는다', () => {
  expect(extractTodos(ANSWER)).toEqual(['모니터링 확인', '문서 정리', '롤백 절차 점검'])
  // 코드 블록 안, 제목 없는 목록은 후보가 아니다.
  expect(extractTodos('```\n- [ ] 코드 안\n```\n- 그냥 목록')).toEqual([])
  expect(extractTodos('TODO: 로그 확인하기')).toEqual(['로그 확인하기'])
})

test('할 일 탭이 Claude 작업과 후보를 보여준다', async ($, on) => {
  setup(on)
  await begin($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.press({ key: 'tab:todo' })
    expect(await ui.find({ type: 'Text', text: /\[x\] 빌드 확인/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\[>\] 배포 실행/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /모니터링 확인/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /롤백 절차 점검/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /이미 끝낸 일/ })).toBeUndefined()
    await ui.press({ key: 'tab:outline' })
    await ui.unmount()
  }
})

test('내 할 일을 적고, 체크하고, 지운다', async ($, on) => {
  setup(on, [])
  await begin($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab:todo' })

  const field = await ui.find({ type: 'Input' })

  expect(field?.key).toBe('add:first')
  await ui.input({ key: 'add:first', text: '  새   할 일 ' })

  const row = await ui.find({ type: 'Button', text: /새 할 일/ })

  expect(row?.text).toContain('[ ] 새 할 일')
  // 추가하면 입력창이 새것으로 바뀌어 비워진다.
  expect((await ui.find({ type: 'Input' }))?.key).not.toBe('add:first')
  // 같은 글은 두 번 들어가지 않는다.
  await ui.input({ key: (await ui.find({ type: 'Input' }))?.key ?? '', text: '새 할 일' })
  expect(await ui.findAll({ type: 'Button', text: /새 할 일/ })).toHaveLength(1)

  const key = row?.key ?? ''

  await ui.press({ key })
  expect((await ui.find({ type: 'Button', text: /새 할 일/ }))?.text).toContain('[x] 새 할 일')
  // 세션을 다시 시작하면 저장소에서 불러온다. 체크한 상태가 남아 있어야 한다.
  await begin($)
  expect((await ui.find({ type: 'Button', text: /새 할 일/ }))?.text).toContain('[x] 새 할 일')

  await ui.press({ key: key.replace('m:', 'md:') })
  expect(await ui.find({ type: 'Button', text: /새 할 일/ })).toBeUndefined()
  await begin($)
  expect(await ui.find({ type: 'Button', text: /새 할 일/ })).toBeUndefined()
  await ui.unmount()
})

test('저장해 둔 할 일을 다시 열면 불러온다', async ($, on) => {
  setup(on, [], { 'mine:/p': [{ id: 'a', text: '저장된 일', isDone: true }] })
  await begin($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab:todo' })
  expect((await ui.find({ type: 'Button', text: /저장된 일/ }))?.text).toContain('[x] 저장된 일')
  await ui.unmount()
})

test('후보를 내 할 일로 올리거나 치운다', async ($, on) => {
  setup(on)
  await begin($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const up = hashOf(normalize('모니터링 확인'))
  const off = hashOf(normalize('문서 정리'))

  await ui.press({ key: 'tab:todo' })

  await ui.press({ key: `c+:${up}` })
  // 올린 후보는 후보 줄에서 사라지고 내 할 일에 나타난다.
  expect(await ui.find({ key: `cj:${up}` })).toBeUndefined()
  expect((await ui.find({ type: 'Button', text: /\[ \] 모니터링 확인/ }))?.text).toBeDefined()

  await ui.press({ key: `cx:${off}` })
  expect(await ui.find({ key: `cj:${off}` })).toBeUndefined()
  // 다시 시작해서 후보를 새로 뽑아도, 치워 둔 후보는 저장소에 남아 다시 나오지 않는다.
  await begin($)
  expect(await ui.find({ key: `cj:${off}` })).toBeUndefined()
  expect(await ui.find({ key: `cj:${hashOf(normalize('롤백 절차 점검'))}` })).toBeDefined()
  // 치운 후보는 내 할 일에 들어가지 않는다.
  expect(await ui.find({ type: 'Button', text: /\[ \] 문서 정리/ })).toBeUndefined()
  await ui.unmount()
})

test('Claude 작업 목록이 바뀌면 바로 보인다', async ($, on) => {
  const world = setup(on, [])
  await begin($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab:todo' })
  expect(await ui.find({ type: 'Text', text: /작업 목록이 없어요/ })).toBeDefined()

  // 이전 방식(TodoWrite): 목록 전체를 바꾼다.
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: '설계', status: 'in_progress', activeForm: '설계 중' }],
  })
  expect(await ui.find({ type: 'Text', text: /\[>\] 설계/ })).toBeDefined()

  // 새 방식(TaskCreate, TaskUpdate): 결과의 번호로 작업을 이어 간다.
  world.toolResult = { task: { id: '7', subject: '구현' } }
  await $.tool.call({ tool: 'TaskCreate', subject: '구현', description: '구현하기' })
  expect(await ui.find({ type: 'Text', text: /\[ \] 구현/ })).toBeDefined()
  await ui.unmount()
})

test('Task 도구 기록으로 작업 목록을 다시 만든다', async ($, on) => {
  const messages: SessionMessage[] = [
    { role: 'user', text: '구현해줘', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        {
          tool_use_id: 'a',
          tool: 'TaskCreate',
          input: { subject: '구현', description: 'x' },
          result: { task: { id: '1', subject: '구현' } },
        },
        {
          tool_use_id: 'b',
          tool: 'TaskCreate',
          input: { subject: '시험', description: 'x' },
          result: { task: { id: '2', subject: '시험' } },
        },
        { tool_use_id: 'c', tool: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
        { tool_use_id: 'd', tool: 'TaskUpdate', input: { taskId: '2', status: 'deleted' } },
      ],
    },
  ]

  setup(on, messages)
  await begin($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'tab:todo' })
  expect(await ui.find({ type: 'Text', text: /\[x\] 구현/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /시험/ })).toBeUndefined()
  await ui.unmount()
})
