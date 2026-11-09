# chat-outline

Claude Code 대화 옆에 **대화 목차 패널**을 띄워 주는 플러그인입니다.
긴 대화에서 내가 무엇을 요청했고 Claude가 어떻게 답했는지 한눈에 보고, 항목을 누르면 그 위치로 이동합니다.

## 기능

- **목차 탭**: 내가 보낸 요청마다 한 줄, 그 아래에 Claude 최종 답변의 요약을 보여 줍니다. 항목을 누르면 대화 화면의 그 위치로 이동합니다.
- **할 일 탭**: 세 가지를 모아 보여 줍니다.
  - 내 할 일: 직접 적고, 체크하고, 지웁니다. 프로젝트별로 저장되어 다음 세션에도 남습니다.
  - Claude 작업: Claude가 만든 작업 목록(`TodoWrite`, `TaskCreate`, `TaskUpdate`)을 실시간으로 반영합니다.
  - 대화에서 찾은 후보: Claude 답변에서 할 일처럼 보이는 문장을 뽑아 둡니다. `+`로 내 할 일에 올리고 `x`로 치웁니다.
- 슬래시 명령 `/outline`: 패널을 엽니다. 터미널이 좁아 패널이 자동으로 열리지 않을 때 쓰세요.

## 설치

Claude Code 터미널에서:

```
/plugin install chat-outline --marketplace pyhu26-public/claude-chat-outline
```

셸에서:

```
claude plugin install chat-outline --marketplace pyhu26-public/claude-chat-outline
```

처음이면 `Add marketplace?`가 뜹니다. `y`를 누르고, 설치 범위(user 권장)를 Enter로 고르면 끝입니다.
설치한 뒤 시작하는 세션부터 자동으로 적용됩니다.

## 참고

- 대화 기록은 이 컴퓨터 안에서만 읽습니다. 밖으로 보내지 않습니다.
- 내 할 일과 치워 둔 후보는 Claude Code의 저장소(`$.store`)에 프로젝트 경로별로 저장됩니다.
- 시험은 `claude plugin test <이 폴더>`로 돌립니다.

## 라이선스

[MIT](LICENSE)
