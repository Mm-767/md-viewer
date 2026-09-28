import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { render } from './render.mjs';
import { commands, codeBlock, foldImageData } from './editor.mjs';

// The whole data URL must be folded, however long the line is.
const png = `data:image/png;base64,${'A'.repeat(500000)}`;
const folded = [];
const docWithImage = EditorState.create({ doc: `x\n![image](${png}) text\n![s](data:image/png;base64,abc)`, extensions: foldImageData });
docWithImage.field(foldImageData).between(0, docWithImage.doc.length, (from, to) => { folded.push([from, to]); });
assert.deepEqual(folded, [[11, 11 + png.length]]);

assert.match(await render('$x^2$'), /class="katex"/);

// LLM output escapes LaTeX (\\prod, x\_i); the blog's fix must undo it, inline and display.
// Without the fix KaTeX reads \\ as a line break, so check for the rendered ∏, not katex-error.
assert.match(await render('$\\\\prod_{i} x\\_i$'), /∏/);
const display = await render('$$\n\\\\prod_{i} x\\_i\n$$');
assert.match(display, /katex-display/);
assert.match(display, /∏/);

const withFrontmatter = await render('---\ntitle: "t"\n---\n\n# Hi');
assert.doesNotMatch(withFrontmatter, /title:/);
assert.match(withFrontmatter, /<h1 data-line="5">Hi<\/h1>/);

const highlighted = await render('```js\nconst a = 1;\n```\n\n```\nplain\n```\n\n```nosuchlang\nx\n```');
assert.equal(highlighted.match(/class="shiki shiki-themes md-viewer-dark md-viewer-light notion-dark notion-light"/g)?.length, 3);
assert.match(highlighted, /<span style="--shiki-dark:#C792D9;--shiki-light:#9B3FB5;--shiki-notion-dark:#569CD6;--shiki-notion-light:#0077AA">const<\/span>/);

const mermaidBlock = await render('```mermaid\ngraph TD; A-->B\n```');
assert.match(mermaidBlock, /class="language-mermaid"/);

const anchors = await render('# a\n\npara\n\n- x\n\n```js\nx\n```');
assert.match(anchors, /<h1 data-line="1">/);
assert.match(anchors, /<p data-line="3">/);
assert.match(anchors, /<ul data-line="5">/);
assert.match(anchors, /<pre[^>]*data-line="7"/);

const state = (doc, from, to = from) => EditorState.create({ doc, selection: EditorSelection.single(from, to) });
const run = (s, name) => s.update(commands[name](s)).state;

let s = run(state('hello', 0, 5), 'bold');
assert.equal(s.doc.toString(), '**hello**');
assert.deepEqual([s.selection.main.from, s.selection.main.to], [2, 7]);
s = run(state('**hello**', 0, 9), 'bold');
assert.equal(s.doc.toString(), 'hello');

assert.equal(run(state('# 제목', 0), 'h2').doc.toString(), '## 제목');
assert.equal(run(state('## 제목', 0), 'h2').doc.toString(), '제목');
assert.equal(run(state('a\nb', 0, 3), 'quote').doc.toString(), '> a\n> b');
assert.equal(run(state('a', 0, 1), 'inlineCode').doc.toString(), '`a`');

const block = (s, lang) => s.update(codeBlock(s, lang)).state;
s = block(state('', 0), 'java');
assert.equal(s.doc.toString(), '```java\n\n```');
assert.equal(s.selection.main.head, 8);
assert.equal(block(state('a\nb', 0, 3), '').doc.toString(), '```\na\nb\n```');
assert.equal(block(state('ab', 1), 'py').doc.toString(), 'a\n```py\n\n```\nb');

console.log('all tests passed');
