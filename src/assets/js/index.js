const { ipcRenderer, shell } = require('electron');
const os = require('os');

let pkg = { name: "HyLegacy-Launcher", repository: {} };
try { pkg = require('../../package.json'); } catch {}

import { config, database } from './utils.js';

const $ = (sel, root=document) => root.querySelector(sel);

function prettyBytes(bytes=0){
    if(!Number.isFinite(bytes)||bytes<=0) return '0 B';
    const u=['B','KB','MB','GB','TB'];
    const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),u.length-1);
    const n=bytes/Math.pow(1024,i);
    return `${n.toFixed(n>=100?0:n>=10?1:2)} ${u[i]}`;
}
function escapeHTML(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function killScrollbars(){
    document.documentElement.style.overflow='hidden';
    document.body.style.overflow='hidden';
    const st=document.createElement('style'); st.textContent=`::-webkit-scrollbar{width:0;height:0}`; document.head.appendChild(st);
}

function attachTilt(card){
    if(!card) return;
    let rect; const maxTilt=10;
    const onMove=e=>{
        rect=rect||card.getBoundingClientRect();
        const x=(e.clientX-rect.left)/rect.width-.5;
        const y=(e.clientY-rect.top)/rect.height-.5;
        card.style.transform=`rotateX(${(-y*maxTilt).toFixed(2)}deg) rotateY(${(x*maxTilt).toFixed(2)}deg)`;
    };
    const reset=()=>{ card.style.transform=''; rect=null; };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', reset);
}

class Splash{
    constructor(){
        this.$root   = $('#splash');
        this.$card   = document.querySelector('.card');
        this.$msg    = $('#splashMessage');
        this.$author = $('#splashAuthor');
        this.$status = $('#statusMessage');
        this.$progress   = $('#progressBar');
        this.$progressLb = $('#progressLabel');
        this.$btn        = $('#downloadButton');
        this.$wrap       = document.querySelector('.progress-wrap');
        this._closing = false;

        document.addEventListener('keydown', e=>{
            const isDevTools=(e.ctrlKey&&e.shiftKey&&e.code==='KeyI')||e.code==='F12';
            if(isDevTools) ipcRenderer.send('update-window-dev-tools');
        });

        document.addEventListener('DOMContentLoaded',()=>this.onReady());
    }

    async onReady(){
        try{
            const db=new database();
            const cfg=await db.readData('configClient');
            const theme=cfg?.launcher_config?.theme||'auto';
            const isDark=await ipcRenderer.invoke('is-dark-theme',theme).then(Boolean);
            document.body.className=isDark?'dark global':'light global';
        }catch{ document.body.className='dark global'; }

        if(process.platform==='win32') ipcRenderer.send('update-window-progress-load');

        if(this.$msg) this.$msg.style.display='none';
        if(this.$author) this.$author.closest('p')?.style && (this.$author.closest('p').style.display='none');

        killScrollbars();

        // Mostrar splash y centrar (hidden -> false)
        this.$root.hidden=false;
        // añade clases para animación y tilt
        this.$card?.classList.add('tilt');
        requestAnimationFrame(()=>this.$card?.classList.add('show'));
        attachTilt(this.$card);

        this.setStatus('Comprobando actualizaciones…');
        this.checkUpdate();
    }

    checkUpdate(){
        ipcRenderer.invoke('update-app').catch(err=>{
            this.shutdown(`No fue posible comprobar actualizaciones.<br>${escapeHTML(err?.message||'')}`);
        });

        ipcRenderer.on('updateAvailable', ()=>{
            // La descarga ya arrancó sola del lado del proceso principal
            // (autoDownload:true) — acá solo se muestra el progreso.
            this.setStatus('Descargando actualización…');
            if(os.platform()==='win32'){
                this.toggleProgress(true);
            }else{
                this.prepareManualDownload().catch(()=>{
                    this.setStatus('No se pudo preparar la descarga. Inténtalo más tarde.');
                });
            }
        });

        ipcRenderer.on('download-progress', (_evt, p)=>{
            const { transferred=0, total=0 } = p||{};
            this.toggleProgress(true);
            this.setProgress(transferred,total);
            ipcRenderer.send('update-window-progress',{progress:transferred,size:total});
            this.setStatus(`Descargando actualización… ${prettyBytes(transferred)} / ${prettyBytes(total)}`);
        });

        ipcRenderer.on('update-not-available', ()=>{
            this.setStatus('Launcher actualizado.');
            this.maintenanceCheck();
        });

        ipcRenderer.on('error', (_evt, err)=>{
            if(err) this.shutdown(escapeHTML(err.message||'Ocurrió un error inesperado.'));
        });
    }

    async prepareManualDownload(){
        this.setStatus('Buscando instalador para tu sistema…');

        const repoFromPkgUrl=(pkg?.repository?.url||'')
            .replace(/^git\+/,'').replace(/\.git$/,'').replace(/^https:\/\/github\.com\//,'');
        let owner='', repo='';
        if(repoFromPkgUrl.includes('/')) [owner,repo]=repoFromPkgUrl.split('/');
        if(!owner||!repo){ owner=owner||'HyLegacy'; repo=repo||(pkg?.name?.replace(/\s+/g,'-')||'HyLegacy-Launcher'); }

        const releases=await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`,{
            headers:{'Accept':'application/vnd.github+json'}
        }).then(r=>r.ok?r.json():Promise.reject(new Error(`GitHub API ${r.status}`)));

        if(!Array.isArray(releases)||releases.length===0){ this.setStatus('No se encontraron releases en GitHub.'); return; }

        const osKey=os.platform()==='darwin'?'mac':'linux';
        const preferredExt=os.platform()==='darwin'?'.dmg':'.AppImage';

        let foundAsset=null;
        for(const rel of releases){
            const assets=Array.isArray(rel.assets)?rel.assets:[];
            const match=assets
                .filter(a=>typeof a?.name==='string')
                .filter(a=>a.name.toLowerCase().includes(osKey))
                .filter(a=>a.name.toLowerCase().endsWith(preferredExt.toLowerCase()))
                .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
            if(match){ foundAsset=match; break; }
        }
        if(!foundAsset){ this.setStatus('Hay una actualización, pero no se encontró un instalador para este sistema.'); return; }

        this.$btn.hidden=false;
        this.$btn.textContent='Descargar actualización';
        this.$btn.onclick=()=>{
            shell.openExternal(foundAsset.browser_download_url);
            this.shutdown('Abriendo descarga en el navegador…');
        };
        this.setStatus('Actualización lista para descargar.');
    }

    async maintenanceCheck(){
        try{
            const res=await config.GetConfig();
            if(res?.maintenance) return this.shutdown(res.maintenance_message||'Servicio en mantenimiento. Inténtalo más tarde.');
            this.startLauncher();
        }catch{ return this.shutdown('No hay conexión a internet. Revisa tu red e inténtalo de nuevo.'); }
    }

    startLauncher(){
        if(this._closing) return;
        this.setStatus('Iniciando…');
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
        this._closing=true;
    }

    shutdown(text){
        if(this._closing) return; this._closing=true;
        this.setStatus(`${text}<br>La ventana se cerrará en 5 s`);
        let i=4; const id=setInterval(()=>{
            this.setStatus(`${text}<br>La ventana se cerrará en ${i--} s`);
            if(i<0){ clearInterval(id); ipcRenderer.send('update-window-close'); }
        },1000);
        this.toggleProgress(false);
        if(this.$btn) this.$btn.hidden=true;
    }

    setStatus(html){ if(this.$status) this.$status.innerHTML=html; }
    toggleProgress(show){ this.$wrap?.classList.toggle('show', !!show); if(show) this.setProgress(0,1); }
    setProgress(value=0, max=1){
        if(!this.$progress||!this.$progressLb) return;
        this.$progress.max=Math.max(1, Number(max)||1);
        this.$progress.value=Math.max(0, Math.min(this.$progress.max, Number(value)||0));
        const pct=Math.floor((this.$progress.value/this.$progress.max)*100);
        this.$progressLb.textContent=`${Number.isFinite(pct)?pct:0}%`;
    }
}

new Splash();
