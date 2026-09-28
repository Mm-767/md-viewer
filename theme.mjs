import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// One syntax palette per mode, shared by the preview (Shiki) and the editor (CodeMirror)
// so a keyword is the same color in both panes. Page and chrome colors live in index.html.
export const SYNTAX = {
  dark: {
    fg: '#d4d4d4', comment: '#6f6f6f', keyword: '#c792d9', type: '#e5c07b', property: '#e0935f',
    primitive: '#8abeb7', string: '#b5bd68', func: '#82aadf', punct: '#b4b4b4',
  },
  light: {
    fg: '#2b2b2b', comment: '#9a9a9a', keyword: '#9b3fb5', type: '#a36a00', property: '#c2542d',
    primitive: '#1f7a73', string: '#4f7d12', func: '#2f6db3', punct: '#555555',
  },
};

function shikiTheme(name, type, c) {
  const rule = (scope, foreground) => ({ scope, settings: { foreground } });
  return {
    name,
    type,
    colors: { 'editor.foreground': c.fg, 'editor.background': '#00000000' },
    tokenColors: [
      rule(['comment', 'punctuation.definition.comment'], c.comment),
      rule(['keyword', 'storage.type', 'storage.modifier', 'keyword.operator.new', 'keyword.operator.expression', 'variable.language'], c.keyword),
      rule(['support.type.primitive', 'support.type.builtin', 'keyword.type', 'storage.type.primitive', 'support.type.python'], c.primitive),
      rule(['entity.name.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class', 'entity.name.namespace', 'entity.other.attribute-name'], c.type),
      rule(['variable.object.property', 'variable.other.property', 'variable.other.object.property', 'meta.object-literal.key', 'support.variable.property', 'entity.name.tag', 'support.type.property-name', 'constant.numeric', 'constant.language'], c.property),
      rule(['string', 'punctuation.definition.string', 'markup.inline.raw'], c.string),
      rule(['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], c.func),
      rule(['punctuation', 'meta.brace', 'keyword.operator'], c.punct),
    ],
  };
}

export const shikiThemes = {
  dark: shikiTheme('md-viewer-dark', 'dark', SYNTAX.dark),
  light: shikiTheme('md-viewer-light', 'light', SYNTAX.light),
};

function editorTheme(dark, c) {
  const view = EditorView.theme({
    '&': { color: c.fg, backgroundColor: 'var(--pane)' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection)' },
    '.cm-gutters': { backgroundColor: 'var(--pane)', color: 'var(--faint)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: 'var(--muted)' },
  }, { dark });
  const highlight = HighlightStyle.define([
    { tag: t.heading, color: 'var(--fg)', fontWeight: '700' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.link, t.url], color: 'var(--accent)' },
    { tag: t.monospace, color: 'var(--accent)' },
    { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
    { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--faint)' },
    { tag: t.comment, color: c.comment },
    { tag: [t.keyword, t.modifier, t.operatorKeyword], color: c.keyword },
    { tag: [t.typeName, t.className, t.namespace], color: c.type },
    { tag: [t.propertyName, t.number, t.bool, t.atom, t.tagName], color: c.property },
    { tag: [t.standard(t.typeName)], color: c.primitive },
    { tag: [t.string, t.special(t.string)], color: c.string },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.func },
  ]);
  return [view, syntaxHighlighting(highlight)];
}

export const editorThemes = {
  dark: editorTheme(true, SYNTAX.dark),
  light: editorTheme(false, SYNTAX.light),
};
