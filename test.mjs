import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { render } from './render.mjs';
import { commands } from './editor.mjs';

assert.match(render('$x^2$'), /class="katex"/);

// LLM output escapes LaTeX (\\prod, x\_i); the blog's fix must undo it. Without the fix
// KaTeX reads \\ as a line break, so check for the rendered ∏ rather than for katex-error.
assert.match(render('$\\\\prod_{i} x\\_i$'), /∏/);

const withFrontmatter = render('---\ntitle: "t"\n---\n\n# Hi');
assert.doesNotMatch(withFrontmatter, /title:/);
assert.match(withFrontmatter, /<h1 data-line="5">Hi<\/h1>/);

assert.match(render('```mermaid\ngraph TD; A-->B\n```'), /class="language-mermaid"/);

const anchors = render('# a\n\npara\n\n- x');
assert.match(anchors, /<h1 data-line="1">/);
assert.match(anchors, /<p data-line="3">/);
assert.match(anchors, /<ul data-line="5">/);

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
assert.equal(run(state('a\nb', 0, 3), 'code').doc.toString(), '```\na\nb\n```');
assert.equal(run(state('a', 0, 1), 'code').doc.toString(), '`a`');

console.log('all tests passed');
