/**
 * HyLegacy Launcher — Splash (Profesional)
 * Basado en Luuxis — Adaptado por HyLegacy
 * Licencia Luuxis v1.0 (ver LICENSE)
 */

const { ipcRenderer, shell } = require('electron');
const pkg = require('../package.json');
const os = require('os');
import { config, database } from './utils.js';
const nodeFetch = require('node-fetch');

class Splash {
    constructor() {
        // Elementos UI
        this.$root         = document.getElementById('splash');
        this.$msg          = document.getElementById('splashMessage');   // se ocultará
        this.$author       = document.getElementById('splashAuthor');    // se ocultará
        this.$status       = document.getElementById('statusMessage');
        this.$progress     = document.getElementById('progressBar');
        this.$progressLb   = document.getElementById('progressLabel');
        this.$btn          = document.getElementById('downloadButton');
        this.$progressWrap = null;

        document.addEventListener('DOMContentLoaded', async () => {
            // Tema claro/oscuro desde DB + preferencia del SO
            const db    = new database();
            const cfg   = await db.readData('configClient');
            const theme = cfg?.launcher_config?.theme || 'auto';
            const isDark = await ipcRenderer.invoke('is-dark-theme', theme).then(Boolean);
            document.body.className = isDark ? 'dark global' : 'light global';

            // Progreso en la taskbar de Windows
            if (process.platform === 'win32') {
                ipcRenderer.send('update-window-progress-load');
            }

            // Ocultar quote/author para un look profesional
            if (this.$msg)    this.$msg.style.display = 'none';
            if (this.$author) this.$author.style.display = 'none';

            // Mostrar splash
            this.$root.hidden = false;
            requestAnimationFrame(() => this.$root.classList.add('show'));

            // Cache wrapper de progreso
            this.$progressWrap = document.querySelector('.progress-wrap');

            // Iniciar flujo
            this.begin();
        });

        // Abrir DevTools: Ctrl+Shift+I o F12 (útil en QA)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey && e.shiftKey && e.keyCode === 73) || e.keyCode === 123) {
                ipcRenderer.send('update-window-dev-tools');
            }
        });
    }

    async begin() {
        // Mensaje neutro y profesional
        this.setStatus('Comprobando actualizaciones…');
        await sleep(200);
        this.checkUpdate();
    }

    /* ================================ Updater ================================== */
    async checkUpdate() {
        ipcRenderer.invoke('update-app').catch(err => {
            return this.shutdown(`No fue posible comprobar actualizaciones.<br>${this.escape(err?.message || '')}`);
        });

        ipcRenderer.on('updateAvailable', () => {
            this.setStatus('Actualización disponible.');
            if (os.platform() === 'win32') {
                // Windows: actualización integrada
                this.toggleProgress(true);
                ipcRenderer.send('start-update');
            } else {
                // macOS / Linux: descarga manual
                this.downloadUpdate();
            }
        });

        ipcRenderer.on('error', (_evt, err) => {
            if (err) return this.shutdown(this.escape(err.message || 'Ocurrió un error inesperado.'));
        });

        ipcRenderer.on('download-progress', (_evt, progress) => {
            // { transferred, total }
            this.setProgress(progress.transferred, progress.total);
            ipcRenderer.send('update-window-progress', {
                progress: progress.transferred,
                size: progress.total
            });
            this.setStatus('Descargando actualización…');
        });

        ipcRenderer.on('update-not-available', () => {
            this.setStatus('Launcher actualizado.');
            this.maintenanceCheck();
        });
    }

    getLatestReleaseForOS(osKey, preferredFormat, assets) {
        return assets
            .filter(a =>
                a?.name?.toLowerCase().includes(osKey) &&
                a?.name?.toLowerCase().endsWith(preferredFormat)
            )
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async downloadUpdate() {
        try {
            // owner/repo desde package.json
            const repoParts = (pkg.repository?.url || '')
                .replace('git+', '')
                .replace('.git', '')
                .replace('https://github.com/', '')
                .split('/');
            const [owner, repo] = repoParts;

            // API GitHub
            const api     = await nodeFetch('https://api.github.com').then(r => r.json());
            const repoUrl = api.repository_url.replace('{owner}', owner).replace('{repo}', repo);
            const repoJson = await nodeFetch(repoUrl).then(r => r.json());
            const releases = await nodeFetch(repoJson.releases_url.replace('{/id}', '')).then(r => r.json());

            const assets = releases?.[0]?.assets || [];
            let latest;
            if (os.platform() === 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', assets);
            else if (os.platform() === 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', assets);

            if (!latest) {
                this.setStatus('Hay una actualización, pero no se encontró un instalador para este sistema.');
                return;
            }

            this.setStatus('Actualización lista para descargar.');
            this.$btn.hidden = false;
            this.$btn.onclick = () => {
                shell.openExternal(latest.browser_download_url);
                return this.shutdown('Abriendo descarga en el navegador…');
            };
        } catch (e) {
            console.error(e);
            this.setStatus('No se pudo preparar la descarga. Inténtalo más tarde.');
        }
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
        this.setStatus('Iniciando…');
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text) {
        this.setStatus(`${text}<br>La ventana se cerrará en 5 s`);
        let i = 4;
        const id = setInterval(() => {
            this.setStatus(`${text}<br>La ventana se cerrará en ${i--} s`);
            if (i < 0) {
                clearInterval(id);
                ipcRenderer.send('update-window-close');
            }
        }, 1000);
    }

    /* ================================ UI Helpers ================================ */
    setStatus(html) {
        this.$status.innerHTML = html;
    }

    toggleProgress(show) {
        if (!this.$progressWrap) this.$progressWrap = document.querySelector('.progress-wrap');
        if (this.$progressWrap) this.$progressWrap.classList.toggle('show', !!show);
        if (show) this.setProgress(0, 1);
    }

    setProgress(value, max) {
        this.$progress.value = value;
        this.$progress.max = max;
        const pct = max > 0 ? Math.floor((value / max) * 100) : 0;
        this.$progressLb.textContent = max > 0 ? `${pct}%` : '';
    }

    escape(s = '') {
        return String(s).replace(/[&<>'"]/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

new Splash();
