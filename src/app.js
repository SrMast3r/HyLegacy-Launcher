/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { app, ipcMain, nativeTheme, shell } = require('electron');
const { Microsoft } = require('minecraft-java-core');
const { autoUpdater } = require('electron-updater')

const path = require('path');
const fs = require('fs');

const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");

let dev = process.env.NODE_ENV === 'dev';

if (dev) {
    let appPath = path.resolve('./data/Launcher').replace(/\\/g, '/');
    let appdata = path.resolve('./data').replace(/\\/g, '/');
    if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
    if (!fs.existsSync(appdata)) fs.mkdirSync(appdata, { recursive: true });
    app.setPath('userData', appPath);
    app.setPath('appData', appdata)
}

/* =================== Login de Microsoft en el navegador del sistema ===================
   El flujo abre login.live.com en el navegador externo (no en una ventana embebida) y
   captura el código de vuelta vía el protocolo hylegacy://auth, que Windows entrega a
   esta misma instancia a través de 'second-instance' (single-instance lock ya activo). */
const AUTH_PROTOCOL = 'hylegacy';

if (dev) {
    // en dev, electron se lanza como `electron .` — hay que apuntar al script real
    app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
} else {
    app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

let pendingMicrosoftAuth = null;

function extractCodeFromProtocolUrl(url) {
    try {
        return new URL(url).searchParams.get('code');
    } catch {
        return null;
    }
}

function handleAuthProtocolUrl(url) {
    if (!url || !url.startsWith(`${AUTH_PROTOCOL}://`)) return;
    if (pendingMicrosoftAuth) {
        pendingMicrosoftAuth(extractCodeFromProtocolUrl(url) || 'cancel');
        pendingMicrosoftAuth = null;
    }
    const win = MainWindow.getWindow();
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        const urlArg = argv.find(a => a.startsWith(`${AUTH_PROTOCOL}://`));
        if (urlArg) handleAuthProtocolUrl(urlArg);
    });
    // macOS entrega el protocolo por este evento en vez de second-instance
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleAuthProtocolUrl(url);
    });
    app.whenReady().then(() => {
        if (dev) return MainWindow.createWindow()
        UpdateWindow.createWindow()
    });
}

ipcMain.on('main-window-open', () => MainWindow.createWindow())
ipcMain.on('main-window-dev-tools', () => MainWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('main-window-dev-tools-close', () => MainWindow.getWindow().webContents.closeDevTools())
ipcMain.on('main-window-close', () => MainWindow.destroyWindow())
ipcMain.on('main-window-reload', () => MainWindow.getWindow().reload())
ipcMain.on('main-window-progress', (event, options) => MainWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('main-window-progress-reset', () => MainWindow.getWindow().setProgressBar(-1))
ipcMain.on('main-window-progress-load', () => MainWindow.getWindow().setProgressBar(2))
ipcMain.on('main-window-minimize', () => MainWindow.getWindow().minimize())

ipcMain.on('update-window-close', () => UpdateWindow.destroyWindow())
ipcMain.on('update-window-dev-tools', () => UpdateWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('update-window-progress', (event, options) => UpdateWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('update-window-progress-reset', () => UpdateWindow.getWindow().setProgressBar(-1))
ipcMain.on('update-window-progress-load', () => UpdateWindow.getWindow().setProgressBar(2))

ipcMain.handle('path-user-data', () => app.getPath('userData'))
ipcMain.handle('appData', e => app.getPath('appData'))

ipcMain.on('main-window-maximize', () => {
    if (MainWindow.getWindow().isMaximized()) {
        MainWindow.getWindow().unmaximize();
    } else {
        MainWindow.getWindow().maximize();
    }
})

ipcMain.on('main-window-hide', () => MainWindow.getWindow().hide())
ipcMain.on('main-window-show', () => MainWindow.getWindow().show())

ipcMain.handle('Microsoft-window', async (_, client_id) => {
    const redirect_uri = `${AUTH_PROTOCOL}://auth`;
    const authUrl =
        `https://login.live.com/oauth20_authorize.srf` +
        `?client_id=${encodeURIComponent(client_id)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&scope=${encodeURIComponent('XboxLive.signin offline_access')}` +
        `&prompt=select_account`;

    await shell.openExternal(authUrl);

    const TIMEOUT_MS = 10 * 60 * 1000; // 10 min para completar el login en el navegador
    const code = await new Promise((resolve) => {
        pendingMicrosoftAuth = resolve;
        setTimeout(() => {
            if (pendingMicrosoftAuth === resolve) {
                pendingMicrosoftAuth = null;
                resolve('cancel');
            }
        }, TIMEOUT_MS);
    });

    if (!code || code === 'cancel') return false;

    try {
        const tokenRes = await fetch('https://login.live.com/oauth20_token.srf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `client_id=${encodeURIComponent(client_id)}&code=${encodeURIComponent(code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(redirect_uri)}`
        });
        const oauth2 = await tokenRes.json();
        if (oauth2.error) return { error: oauth2.error, errorType: 'oauth2', ...oauth2 };

        return await new Microsoft(client_id).getAccount(oauth2);
    } catch (err) {
        return { error: err.message, errorType: 'network' };
    }
})

ipcMain.on('Microsoft-window-cancel', () => {
    if (pendingMicrosoftAuth) {
        pendingMicrosoftAuth('cancel');
        pendingMicrosoftAuth = null;
    }
})

ipcMain.handle('is-dark-theme', (_, theme) => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return nativeTheme.shouldUseDarkColors;
})

app.on('window-all-closed', () => app.quit());

// Token de solo lectura para poder revisar los releases del repo privado de
// GitHub. Se sustituye en build time (ver build.js/Obfuscate) desde el secret
// GH_UPDATE_TOKEN del workflow de CI — nunca queda como texto plano en el repo,
// solo en el binario ya compilado.
const GH_UPDATE_TOKEN = 'GH_UPDATE_TOKEN_PLACEHOLDER';
if (GH_UPDATE_TOKEN && GH_UPDATE_TOKEN !== 'GH_UPDATE_TOKEN_PLACEHOLDER') {
    autoUpdater.requestHeaders = { Authorization: `token ${GH_UPDATE_TOKEN}` };
}

autoUpdater.autoDownload = false;

ipcMain.handle('update-app', async () => {
    return await new Promise(async (resolve, reject) => {
        autoUpdater.checkForUpdates().then(res => {
            resolve(res);
        }).catch(error => {
            reject({
                error: true,
                message: error
            })
        })
    })
})

autoUpdater.on('update-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('updateAvailable');
});

ipcMain.on('start-update', () => {
    autoUpdater.downloadUpdate();
})

autoUpdater.on('update-not-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('update-not-available');
});

autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall();
});

autoUpdater.on('download-progress', (progress) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('download-progress', progress);
})

autoUpdater.on('error', (err) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('error', err);
});
