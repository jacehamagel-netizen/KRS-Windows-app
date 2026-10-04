const { app, BrowserWindow, shell, Menu, Tray, dialog, net, session, powerMonitor, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const PORTAL_URL = 'https://krs-student-portal.web.app';
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

// ---- EDIT THESE: shown in Help > About and Help > Contact support ----
const SUPPORT = {
  school: 'Kilifi Rising Star Academy',
  email: '',        // e.g. 'info@yourschool.ac.ke'
  phone: ''         // e.g. '+254 700 000000'
};

/* ---------- saved settings ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { autoStart: false, runInBackground: true, autoLockMinutes: 15, downloadDir: '' };
let settings = { ...DEFAULTS };
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch { /* non-fatal */ }
}
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
const startHidden = process.argv.includes('--hidden');
let tray = null;
app.isQuitting = false;

let win = null;
let splash = null;
let offlineTimer = null;
let showingOffline = false;
let shownOnce = false;

/* ---------- remember window size / position ---------- */
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.isMaximized() ? (loadState().bounds || win.getNormalBounds()) : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ bounds: b, maximized: win.isMaximized() }));
  } catch { /* non-fatal */ }
}

/* ---------- print / save as PDF ---------- */
function printPage() {
  if (win) win.webContents.print({ printBackground: true });
}
async function savePdf() {
  if (!win) return;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save as PDF',
    defaultPath: path.join(app.getPath('documents'), 'KRS-Portal.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return;
  try {
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(filePath, data);
    dialog.showMessageBox(win, { type: 'info', message: 'PDF saved', detail: filePath });
  } catch (e) {
    dialog.showErrorBox('Could not save PDF', String(e.message || e));
  }
}
function applyAutoStart() {
  if (!app.isPackaged || isPortable()) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, args: ['--hidden'] });
}
function chooseDownloadDir() {
  const r = dialog.showOpenDialogSync(win || undefined, {
    title: 'Choose where downloads are saved',
    defaultPath: settings.downloadDir || app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (r && r[0]) { settings.downloadDir = r[0]; saveSettings(); buildMenu(); }
}
function showAbout() {
  const lines = [
    `Version ${app.getVersion()}`,
    '',
    SUPPORT.school + ' student portal',
    SUPPORT.email ? `Email: ${SUPPORT.email}` : '',
    SUPPORT.phone ? `Phone: ${SUPPORT.phone}` : '',
    !SUPPORT.email && !SUPPORT.phone ? 'For help, please contact the school office.' : '',
    '',
    'Portal: ' + PORTAL_URL
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === ''));
  dialog.showMessageBox(win || undefined, {
    type: 'info', title: 'About KRS Portal', message: 'KRS Portal', detail: lines.join('\n'),
    buttons: ['OK'], icon: path.join(__dirname, 'icon.ico')
  });
}
function contactSupport() {
  if (SUPPORT.email) shell.openExternal('mailto:' + SUPPORT.email + '?subject=' + encodeURIComponent('KRS Portal support'));
  else showAbout();
}
function buildMenu() {
  const lockOpt = (m, label) => ({
    label, type: 'radio', checked: settings.autoLockMinutes === m,
    click: () => { settings.autoLockMinutes = m; saveSettings(); buildMenu(); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: printPage },
      { label: 'Save as PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: savePdf },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'Alt+F4', click: () => { app.isQuitting = true; app.quit(); } }
    ] },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
      { role: 'togglefullscreen' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: 'Settings', submenu: [
      { label: isPortable() ? 'Start with Windows (installed version only)' : 'Start with Windows',
        type: 'checkbox', checked: !!settings.autoStart, enabled: !isPortable(),
        click: m => { settings.autoStart = m.checked; saveSettings(); applyAutoStart(); } },
      { label: 'Keep running in the tray when closed', type: 'checkbox', checked: !!settings.runInBackground,
        click: m => { settings.runInBackground = m.checked; saveSettings(); } },
      { label: 'Auto-lock after inactivity', submenu: [
        lockOpt(0, 'Off'), lockOpt(5, '5 minutes'), lockOpt(15, '15 minutes'), lockOpt(30, '30 minutes'), lockOpt(60, '1 hour')
      ] },
      { type: 'separator' },
      { label: 'Download folder: ' + (settings.downloadDir || 'ask every time'), enabled: false },
      { label: 'Choose download folder…', click: chooseDownloadDir },
      { label: 'Ask where to save every time', click: () => { settings.downloadDir = ''; saveSettings(); buildMenu(); } },
      { label: 'Open download folder', enabled: !!settings.downloadDir, click: () => shell.openPath(settings.downloadDir) }
    ] },
    { label: 'Help', submenu: [
      { label: 'About KRS Portal', click: showAbout },
      { label: 'Contact support', click: contactSupport }
    ] }
  ]));
}

