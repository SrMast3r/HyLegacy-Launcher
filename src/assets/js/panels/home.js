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
            // Hero
            instanceHero: document.querySelector('.instance-hero'),
            instanceHeroName: document.querySelector('.instance-hero__name'),
            chipLoader: document.querySelector('.chip--loader'),
            chipVersion: document.querySelector('.chip--version'),

            // Barra inferior
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

        await this.populatePlayerInfo();
        await this.setupInstanceSelector();
    }

    /* ===== Info jugador ===== */
    async populatePlayerInfo() {
        const cfg = await this.db.readData('configClient');
        const acc = await this.db.readData('accounts', cfg?.account_selected);
        const nick = acc?.name || acc?.username || acc?.profile?.name || 'Jugador';
        if (this.$.playerNick) this.$.playerNick.textContent = nick;
        // La cabeza ya la pinta tu flujo de login con utils.headplayer()
    }

    /* ====== Helpers ====== */
    getInstanceImage(inst) {
        return (
            inst?.assets?.hero ||
            inst?.images?.hero ||
            inst?.hero ||
            inst?.banner ||
            inst?.image ||
            'assets/images/instance-default.jpg'
        );
    }

    renderHero(inst) {
        if (!this.$.instanceHero || !inst) return;
        const img = this.getInstanceImage(inst);
        this.$.instanceHero.style.backgroundImage = `url('${img}')`;

        // Texto
        if (this.$.instanceHeroName) this.$.instanceHeroName.textContent = inst?.name ?? 'Instancia';
        const loaderType = inst?.loadder?.loadder_type || 'Vanilla';
        const loaderBuild = inst?.loadder?.loadder_version ? ` ${inst.loadder.loadder_version}` : '';
        const mcVersion = inst?.loadder?.minecraft_version || '—';
        if (this.$.chipLoader) this.$.chipLoader.textContent = (loaderType === 'none' ? 'Vanilla' : loaderType) + loaderBuild;
        if (this.$.chipVersion) this.$.chipVersion.textContent = `MC ${mcVersion}`;
    }

    /* ===== Selector de instancias ===== */
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
            this.$.instancePopup.setAttribute('aria-hidden', 'false');
            this.$.instancesListPopup.querySelector('.instance-card')?.focus();
        });

        const closePopup = () => {
            this.$.instancePopup.style.display = 'none';
            this.$.instancePopup.setAttribute('aria-hidden', 'true');
        };
        this.$.instanceCloseBtn?.addEventListener('click', closePopup);
        this.$.instancePopup?.addEventListener('click', (e) => {
            if (e.target.classList.contains('instance-popup')) closePopup();
        });

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

            const card = document.createElement('div');
            card.className = `instance-card${inst.name === chosen?.name ? ' active' : ''}`;
            card.id = inst.name;
            card.tabIndex = 0;
            card.style.backgroundImage = `url('${this.getInstanceImage(inst)}')`;

            const overlay = document.createElement('div');
            overlay.className = 'instance-card__overlay';

            const content = document.createElement('div');
            content.className = 'instance-card__content';

            const name = document.createElement('div');
            name.className = 'instance-card__name';
            name.textContent = inst.name;

            const chips = document.createElement('div');
            chips.className = 'instance-card__chips';

            const chipLoader = document.createElement('span');
            chipLoader.className = 'chip';
            chipLoader.textContent = (inst?.loadder?.loadder_type || 'Vanilla') +
                (inst?.loadder?.loadder_version ? ` ${inst.loadder.loadder_version}` : '');

            const chipVersion = document.createElement('span');
            chipVersion.className = 'chip';
            chipVersion.textContent = `MC ${inst?.loadder?.minecraft_version || '—'}`;

            chips.appendChild(chipLoader);
            chips.appendChild(chipVersion);

            content.appendChild(name);
            content.appendChild(chips);

            card.appendChild(overlay);
            card.appendChild(content);
            list.appendChild(card);
        }

        const choose = async (name) => {
            const cfg = await this.db.readData('configClient');
            const newInst = instances.find(i => i.name === name);
            if (!newInst) return;

            cfg.instance_selct = newInst.name;
            await this.db.updateData('configClient', cfg);
            await setStatus(newInst.status);
            this.renderHero(newInst);

            list.querySelectorAll('.instance-card').forEach(n => n.classList.remove('active'));
            list.querySelector(`#${CSS.escape(name)}`)?.classList.add('active');

            this.$.instancePopup.style.display = 'none';
            this.$.instancePopup.setAttribute('aria-hidden', 'true');
        };

        list.onclick = (e) => {
            const el = e.target.closest('.instance-card');
            if (el) choose(el.id);
        };
        list.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const el = e.target.closest('.instance-card');
                if (el) { e.preventDefault(); choose(el.id); }
            }
        };
    }

    /* ===== Lanzamiento ===== */
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

    /* ===== Utils menores ===== */
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
