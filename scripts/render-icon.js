// Renders build/icon.svg to the 1024px transparent build/icon.png that electron-builder uses.
// Run with `npm run icon` after editing the SVG.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const svgPath = path.join(__dirname, '..', 'build', 'icon.svg');
const pngPath = path.join(__dirname, '..', 'build', 'icon.png');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const svg = fs.readFileSync(svgPath, 'utf8');
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`)}`);
  let frames = 0;
  win.webContents.on('paint', (_e, _dirty, image) => {
    if (++frames < 3) return; // the first frames can be blank while the SVG lays out
    fs.writeFileSync(pngPath, image.resize({ width: 1024, height: 1024 }).toPNG());
    console.log(`wrote ${path.relative(process.cwd(), pngPath)}`);
    app.exit(0);
  });
});
