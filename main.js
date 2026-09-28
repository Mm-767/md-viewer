const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const docs = new Map(); // window id -> { path, dirty, forceClose }
const pending = [];
const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const doc = { path: null, dirty: false, forceClose: false };
  docs.set(win.id, doc);
  win.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault()); // keep the file name, not index.html's <title>
  updateTitle(win);

  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
    else if (url.startsWith('file:') && /\.(md|markdown)$/i.test(url)) openPath(fileURLToPath(url));
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', async (e) => {
    if (!doc.dirty || doc.forceClose) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      message: `"${title(doc)}"의 변경 내용을 저장할까요?`,
      detail: '저장하지 않으면 변경 내용이 사라집니다.',
    });
    if (response === 2) return;
    if (response === 0 && !(await save(win))) return;
    doc.forceClose = true;
    win.close();
  });
  win.on('closed', () => docs.delete(win.id));
  return win;
}

const title = (doc) => (doc.path ? path.basename(doc.path) : '새 문서');

function updateTitle(win) {
  const doc = docs.get(win.id);
  win.setTitle(title(doc));
  win.setRepresentedFilename(doc.path ?? '');
  win.setDocumentEdited(doc.dirty);
}

async function openPath(filePath) {
  const existing = BrowserWindow.getAllWindows().find((w) => docs.get(w.id)?.path === filePath);
  if (existing) return existing.focus();
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    return dialog.showErrorBox('파일을 열 수 없습니다', `${filePath}\n${err.message}`);
  }
  const focused = BrowserWindow.getFocusedWindow();
  const blank = focused && !docs.get(focused.id).path && !docs.get(focused.id).dirty;
  const win = blank ? focused : createWindow();
  const doc = docs.get(win.id);
  doc.path = filePath;
  doc.dirty = false;
  updateTitle(win);
  app.addRecentDocument(filePath);
  await win.loaded;
  win.webContents.send('load', { content, dir: path.dirname(filePath), editing: false });
}

async function openDialog(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: MD_FILTER });
  if (!canceled) filePaths.forEach(openPath);
}

async function newDocument() {
  const win = createWindow();
  await win.loaded;
  win.webContents.send('load', { content: '', dir: null, editing: true });
}

async function save(win, saveAs = false) {
  const doc = docs.get(win.id);
  let filePath = doc.path;
  if (!filePath || saveAs) {
    const r = await dialog.showSaveDialog(win, { defaultPath: filePath ?? '제목 없음.md', filters: MD_FILTER });
    if (r.canceled) return false;
    filePath = r.filePath;
  }
  const { text, version } = await win.webContents.executeJavaScript('__getContent()');
  try {
    await fs.writeFile(filePath, text, 'utf8');
  } catch (err) {
    dialog.showErrorBox('저장하지 못했습니다', `${filePath}\n${err.message}`);
    return false;
  }
  doc.path = filePath;
  updateTitle(win);
  app.addRecentDocument(filePath);
  win.webContents.send('saved', { dir: path.dirname(filePath), version });
  return true;
}

// PDFs (the live preview and the export) are printed from one hidden window that is always in
// light mode, so dark mode never ends up on paper and the visible windows never flicker.
let printWindow;
let printQueue = Promise.resolve();

async function getPrintWindow() {
  if (printWindow && !printWindow.isDestroyed()) return printWindow;
  printWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  await printWindow.loadFile(path.join(__dirname, 'index.html'), { query: { print: '1' } });
  printWindow.webContents.debugger.attach('1.3');
  await printWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  return printWindow;
}

// ponytail: one print at a time; a slow render delays the next preview rather than racing it.
function renderPdf(text, dir) {
  const job = printQueue.then(async () => {
    const win = await getPrintWindow();
    await win.webContents.executeJavaScript(`__renderForPrint(${JSON.stringify(text)}, ${JSON.stringify(dir)})`);
    return win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  });
  printQueue = job.catch(() => {});
  return job;
}

const docDir = (win) => {
  const doc = docs.get(win.id);
  return doc?.path ? path.dirname(doc.path) : null;
};

ipcMain.handle('render-pdf', (e, text) => renderPdf(text, docDir(BrowserWindow.fromWebContents(e.sender))));

async function exportPdf(win) {
  const doc = docs.get(win.id);
  const base = doc.path ? doc.path.replace(/\.(md|markdown)$/i, '') : '제목 없음';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${base}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled) return;
  try {
    const { text } = await win.webContents.executeJavaScript('__getContent()');
    await fs.writeFile(filePath, await renderPdf(text, docDir(win)));
  } catch (err) {
    dialog.showErrorBox('PDF를 만들지 못했습니다', err.message);
  }
}

