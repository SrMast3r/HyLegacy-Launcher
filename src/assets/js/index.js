// HyLegacy Launcher — Splash Controller (Renderer)

const { ipcRenderer, shell } = require('electron');
const os = require('os');

let pkg = { name: "HyLegacy-Launcher", repository: {} };
try { pkg = require('../../package.json'); } catch { /* opcional */ }

import { config, database } from './utils.js';

/* ===== Helpers ===== */
const $ = (sel, root=document) => root.querySelector(sel);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const prettyBytes = (b=0)=> {
    if (!Number.isFinite(b) || b<=0) return '0 B';
    const u = ['B','KB','MB','GB','TB']; const i = Math.min(Math.floor(Math.log(b)/Math.log(1024)),4);
    const n = b/Math.pow(1024,i); return `${n.toFixed(n>=100?0:n>=10?1:2)} ${u[i]}`;
};
const escapeHTML = (s='') => String(s).replace(/[&<>'"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));

// Kill scrollbars siempre
(function killScrollbars(){
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const st = document.createElement('style');
    st.textContent = `html,body{overflow:hidden!important}::-webkit-scrollbar{width:0;height:0}`;
    document.head.appendChild(st);
})();

class Splash {
    constructor() {
        this.$root = $('#splash');
        this.$status = $('#statusMessage');
        this.$progress = $('#progressBar');
        this.$progressLb = $('#progressLabel');
        this.$btn = $('#downloadButton');
        this.$wrap = document.querySelector('.progress-wrap');

        this._closing = false;

        document.addEventListener('keydown', e => {
            if ((e.ctrlKey && e.shiftKey && e.code==='KeyI') || e.code==='F12')
                ipcRenderer.send('update-window-dev-tools');
        });

        document.addEventListener('DOMContentLoaded', () => this.onReady());
    }

    async onReady() {
        try {
            const db = new database();
            const cfg = await db.readData('configClient');
            const theme = cfg?.launcher_config?.theme || 'auto';
            const isDark = await ipcRenderer.invoke('is-dark-theme', theme).then(Boolean);
            document.body.className = isDark ? 'dark global' : 'light global';
        } catch {
            document.body.className = 'dark global';
        }

        if (process.platform === 'win32') ipcRenderer.send('update-window-progress-load');

        // Mostrar splash
        this.$root.hidden = false;
        requestAnimationFrame(()=> this.$root.classList.add('show'));

        this.setStatus('Comprobando actualizaciones…');
        await sleep(120);
        this.checkUpdate();
    }

    /* ===== Updater ===== */
    checkUpdate() {
        ipcRenderer.invoke('update-app').catch(err=>{
            this.shutdown(`No fue posible comprobar actualizaciones.<br>${escapeHTML(err?.message || '')}`);
        });

        ipcRenderer.on('updateAvailable', () => {
            this.setStatus('Actualización disponible.');
            if (os.platform()==='win32') {
                this.toggleProgress(true);
                ipcRenderer.send('start-update');
            } else {
                this.prepareManualDownload().catch(e=>{
                    console.error(e); this.setStatus('No se pudo preparar la descarga. Inténtalo más tarde.');
                });
            }
        });

        ipcRenderer.on('download-progress', (_e, p) => {
            const transferred = p?.transferred ?? 0;
            const total = p?.total ?? 0;
            this.toggleProgress(true);                 // ✅ asegura que se vea
            this.setProgress(transferred, total);
            ipcRenderer.send('update-window-progress', { progress: transferred, size: total });
            this.setStatus(`Descargando actualización… ${prettyBytes(transferred)} / ${prettyBytes(total)}`);
        });

        ipcRenderer.on('update-not-available', () => {
            this.setStatus('Launcher actualizado.');
            this.maintenanceCheck();
        });

        ipcRenderer.on('error', (_evt, err) => {
            if (err) this.shutdown(escapeHTML(err.message || 'Ocurrió un error inesperado.'));
        });
    }

    async prepareManualDownload() {
        this.setStatus('Buscando instalador para tu sistema…');

        const repoFrom = (pkg?.repository?.url || '')
            .replace(/^git\+/, '').replace(/\.git$/, '').replace(/^https:\/\/github\.com\//,'');
        let [owner, repo] = repoFrom.includes('/') ? repoFrom.split('/') : [null, null];
        owner = owner || 'HyLegacy';
        repo  = repo  || (pkg?.name?.replace(/\s+/g,'-') || 'HyLegacy-Launcher');

        const releases = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
            headers: { 'Accept': 'application/vnd.github+json' }
        }).then(r=> r.ok ? r.json() : Promise.reject(new Error(`GitHub API ${r.status}`)));

        if (!Array.isArray(releases) || !releases.length)
            return this.setStatus('No se encontraron releases en GitHub.');

        const isMac = os.platform()==='darwin';
        const key = isMac ? 'mac' : 'linux';
        const ext = isMac ? '.dmg' : '.AppImage';

        let asset = null;
        for (const rel of releases) {
            const a = (rel.assets||[])
                .filter(x => x?.name?.toLowerCase?.().includes(key))
                .filter(x => x?.name?.toLowerCase?.().endsWith(ext.toLowerCase()))
                .sort((A,B)=> new Date(B.created_at)-new Date(A.created_at))[0];
            if (a) { asset = a; break; }
        }

        if (!asset) return this.setStatus('Hay una actualización, pero no se encontró un instalador para este sistema.');

        this.$btn.hidden = false;
        this.$btn.textContent = 'Descargar actualización';
        this.$btn.onclick = () => { shell.openExternal(asset.browser_download_url); this.shutdown('Abriendo descarga en el navegador…'); };
        this.setStatus('Actualización lista para descargar.');
    }

    async maintenanceCheck() {
        try {
            const res = await config.GetConfig();
            if (res?.maintenance) return this.shutdown(res.maintenance_message || 'Servicio en mantenimiento. Inténtalo más tarde.');
            this.startLauncher();
        } catch {
            return this.shutdown('No hay conexión a internet. Revisa tu red e inténtalo de nuevo.');
        }
    }

    startLauncher() {
        if (this._closing) return;
        this.setStatus('Iniciando…');
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
        this._closing = true;
    }

    shutdown(text) {
        if (this._closing) return; this._closing = true;
        this.setStatus(`${text}<br>La ventana se cerrará en 5 s`);
        let i=4; const id=setInterval(()=>{
            this.setStatus(`${text}<br>La ventana se cerrará en ${i--} s`);
            if (i<0){ clearInterval(id); ipcRenderer.send('update-window-close'); }
        }, 1000);
        this.toggleProgress(false);
        if (this.$btn) this.$btn.hidden = true;
    }

    /* ===== UI Helpers ===== */
    setStatus(html){ if (this.$status) this.$status.innerHTML = html; }
    toggleProgress(show){
        if (!this.$wrap) this.$wrap = document.querySelector('.progress-wrap');
        if (this.$wrap) this.$wrap.classList.toggle('show', !!show); // ✅ coincide con CSS
        if (show) this.setProgress(0,1);
    }
    setProgress(v=0, m=1){
        if (!this.$progress || !this.$progressLb) return;
        this.$progress.max = Math.max(1, Number(m)||1);
        this.$progress.value = Math.max(0, Math.min(this.$progress.max, Number(v)||0));
        const pct = Math.floor((this.$progress.value/this.$progress.max)*100) || 0;
        this.$progressLb.textContent = `${pct}%`;
    }
}

new Splash();
