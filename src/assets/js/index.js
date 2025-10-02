/**
 * @author Luuxis
 * Licencia Luuxis v1.0 (ver archivo LICENSE para detalles en FR/ES)
 */

const { ipcRenderer, shell } = require('electron');
const pkg = require('../package.json');
const os = require('os');
import { config, database } from './utils.js';
const nodeFetch = require('node-fetch');

class Splash {
    constructor(){
        this.$root       = document.getElementById('splash');
        this.$msg        = document.getElementById('splashMessage');
        this.$author     = document.getElementById('splashAuthor');
        this.$status     = document.getElementById('statusMessage');
        this.$progress   = document.getElementById('progressBar');
        this.$progressLb = document.getElementById('progressLabel');
        this.$btn        = document.getElementById('downloadButton');

        document.addEventListener('DOMContentLoaded', async () => {
            const db = new database();
            const cfg = await db.readData('configClient');
            const theme = cfg?.launcher_config?.theme || 'auto';
            const isDark = await ipcRenderer.invoke('is-dark-theme', theme).then(Boolean);
            document.body.className = isDark ? 'dark global' : 'light global';

            if (process.platform === 'win32') ipcRenderer.send('update-window-progress-load');

            this.$root.hidden = false;
            this.startAnimation();
        });

        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+I o F12
            if ((e.ctrlKey && e.shiftKey && e.keyCode === 73) || e.keyCode === 123) {
                ipcRenderer.send('update-window-dev-tools');
            }
        });
    }

    async startAnimation(){
        const splashes = [
            { message: 'Yo… vivo…', author: 'Luuxis' },
            { message: 'Hola, soy solo código.', author: 'Luuxis' },
            { message: 'Linux no es un sistema operativo, es un kernel.', author: 'Luuxis' },
            { message: 'Toma agüita y estira las manos.', author: 'HyLegacy' },
            { message: 'Compila con fe, pero guarda primero.', author: 'HyLegacy' }
        ];
        const pick = splashes[Math.floor(Math.random() * splashes.length)];
        this.$msg.textContent = pick.message;
        this.$author.textContent = '@' + pick.author;

        await sleep(350);
        this.checkUpdate();
    }

    /* ========== Actualizaciones ========== */
    async checkUpdate(){
        this.setStatus('Buscando actualización…');

        ipcRenderer.invoke('update-app').catch(err => {
            return this.shutdown(`Error al buscar actualización:<br>${this.escape(err?.message)}`);
        });

        ipcRenderer.on('updateAvailable', () => {
            this.setStatus('¡Actualización disponible!');
            if (os.platform() === 'win32') {
                this.toggleProgress(true);
                ipcRenderer.send('start-update');
            } else {
                // macOS / Linux -> descarga manual
                this.downloadUpdate();
            }
        });

        ipcRenderer.on('error', (_evt, err) => {
            if (err) return this.shutdown(this.escape(err.message || 'Error desconocido'));
        });

        ipcRenderer.on('download-progress', (_evt, progress) => {
            this.setProgress(progress.transferred, progress.total);
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total });
        });

        ipcRenderer.on('update-not-available', () => {
            console.log('[Updater] No hay actualización disponible');
            this.maintenanceCheck();
        });
    }

    getLatestReleaseForOS(osKey, preferredFormat, assets){
        return assets
            .filter(a => a?.name?.toLowerCase().includes(osKey) && a?.name?.toLowerCase().endsWith(preferredFormat))
            .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async downloadUpdate(){
        try{
            const repoParts = (pkg.repository?.url || '')
                .replace('git+','')
                .replace('.git','')
                .replace('https://github.com/','')
                .split('/');
            const [owner, repo] = repoParts;

            const api = await nodeFetch('https://api.github.com').then(r=>r.json());
            const repoUrl = api.repository_url.replace('{owner}', owner).replace('{repo}', repo);
            const repoJson = await nodeFetch(repoUrl).then(r=>r.json());
            const releases = await nodeFetch(repoJson.releases_url.replace('{/id}','')).then(r=>r.json());

            const assets = releases?.[0]?.assets || [];
            let latest;
            if (os.platform() === 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', assets);
            else if (os.platform() === 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', assets);

            if (!latest) {
                this.setStatus('Actualización disponible, pero no se encontró un artefacto compatible.');
                return;
            }

            this.setStatus('¡Actualización disponible!');
            this.$btn.hidden = false;
            this.$btn.onclick = () => {
                shell.openExternal(latest.browser_download_url);
                return this.shutdown('Descargando actualización…');
            };
        }catch(e){
            console.error(e);
            this.setStatus('No se pudo preparar la descarga. Intenta más tarde.');
        }
    }

    /* ========== Mantenimiento ========== */
    async maintenanceCheck(){
        try{
            const res = await config.GetConfig();
            if (res?.maintenance) {
                return this.shutdown(res.maintenance_message || 'En mantenimiento. Intenta más tarde.');
            }
            this.startLauncher();
        }catch(e){
            console.error(e);
            return this.shutdown('No se detectó conexión a internet,<br>por favor intenta más tarde.');
        }
    }

    /* ========== Navegación ========== */
    startLauncher(){
        this.setStatus('Iniciando el launcher…');
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text){
        this.setStatus(`${text}<br>Se cerrará en 5s`);
        let i = 4;
        const id = setInterval(() => {
            this.setStatus(`${text}<br>Se cerrará en ${i--}s`);
            if (i < 0) {
                clearInterval(id);
                ipcRenderer.send('update-window-close');
            }
        }, 1000);
    }

    /* ========== UI helpers ========== */
    setStatus(html){
        this.$status.innerHTML = html;
    }

    toggleProgress(show){
        this.$progress.classList.toggle('show', !!show);
        if (show) this.setProgress(0, 1);
    }

    setProgress(value, max){
        this.$progress.value = value;
        this.$progress.max = max;
        const pct = max > 0 ? Math.floor((value / max) * 100) : 0;
        this.$progressLb.textContent = max > 0 ? `${pct}%` : '';
    }

    escape(s=''){ return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

new Splash();
