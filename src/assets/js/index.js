// assets/js/index.js
// HyLegacy Launcher — Splash Controller (Renderer)
// Autor: HyLegacy (SrMast3r)
// Nota: Este archivo asume que en tu BrowserWindow tienes nodeIntegration habilitado
//       y que existen los canales IPC usados aquí (mismo naming que tu proyecto).

/* =============================== Imports/Globals =============================== */
const { ipcRenderer, shell } = require('electron');
const os = require('os');

// Si tienes package.json accesible en renderer:
let pkg = { name: "HyLegacy-Launcher", repository: {} };
try {
    pkg = require('../../package.json'); // ajusta ruta si cambia tu estructura
} catch { /* no crítico */ }

// Tus utilidades (como ya las usabas)
import { config, database } from './utils.js';

/* ================================ Utilidades ================================== */
const $$ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Formatea bytes a cadena breve */
function prettyBytes(bytes = 0) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const num = bytes / Math.pow(1024, i);
    return `${num.toFixed(num >= 100 ? 0 : num >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Escapa HTML en strings */
function escapeHTML(s = '') {
    return String(s).replace(/[&<>'"]/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
}

/** Forzar no-scroll incluso en WebViews tercos */
function killScrollbars() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    // Extra: quitar scrollbars WebKit
    const style = document.createElement('style');
    style.textContent = `::-webkit-scrollbar{width:0;height:0}`;
    document.head.appendChild(style);
}

/* ================================ Clase Splash ================================ */
class Splash {
    constructor() {
        // --- Cache de elementos UI ---
        this.$root       = $('#splash');
        this.$msg        = $('#splashMessage');
        this.$author     = $('#splashAuthor');
        this.$status     = $('#statusMessage');
        this.$substatus  = $('.substatus');     // opcional, si existe en tu HTML
        this.$progress   = $('#progressBar');
        this.$progressLb = $('#progressLabel');
        this.$btn        = $('#downloadButton');
        this.$progressWrap = $('.progress-wrap');

        // Estado
        this._closing = false;

        // Bind keys (DevTools)
        document.addEventListener('keydown', (e) => {
            const isDevTools = (e.ctrlKey && e.shiftKey && e.code === 'KeyI') || e.code === 'F12';
            if (isDevTools) ipcRenderer.send('update-window-dev-tools');
        });

        // DOM listo
        document.addEventListener('DOMContentLoaded', () => this.onReady());
    }

    async onReady() {
        // Tema claro/oscuro desde DB + preferencia del SO
        try {
            const db = new database();
            const cfg = await db.readData('configClient');
            const theme = cfg?.launcher_config?.theme || 'auto';
            const isDark = await ipcRenderer.invoke('is-dark-theme', theme).then(Boolean);
            document.body.className = isDark ? 'dark global' : 'light global';
        } catch {
            document.body.className = 'dark global';
        }

        // Progreso en taskbar (Windows)
        if (process.platform === 'win32') {
            ipcRenderer.send('update-window-progress-load');
        }

        // Ocultar quote/author para un look profesional (si existen)
        if (this.$msg)    this.$msg.style.display = 'none';
        if (this.$author) this.$author.closest('p')?.style && (this.$author.closest('p').style.display = 'none');

        // Kill scrollbars a prueba de todo
        killScrollbars();

        // Mostrar splash con fade-in
        this.$root.hidden = false;
        requestAnimationFrame(() => this.$root.classList.add('show'));

        // Iniciar flujo
        this.setStatus('Comprobando actualizaciones…');
        await sleep(160);
        this.checkUpdate();
    }

    /* ================================ Updater ================================== */
    checkUpdate() {
        // Pedimos al proceso principal que busque updates
        ipcRenderer.invoke('update-app').catch(err => {
            this.shutdown(`No fue posible comprobar actualizaciones.<br>${escapeHTML(err?.message || '')}`);
        });

        // Update disponible
        ipcRenderer.on('updateAvailable', () => {
            this.setStatus('Actualización disponible.');
            if (os.platform() === 'win32') {
                // Windows: auto-update por IPC
                this.toggleProgress(true);
                ipcRenderer.send('start-update');
            } else {
                // macOS / Linux: descarga manual desde releases
                this.prepareManualDownload().catch(e => {
                    console.error(e);
                    this.setStatus('No se pudo preparar la descarga. Inténtalo más tarde.');
                });
            }
        });

        // Progreso de descarga (Windows auto-update)
        ipcRenderer.on('download-progress', (_evt, progress) => {
            // progress: { transferred, total }
            const { transferred = 0, total = 0 } = progress || {};
            this.toggleProgress(true);
            this.setProgress(transferred, total);
            ipcRenderer.send('update-window-progress', { progress: transferred, size: total });
            this.setStatus(`Descargando actualización… ${prettyBytes(transferred)} / ${prettyBytes(total)}`);
        });

        // No hay update
        ipcRenderer.on('update-not-available', () => {
            this.setStatus('Launcher actualizado.');
            this.maintenanceCheck();
        });

        // Error del updater
        ipcRenderer.on('error', (_evt, err) => {
            if (err) this.shutdown(escapeHTML(err.message || 'Ocurrió un error inesperado.'));
        });
    }

    /**
     * macOS/Linux: Busca el último release y habilita botón de descarga
     */
    async prepareManualDownload() {
        this.setStatus('Buscando instalador para tu sistema…');

        // Detectar owner/repo desde package.json.repository.url
        const repoFromPkgUrl = (pkg?.repository?.url || '')
            .replace(/^git\+/, '')
            .replace(/\.git$/, '')
            .replace(/^https:\/\/github\.com\//, '');
        let owner = '';
        let repo  = '';
        if (repoFromPkgUrl.includes('/')) {
            [owner, repo] = repoFromPkgUrl.split('/');
        }

        // Fallback por si no está bien definido en package.json
        if (!owner || !repo) {
            // 👉 Ajusta estos valores si quieres forzar el repo
            owner = owner || 'HyLegacy';
            repo  = repo  || (pkg?.name?.replace(/\s+/g, '-') || 'HyLegacy-Launcher');
        }

        // Usamos window.fetch (permite CSP connect-src a api.github.com)
        const releases = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
            headers: { 'Accept': 'application/vnd.github+json' }
        }).then(r => r.ok ? r.json() : Promise.reject(new Error(`GitHub API ${r.status}`)));

        if (!Array.isArray(releases) || releases.length === 0) {
            this.setStatus('No se encontraron releases en GitHub.');
            return;
        }

        // Buscar asset adecuado
        const osKey = os.platform() === 'darwin' ? 'mac' : 'linux';
        const preferredExt = os.platform() === 'darwin' ? '.dmg' : '.AppImage';

        // Busca en releases hasta hallar un asset que machee
        let foundAsset = null;
        for (const rel of releases) {
            const assets = Array.isArray(rel.assets) ? rel.assets : [];
            const match = assets
                .filter(a => typeof a?.name === 'string')
                .filter(a => a.name.toLowerCase().includes(osKey))
                .filter(a => a.name.toLowerCase().endsWith(preferredExt.toLowerCase()))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
            if (match) { foundAsset = match; break; }
        }

        if (!foundAsset) {
            this.setStatus('Hay una actualización, pero no se encontró un instalador para este sistema.');
            return;
        }

        // Mostrar botón de descarga
        this.$btn.hidden = false;
        this.$btn.textContent = 'Descargar actualización';
        this.$btn.onclick = () => {
            shell.openExternal(foundAsset.browser_download_url);
            this.shutdown('Abriendo descarga en el navegador…');
        };

        this.setStatus('Actualización lista para descargar.');
    }

    /* ============================== Mantenimiento =============================== */
    async maintenanceCheck() {
        try {
            const res = await config.GetConfig();
            if (res?.maintenance) {
                return this.shutdown(res.maintenance_message || 'Servicio en mantenimiento. Inténtalo más tarde.');
            }
            this.startLauncher();
        } catch (e) {
            console.error(e);
            return this.shutdown('No hay conexión a internet. Revisa tu red e inténtalo de nuevo.');
        }
    }

    /* ================================= Navegación =============================== */
    startLauncher() {
        if (this._closing) return;
        this.setStatus('Iniciando…');
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
        this._closing = true;
    }

    shutdown(text) {
        if (this._closing) return;
        this._closing = true;

        this.setStatus(`${text}<br>La ventana se cerrará en 5 s`);
        let i = 4;
        const id = setInterval(() => {
            this.setStatus(`${text}<br>La ventana se cerrará en ${i--} s`);
            if (i < 0) {
                clearInterval(id);
                ipcRenderer.send('update-window-close');
            }
        }, 1000);

        // Por UX, ocultar progreso y botón
        this.toggleProgress(false);
        if (this.$btn) this.$btn.hidden = true;
    }

    /* ================================ UI Helpers ================================ */
    setStatus(html) {
        if (this.$status) this.$status.innerHTML = html;
    }

    toggleProgress(show) {
        if (!this.$progressWrap) this.$progressWrap = $('.progress-wrap');
        if (this.$progressWrap) this.$progressWrap.classList.toggle('show', !!show);
        if (show) this.setProgress(0, 1);
    }

    setProgress(value = 0, max = 1) {
        if (!this.$progress || !this.$progressLb) return;
        this.$progress.max = Math.max(1, Number(max) || 1);
        this.$progress.value = Math.max(0, Math.min(this.$progress.max, Number(value) || 0));
        const pct = Math.floor((this.$progress.value / this.$progress.max) * 100);
        this.$progressLb.textContent = `${Number.isFinite(pct) ? pct : 0}%`;
    }
}

/* =============================== Helpers DOM =============================== */
function $(sel, root = document) { return root.querySelector(sel); }

/* ================================ Bootstrap ================================= */
new Splash();