/* ---------- system tray ---------- */
function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function createTray() {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, 'icon.ico'));
  } catch { return; }
  tray.setToolTip('KRS Portal');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open KRS Portal', click: showWindow },
    { label: 'About', click: showAbout },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

/* ---------- auto-lock after inactivity ---------- */
let locked = false;
function lockSession() {
  if (!win || win.isDestroyed() || locked || showingOffline) return;
  locked = true;
  // Firebase keeps the sign-in (and its offline copy of the data) in IndexedDB / storage; clearing it
  // signs the user out and removes cached marks from this computer.
  session.defaultSession.clearStorageData({
    storages: ['indexdb', 'localstorage', 'cookies', 'serviceworkers', 'cachestorage']
  }).catch(() => {}).finally(() => {
    if (win && !win.isDestroyed()) win.loadURL(PORTAL_URL);
    try { new Notification({ title: 'KRS Portal', body: 'Signed out after inactivity.' }).show(); } catch {}
    setTimeout(() => { locked = false; }, 5000);
  });
}
function startIdleWatch() {
  setInterval(() => {
    const mins = settings.autoLockMinutes;
    if (!mins) return;
    if (powerMonitor.getSystemIdleTime() >= mins * 60) lockSession();
  }, 30 * 1000);
}

/* ---------- downloads (CSV exports etc.) ---------- */
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}
function setupDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    if (settings.downloadDir) {
      try { fs.mkdirSync(settings.downloadDir, { recursive: true }); item.setSavePath(uniquePath(settings.downloadDir, item.getFilename())); } catch { /* fall back to Save dialog */ }
    }
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return;
      const file = item.getSavePath();
      if (!file) return;
      dialog.showMessageBox(win || undefined, {
        type: 'info', title: 'Saved', message: 'Saved', detail: file, buttons: ['OK', 'Show in folder'], defaultId: 0
      }).then(r => { if (r.response === 1) shell.showItemInFolder(file); });
    });
  });
}

/* ---------- offline screen + automatic reconnect ---------- */
function showOffline() {
  if (showingOffline || !win) return;
  showingOffline = true;
  win.loadFile(OFFLINE_PAGE);
  clearInterval(offlineTimer);
  offlineTimer = setInterval(checkBackOnline, 5000);
}
function checkBackOnline() {
  if (!net.isOnline()) return;
  const req = net.request({ method: 'HEAD', url: PORTAL_URL });
  req.on('response', () => reconnect());
  req.on('error', () => {});
  req.end();
}
function reconnect() {
  clearInterval(offlineTimer);
  showingOffline = false;
  if (win) win.loadURL(PORTAL_URL);
}

/* ---------- splash ---------- */
function showSplash() {
  splash = new BrowserWindow({
    width: 380, height: 280, frame: false, resizable: false, movable: true, show: true,
    alwaysOnTop: true, skipTaskbar: true, icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { sandbox: true }
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
}
function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

/* ---------- main window ---------- */
function createWindow() {
  buildMenu();
  if (!startHidden) showSplash();
  const st = loadState();
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    ...(st.bounds || {}),
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    title: 'KRS Portal',
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  if (st.maximized) win.maximize();

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    closeSplash();
    if (win && !win.isDestroyed() && !(startHidden && !shownOnce)) win.show();
    shownOnce = true;
  };
  win.webContents.once('did-finish-load', reveal);
  win.webContents.on('did-fail-load', (_e, code, _d, _url, isMain) => {
    if (!isMain || code === -3) return;       // -3 = aborted (normal during redirects)
    showOffline();
    reveal();
  });
  setTimeout(reveal, 15000);                   // never leave the splash up forever

  // Offline page "Try again now" button
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('krs-retry://')) { e.preventDefault(); reconnect(); }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(PORTAL_URL)) return { action: 'allow' };
    shell.openExternal(url);                   // WhatsApp, SMS, mail links open outside the app
    return { action: 'deny' };
  });

  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('close', e => {
    saveState();
    if (!app.isQuitting && settings.runInBackground && tray) {
      e.preventDefault();
      win.hide();
      if (!settings.trayHintShown) {
        settings.trayHintShown = true; saveSettings();
        try { new Notification({ title: 'KRS Portal is still running', body: 'Use the tray icon (bottom-right) to open or quit it.' }).show(); } catch {}
      }
    }
  });
  win.on('closed', () => { win = null; clearInterval(offlineTimer); });

  win.loadURL(PORTAL_URL);
}

/* ---------- automatic updates (installed version only) ---------- */
function setupUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;   // skip dev + portable build
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(win, {
        type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0,
        message: 'A new version of KRS Portal is ready.',
        detail: 'Restart to finish updating.'
      }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
    });
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdates().catch(() => {});
  } catch { /* updater unavailable: ignore */ }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => { app.isQuitting = true; });
  app.whenReady().then(() => {
    loadSettings();
    applyAutoStart();
    createTray();
    setupDownloads();
    createWindow();
    startIdleWatch();
    setupUpdates();
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
