# 맥용 마크다운 뷰어/에디터 (Electron) 계획

## Context
.md 파일을 볼 때마다 Xcode로 열리는 게 불편해서, 맥에 설치하는 마크다운 앱을 만든다. 기본은 **뷰어**이고, 편집 버튼을 누르면 벨로그처럼 왼쪽 에디터(툴바 포함) + 오른쪽 미리보기로 바뀐다. 수식은 깃블로그(Mm-767.github.io)와 똑같이 보여야 하고, .md 파일로 저장하고, PDF로 추출할 수 있어야 한다.

확정한 결정:
| 항목 | 선택 | 버린 선택지 |
|---|---|---|
| 기술 스택 | Electron | Tauri (Rust 설치, macOS PDF 우회 필요), SwiftUI (Swift와 JS를 오가야 함) |
| 저장 | .md 파일 열기/저장 | 자동저장, 앱 내부 보관함 |
| mermaid | 넣기 | 나중에 |
| 이미지 붙여넣기 | md 안에 base64로 박기 (블로그의 현재 방식과 같음) | md 옆 images 폴더 |
| 스크롤 동기화 | 문단 단위 맞추기 | 비율로 맞추기 |
| 다크모드 | 맥 설정 따라가기 | 수동 전환 메뉴 |
| 제목·태그 입력칸 | 넣지 않기 | 벨로그식 입력칸 |
| 에디터 | CodeMirror 6 (문법 하이라이트 요청) | textarea, Monaco (너무 무거움) |

블로그를 확인한 결과: Astro 파이프라인은 `remark-gfm`(Astro 기본) + `remark-math` + `remarkFixEscapedMath`(블로그 `astro.config.mjs`) + `rehype-katex`로 되어 있다. 앱도 이 체인을 똑같이 쓴다. 블로그의 `/new` 에디터는 TipTap 위지윅에 `marked`를 쓰고 수식을 지원하지 않아서 재사용하지 않는다.

## 위치와 레포
- 로컬 폴더는 `~/md-viewer`, 앱 이름은 `MD Viewer`
- GitHub 레포는 `Mm-767/md-viewer` (public)
- 첫 커밋에는 이 계획서(`PLAN.md`)와 `.gitignore`(node_modules, dist, 번들 결과물)만 넣고 `main`에 푸시한다. 그 뒤로는 실행 순서의 단계마다 커밋하고, **푸시하기 전에 매번 보고한 뒤 답을 기다린다.**
- 커밋 메시지에는 AI 표기(Co-Authored-By)를 넣지 않는다 (CLAUDE.md §8).

