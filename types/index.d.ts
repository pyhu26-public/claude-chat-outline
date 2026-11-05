// 대화 한 턴(내 요청 + Claude 답변)의 목차 항목.
export type OutlineTurn = {
  // 내가 요청한 내용 (한 줄로 줄인 글)
  user: string
  // 화면 위치를 찾을 때 쓰는 요청 앞부분 열쇠
  userKey: string
  // Claude 답변 요약 (답변이 아직 없으면 빈 글)
  answer: string
  // 화면 위치를 찾을 때 쓰는 답변 앞부분 열쇠
  answerKey: string
}

// 내가 직접 적는 할 일. 프로젝트별로 저장된다.
export type MyTodo = { id: string; text: string; isDone: boolean }

// Claude가 만든 작업 목록의 항목(보기만 한다).
export type ClaudeTodo = {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

// 답변에서 뽑은 할 일 후보. answerKey는 그 답변의 화면 위치를 찾는 열쇠.
export type TodoCandidate = { id: string; text: string; answerKey: string }

declare module 'claude-code' {
  interface PluginState {
    'chat-outline': {
      turns: Shaped<OutlineTurn[]>
      // 패널에서 보고 있는 탭
      tab: 'outline' | 'todo'
      mine: Shaped<MyTodo[]>
      claude: Shaped<ClaudeTodo[]>
      candidates: Shaped<TodoCandidate[]>
      // 치워 둔 후보의 이름표
      dismissed: Shaped<string[]>
    }
  }
}
