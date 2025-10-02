/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { ipcRenderer, shell } = require('electron');
const pkg = require('../package.json');
const os = require('os');
import { config, database } from './utils.js';
const nodeFetch = require("node-fetch");


class Splash {
    constructor() {
        this.splash = document.querySelector(".splash");
        this.splashMessage = document.querySelector(".splash-message");
        this.splashAuthor = document.querySelector(".splash-author");
        this.message = document.querySelector(".message");
        this.progress = document.querySelector(".progress");
        document.addEventListener('DOMContentLoaded', async () => {
            let databaseLauncher = new database();
            let configClient = await databaseLauncher.readData('configClient');
            let theme = configClient?.launcher_config?.theme || "auto"
            let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
            document.body.className = isDarkTheme ? 'dark global' : 'light global';
            if (process.platform == 'win32') ipcRenderer.send('update-window-progress-load')
            this.startAnimation()
        });
    }

    async startAnimation() {
        let splashes = [
            { "message": "Je... vie...", "author": "Luuxis" },
            { "message": "Salut je suis du code.", "author": "Luuxis" },
            { "message": "Linux n'est pas un os, mais un kernel.", "author": "Luuxis" }
        ];
        let splash = splashes[Math.floor(Math.random() * splashes.length)];
        this.splashMessage.textContent = splash.message;
        this.splashAuthor.children[0].textContent = "@" + splash.author;
        await sleep(100);
        document.querySelector("#splash").style.display = "block";
        await sleep(500);
        this.splash.classList.add("opacity");
        await sleep(500);
        this.splash.classList.add("translate");
        this.splashMessage.classList.add("opacity");
        this.splashAuthor.classList.add("opacity");
        this.message.classList.add("opacity");
        await sleep(1000);
        this.checkUpdate();
    }

    async checkUpdate() {
        this.setStatus(`Recherche de mise à jour...`);

        try {
            const res = await ipcRenderer.invoke('update-app');
            // res puede indicar update/no-update según electron-updater;
            // aquí no necesitas hacer nada: te guías por los eventos de abajo.
        } catch (err) {
            const msg = err?.message || String(err);
            return this.shutdown(`erreur lors de la recherche de mise à jour :<br>${msg}`);
        }

        ipcRenderer.once('updateAvailable', () => {
            this.setStatus(`Mise à jour disponible !`);
            if (os.platform() === 'win32') {
                this.toggleProgress();
                ipcRenderer.send('start-update');
            } else {
                return this.dowloadUpdate();
            }
        });

        ipcRenderer.once('error', (_event, err) => {
            const msg = err?.message || String(err);
            return this.shutdown(`${msg}`);
        });

        ipcRenderer.once('download-progress', (_event, progress) => {
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total });
            this.setProgress(progress.transferred, progress.total);
        });

        ipcRenderer.once('update-not-available', () => {
            console.error("Mise à jour non disponible");
            this.maintenanceCheck();
        });
    }


    getLatestReleaseForOS(osTokenList, preferredFormat, assets) {
        const tokens = Array.isArray(osTokenList) ? osTokenList : [osTokenList];
        return assets
            .filter(a => {
                const name = (a.name || '').toLowerCase();
                const matchOS = tokens.some(t => name.includes(t));
                const matchFormat = name.endsWith(preferredFormat);
                return matchOS && matchFormat;
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async dowloadUpdate() {
        const repo = pkg.repository?.url
            ?.replace("git+", "")
            ?.replace(".git", "")
            ?.replace("https://github.com/", "")
            ?.split("/");
        if (!repo || repo.length < 2) {
            return this.shutdown("Configuration du dépôt GitHub invalide.");
        }

        let apiRoot, repoAPI, releases;
        try {
            apiRoot = await nodeFetch('https://api.github.com').then(r => r.json());
            const repoURL = apiRoot.repository_url
                .replace("{owner}", repo[0])
                .replace("{repo}", repo[1]);
            repoAPI = await nodeFetch(repoURL).then(r => r.json());
            releases = await nodeFetch(repoAPI.releases_url.replace("{/id}", '')).then(r => r.json());
        } catch (e) {
            const msg = e?.message || String(e);
            return this.shutdown(`Erreur GitHub API :<br>${msg}`);
        }

        const latestRelease = (releases?.[0]?.assets) || [];
        let latest;

        if (os.platform() === 'darwin') {
            latest = this.getLatestReleaseForOS(['mac', 'darwin'], '.dmg', latestRelease);
        } else if (os.platform() === 'linux') {
            latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);
        } else {
            // Windows no usa descarga manual aquí; se maneja por autoUpdater
            return this.shutdown("Plateforme non prise en charge pour le téléchargement manuel.");
        }

        if (!latest) {
            return this.shutdown("Aucun binaire de mise à jour trouvé pour votre plateforme.");
        }

        this.setStatus(`Mise à jour disponible !<br><div class="download-update">Télécharger</div>`);
        document.querySelector(".download-update").addEventListener("click", () => {
            shell.openExternal(latest.browser_download_url);
            return this.shutdown("Téléchargement en cours...");
        });
    }



    async maintenanceCheck() {
        config.GetConfig().then(res => {
            if (res.maintenance) return this.shutdown(res.maintenance_message);
            this.startLauncher();
        }).catch(e => {
            console.error(e);
            return this.shutdown("Aucune connexion internet détectée,<br>veuillez réessayer ultérieurement.");
        })
    }

    startLauncher() {
        this.setStatus(`Démarrage du launcher`);
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text) {
        this.setStatus(`${text}<br>Arrêt dans 5s`);
        let i = 4;
        setInterval(() => {
            this.setStatus(`${text}<br>Arrêt dans ${i--}s`);
            if (i < 0) ipcRenderer.send('update-window-close');
        }, 1000);
    }

    setStatus(text) {
        this.message.innerHTML = text;
    }

    toggleProgress() {
        if (this.progress.classList.toggle("show")) this.setProgress(0, 1);
    }

    setProgress(value, max) {
        this.progress.value = value;
        this.progress.max = max;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
        ipcRenderer.send("update-window-dev-tools");
    }
})
new Splash();