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
  lastRender = renderPreview(++renderSeq);
  return lastRender;
}

async function renderPreview(seq) {
  const html = await render(editor.view.state.doc.toString());
  if (seq !== renderSeq) return;
  article.innerHTML = html;
  fixImagePaths();
  await drawMermaid(seq);
  if (seq === renderSeq && isEditing()) syncScroll();
}

// ponytail: unbounded cache keyed by theme+source; fine for one document's diagrams.
const svgCache = new Map();
let mermaidId = 0;

async function drawMermaid(seq) {
  const theme = darkQuery.matches ? 'dark' : 'neutral';
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
  mermaid.initialize({ startOnLoad: false, theme: darkQuery.matches ? 'dark' : 'neutral' });
  return update();
}

function runCommand(cmd) {
  if (!isEditing()) return;
  if (cmd === 'image') imageInput.click();
  else if (cmd === 'codeBlock') openLangPicker();
  else editor.run(cmd);
}

const toolbar = document.getElementById('toolbar');
toolbar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
toolbar.addEventListener('click', (e) => {
  const cmd = e.target.closest('button[data-cmd]')?.dataset.cmd;
  if (cmd) runCommand(cmd);
});

// Shiki language ids; anything typed that isn't listed can still be used as-is.
const LANGS = [
  ['', '없음 (일반 텍스트)'], ['java', 'Java'], ['python', 'Python'], ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'], ['sql', 'SQL'], ['bash', 'Bash'], ['json', 'JSON'], ['html', 'HTML'],
  ['css', 'CSS'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['kotlin', 'Kotlin'], ['swift', 'Swift'],
  ['go', 'Go'], ['rust', 'Rust'], ['dart', 'Dart'], ['yaml', 'YAML'], ['markdown', 'Markdown'],
  ['mermaid', 'Mermaid (다이어그램)'], ['diff', 'Diff'],
];
const picker = document.getElementById('lang-picker');
const langSearch = document.getElementById('lang-search');
const langList = document.getElementById('lang-list');
let langItems = [];
let langActive = 0;

function openLangPicker() {
  const btn = toolbar.querySelector('[data-cmd="codeBlock"]').getBoundingClientRect();
  picker.style.left = `${btn.left}px`;
  picker.style.top = `${btn.bottom + 4}px`;
  picker.hidden = false;
  langSearch.value = '';
  filterLangs();
  langSearch.focus();
}

function closeLangPicker() {
  picker.hidden = true;
  editor.view.focus();
}

function filterLangs() {
  const q = langSearch.value.trim().toLowerCase();
  langItems = LANGS.filter(([id, name]) => !q || id.includes(q) || name.toLowerCase().includes(q));
  if (q && !LANGS.some(([id]) => id === q)) langItems.push([q, `"${q}" 그대로 쓰기`]);
  langActive = 0;
  drawLangs();
}

function drawLangs() {
  langList.replaceChildren(...langItems.map(([id, name], i) => {
    const li = document.createElement('li');
    li.textContent = name;
    li.classList.toggle('active', i === langActive);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); chooseLang(id); });
    return li;
  }));
  langList.children[langActive]?.scrollIntoView({ block: 'nearest' });
}

function chooseLang(id) {
  closeLangPicker();
  editor.insertCodeBlock(id);
}

langSearch.addEventListener('input', filterLangs);
langSearch.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'ArrowDown') langActive = Math.min(langActive + 1, langItems.length - 1);
  else if (e.key === 'ArrowUp') langActive = Math.max(langActive - 1, 0);
  else if (e.key === 'Enter') { e.preventDefault(); if (langItems[langActive]) chooseLang(langItems[langActive][0]); return; }
  else if (e.key === 'Escape') { closeLangPicker(); return; }
  else return;
  e.preventDefault();
  drawLangs();
});
document.addEventListener('mousedown', (e) => {
  if (!picker.hidden && !picker.contains(e.target)) picker.hidden = true;
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
  else if (action.startsWith('format:')) runCommand(action.slice('format:'.length));
});

window.__getContent = () => ({ text: editor.view.state.doc.toString(), version });
window.__prepareForPrint = async () => {
  // nativeTheme was just switched to light; wait for the media query to follow.
  for (let i = 0; i < 50 && darkQuery.matches; i++) await new Promise((r) => setTimeout(r, 20));
  await applyTheme();
  for (let p; p !== lastRender; ) { p = lastRender; await p; }
};

applyTheme();
