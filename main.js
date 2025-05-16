const { app, Tray, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const Store = require('electron-store');
const activeWin = require('active-win');

const SYSTRAY_ICON = (process.platform === 'darwin') ? path.join(__dirname, '/assets/images/icon_18x18.png') : path.join(__dirname, '/assets/images/icon.png');
const SYSTRAY_ICON_OFF = (process.platform === 'darwin') ? path.join(__dirname, '/assets/images/icon_off_18x18.png') : path.join(__dirname, '/assets/images/icon_off.png');
const ICON = path.join(__dirname, '/assets/images/icon.png');
const gotTheLock = app.requestSingleInstanceLock();

let keyboardListener = null;

function showIfAble() { // focus the existing window if it exists
    if (bgwin) {
        bgwin.show();
        bgwin.focus();
    }
}

function setDisable(value) {
    value = preferences.get('always_enabled') ? false : value;
    if (disabled === value) return;
    disabled = value;
    if (tray) {
        tray.setImage(disabled?SYSTRAY_ICON_OFF:SYSTRAY_ICON);
        tray.setToolTip(disabled?'Animalese Typing: Disabled':'Animalese Typing');
    }
    if (disabled) {
        if (keyboardListener) keyboardListener.kill();
    } else {
        startKeyboardListener();
    }
}

if (!gotTheLock) app.quit(); // if another instance is already running then quit
else app.on('second-instance', () => showIfAble()); // show instance that is running

app.setAppUserModelId('com.joshxviii.animalese-typing');

const preferences = new Store({
    defaults: {
        lang: 'en',
        volume: 0.5,
        audio_mode: 0,
        always_enabled: true,
        enabled_apps: [],
        voice_profile: {
            voice_type: 'f2',
            pitch_shift: 0.0,
            pitch_variation: 0.2,
            intonation: 0.0
        },
        saved_voice_profiles: new Map()
    }
});

ipcMain.on('get-store-data-sync', (e) => {
    e.returnValue = preferences.store;
});
ipcMain.handle('store-set', async (e, key, value) => {
    preferences.set(key, value);
    bgwin.webContents.send(`updated-${key}`, value);
});
ipcMain.on('close-window', (e) => {
    if (bgwin) bgwin.close();
});
ipcMain.on('minimize-window', (e) => {
    if (bgwin) bgwin.minimize();
});
ipcMain.on('get-app-info', (e) => {
    e.returnValue = {
        version: app.getVersion(),
        name: app.getName()
    }
});

var bgwin = null;
var tray = null;
var disabled = !preferences.get('always_enabled');
let lastActiveWindow = null;
let activeWindows = [];

// check for active window changes and update `lastActiveWindow` when the window changes
async function monitorActiveWindow() {
    const activeWindow = await activeWin();
    if (!activeWindow?.owner?.name) return;// return early if invlaid window

    const winName = activeWindow.owner.name
    if (winName === lastActiveWindow?.owner?.name) return;// return early if the active window hasn't changed.
    
    const enabledApps = preferences.get('enabled_apps');

    // change disable value when focusing in or out of an animalese-enabled app.
    setDisable( !(enabledApps.includes(winName) || activeWindow?.owner?.processId === process.pid) )

    lastActiveWindow = activeWindow;
    if (!activeWindows.includes(winName)) {
        activeWindows.push(winName);
        if (activeWindows.length > 8) activeWindows.shift();
        bgwin.webContents.send(`active-windows-updated`, activeWindows);
    }
}

function startActiveWindowMonitoring() {
    setInterval(monitorActiveWindow, 500); // check window every .5 seconds
}
app.disableHardwareAcceleration();
function createMainWin() {
    if(bgwin !== null) return;
    bgwin = new BrowserWindow({
        width: 720,
        height: 360,
        icon: ICON,
        resizable: true,
        frame: false,
        skipTaskbar: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    bgwin.webContents.openDevTools({ mode: 'detach' });
    bgwin.removeMenu();
    bgwin.loadFile('editor.html');
    bgwin.setAspectRatio(2);
    bgwin.setMinimumSize(720, 360);
    
    bgwin.on('close', function (e) {
        if (!app.isQuiting) {
            if (process.platform === 'darwin') app.dock.hide();
            e.preventDefault();
            bgwin.hide();
        }
        return false;
    });

    bgwin.on('closed', function () {
        bgwin = null;
    });

    bgwin.webContents.on('before-input-event', (e, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            const wc = bgwin.webContents;
            if (wc.isDevToolsOpened()) wc.closeDevTools();
            else  wc.openDevTools({ mode: 'detach' });
            e.preventDefault();
        }
    });
}

function createTrayIcon() {
    if(tray !== null) return; // prevent dupe tray icons

    tray = new Tray(SYSTRAY_ICON);

    tray.setToolTip('Animalese Typing');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Settings',
            click: () => { showIfAble(); }
        },
        {
            label: 'Run on startup',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (menuItem) => {
                app.setLoginItemSettings({
                    openAtLogin: menuItem.checked,
                    openAsHidden: true
                });
            }
        },
        {
            label: 'Quit',
            click: () => {
                if (keyboardListener) keyboardListener.kill();
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);

    // On Windows, clicking shows the window, while on macOS it shows the context menu
    if (process.platform === 'win32') {
        tray.on('click', () => { showIfAble(); });
    }

    tray.displayBalloon({
        title: "Animalese Typing",
        content: "Animalese Typing is Running!"
    });    
}

app.whenReady().then(() => {
    startActiveWindowMonitoring();
    createMainWin();
    createTrayIcon();
    if (!disabled) startKeyboardListener();
    if (process.platform === 'darwin') app.dock.hide();
    bgwin.hide();
});

app.on('activate', function () {
    if (bgwin === null) createMainWin();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (keyboardListener) keyboardListener.kill();

    if (bgwin) {
        bgwin.removeAllListeners();
        bgwin.close();
    }
    if (tray) tray.destroy();

    ipcMain.removeAllListeners();
});

app.on('quit', () =>  app.exit(0) );

function startKeyboardListener() {
    if (keyboardListener) {
        keyboardListener.kill();
    }

    keyboardListener = new GlobalKeyboardListener();

    keyboardListener.addListener((e, down) => {
        const shiftKey = (down["LEFT SHIFT"] || down["RIGHT SHIFT"]) && !["LEFT SHIFT", "RIGHT SHIFT"].includes(e.name);
        if (e.state === 'DOWN') {
            bgwin.webContents.send('keydown', {
                keycode: e.vKey,
                keychar: e.rawKey.name,
                shiftKey: shiftKey,
            });
        } else if (e.state === 'UP') {
            bgwin.webContents.send('keyup', {
                keycode: e.vKey,
                keychar: e.rawKey.name,
                shiftKey: shiftKey,
            });
        }
    });
}