## 파일
| 파일 | 역할 |
|---|---|
| `package.json` | 의존성, 스크립트(`start`/`build`/`test`/`dist`), electron-builder 설정(`.md`/`.markdown` 파일 연결 포함) |
| `main.js` | 창 관리(파일 하나당 창 하나, 비어 있는 새 창이면 재사용), 메뉴, 열기/저장/다른이름저장 다이얼로그, `open-file` 이벤트(더블클릭으로 열기), `printToPDF`, 저장 안 한 변경이 있을 때 닫기 확인, PDF용 `nativeTheme` 전환 |
| `preload.js` | `contextBridge`로 필요한 IPC만 노출 (`contextIsolation: true`, `nodeIntegration: false`) |
| `render.js` | `unified` 파이프라인: remark-parse → remark-frontmatter → remark-gfm → remark-math → **fixEscapedMath(블로그 코드 복사)** → remark-rehype → **rehypeLineAnchors**(최상위 블록에 `data-line=시작줄` 부여, 약 10줄) → rehype-katex → rehype-stringify. `render(md) → html` |
| `editor.js` | CodeMirror 6 설정(markdown 하이라이트, 줄바꿈, 다크 테마 전환용 Compartment). 툴바 명령을 순수 함수 두 개로 구성: `wrap(before, after)`(굵게 `**`, 기울임 `_`, 취소선 `~~`, 인라인 코드, 링크 `[text](url)`)와 `linePrefix(prefix)`(H1~H4는 기존 `#`을 교체, 인용 `> `). 코드 버튼은 여러 줄을 선택했으면 ```` ``` ```` 블록으로 감싼다. 이미지 붙여넣기/드롭/버튼은 `FileReader.readAsDataURL` → `![파일명](data:...)` 삽입 |
| `renderer.js` | 뷰어/편집 모드 전환(버튼 + Cmd+E), 150ms 디바운스로 렌더, mermaid 그리기, 스크롤 동기화, 수정 표시, PDF 추출 순서 제어 |
| `index.html` | 레이아웃(툴바: H1 H2 H3 H4 \| B I S \| 인용 링크 이미지 코드), `github-markdown-css`(라이트/다크 자동) + KaTeX CSS, `@media print` 스타일 |
| `test.mjs` | 렌더러와 툴바 명령 검증 (아래 참고) |

렌더러 쪽 ESM 패키지(CodeMirror, unified, mermaid)는 `esbuild`로 번들한다 (`npm run build`).

## 핵심 동작
- **모드**: 파일을 열면 미리보기만 전체 폭으로 보인다. "편집" 버튼이나 Cmd+E를 누르면 왼쪽에 툴바와 에디터가, 오른쪽에 미리보기가 나온다. 다시 누르면 뷰어로 돌아온다.
- **스크롤 동기화 (에디터 → 미리보기 한 방향)**: 에디터 맨 위에 보이는 줄 번호를 구하고(`lineBlockAtHeight`), 그 줄을 감싸는 앞뒤 `data-line` 블록 사이에서 비율을 계산해 미리보기 `scrollTop`을 맞춘다.
- **다크모드**: CSS는 `prefers-color-scheme`로 처리한다. 모드가 바뀌면 `matchMedia` change 이벤트에서 CodeMirror 테마와 mermaid 테마(`dark`/`default`)를 다시 적용한다.
- **PDF**: Cmd+P → 렌더러가 테마를 라이트로 강제 전환 → mermaid를 다시 그림 → main이 `printToPDF`(A4) 실행 → 저장 다이얼로그 → 테마를 `system`으로 되돌림. print CSS가 에디터와 툴바를 숨긴다. 이렇게 하지 않으면 다크모드에서 흰 종이에 밝은 글자가 찍힌다.
- **파일 연결**: electron-builder의 `fileAssociations`로 앱이 .md를 열 수 있다고 등록하고, main에서 `open-file`을 `ready` 전에 받아 큐에 쌓는다. 앱을 **기본 앱**으로 지정하는 건 사용자가 Finder에서 직접 해야 한다 (정보 가져오기 → 다음으로 열기 → 모두 변경).
- **메뉴/단축키**: 새 문서 Cmd+N, 열기 Cmd+O, 저장 Cmd+S, 다른 이름으로 저장 Cmd+Shift+S, PDF Cmd+P, 편집 전환 Cmd+E, 굵게 Cmd+B, 기울임 Cmd+I. 맥에서는 `role: 'editMenu'`가 없으면 복사/붙여넣기가 안 되므로 반드시 넣는다.
- **데이터 보호**: 저장 안 한 상태로 창을 닫거나 앱을 종료하면 "저장/버리기/취소"를 묻는다.
- **설치**: `electron-builder --mac --dir`로 `MD Viewer.app`을 만들어 `/Applications`에 복사한다. 서명을 안 했으므로 처음 한 번은 우클릭 → 열기로 실행해야 한다.

## 실행 순서
0. 노션 ADR 기록 (CLAUDE.md §9): 위 결정표 전부. 버린 선택지와 "당시 몰랐던 것"(Astro가 md 옆 상대경로 이미지를 처리하는지 확인 안 함, 블로그 업로드 API가 삭제돼 base64로 떨어지고 있다는 점 등)까지 넣는다. 메인 모델이 직접 쓰고 fetch로 다시 읽어 한글을 대조한다.
1. `~/md-viewer`를 만들고 `git init`, `PLAN.md`와 `.gitignore`를 커밋한 뒤 `gh repo create Mm-767/md-viewer --public --source . --push` → 확인: GitHub에서 PLAN.md가 보임
2. 의존성 설치 → 확인: 설치 성공
3. `render.js`, `editor.js`의 순수 명령, `test.mjs` → 확인: `npm test` 통과
4. main/preload/index/renderer로 뷰어와 편집 모드 구현 → 확인: `npm start`로 파일을 열고 모드 전환, 입력하면 미리보기가 갱신됨
5. 툴바, 이미지 붙여넣기, 스크롤 동기화 → 확인: 버튼마다 눌러보기, 스크린샷 붙여넣기, 긴 글에서 스크롤해보기
6. 저장, 닫기 확인, PDF, 다크모드 → 확인: 저장한 뒤 다시 열기, 다크모드에서 PDF를 뽑아 라이트로 나오는지 확인
7. 패키징, `/Applications` 설치, 파일 연결 → 확인: Finder에서 .md를 더블클릭하면 앱으로 열림

## 검증
- `test.mjs` (assert, `EditorState`로 DOM 없이 실행):
  - `$x^2$` → `class="katex"` 포함
  - `$$\\prod x\_i$$`처럼 이스케이프된 LaTeX가 `katex-error` 없이 렌더됨
  - 프론트매터가 출력에 없음
  - ```` ```mermaid ```` 블록이 `language-mermaid` 클래스로 나옴
  - 최상위 블록에 `data-line`이 올바른 줄 번호로 붙음
  - `wrap('**','**')`로 선택 영역이 감싸짐, `linePrefix('## ')`를 `# 제목`에 적용하면 `## 제목`이 됨
- 수동: 블로그의 수식 많은 포스트(예: `1장-trade-offs-...md`)를 앱으로 열어 블로그 페이지와 나란히 비교 → PDF로 뽑아 수식과 mermaid 확인

## 이번엔 안 하는 것
- 미리보기 → 에디터 방향 스크롤 동기화
- 에디터에서 긴 base64 문자열을 `[이미지]`로 접어 보이기 (base64 이미지가 많아져서 거슬리면 CodeMirror 데코레이션으로 추가)
- 마크다운 안의 raw HTML 렌더링 (기본으로 제거됨)
- 앱 서명과 공증
