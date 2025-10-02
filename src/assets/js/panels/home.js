/**
 * @author Luuxis
 * @license Luuxis License v1.0
 */
import config from '../utils/config.js';
import { database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js';

const { Launch } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

/* Compat: loader vs loadder */
const readLoader = (inst) => {
    const l = inst?.loader ?? inst?.loadder ?? {};
    return {
        type: l.loader_type ?? l.loadder_type ?? 'none',
        version: l.loader_version ?? l.loadder_version ?? '',
        mc: l.minecraft_version ?? '—'
    };
};
const getInstanceSelectedKey = (cfg) => cfg?.instance_select ?? cfg?.instance_selct;
const setInstanceSelectedKey = (cfg, name) => ({ ...(cfg || {}), instance_select: name });

class Home {
    static id = 'home';

    async init(configIn) {
        this.config = configIn;
        this.db = new database();

        this.$ = {
            instanceHero: document.querySelector('.instance-hero'),
            instanceHeroName: document.querySelector('.instance-hero__name'),
            chipLoader: document.querySelector('.chip--loader'),
            chipVersion: document.querySelector('.chip--version'),

            infoBox: document.querySelector('.info-starting-game'),
            infoText: document.querySelector('.info-starting-game-text'),
            progressBar: document.querySelector('.progress-bar'),

            railBtns: document.querySelectorAll('.rail-btn[data-target], .rail-btn[data-open-settings]'),
            railSettings: document.querySelector('[data-open-settings]'),

            paneHome: document.getElementById('pane-home'),
            paneInstances: document.getElementById('pane-instances'),
            instancesList: document.querySelector('.instances-List'),

            playerNick: document.querySelector('.player-nick'),
            playBtn: document.querySelector('.play-btn'),
            settingsBtn: document.querySelector('.settings-btn'),
        };

        this.$.settingsBtn?.addEventListener('click', () => changePanel('settings'));
        this.$.railSettings?.addEventListener('click', () => changePanel('settings'));
        this.$.playBtn?.addEventListener('click', () => this.startGame());

        this.$.railBtns.forEach(btn => {
            const target = btn.dataset.target;
            btn.addEventListener('click', () => {
                if (target === 'pane-instances') this.showInstancesPane();
                else if (target === 'pane-home') this.showHomePane(btn);
                else this.switchPane(target, btn);

                // actualizar estado visual del rail
                this.$.railBtns.forEach(b => b.classList.remove('is-active'));
                if (target) btn.classList.add('is-active');

                btn.animate([{ transform:'translateY(0)' },{ transform:'translateY(-2px)' },{ transform:'translateY(0)' }], { duration:180 });
            });
        });

        // tooltips limpios
        this.$.railBtns.forEach(btn => {
            const tip = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
            if (tip) btn.setAttribute('data-tip', tip);
            btn.setAttribute('title', '');
        });

        await this.populatePlayerInfo();
        await this.prepareDataAndUI();
    }

    async populatePlayerInfo() {
        const cfg = await this.db.readData('configClient');
        const acc = await this.db.readData('accounts', cfg?.account_selected);
        const nick = acc?.name || acc?.username || acc?.profile?.name || 'Jugador';
        if (this.$.playerNick) this.$.playerNick.textContent = nick;
    }

    async prepareDataAndUI() {
        if (!config || typeof config.getInstanceList !== 'function') return console.error('[Home] config.getInstanceList no disponible');
        const cfg = await this.db.readData('configClient');
        const acc = await this.db.readData('accounts', cfg?.account_selected);
        this.playerName = acc?.name || acc?.username || acc?.profile?.name;

        this.instances = await config.getInstanceList();

        let chosen = this.pickValidInstance(this.instances, getInstanceSelectedKey(cfg), this.playerName);
        if (chosen) {
            await setStatus(chosen.status);
            this.renderHero(chosen);
            await this.db.updateData('configClient', setInstanceSelectedKey(cfg, chosen.name));
        } else {
            this.renderHero({ name: 'Sin acceso', images: { hero: 'assets/images/instance-default.jpg' } });
            this.$.playBtn?.setAttribute('disabled', 'true');
        }

        this.renderInstancesGrid(this.instances, chosen?.name);
    }

    getInstanceImage(inst) {
        return inst?.assets?.hero || inst?.images?.hero || inst?.hero || inst?.banner || inst?.image || 'assets/images/instance-default.jpg';
    }

    renderHero(inst) {
        const src = this.getInstanceImage(inst);
        if (this.$.instanceHero) this.$.instanceHero.style.backgroundImage = `url('${src}')`;
        if (this.$.instanceHeroName) this.$.instanceHeroName.textContent = inst?.name ?? 'Instancia';

        const L = readLoader(inst);
        const loaderText = (L.type === 'none' ? 'Vanilla' : L.type) + (L.version ? ` ${L.version}` : '');
        this.$.chipLoader && (this.$.chipLoader.textContent = loaderText);
        this.$.chipVersion && (this.$.chipVersion.textContent = `MC ${L.mc}`);
    }

    pickValidInstance(instances, desiredName, playerName) {
        const byName = (n) => instances.find(i => i.name === n);
        const canUse = (i) => !i.whitelistActive || i.whitelist?.includes(playerName);
        if (desiredName) {
            const inst = byName(desiredName);
            if (inst && canUse(inst)) return inst;
        }
        return instances.find(canUse);
    }

    renderInstancesGrid(instances, activeName) {
        const list = this.$.instancesList;
        if (!list) return;
        list.innerHTML = '';

        const arr = Array.isArray(instances) ? instances : [];
        const canUse = (inst) => {
            if (inst?.whitelistActive !== true) return true;
            const wl = Array.isArray(inst?.whitelist) ? inst.whitelist : null;
            if (!wl) return true;
            if (!this.playerName) return false;
            return wl.includes(this.playerName);
        };

        const usable = [], locked = [];
        for (const inst of arr) (canUse(inst) ? usable : locked).push(inst);

        const paint = (inst, { active = false, disabled = false } = {}) => {
            const L = readLoader(inst);
            const card = document.createElement('div');
            card.className = `instance-card${active ? ' active-instance' : ''}${disabled ? ' is-locked' : ''}`;
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'option');
            card.setAttribute('aria-label', inst.name);
            card.dataset.name = inst.name;
            card.innerHTML = `
        <div class="instance-card__bg" style="background-image:url('${this.getInstanceImage(inst)}')"></div>
        <div class="instance-card__veil"></div>
        <div class="instance-card__content">
          <div class="instance-card__name">${this.escapeHTML(inst.name)}</div>
          <div class="instance-card__tags">
            <span class="tag">${this.escapeHTML(L.type === 'none' ? 'Vanilla' : L.type)}</span>
            <span class="tag">MC ${this.escapeHTML(L.mc)}</span>
          </div>
        </div>
      `;
            const choose = async () => {
                if (disabled) return;
                const cfg = await this.db.readData('configClient');
                await this.db.updateData('configClient', setInstanceSelectedKey(cfg, inst.name));
                await setStatus(inst.status);
                this.renderHero(inst);
                list.querySelectorAll('.instance-card').forEach(n => n.classList.remove('active-instance'));
                card.classList.add('active-instance');
                card.animate([{boxShadow:'0 0 0 0 rgba(45,255,136,0)'},{boxShadow:'0 0 0 12px rgba(45,255,136,0)'}],{duration:420,easing:'cubic-bezier(.21,.98,.24,.99)'});
            };
            card.addEventListener('click', choose);
            card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });

            list.appendChild(card);
        };

        usable.forEach(inst => paint(inst, { active: inst.name === activeName }));
        locked.forEach(inst => paint(inst, { disabled: true }));

        if (!usable.length && !locked.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#9AA7C5;font-weight:800;padding:1rem;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.03);';
            empty.textContent = 'No hay instancias disponibles.';
            list.appendChild(empty);
        }
    }

    /* ======= NAV ======= */
    switchPane(targetId, btn = null) {
        const panes = [this.$.paneHome, this.$.paneInstances].filter(Boolean);
        const current = panes.find(p => p?.classList.contains('is-active'));
        const next = panes.find(p => p?.id === targetId);
        if (!next || next === current) return;

        if (current) {
            current.animate([{opacity:1, transform:'none'}, {opacity:0, transform:'translateY(8px) scale(.995)'}], {duration:160, easing:'ease-out'})
                .onfinish = () => {
                current.hidden = true; current.classList.remove('is-active');
                next.hidden = false; next.classList.add('is-active');
                next.animate([{opacity:0, transform:'translateY(-8px) scale(.995)'}, {opacity:1, transform:'none'}], {duration:200, easing:'cubic-bezier(.21,.98,.24,.99)'});
            };
        } else {
            next.hidden = false; next.classList.add('is-active');
        }

        this.$.railBtns.forEach(b => b.classList.toggle('is-active', b.dataset.target === targetId));
        btn?.animate([{ transform:'translateY(0)' },{ transform:'translateY(-2px)' },{ transform:'translateY(0)' }], { duration:180 });
    }

    async showHomePane(btn){
        try {
            if (!this.instances?.length && config?.getInstanceList) this.instances = await config.getInstanceList();
            const cfg = await this.db.readData('configClient');
            const chosen = (this.instances || []).find(i => i.name === getInstanceSelectedKey(cfg)) || this.instances?.[0];
            if (chosen) this.renderHero(chosen);
        } catch(e){ console.error(e); }
        this.switchPane('pane-home', btn);
    }

    async showInstancesPane(){
        try {
            const cfg = await this.db.readData('configClient');
            if (config?.getInstanceList) this.instances = await config.getInstanceList();
            this.renderInstancesGrid(this.instances, getInstanceSelectedKey(cfg));
        } catch (e){ console.error(e); }
        this.switchPane('pane-instances');
        requestAnimationFrame(() => this.$.instancesList?.querySelector('.instance-card')?.focus());
    }

    /* ======= Launch ======= */
    async startGame() {
        const cfg = await this.db.readData('configClient');
        const chosenName = getInstanceSelectedKey(cfg);
        if (!config || typeof config.getInstanceList !== 'function') return;

        const instances = await config.getInstanceList();
        const options = instances.find(i => i.name === chosenName);
        if (!options) return new popup().openPopup({ title: 'Instancia no seleccionada', content: 'Ve a la pestaña Instancias y elige una.', color: 'yellow', options: true });

        const authenticator = await this.db.readData('accounts', cfg?.account_selected);
        if (!authenticator) return new popup().openPopup({ title:'Sesión requerida', content:'Inicia sesión antes de jugar.', color:'red', options:true });

        const L = readLoader(options);
        const opt = {
            url: options.url,
            authenticator,
            timeout: 10000,
            path: `${await appdata()}/${process.platform === 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
            instance: options.name,
            version: L.mc,
            detached: cfg?.launcher_config?.closeLauncher !== "close-all",
            downloadFileMultiple: cfg?.launcher_config?.download_multi,
            intelEnabledMac: cfg?.launcher_config?.intelEnabledMac,
            loader: { type: L.type, build: L.version, enable: L.type !== 'none' },
            verify: options.verify,
            ignored: [...(options.ignored || [])],
            java: { path: cfg?.java_config?.java_path },
            JVM_ARGS: options.jvm_args || [],
            GAME_ARGS: options.game_args || [],
            screen: { width: cfg?.game_config?.screen_size?.width, height: cfg?.game_config?.screen_size?.height },
            memory: { min: `${(cfg?.java_config?.java_memory?.min ?? 2) * 1024}M`, max: `${(cfg?.java_config?.java_memory?.max ?? 4) * 1024}M` }
        };

        // === Mostrar estado de descarga en el footer ===
        const btn = this.$.playBtn;
        const box = this.$.infoBox;
        const text = this.$.infoText;
        const bar = this.$.progressBar;

        btn.disabled = true;
        btn.style.display = "none";
        box.style.display = "block";
        bar.style.display = "";
        bar.value = 0; bar.max = 0;
        text.textContent = 'Preparando…';

        ipcRenderer.send('main-window-progress-load');

        const throttle = (() => { let t=0; return (cb)=>{ const n=performance.now(); if(n-t>66){ t=n; cb(); } }; })();

        const launch = new Launch();
        launch.Launch(opt);

        launch.on('progress', (p, s) => {
            const pct = ((p/s)*100).toFixed(0);
            text.innerHTML = `Descargando ${pct}%`;
            bar.value = p; bar.max = s;
            throttle(() => ipcRenderer.send('main-window-progress', { progress: p, size: s }));
        });
        launch.on('check', (p, s) => {
            const pct = ((p/s)*100).toFixed(0);
            text.innerHTML = `Verificando ${pct}%`;
            bar.value = p; bar.max = s;
            throttle(() => ipcRenderer.send('main-window-progress', { progress: p, size: s }));
        });
        launch.on('patch', () => {
            ipcRenderer.send('main-window-progress-load');
            text.innerHTML = `Aplicando patch...`;
        });
        launch.on('data', () => {
            // Juego arrancando
            bar.style.display = "none";
            text.innerHTML = `Iniciando juego...`;
            if (cfg?.launcher_config?.closeLauncher === 'close-launcher') ipcRenderer.send("main-window-hide");
            new logger('Minecraft', '#36b030');
            ipcRenderer.send('main-window-progress-load');
        });
        const restoreUI = () => {
            ipcRenderer.send('main-window-progress-reset');
            box.style.display = "none";
            btn.style.display = "inline-flex";
            btn.disabled = false;
            text.innerHTML = `Conectando…`;
            bar.style.display = "";
            bar.value = 0; bar.max = 0;
        };
        launch.on('close', restoreUI);
        launch.on('error', err => {
            const msg = err?.error || err?.stack || err?.message || String(err);
            new popup().openPopup({ title:'Error', content: msg, color:'red', options:true });
            if (cfg?.launcher_config?.closeLauncher === 'close-launcher') ipcRenderer.send("main-window-show");
            restoreUI();
            console.error(err);
        });
    }

    escapeHTML(str=""){ return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
}

export default Home;
