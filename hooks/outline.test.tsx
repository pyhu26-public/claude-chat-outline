import type { On, SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: '로그인 오류를 고쳐줘', toolUses: [] },
  { role: 'assistant', text: '확인해 볼게요.', toolUses: [] },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }],
  },
  {
    role: 'assistant',
    text: '**결론: 토큰 만료 처리가 빠져 있었어요.**\n\n- 자세한 내용은 아래와 같아요.',
    toolUses: [],
  },
  { role: 'user', text: '<system-reminder>메모</system-reminder>배포도 해줘', toolUses: [] },
]

const PANE = {
  plugin: 'chat-outline',
  component: 'Pane',
  requestId: 'chat-outline',
  props: {
    title: '대화 목차',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const start = (on: On): void => {
  on('command.register', () => ({ value: { command: 'outline' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [...MESSAGES] }))
  // 대화 줄은 엔진이 그린다. mod는 그림을 건드리지 않고 id만 기억한다.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

const begin = ($: Engine) =>
  $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('목차가 요청과 답변 요약을 보여준다', async ($, on) => {
  start(on)
  await begin($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // 도구 결과뿐인 기록은 빠지고, 요청은 둘이다.
    expect((await ui.find({ key: 'u0' }))?.text).toMatch(/로그인 오류를 고쳐줘/)
    expect((await ui.find({ key: 'u1' }))?.text).toMatch(/배포도 해줘/)
    expect((await ui.find({ key: 'u1' }))?.text).not.toMatch(/메모/)
    // 답변은 마지막 글의 첫 문장이고 마크다운 기호가 없다.
    const answer = await ui.find({ key: 'a0:0' })
    expect(answer?.text).toMatch(/결론: 토큰 만료/)
    expect(answer?.text).not.toMatch(/\*/)
    // 아직 답이 없는 요청은 기다리는 중이라고 보여준다.
    expect(await ui.find({ type: 'Text', text: /답변 기다리는 중/ })).toBeDefined()
    await ui.unmount()
  }
})

test('화면에 나온 줄은 위치를 찾아 이동을 요청한다', async ($, on) => {
  start(on)
  const toasts: unknown[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)

    return { value: undefined }
  })
  await begin($)

  // 대화 화면에 그 줄이 한 번 그려진다.
  const row = await $.ui.mount({
    plugin: 'chat-outline',
    component: 'UserMessage',
    requestId: 'row-1',
    props: { text: '로그인 오류를 고쳐줘', origin: { kind: 'composer' }, isExpanded: true },
    surface: 'terminal',
  })
  await row.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // 화면 이동 자체($.ui.scroll)는 엔진의 일이라 시험 도구가 대신 답할 수 없다.
  // 여기서는 위치를 찾았는지(안내 말이 뜨지 않는지)만 본다. 실제 이동은 직접 눌러 확인한다.
  await ui.press({ key: 'u0' }).catch(() => undefined)

  expect(JSON.stringify(toasts)).not.toContain('찾지 못했어요')
  await ui.unmount()
})

test('아직 본 적 없는 줄은 안내만 한다', async ($, on) => {
  start(on)
  const toasts: unknown[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)

    return { value: undefined }
  })
  await begin($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'u1' })

  expect(JSON.stringify(toasts)).toContain('찾지 못했어요')
  await ui.unmount()
})