ipcMain.on('dirty', (e, dirty) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  docs.get(win.id).dirty = dirty;
  updateTitle(win);
});

let template;

function buildMenu() {
  const send = (action) => (_item, win) => win?.webContents.send('menu', action);
  template = [
    { role: 'appMenu' },
    {
      label: '파일',
      submenu: [
        { label: '새 문서', accelerator: 'CmdOrCtrl+N', click: newDocument },
        { label: '열기…', accelerator: 'CmdOrCtrl+O', click: (_item, win) => openDialog(win) },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: (_item, win) => win && save(win) },
        { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: (_item, win) => win && save(win, true) },
        { label: 'PDF로 내보내기…', accelerator: 'CmdOrCtrl+P', click: (_item, win) => win && exportPdf(win) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '서식',
      submenu: FORMAT_MENU.map((item) => (item
        ? { label: item[1], accelerator: item[2], click: send(`format:${item[0]}`) }
        : { type: 'separator' })),
    },
    {
      label: '보기',
      submenu: [
        { label: '편집 모드 전환', accelerator: 'CmdOrCtrl+E', click: send('toggle-edit') },
        { type: 'separator' },
        { label: '미리보기: 기본', accelerator: 'CmdOrCtrl+Alt+1', click: send('preview:basic') },
        { label: '미리보기: PDF', accelerator: 'CmdOrCtrl+Alt+2', click: send('preview:pdf') },
        { label: '미리보기: 노션', accelerator: 'CmdOrCtrl+Alt+3', click: send('preview:notion') },
        { type: 'separator' },
        { label: 'PDF 확대', accelerator: 'CmdOrCtrl+=', click: send('zoom:in') },
        { label: 'PDF 축소', accelerator: 'CmdOrCtrl+-', click: send('zoom:out') },
        { label: 'PDF 폭 맞춤', accelerator: 'CmdOrCtrl+0', click: send('zoom:fit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: '도움말',
      submenu: [{ label: '키보드 단축키', click: (_item, win) => showShortcuts(win) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const FORMAT_MENU = [
  ['h1', '제목 1', 'CmdOrCtrl+1'],
  ['h2', '제목 2', 'CmdOrCtrl+2'],
  ['h3', '제목 3', 'CmdOrCtrl+3'],
  ['h4', '제목 4', 'CmdOrCtrl+4'],
  null,
  ['bold', '굵게', 'CmdOrCtrl+B'],
  ['italic', '기울임', 'CmdOrCtrl+I'],
  ['strike', '취소선', 'CmdOrCtrl+Shift+X'],
  ['inlineCode', '인라인 코드', 'CmdOrCtrl+Shift+C'],
  null,
  ['quote', '인용', 'CmdOrCtrl+Alt+Q'],
  ['link', '링크', 'CmdOrCtrl+K'],
  ['image', '이미지…', 'CmdOrCtrl+Shift+I'],
  ['codeBlock', '코드블록…', 'CmdOrCtrl+Alt+C'],
];

// macOS lists modifiers as ⌥⇧⌘ regardless of how the accelerator is written.
const MODIFIERS = [['Alt', '⌥'], ['Shift', '⇧'], ['CmdOrCtrl', '⌘']];
const keySymbols = (accelerator) => {
  const parts = accelerator.split('+');
  const key = parts.pop();
  return MODIFIERS.filter(([name]) => parts.includes(name)).map(([, symbol]) => symbol).join('') + key;
};

// Built from the menu template, so the list can't drift from the real shortcuts.
function showShortcuts(win) {
  const sections = template
    .filter((menu) => menu.submenu?.some((item) => item.accelerator))
    .map((menu) => [`[${menu.label}]`, ...menu.submenu.filter((item) => item.accelerator)
      .map((item) => `${item.label}   ${keySymbols(item.accelerator)}`)].join('\n'));
  dialog.showMessageBox(win, { message: '키보드 단축키', detail: `${sections.join('\n\n')}\n\n서식 단축키는 편집 모드에서 동작합니다.` });
}

// macOS delivers Finder double-clicks via open-file, possibly before the app is ready.
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (app.isReady()) openPath(filePath);
  else pending.push(filePath);
});

app.whenReady().then(() => {
  buildMenu();
  const cliFiles = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => /\.(md|markdown)$/i.test(a));
  const files = [...pending, ...cliFiles.map((f) => path.resolve(f))];
  if (files.length) files.forEach(openPath);
  else newDocument();
});

app.on('window-all-closed', () => {}); // stay in the Dock like other macOS apps

app.on('activate', () => {
  if (docs.size === 0) newDocument(); // the hidden print window doesn't count
});
