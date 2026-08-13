/**
 * @author Luuxis
 * @license Luuxis License v1.0
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground } from '../utils.js'
const os = require('os');

class Settings {
    static id = "settings";

    async init(configIn) {
        this.config = configIn;
        this.db = new database();

        // Aplica el fondo según la instancia seleccionada
        await this.applyInstanceBackground();

        this.navBTN();
        this.railNav();
        this.footer();
        this.accounts();
        this.ram();
        this.javaPath();
        // this.resolution();  // ❌ eliminado: ya no hay pestaña de resolución
        this.launcher();
    }

    /** ===================== Fondo con imagen de la instancia ===================== */
    async applyInstanceBackground() {
        // contenedor del panel de ajustes
        const host = document.querySelector('.settings .container');
        if (!host) return;

        // Lee instancia seleccionada
        const cfg = await this.db.readData('configClient').catch(() => null);
        const instances = await config.getInstanceList().catch(() => []);
        const picked = instances.find(i => i.name === cfg?.instance_selct) || instances[0] || null;

        // Candidatos de imagen
        const FALLBACK = 'assets/images/instance-default.jpg';
        const sources = [
            picked?.assets?.hero,
            picked?.images?.hero,
            picked?.hero,
            picked?.banner,
            picked?.image,
            FALLBACK
        ].filter(Boolean);

        // Pre-carga en cadena hasta que alguna funcione
        const preload = (src, timeout = 8000) => new Promise((res, rej) => {
            if (!src) return rej();
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const t = setTimeout(() => { img.onload = img.onerror = null; rej(); }, timeout);
            img.onload = () => { clearTimeout(t); res(src); };
            img.onerror = () => { clearTimeout(t); rej(); };
            img.src = src;
        });

        let finalSrc = FALLBACK;
        for (let i = 0; i < sources.length; i++) {
            try { finalSrc = await preload(sources[i]); break; } catch {}
        }

        // Fija la variable CSS para que el ::before la use
        host.style.setProperty('--settings-hero', `url("${finalSrc}")`);
    }

    /** ===================== Navegación lateral ===================== */
    navBTN() {
        document.querySelector('.nav-box').addEventListener('click', e => {
            if (!e.target.classList.contains('nav-settings-btn')) return;

            const id = e.target.id;
            const activeBtn = document.querySelector('.active-settings-BTN');
            const activeTab = document.querySelector('.active-container-settings');

            if (id === 'save') {
                // Volver a HOME de forma limpia
                activeBtn?.classList.remove('active-settings-BTN');
                document.querySelector('#account')?.classList.add('active-settings-BTN');

                activeTab?.classList.remove('active-container-settings');
                document.querySelector('#account-tab')?.classList.add('active-container-settings');

                return changePanel('home');
            }

            activeBtn?.classList.remove('active-settings-BTN');
            e.target.classList.add('active-settings-BTN');

            activeTab?.classList.remove('active-container-settings');
            document.querySelector(`#${id}-tab`)?.classList.add('active-container-settings');
        });
    }

    /** ===================== Rail — volver a Inicio/Instancias ===================== */
    railNav() {
        document.querySelectorAll('.settings-shell .rail-btn[data-nav]').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.nav === 'instances' ? 'pane-instances' : 'pane-home';
                document.dispatchEvent(new CustomEvent('hy:navigate-home', { detail: { pane: target } }));
                changePanel('home');
            });
        });
    }

    /** ===================== Footer — jugador + Jugar (igual que Home) ===================== */
    async footer() {
        const cfg = await this.db.readData('configClient');
        const acc = await this.db.readData('accounts', cfg?.account_selected);
        const nick = acc?.name || acc?.username || acc?.profile?.name || 'Jugador';
        const nickEl = document.querySelector('.settings-player-nick');
        if (nickEl) nickEl.textContent = nick;

        document.querySelector('.settings-play-btn')?.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('hy:navigate-home', { detail: { pane: 'pane-home' } }));
            changePanel('home');
            // pequeña espera para que el footer real de Home ya esté visible
            // (barra de progreso) antes de disparar el lanzamiento.
            setTimeout(() => document.dispatchEvent(new CustomEvent('hy:play-now')), 60);
        });
    }

    /** ===================== Cuentas ===================== */
    accounts() {
        document.querySelector('.accounts-list').addEventListener('click', async e => {
            const pop = new popup();
            try {
                const id = e.target.id;

                if (e.target.classList.contains('account')) {
                    pop.openPopup({
                        title: 'Conectando',
                        content: 'Por favor, espera…',
                        color: 'var(--color)'
                    });

                    if (id === 'add') {
                        document.querySelector('.cancel-home').style.display = 'inline';
                        return changePanel('login');
                    }

                    const account = await this.db.readData('accounts', id);
                    const configClient = await this.setInstance(account);
                    await accountSelect(account);
                    configClient.account_selected = account.ID;
                    return await this.db.updateData('configClient', configClient);
                }

                if (e.target.classList.contains('delete-profile')) {
                    pop.openPopup({
                        title: 'Conectando',
                        content: 'Por favor, espera…',
                        color: 'var(--color)'
                    });

                    await this.db.deleteData('accounts', id);
                    const card = document.getElementById(`${id}`);
                    const list = document.querySelector('.accounts-list');
                    list.removeChild(card);

                    if (list.children.length === 1) return changePanel('login');

                    const configClient = await this.db.readData('configClient');

                    if (configClient.account_selected === id) {
                        const all = await this.db.readAllData('accounts');
                        configClient.account_selected = all[0].ID;
                        accountSelect(all[0]);
                        const newSelect = await this.setInstance(all[0]);
                        configClient.instance_selct = newSelect.instance_selct;
                        return await this.db.updateData('configClient', configClient);
                    }
                }
            } catch (err) {
                console.error(err);
            } finally {
                pop.closePopup();
            }
        });
    }

    async setInstance(auth) {
        const configClient = await this.db.readData('configClient');
        const instanceSelect = configClient.instance_selct;
        const instancesList = await config.getInstanceList();

        for (const instance of instancesList) {
            if (instance.whitelistActive) {
                const ok = instance.whitelist.find(w => w === auth.name);
                if (ok !== auth.name) {
                    if (instance.name === instanceSelect) {
                        const fallback = instancesList.find(i => i.whitelistActive === false);
                        configClient.instance_selct = fallback.name;
                        await setStatus(fallback.status);
                    }
                }
            }
        }
        return configClient;
    }

    /** ===================== RAM ===================== */
    async ram() {
        const cfg = await this.db.readData('configClient');
        const totalMem = Math.trunc((os.totalmem() / 1073741824) * 10) / 10;
        const freeMem  = Math.trunc((os.freemem()  / 1073741824) * 10) / 10;

        document.getElementById('total-ram').textContent = `${totalMem} GB`;
        document.getElementById('free-ram').textContent  = `${freeMem} GB`;

        const sliderDiv = document.querySelector('.memory-slider');
        sliderDiv.setAttribute('max', Math.trunc((80 * totalMem) / 100));

        let ram = cfg?.java_config?.java_memory
            ? { ramMin: cfg.java_config.java_memory.min, ramMax: cfg.java_config.java_memory.max }
            : { ramMin: '1', ramMax: '2' };

        if (totalMem < ram.ramMin) {
            cfg.java_config.java_memory = { min: 1, max: 2 };
            this.db.updateData('configClient', cfg);
            ram = { ramMin: '1', ramMax: '2' };
        }

        const slider = new Slider('.memory-slider', parseFloat(ram.ramMin), parseFloat(ram.ramMax));
        const minSpan = document.querySelector('.slider-touch-left span');
        const maxSpan = document.querySelector('.slider-touch-right span');

        minSpan.setAttribute('value', `${ram.ramMin} GB`);
        maxSpan.setAttribute('value', `${ram.ramMax} GB`);

        slider.on('change', async (min, max) => {
            const cfg2 = await this.db.readData('configClient');
            minSpan.setAttribute('value', `${min} GB`);
            maxSpan.setAttribute('value', `${max} GB`);
            cfg2.java_config.java_memory = { min, max };
            this.db.updateData('configClient', cfg2);
        });
    }

    /** ===================== Java Path ===================== */
    async javaPath() {
        const javaPathText = document.querySelector('.java-path-txt');
        javaPathText.textContent = `${await appdata()}/${process.platform === 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`;

        const configClient = await this.db.readData('configClient');
        const javaPath = configClient?.java_config?.java_path || 'Usar Java integrado del launcher';
        const txt = document.querySelector('.java-path-input-text');
        const file = document.querySelector('.java-path-input-file');
        txt.value = javaPath;

        document.querySelector('.java-path-set').addEventListener('click', async () => {
            file.value = '';
            file.click();
            await new Promise(resolve => {
                let itv = setInterval(() => {
                    if (file.value !== '') resolve(clearInterval(itv));
                }, 100);
            });

            const v = file.value.replace('.exe', '');
            if (v.endsWith('java') || v.endsWith('javaw')) {
                const cfg = await this.db.readData('configClient');
                const picked = file.files[0].path;
                txt.value = picked;
                cfg.java_config.java_path = picked;
                await this.db.updateData('configClient', cfg);
            } else {
                alert('El archivo debe llamarse java o javaw');
            }
        });

        document.querySelector('.java-path-reset').addEventListener('click', async () => {
            const cfg = await this.db.readData('configClient');
            txt.value = 'Usar Java integrado del launcher';
            cfg.java_config.java_path = null;
            await this.db.updateData('configClient', cfg);
        });
    }

    /** ===================== Launcher ===================== */
    async launcher() {
        const cfg = await this.db.readData('configClient');

        // Descargas simultáneas
        const maxDL = cfg?.launcher_config?.download_multi || 5;
        const input = document.querySelector('.max-files');
        const reset = document.querySelector('.max-files-reset');
        input.value = maxDL;

        input.addEventListener('change', async () => {
            const cfg2 = await this.db.readData('configClient');
            cfg2.launcher_config.download_multi = input.value;
            await this.db.updateData('configClient', cfg2);
        });

        reset.addEventListener('click', async () => {
            const cfg2 = await this.db.readData('configClient');
            input.value = 5;
            cfg2.launcher_config.download_multi = 5;
            await this.db.updateData('configClient', cfg2);
        });

        // Tema
        const themeBox = document.querySelector('.theme-box');
        let theme = cfg?.launcher_config?.theme || 'auto';

        if (theme === 'auto')      document.querySelector('.theme-btn-auto')  .classList.add('active-theme');
        else if (theme === 'dark') document.querySelector('.theme-btn-sombre').classList.add('active-theme');
        else if (theme === 'light')document.querySelector('.theme-btn-clair') .classList.add('active-theme');

        themeBox.addEventListener('click', async e => {
            if (!e.target.classList.contains('theme-btn')) return;

            document.querySelector('.active-theme')?.classList.remove('active-theme');

            if (e.target.classList.contains('theme-btn-auto')) {
                setBackground();
                theme = 'auto';
            } else if (e.target.classList.contains('theme-btn-sombre')) {
                setBackground(true);
                theme = 'dark';
            } else if (e.target.classList.contains('theme-btn-clair')) {
                setBackground(false);
                theme = 'light';
            }
            e.target.classList.add('active-theme');

            const cfg3 = await this.db.readData('configClient');
            cfg3.launcher_config.theme = theme;
            await this.db.updateData('configClient', cfg3);
        });

        // Comportamiento al iniciar
        const closeBox = document.querySelector('.close-box');
        const closeMode = cfg?.launcher_config?.closeLauncher || 'close-launcher';

        if (closeMode === 'close-launcher') document.querySelector('.close-launcher').classList.add('active-close');
        else if (closeMode === 'close-all') document.querySelector('.close-all').classList.add('active-close');
        else if (closeMode === 'close-none')document.querySelector('.close-none').classList.add('active-close');

        closeBox.addEventListener('click', async e => {
            if (!e.target.classList.contains('close-btn')) return;
            document.querySelector('.active-close')?.classList.remove('active-close');

            const cfg4 = await this.db.readData('configClient');

            if (e.target.classList.contains('close-launcher')) {
                e.target.classList.add('active-close');
                cfg4.launcher_config.closeLauncher = 'close-launcher';
            } else if (e.target.classList.contains('close-all')) {
                e.target.classList.add('active-close');
                cfg4.launcher_config.closeLauncher = 'close-all';
            } else if (e.target.classList.contains('close-none')) {
                e.target.classList.add('active-close');
                cfg4.launcher_config.closeLauncher = 'close-none';
            }
            await this.db.updateData('configClient', cfg4);
        });
    }
}

export default Settings;
