/**
 * HyLegacy Launcher — Login Panel
 * Autor: SrMast3r (HyLegacy)
 * Basado en Luuxis, adaptado a estilo Splash
 */

const { AZauth } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import {
    popup,
    database,
    changePanel,
    accountSelect,
    addAccount,
    offlineAccount,
    config,
    setStatus
} from '../utils.js';

/* ===================== Utilidades ===================== */
const $$ = (sel, root=document) => root.querySelector(sel);
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

// Nick válido de Minecraft: 3-16 caracteres, letras, números o _
const OFFLINE_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

const MS_ERRORS = {
    NO_MINECRAFT_ACCOUNT: 'Esta cuenta de Microsoft no tiene Minecraft Java. Usa otra cuenta o el Modo Offline.',
    NO_MINECRAFT_ENTITLEMENTS: 'Esta cuenta de Microsoft no tiene Minecraft Java. Usa otra cuenta o el Modo Offline.',
};
const errorText = (err) => {
    const raw = err?.error ?? err?.message ?? err;
    if (typeof raw === 'string') return MS_ERRORS[raw] || raw;
    try { return JSON.stringify(raw); } catch { return String(raw); }
};

/* Forzar no-scroll en motores tercos */
(function killScrollbars(){
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const st = document.createElement('style');
    st.textContent = `::-webkit-scrollbar{width:0;height:0}`;
    document.head.appendChild(st);
})();

/* Vistas */
const VIEWS = ['.login-home', '.login-offline', '.login-AZauth', '.login-AZauth-A2F'];
const showView = (sel) => {
    VIEWS.forEach(s => {
        const el = $$(s);
        if (!el) return;
        el.classList.toggle('is-active', s === sel);
    });
};

export default class Login {
    static id = "login";

