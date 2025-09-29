/**
 * @author Luuxis
 * @license Luuxis License v1.0
 */

import config from '../utils/config.js'
import { database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { ipcRenderer } = require('electron')

class Home {
    static id = 'home';

    async init(configIn) {
        this.config = configIn;
        this.db = new database();

        this.$ = {
            // hero
            instanceHero: document.querySelector('.instance-hero'),
            instanceHeroName: document.querySelector('.instance-hero__name'),
            chipLoader: document.querySelector('.chip--loader'),
            chipVersion: document.querySelector('.chip--version'),
            // bottom bar
            playerHead: document.querySelector('.player-head'),
            playerNick: document.querySelector('.player-nick'),
            playInstanceBtn: document.querySelector('.play-instance'),
            instanceSelectBtn: document.querySelector('.instance-select'),
            instancePopup: document.querySelector('.instance-popup'),
            instancesListPopup: document.querySelector('.instances-List'),
            instanceCloseBtn: document.querySelector('.close-popup'),
            infoBox: document.querySelector('.info-starting-game'),
            infoText: document.querySelector('.info-starting-game-text'),
            progressBar: document.querySelector('.progress-bar'),
            settingsBtn: document.querySelector('.settings-btn'),
        };

        this.$.settingsBtn?.addEventListener('click', () => changePanel('settings'));

        await this.populatePlayerInfo();   // ← pone nickname y skin
        await this.setupInstanceSelector();
    }

    /* ===== Player info (nickname/skin) ===== */
    async populatePlayerInfo() {
        const cfg = await this.db.readData('configClient');
        const acc = await this.db.readData('accounts', cfg?.account_selected);
        const nick = acc?.name || acc?.username || acc?.profile?.name || 'Jugador';
        if (this.$.playerNick) this.$.playerNick.textContent = nick;

        // Si ya tienes util de skin en utils, úsala; aquí solo dejamos el div preparado.
        // (tu proceso actual ya pinta la cabeza al loguear; si no, añade aquí el set background)
    }

    /* ================= HERO ================= */
    renderHero(inst) {
        if (!this.$.instanceHero) return;

        const sources = [
            inst?.assets?.hero,
            inst?.images?.hero,
            inst?.hero,
            inst?.banner,
            inst?.image
        ].filter(Boolean);

        const FALLBACK = 'assets/images/instance-default.jpg';

        const preload = (src, timeout = 8000) => new Promise((res, rej) => {
            if (!src) return rej();
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const t = setTimeout(() => { img.onload = img.onerror = null; rej(); }, timeout);
            img.onload = () => { clearTimeout(t); res(src); };
            img.onerror = () => { clearTimeout(t); rej(); };
            img.src = src;
        });

        const tryChain = async (i = 0) => {
            const src = sources[i] || FALLBACK;
            try {
                const ok = await preload(src);
                this.$.instanceHero.style.backgroundImage = `url('${ok}')`;
            } catch {
                if (i < sources.length) return tryChain(i + 1);
                this.$.instanceHero.style.backgroundImage = `url('${FALLBACK}')`;
            }
        };
        tryChain();

        // Texto
        if (this.$.instanceHeroName) this.$.instanceHeroName.textContent = inst?.name ?? 'Instancia';
        const loaderType = inst?.loadder?.loadder_type || 'Vanilla';
        const loaderBuild = inst?.loadder?.loadder_version ? ` ${inst.loadder.loadder_version}` : '';
        const mcVersion = inst?.loadder?.minecraft_version || '—';
        if (this.$.chipLoader) this.$.chipLoader.textContent = (loaderType === 'none' ? 'Vanilla' : loaderType) + loaderBuild;
        if (this.$.chipVersion) this.$.chipVersion.textContent = `MC ${mcVersion}`;
    }

    /* ================= Selector de instancias ================= */
    async setupInstanceSelector() {
        const cfg = await this.db.readData('configClient');
        const auth = await this.db.readData('accounts', cfg?.account_selected);

        if (!config || typeof config.getInstanceList !== 'function') {
            console.error('[Home] config.getInstanceList no disponible');
            return;
        }

        const instances = await config.getInstanceList();

        let chosen = this.pickValidInstance(instances, cfg?.instance_selct, auth?.name);

        if (!cfg || cfg.instance_selct !== chosen?.name) {
            await this.db.updateData('configClient', { ...(cfg || {}), instance_selct: chosen?.name });
        }
        if (chosen) {
            setStatus(chosen.status);
            this.renderHero(chosen);
        }

        if (instances.length === 1) {
            this.$.instanceSelectBtn?.classList.add('is-hidden');
            this.$.playInstanceBtn && (this.$.playInstanceBtn.style.paddingRight = '0');
        }

        this.$.instanceSelectBtn?.addEventListener('click', () => {
            this.renderInstancePopup(instances, chosen, auth?.name);
            this.$.instancePopup.style.display = 'flex';
            this.$.instancesListPopup.querySelector('.instance-elements')?.focus();
        });

        this.$.instanceCloseBtn?.addEventListener('click', () => { this.$.instancePopup.style.display = 'none'; });

        this.$.playInstanceBtn?.addEventListener('click', (e) => {
            if (e.target.closest('.instance-select')) return;
            this.startGame();
        });
    }

    pickValidInstance(instances, desiredName, playerName) {
        const byName = (n) => instances.find(i => i.name === n);
        const canUse = (i) => !i.whitelistActive || i.whitelist?.includes(playerName);
        if (desiredName) {
            const inst = byName(desiredName);
            if (inst && canUse(inst)) return inst;
        }
        return instances.find(canUse) || instances[0];
    }

    renderInstancePopup(instances, chosen, playerName) {
        const list = this.$.instancesListPopup;
        list.innerHTML = '';

        const canUse = (inst) => !inst.whitelistActive || inst.whitelist?.includes(playerName);
        for (const inst of instances) {
            if (!canUse(inst)) continue;
            const div = document.createElement('div');
            div.id = inst.name;
            div.className = `instance-elements${inst.name === chosen?.name ? ' active-instance' : ''}`;
            div.setAttribute('tabindex', '0');
            div.setAttribute('role', 'button');
            div.textContent = inst.name;
            list.appendChild(div);
        }

        const choose = async (name) => {
            const cfg = await this.db.readData('configClient');
            const newInst = instances.find(i => i.name === name);
            if (!newInst) return;
            cfg.instance_selct = newInst.name;
            await this.db.updateData('configClient', cfg);
            await setStatus(newInst.status);
            this.renderHero(newInst);
            list.querySelectorAll('.instance-elements').forEach(n => n.classList.remove('active-instance'));
            list.querySelector(`#${CSS.escape(name)}`)?.classList.add('active-instance');
            this.$.instancePopup.style.display = 'none';
        };

        list.onclick = (e) => {
            const el = e.target.closest('.instance-elements');
            if (el) choose(el.id);
        };
        list.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const el = e.target.closest('.instance-elements');
                if (el) choose(el.id);
            }
        };
    }

    /* ================= Lanzamiento ================= */
    async startGame() {
        const launch = new Launch();
        const configClient = await this.db.readData('configClient');

        if (!config || typeof config.getInstanceList !== 'function') {
            console.error('[Home] config.getInstanceList no disponible');
            return;
        }

        const instances = await config.getInstanceList();
        const authenticator = await this.db.readData('accounts', configClient.account_selected);
        const options = instances.find(i => i.name === configClient.instance_selct);
        if (!options) return;

        const opt = {
            url: options.url,
            authenticator,
            timeout: 10000,
            path: `${await appdata()}/${process.platform === 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
            instance: options.name,
            version: options.loadder.minecraft_version,
            detached: configClient.launcher_config.closeLauncher === "close-all" ? false : true,
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,
            loader: {
                type: options.loadder.loadder_type,
                build: options.loadder.loadder_version,
                enable: options.loadder.loadder_type !== 'none'
            },
            verify: options.verify,
            ignored: [...(options.ignored || [])],
            java: { path: configClient.java_config.java_path },
            JVM_ARGS: options.jvm_args || [],
            GAME_ARGS: options.game_args || [],
            screen: {
                width: configClient.game_config.screen_size.width,
                height: configClient.game_config.screen_size.height
            },
            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        };

        const btn = this.$.playInstanceBtn;
        const box = this.$.infoBox;
        const text = this.$.infoText;
        const bar = this.$.progressBar;

        launch.Launch(opt);

        btn.style.display = "none";
        box.style.display = "block";
        bar.style.display = "";
        ipcRenderer.send('main-window-progress-load');

        launch.on('progress', (progress, size) => {
            text.innerHTML = `Descargando ${((progress / size) * 100).toFixed(0)}%`;
            ipcRenderer.send('main-window-progress', { progress, size });
            bar.value = progress; bar.max = size;
        });
        launch.on('check', (progress, size) => {
            text.innerHTML = `Verificando ${((progress / size) * 100).toFixed(0)}%`;
            ipcRenderer.send('main-window-progress', { progress, size });
            bar.value = progress; bar.max = size;
        });
        launch.on('patch', () => {
            ipcRenderer.send('main-window-progress-load');
            text.innerHTML = `Aplicando patch...`;
        });
        launch.on('data', () => {
            bar.style.display = "none";
            if (configClient.launcher_config.closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-hide");
            }
            new logger('Minecraft', '#36b030');
            ipcRenderer.send('main-window-progress-load');
            text.innerHTML = `Iniciando juego...`;
        });
        launch.on('close', () => {
            if (configClient.launcher_config.closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-show");
            }
            ipcRenderer.send('main-window-progress-reset');
            box.style.display = "none";
            btn.style.display = "flex";
            text.innerHTML = `Verificación`;
            new logger(pkg.name, '#7289da');
        });
        launch.on('error', err => {
            const popupError = new popup();
            popupError.openPopup({
                title: 'Error',
                content: err.error,
                color: 'red',
                options: true
            });
            if (configClient.launcher_config.closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-show");
            }
            ipcRenderer.send('main-window-progress-reset');
            box.style.display = "none";
            btn.style.display = "flex";
            text.innerHTML = `Verificación`;
            new logger(pkg.name, '#7289da');
            console.error(err);
        });
    }

    /* ================= Utils ================= */
    fmtDate(e) {
        const date = new Date(e);
        const allMonth = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return { year: date.getFullYear(), month: allMonth[date.getMonth()], day: date.getDate() };
    }
    escapeHTML(str = "") {
        return str.replace(/[&<>'"]/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    }
}

export default Home;
