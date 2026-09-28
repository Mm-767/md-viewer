import mermaid from 'mermaid';
import { render } from './render.mjs';
import { createEditor } from './editor.mjs';

const preview = document.getElementById('preview');
const article = preview.querySelector('.markdown-body');
const modeBtn = document.getElementById('mode-btn');
const imageInput = document.getElementById('image-input');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let dir = null;
let version = 0; // bumped on every edit; compared with the version last written to disk
let savedVersion = 0;
let dirty = false;
let renderSeq = 0;
let lastRender = Promise.resolve();
let timer;

const editor = createEditor(document.getElementById('editor'), {
  onChange: () => {
    version++;
    setDirty(true);
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  },
  onImageFile: insertImage,
});

function setDirty(value) {
  if (value === dirty) return;
  dirty = value;
  window.api.setDirty(value);
}

function update() {
  const seq = ++renderSeq;
  article.innerHTML = render(editor.view.state.doc.toString());
  fixImagePaths();
  lastRender = drawMermaid(seq).then(() => { if (isEditing()) syncScroll(); });
  return lastRender;
}

// ponytail: unbounded cache keyed by theme+source; fine for one document's diagrams.
const svgCache = new Map();
let mermaidId = 0;

async function drawMermaid(seq) {
  const theme = darkQuery.matches ? 'dark' : 'default';
  for (const code of article.querySelectorAll('pre > code.language-mermaid')) {
    const src = code.textContent;
    const key = `${theme}\n${src}`;
    if (!svgCache.has(key)) {
      try {
        await mermaid.parse(src);
        svgCache.set(key, (await mermaid.render(`mermaid-${mermaidId++}`, src)).svg);
      } catch {
        svgCache.set(key, null); // invalid while typing: leave the source visible
      }
    }
    if (seq !== renderSeq) return;
    const svg = svgCache.get(key);
    if (!svg) continue;
    const div = document.createElement('div');
    div.className = 'mermaid';
    if (code.parentElement.dataset.line) div.dataset.line = code.parentElement.dataset.line;
    div.innerHTML = svg;
    code.parentElement.replaceWith(div);
  }
}

function fixImagePaths() {
  if (!dir) return;
  const base = `file://${encodeURI(dir)}/`;
  for (const img of article.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) img.src = new URL(src, base).href;
  }
}

// Maps the editor's top line onto the preview by interpolating between the
// nearest top-level blocks tagged with data-line.
function syncScroll() {
  const { view } = editor;
  const scroller = view.scrollDOM;
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  if (maxScroll > 0 && scroller.scrollTop >= maxScroll - 2) {
    preview.scrollTop = preview.scrollHeight;
    return;
  }
  const block = view.lineBlockAtHeight(scroller.scrollTop);
  const line = view.state.doc.lineAt(block.from).number + (scroller.scrollTop - block.top) / Math.max(block.height, 1);
  let prev = { line: 1, top: 0 };
  let next = { line: view.state.doc.lines + 1, top: article.offsetTop + article.offsetHeight };
  for (const el of article.querySelectorAll(':scope > [data-line]')) {
    const l = Number(el.dataset.line);
    if (l <= line) prev = { line: l, top: el.offsetTop };
    else { next = { line: l, top: el.offsetTop }; break; }
  }
  const ratio = (line - prev.line) / Math.max(next.line - prev.line, 1);
  preview.scrollTop = prev.top + (next.top - prev.top) * ratio - 24;
}

const isEditing = () => document.body.classList.contains('editing');

function setEditing(on) {
  document.body.classList.toggle('editing', on);
  modeBtn.textContent = on ? '보기' : '편집';
  if (!on) return;
  editor.view.requestMeasure();
  editor.view.focus();
  syncScroll();
}

function insertImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const { view } = editor;
    view.dispatch(view.state.replaceSelection(`![image](${reader.result})`));
    view.focus();
  };
  reader.readAsDataURL(file);
}

function applyTheme() {
  editor.setDark(darkQuery.matches);
  mermaid.initialize({ startOnLoad: false, theme: darkQuery.matches ? 'dark' : 'default' });
  return update();
}

const toolbar = document.getElementById('toolbar');
toolbar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
toolbar.addEventListener('click', (e) => {
  const cmd = e.target.closest('button[data-cmd]')?.dataset.cmd;
  if (cmd === 'image') imageInput.click();
  else if (cmd) editor.run(cmd);
});
imageInput.addEventListener('change', () => {
  if (imageInput.files[0]) insertImage(imageInput.files[0]);
  imageInput.value = '';
});
modeBtn.addEventListener('click', () => setEditing(!isEditing()));
editor.view.scrollDOM.addEventListener('scroll', () => { if (isEditing()) syncScroll(); });
darkQuery.addEventListener('change', applyTheme);

window.api.onLoad(({ content, dir: d, editing }) => {
  dir = d;
  version = savedVersion = 0;
  dirty = false;
  editor.setDoc(content);
  update();
  setEditing(editing);
  preview.scrollTop = 0;
});
window.api.onSaved(({ dir: d, version: v }) => {
  dir = d;
  savedVersion = v;
  setDirty(version !== savedVersion);
  fixImagePaths();
});
window.api.onMenu((action) => {
  if (action === 'toggle-edit') setEditing(!isEditing());
});

window.__getContent = () => ({ text: editor.view.state.doc.toString(), version });
window.__prepareForPrint = async () => {
  // nativeTheme was just switched to light; wait for the media query to follow.
  for (let i = 0; i < 50 && darkQuery.matches; i++) await new Promise((r) => setTimeout(r, 20));
  await applyTheme();
  for (let p; p !== lastRender; ) { p = lastRender; await p; }
};

applyTheme();