    async init(configIn) {
        this.config = configIn;
        this.db = new database();
        this.pop = new popup();
        this.busy = false;
        this.isAZauth = typeof this.config.online === 'string'
            && /^(http|https):\/\/[^ "]+$/.test(this.config.online);

        // Tema (oscuro/claro/auto) como el splash
        try {
            const cfg = await this.db.readData('configClient');
            const theme = cfg?.launcher_config?.theme || 'auto';
            const isDark = await ipcRenderer.invoke('is-dark-theme', theme).then(Boolean);
            document.body.classList.toggle('dark',  isDark);
            document.body.classList.toggle('light', !isDark);
        } catch {
            document.body.classList.add('dark');
        }

        // Tecla DevTools
        on(document, 'keydown', (e) => {
            if ((e.ctrlKey && e.shiftKey && e.code === 'KeyI') || e.code === 'F12') {
                ipcRenderer.send('update-window-dev-tools');
            }
        });

        // Botones de navegación entre vistas. La CSP (script-src 'self') bloquea
        // los onclick="" escritos en el HTML, así que se conectan aquí.
        document.querySelectorAll('.login [data-view]').forEach(btn => {
            on(btn, 'click', () => showView(btn.dataset.view));
        });

        // Botón Configurar → settings
        const cancelHome = $$('.cancel-home');
        on(cancelHome, 'click', () => {
            cancelHome.style.display = 'none';
            changePanel('settings');
        });

        // Premium y no premium siempre disponibles; AZauth solo si `online` es una URL
        this.getMicrosoft();
        this.getCrack();
        if (this.isAZauth) {
            const opt = $$('.login-azauth-option');
            if (opt) opt.style.display = '';
            this.getAZauth();
        }

        showView('.login-home');
    }

    /**
     * Ejecuta un intento de login: ignora clics mientras otro está en curso
     * y muestra cualquier error en vez de dejar el botón colgado.
     */
    async attempt(fn) {
        if (this.busy) return;
        this.busy = true;
        try {
            await fn();
        } catch (err) {
            console.error('[Login]', err);
            this.pop.openPopup({ title: 'Error', content: errorText(err), options: true });
        } finally {
            this.busy = false;
        }
    }

    /* ===================== Microsoft (premium) ===================== */
    getMicrosoft() {
        on($$('.connect-home'), 'click', () => this.attempt(async () => {
            this.pop.openPopup({ title: 'Conectando con Microsoft', content: 'Por favor, espera…', color: 'var(--color)' });

            const account = await ipcRenderer.invoke('Microsoft-window', this.config.client_id);
            if (!account || account === 'cancel') return this.pop.closePopup();
            if (account.error) {
                return this.pop.openPopup({ title: 'Error', content: errorText(account), options: true });
            }

            await this.saveData(account);
            this.pop.closePopup();
        }));
    }

    /* ===================== Offline (no premium) ===================== */
    getCrack() {
        const nickInput = $$('.email-offline');

        const submit = () => this.attempt(async () => {
            const nick = (nickInput.value || '').trim();
            if (!OFFLINE_NAME_RE.test(nick)) {
                return this.pop.openPopup({
                    title: 'Error',
                    content: 'El apodo debe tener entre 3 y 16 caracteres y solo puede usar letras, números o _.',
                    options: true
                });
            }

            // Si ese nick offline ya existe, se selecciona en vez de duplicarlo
            const accounts = await this.db.readAllData('accounts') || [];
            const existing = accounts.find(a => a.meta?.online === false
                && a.name?.toLowerCase() === nick.toLowerCase());
            if (existing) return this.selectExisting(existing);

            await this.saveData(offlineAccount(nick));
            nickInput.value = '';
        });

        on($$('.connect-offline'), 'click', submit);
        on(nickInput, 'keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    /* ===================== AZauth (con 2FA) ===================== */
    getAZauth() {
        const client = new AZauth(this.config.online);

        const email = $$('.email-AZauth');
        const pass  = $$('.password-AZauth');
        const code  = $$('.A2F-AZauth');

        on($$('.cancel-AZauth-A2F'), 'click', () => showView('.login-AZauth'));

        on($$('.connect-AZauth'), 'click', () => this.attempt(async () => {
            if (!email.value || !pass.value) {
                return this.pop.openPopup({ title: 'Error', content: 'Completa todos los campos.', options: true });
            }
            this.pop.openPopup({ title: 'Conectando…', content: 'Por favor, espera…', color: 'var(--color)' });

            const r = await client.login(email.value, pass.value);
            if (r.error) return this.pop.openPopup({ title: 'Error', content: r.message, options: true });

            if (r.A2F) {
                showView('.login-AZauth-A2F');
                return this.pop.closePopup();
            }
            await this.saveData(r);
            this.pop.closePopup();
        }));

        on($$('.connect-AZauth-A2F'), 'click', () => this.attempt(async () => {
            if (!code.value) {
                return this.pop.openPopup({ title: 'Error', content: 'Ingresa el código de seguridad.', options: true });
            }
            this.pop.openPopup({ title: 'Conectando…', content: 'Por favor, espera…', color: 'var(--color)' });

            const r = await client.login(email.value, pass.value, code.value);
            if (r.error) return this.pop.openPopup({ title: 'Error', content: r.message, options: true });

            await this.saveData(r);
            this.pop.closePopup();
        }));
    }

    /* ===================== Tras iniciar sesión → Instancias ===================== */
    goToInstances() {
        showView('.login-home');
        document.dispatchEvent(new CustomEvent('hy:navigate-home', { detail: { pane: 'pane-instances' } }));
        changePanel('home');
    }

    /* ===================== Seleccionar cuenta ya guardada ===================== */
    async selectExisting(account) {
        const configClient = await this.db.readData('configClient');
        configClient.account_selected = account.ID;
        await this.db.updateData('configClient', configClient);
        await accountSelect(account);
        this.pop.closePopup();
        this.goToInstances();
    }

    /* ===================== Guardar cuenta & navegar ===================== */
    async saveData(connectionData) {
        const configClient   = await this.db.readData('configClient');
        const account        = await this.db.createData('accounts', connectionData);
        const instanceSelect = configClient.instance_selct;
        const instancesList  = await config.getInstanceList();

        configClient.account_selected = account.ID;

        // Reubicar instancia si la seleccionada tiene whitelist activa y no está permitido
        for (const instance of instancesList) {
            if (instance.whitelistActive) {
                const allowed = Array.isArray(instance.whitelist) && instance.whitelist.includes(account.name);
                if (!allowed && instance.name === instanceSelect) {
                    const fallback = instancesList.find(i => !i.whitelistActive) || instancesList[0];
                    if (fallback) {
                        configClient.instance_selct = fallback.name;
                        await setStatus(fallback.status);
                    }
                }
            }
        }

        await this.db.updateData('configClient', configClient);
        await addAccount(account);
        await accountSelect(account);
        this.goToInstances();
    }
}
