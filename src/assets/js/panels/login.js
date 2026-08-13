/**
 * HyLegacy Launcher — Login Panel
 * Autor: SrMast3r (HyLegacy)
 * Basado en Luuxis, adaptado a estilo Splash
 */

const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import {
    popup,
    database,
    changePanel,
    accountSelect,
    addAccount,
    config,
    setStatus
} from '../utils.js';

/* ===================== Utilidades ===================== */
const $$ = (sel, root=document) => root.querySelector(sel);
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
window.showView = showView; // por si llamas desde HTML

export default class Login {
    static id = "login";

    async init(configIn) {
        this.config = configIn;
        this.db = new database();

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

        // Botón Configurar → settings
        const cancelHome = $$('.cancel-home');
        on(cancelHome, 'click', () => {
            cancelHome.style.display = 'none';
            changePanel('settings');
        }, { once: true });

        // Ruteo inicial según tu config
        if (typeof this.config.online === 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack();
        } else if (typeof this.config.online === 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) this.getAZauth();
            else this.getMicrosoft(); // fallback
        } else {
            this.getMicrosoft(); // default
        }

        // Asegura animación inicial
        requestAnimationFrame(() => {
            document.querySelectorAll('.login-tabs').forEach(el => {
                if (getComputedStyle(el).display !== 'none' || el.classList.contains('is-active')) {
                    el.classList.add('is-active');
                }
            });
        });
    }

    /* ===================== Microsoft ===================== */
    async getMicrosoft() {
        const pop = new popup();
        showView('.login-home');

        const btn = $$('.connect-home');
        on(btn, 'click', () => {
            pop.openPopup({
                title: 'Conectando con Microsoft',
                content: 'Se abrió tu navegador para iniciar sesión. Completa el inicio de sesión ahí — esta ventana se cerrará sola al terminar.',
                color: 'var(--color)',
                options: true
            });
            // Cancelar desde la app si el usuario no quiere seguir en el navegador
            on($$('.popup-button'), 'click', () => ipcRenderer.send('Microsoft-window-cancel'), { once: true });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id)
                .then(async account_connect => {
                    if (account_connect === 'cancel' || !account_connect) { pop.closePopup(); return; }
                    if (account_connect.error) {
                        pop.openPopup({ title: 'Error', content: account_connect.error, options: true });
                        return;
                    }
                    await this.saveData(account_connect);
                    pop.closePopup();
                })
                .catch(err => {
                    pop.openPopup({ title: 'Error', content: String(err), options: true });
                });
        }, { once: true });
    }

    /* ===================== Offline ===================== */
    async getCrack() {
        const pop = new popup();
        showView('.login-offline');

        const nickInput = $$('.email-offline');
        const btn = $$('.connect-offline');

        on(btn, 'click', async () => {
            const nick = (nickInput.value || '').trim();
            if (nick.length < 3) return pop.openPopup({ title: 'Error', content: 'El apodo debe tener al menos 3 caracteres.', options: true });
            if (/\s/.test(nick)) return pop.openPopup({ title: 'Error', content: 'El apodo no puede contener espacios.', options: true });

            const res = await Mojang.login(nick);
            if (res.error) return pop.openPopup({ title: 'Error', content: res.message, options: true });

            await this.saveData(res);
            pop.closePopup();
        }, { once: true });
    }

    /* ===================== AZauth (con 2FA) ===================== */
    async getAZauth() {
        const Pop = new popup();
        const client = new AZauth(this.config.online);

        showView('.login-AZauth');

        const email = $$('.email-AZauth');
        const pass  = $$('.password-AZauth');
        const code  = $$('.A2F-AZauth');

        const btnLogin  = $$('.connect-AZauth');
        const btn2FA    = $$('.connect-AZauth-A2F');
        const btnCancel = $$('.cancel-AZauth-A2F');

        on(btnLogin, 'click', async () => {
            Pop.openPopup({ title: 'Conectando…', content: 'Por favor, espera…', color: 'var(--color)' });

            if (!email.value || !pass.value) {
                Pop.openPopup({ title: 'Error', content: 'Completa todos los campos.', options: true });
                return;
            }

            let r = await client.login(email.value, pass.value);
            if (r.error) return Pop.openPopup({ title: 'Error', content: r.message, options: true });

            if (r.A2F) {
                showView('.login-AZauth-A2F');
                Pop.closePopup();

                on(btnCancel, 'click', () => showView('.login-AZauth'), { once: true });

                on(btn2FA, 'click', async () => {
                    Pop.openPopup({ title: 'Conectando…', content: 'Por favor, espera…', color: 'var(--color)' });
                    if (!code.value) return Pop.openPopup({ title: 'Error', content: 'Ingresa el código de seguridad.', options: true });

                    r = await client.login(email.value, pass.value, code.value);
                    if (r.error) return Pop.openPopup({ title: 'Error', content: r.message, options: true });

                    await this.saveData(r);
                    Pop.closePopup();
                }, { once: true });

            } else {
                await this.saveData(r);
                Pop.closePopup();
            }
        }, { once: true });
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
        changePanel('home');
    }
}
