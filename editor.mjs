import { EditorView, basicSetup } from 'codemirror';
import { EditorState, EditorSelection, Compartment, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';

// Toolbar commands take a state and return a transaction spec, so they can be tested without a DOM.

export function wrap(state, before, after = before) {
  return state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
      const inner = text.slice(before.length, text.length - after.length);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    return {
      changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }],
      range: EditorSelection.range(r.from + before.length, r.to + before.length),
    };
  });
}

export function linePrefix(state, prefix) {
  const re = prefix.startsWith('#') ? /^#{1,6} / : /^> /;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; ; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const old = line.text.match(re)?.[0] ?? '';
        changes.push({ from: line.from, to: line.from + old.length, insert: old === prefix ? '' : prefix });
      }
      if (line.to >= r.to) break;
      pos = line.to + 1;
    }
  }
  return { changes };
}

export function codeBlock(state) {
  const r = state.selection.main;
  return state.doc.lineAt(r.from).number === state.doc.lineAt(r.to).number
    ? wrap(state, '`')
    : wrap(state, '```\n', '\n```');
}

// `*` rather than `_`: CommonMark ignores `_` emphasis inside words, which includes Hangul.
export const commands = {
  h1: (s) => linePrefix(s, '# '),
  h2: (s) => linePrefix(s, '## '),
  h3: (s) => linePrefix(s, '### '),
  h4: (s) => linePrefix(s, '#### '),
  bold: (s) => wrap(s, '**'),
  italic: (s) => wrap(s, '*'),
  strike: (s) => wrap(s, '~~'),
  quote: (s) => linePrefix(s, '> '),
  link: (s) => wrap(s, '[', '](https://)'),
  code: codeBlock,
};

export function createEditor(parent, { onChange, onImageFile }) {
  const theme = new Compartment();
  let dark = false;
  const run = (cmd) => (view) => { view.dispatch(cmd(view.state)); return true; };
  const pickImage = (files, e) => {
    const file = [...(files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return false;
    e.preventDefault();
    onImageFile(file);
    return true;
  };
  const extensions = () => [
    basicSetup,
    markdown({ codeLanguages: languages }),
    EditorView.lineWrapping,
    theme.of(dark ? oneDark : []),
    Prec.high(keymap.of([{ key: 'Mod-b', run: run(commands.bold) }, { key: 'Mod-i', run: run(commands.italic) }])),
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(); }),
    EditorView.domEventHandlers({
      paste: (e) => pickImage(e.clipboardData?.files, e),
      drop: (e) => pickImage(e.dataTransfer?.files, e),
    }),
  ];
  const view = new EditorView({ parent, extensions: extensions() });
  return {
    view,
    setDoc: (doc) => view.setState(EditorState.create({ doc, extensions: extensions() })),
    setDark: (value) => {
      dark = value;
      view.dispatch({ effects: theme.reconfigure(dark ? oneDark : []) });
    },
    run: (name) => { view.dispatch(commands[name](view.state)); view.focus(); },
  };
}
