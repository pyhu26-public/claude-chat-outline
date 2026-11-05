// Claude가 만드는 작업 목록(TodoWrite, TaskCreate, TaskUpdate)을 한 목록으로 합친다.
import type { ClaudeTodo } from '../types'

export const CLAUDE_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate'] as const
export type ClaudeTool = (typeof CLAUDE_TOOLS)[number]

export const isClaudeTool = (tool: string): tool is ClaudeTool =>
  (CLAUDE_TOOLS as readonly string[]).includes(tool)

type Status = ClaudeTodo['status']

const asStatus = (value: unknown): Status | undefined =>
  value === 'pending' || value === 'in_progress' || value === 'completed' ? value : undefined

const asText = (value: unknown): string => {
  if (typeof value === 'number') return String(value)

  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

// 도구 호출 하나를 목록에 반영한다. 같은 호출을 두 번 반영해도 결과가 같다.
//  - TodoWrite: 목록 전체를 새 목록으로 바꾼다.
//  - TaskCreate: 결과에 들어 있는 번호(id)로 작업을 더한다. 번호를 모르면 건너뛴다.
//  - TaskUpdate: 번호로 찾아 상태·제목을 바꾸고, deleted면 뺀다.
export const applyClaude = (
  list: readonly ClaudeTodo[],
  tool: ClaudeTool,
  input: Readonly<Record<string, unknown>>,
  result: unknown,
): ClaudeTodo[] => {
  if (tool === 'TodoWrite') {
    const todos: unknown[] = Array.isArray(input.todos) ? input.todos : []

    return todos
      .map((raw, index): ClaudeTodo => {
        const one = asRecord(raw)

        return {
          id: `todo${index}`,
          text: asText(one?.content),
          status: asStatus(one?.status) ?? 'pending',
        }
      })
      .filter(todo => todo.text !== '')
  }

  if (tool === 'TaskCreate') {
    const id = asText(asRecord(asRecord(result)?.task)?.id)
    const text = asText(input.subject)

    if (id === '' || text === '') return [...list]

    return list.some(todo => todo.id === id)
      ? list.map(todo => (todo.id === id ? { ...todo, text } : todo))
      : [...list, { id, text, status: 'pending' }]
  }

  const id = asText(input.taskId)

  if (input.status === 'deleted') return list.filter(todo => todo.id !== id)

  return list.map(todo =>
    todo.id === id
      ? { ...todo, text: asText(input.subject) || todo.text, status: asStatus(input.status) ?? todo.status }
      : todo,
  )
}
