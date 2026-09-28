# MD Viewer 설계 문서

## 목적
.md 파일을 열 때마다 Xcode로 열려서 불편했다. 그래서 맥에 설치하는 마크다운 앱을 만들었다. 기본은 뷰어이고, 편집 버튼을 누르면 벨로그처럼 왼쪽 에디터(툴바 포함)와 오른쪽 미리보기로 나뉜다. 수식과 코드블록은 [깃블로그](https://github.com/Mm-767/Mm-767.github.io)와 똑같이 보여야 하고, .md 파일로 저장하고 PDF로 내보낼 수 있어야 한다.

## 결정
설계 결정의 자세한 기록(검토한 선택지, 당시 몰랐던 것)은 노션 ADR-47~49에 있다.

| 항목 | 선택 | 버린 선택지 또는 이유 |
|---|---|---|
| 기술 스택 | Electron | Tauri(Rust 설치, macOS PDF 추출 우회 필요), SwiftUI(Swift와 JS를 오가야 함) |
| 저장 | .md 파일 열기/저장 | 자동저장, 앱 내부 보관함 |
| 이미지 | md 안에 base64로 넣기(블로그와 같은 방식) | md 옆 images 폴더 |
| 에디터 | CodeMirror 6 | textarea(문법 하이라이트 없음), Monaco(이 용도에 무거움) |
| 스크롤 동기화 | 문단 단위(에디터 → 미리보기) | 비율로 맞추기(수식·mermaid가 많으면 어긋남) |
| 다크모드 | 맥 설정 따라가기 | 앱 안 수동 전환 |
| mermaid | 넣기 | 나중에 |
| 제목·태그 입력칸 | 넣지 않기 | 벨로그식 입력칸 |
| 코드 하이라이트 | Shiki `github-dark` | 블로그(Astro 기본)와 같은 결과를 내기 위해 |
| 코드블록 입력 | 언어 검색 팝업 | 벨로그식 ``` 뒤 자동완성, 둘 다 |
| 인라인 코드 단축키 | ⇧⌘C | ⌘`는 macOS의 같은 앱 창 전환과 겹친다 |
| 단축키 안내 | 서식 메뉴 + 도움말 → 키보드 단축키 | 목록은 메뉴 템플릿에서 만들어서 실제 단축키와 어긋나지 않는다 |
| base64 표시 | 에디터에서만 썸네일 칩으로 접기, 파일은 그대로 | 저장 방식을 images 폴더로 바꾸기 |
| 배포 | GitHub Releases에 dmg(Apple Silicon) | 공증 없음, Apple Development 인증서로 서명 |

## 구조
| 파일 | 역할 |
|---|---|
| `main.js` | 메인 프로세스. 파일 하나당 창 하나(비어 있는 새 창은 재사용), 메뉴와 단축키, 열기/저장 다이얼로그, 수정 여부 추적과 닫기 확인, PDF 내보내기, Finder 더블클릭(`open-file`) 처리, 외부 링크를 브라우저로 열기 |
| `preload.js` | `contextBridge`로 IPC 네 가지만 노출(`onLoad`, `onSaved`, `onMenu`, `setDirty`). `contextIsolation` 켜짐, `nodeIntegration` 꺼짐 |
| `render.mjs` | 마크다운 → HTML. `render(md)`는 비동기다 |
| `editor.mjs` | CodeMirror 설정과 툴바 명령(`wrap`, `linePrefix`, `codeBlock`), base64 이미지 접기 |
| `renderer.mjs` | 화면 쪽 로직. 뷰어/편집 전환, 미리보기 렌더와 mermaid, 스크롤 동기화, 툴바·메뉴 명령 실행, 언어 선택 팝업 |
| `index.html` | 레이아웃과 스타일. `github-markdown-css`와 KaTeX CSS를 쓰고, 코드블록 스타일은 블로그의 `src/pages/posts/[slug].astro`와 맞춘다 |
| `test.mjs` | 렌더링과 에디터 명령 테스트(`npm test`) |
| `scripts/render-icon.js` | `build/icon.svg`를 1024px `build/icon.png`로 렌더링(`npm run icon`) |
| `build/` | 앱 아이콘. electron-builder가 `icon.png`로 `.icns`를 만든다 |

렌더러 쪽 패키지(CodeMirror, unified, Shiki, mermaid)는 `esbuild`로 `dist/renderer.js` 하나에 묶는다. 그래서 패키지된 앱에는 `node_modules`가 들어가지 않고 모두 `devDependencies`에 있다.

## 렌더링 파이프라인
```
remark-parse → remark-frontmatter → remark-gfm → remark-math → fixEscapedMath
→ remark-rehype → rehype-katex → recordLines → rehype-shiki → applyLines → rehype-stringify
```
- **fixEscapedMath**: LLM 출력에서 이스케이프된 LaTeX(`\\prod`, `x\_i`)를 되돌린다. 블로그 `astro.config.mjs`의 `remarkFixEscapedMath`와 같은 코드라서, 한쪽을 고치면 다른 쪽도 고쳐야 한다. remark-math가 미리 만든 `hChildren`까지 고쳐야 하고, 블록 수식은 `pre > code > text`로 한 단계 더 깊어서 하위 트리 전체를 훑는다.
- **recordLines / applyLines**: 최상위 블록마다 원본 줄 번호를 `data-line`으로 붙인다. 스크롤 동기화에 쓴다. Shiki가 `<pre>`를 같은 자리에서 새로 만들면서 속성을 지우기 때문에, Shiki 전에 기록하고 후에 다시 붙인다.
- **rehype-shiki**: `github-dark`. 언어가 없거나 모르는 언어면 `plaintext`로 처리한다. `language-mermaid` 클래스를 남겨서 렌더러가 mermaid 블록을 찾을 수 있게 한다.
- 프론트매터는 출력하지 않는다. 마크다운 안의 raw HTML은 렌더링하지 않는다.

## 핵심 동작
- **모드**: 파일을 열면 미리보기만 보인다. 편집 버튼이나 ⌘E를 누르면 에디터와 미리보기가 나란히 나온다. 새 문서는 편집 모드로 시작한다.
- **미리보기 갱신**: 입력 후 150ms 뒤에 렌더링한다. 렌더링은 비동기라서 순번을 매겨 늦게 끝난 옛 결과가 새 결과를 덮지 않게 한다. mermaid SVG는 테마와 소스를 키로 캐시한다.
- **스크롤 동기화**: 에디터 맨 위 줄 번호를 구해서, 앞뒤 `data-line` 블록 사이를 비율로 보간해 미리보기 위치를 맞춘다.
- **서식 명령**: 툴바 버튼과 서식 메뉴가 같은 `runCommand`를 거친다. 단축키는 메뉴에 달려 있어서 CodeMirror보다 먼저 받는다. 편집 모드가 아니면 무시한다.
- **코드블록**: 언어를 고르면 여는 펜스와 닫는 펜스가 각각 한 줄을 차지하도록 필요하면 줄을 나눠서 넣고, 커서를 블록 안으로 옮긴다. 선택한 글자가 있으면 그 글자를 감싼다.
- **base64 이미지 접기**: `data:image/...;base64,...`를 썸네일과 용량만 보이는 칩으로 바꿔서 보여준다. 칩은 하나의 덩어리라 백스페이스 한 번에 지워지고, 복사하면 원본 텍스트가 복사된다. CodeMirror는 아주 긴 줄의 일부만 화면에 그려서, 화면만 보는 `MatchDecorator`로는 일부만 접힌다. 그래서 `StateField`로 문서 전체를 훑는다.
- **이미지 경로**: 상대경로 이미지는 열린 md 파일 위치 기준의 `file://` 주소로 바꿔서 보여준다.
- **저장과 수정 표시**: 편집할 때마다 버전 번호를 올리고, 저장할 때의 버전과 비교해서 수정 여부를 정한다. 저장 중에 입력해도 수정 표시가 잘못 꺼지지 않는다. 창 제목과 닫기 버튼의 점(●)으로 보여준다.
- **닫기 확인**: 저장하지 않은 창을 닫으면 저장/저장 안 함/취소를 묻는다.
- **PDF**: ⌘P를 누르면 테마를 잠깐 라이트로 바꾸고 mermaid를 다시 그린 뒤 A4로 `printToPDF`하고, 끝나면 시스템 테마로 되돌린다. 그러지 않으면 다크모드에서 흰 종이에 밝은 글자가 찍힌다. print CSS가 에디터와 버튼을 숨긴다.
- **파일 연결**: electron-builder의 `fileAssociations`로 .md/.markdown을 열 수 있는 앱으로 등록한다. 앱이 준비되기 전에 들어온 `open-file`은 큐에 쌓았다가 연다. 기본 앱 지정은 사용자가 Finder에서 한다.
- **링크**: 미리보기의 http(s) 링크는 기본 브라우저로 연다. 미리보기에 .md 파일을 끌어다 놓으면 새 창으로 연다.

## 테스트
`npm test`(`test.mjs`)는 DOM 없이 돌아간다.
- 인라인·블록 수식의 이스케이프 복원
- 프론트매터 제거, `data-line` 줄 번호(코드블록 포함)
- Shiki 하이라이트, 언어 없음/모르는 언어 처리, mermaid 클래스 유지
- 툴바 명령(굵게 토글, 제목 교체, 인용, 인라인 코드, 코드블록 삽입 위치)
- 50만 자짜리 base64 줄이 통째로 접히는지

창, 메뉴, PDF, 붙여넣기는 테스트가 없다. 바꿨다면 `npm start`로 직접 확인한다.

## 하지 않은 것
- 미리보기 → 에디터 방향 스크롤 동기화
- 마크다운 안의 raw HTML 렌더링
- 공증(notarization)과 Intel 맥 빌드
- 앱 안에서 라이트/다크 직접 고르기
- base64 접기는 입력할 때마다 문서 전체를 다시 훑는다. 수 MB까지는 문제없지만 느려지면 변경 범위만 갱신하도록 바꿔야 한다.

## 처음 계획에서 바뀐 것
- **렌더링이 비동기가 됐다.** 블로그와 같은 코드블록을 내려고 Shiki를 넣었기 때문이다. `data-line`도 Shiki 앞뒤로 나눠 붙이게 바뀌었다.
- **블록 수식 버그를 찾았다.** 블로그에서 가져온 `remarkFixEscapedMath`가 블록 수식을 못 고치고 있었다. 앱과 블로그를 함께 고쳤다(블로그 PR #1). 확인할 때 Astro 콘텐츠 캐시(`node_modules/.astro`) 때문에 수정 전 빌드도 정상처럼 보여서 한 번 잘못 판단했다.
- **mermaid 라이트 테마**를 `default`에서 블로그와 같은 `neutral`로 바꿨다.
- **코드 버튼을 둘로 나눴다.** 처음에는 하나의 버튼이 한 줄이면 인라인, 여러 줄이면 블록이었다. 선택 없이 누르면 인라인이 들어가서 코드블록을 만들 방법이 안 보였다. 그래서 인라인 코드 버튼과 코드블록(언어 선택) 버튼으로 나눴다.
- **단축키를 CodeMirror 키맵에서 메뉴로 옮겼다.** 메뉴에 표시되고 도움말 목록도 자동으로 만들어진다.
- **base64 접기**는 처음에 "안 함"이었는데 구현했다.
- **패키징 결과 폴더를 `dist/`에서 `release/`로 옮겼다.** 렌더러 번들 폴더와 겹쳤기 때문이다. dmg 릴리스도 추가했다.
- **서명**은 "안 함"으로 계획했는데, electron-builder가 키체인의 Apple Development 인증서로 자동 서명했다. 공증은 안 돼 있다.
- **앱 용량**은 150MB로 예상했는데 305MB였다. 대부분이 Electron이고, 앱 코드(`app.asar`)는 Shiki 문법 데이터를 포함해 약 18MB다.
