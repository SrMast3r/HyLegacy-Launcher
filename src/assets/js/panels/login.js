/**
 * HyLegacy Launcher — Login Panel
 * @author SrMast3r
 * Basado en Luuxis | Adaptado por HyLegacy
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

/* ===================== Helpers ===================== */
const VIEWS = ['.login-home', '.login-offline', '.login-AZauth', '.login-AZauth-A2F'];
const showView = (sel) => {
    VIEWS.forEach(s => {
        const el = document.querySelector(s);
        if (!el) return;
        el.classList.toggle('is-active', s === sel);
    });
};

class Login {
    static id = "login";

    async init(configIn) {
        this.config = configIn;
        this.db = new database();

        // Determinar modo de inicio
        if (typeof this.config.online === 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack();
        } else if (typeof this.config.online === 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) this.getAZauth();
        }

        // Botón cancelar
        document.querySelector('.cancel-home')?.addEventListener('click', () => {
            document.querySelector('.cancel-home').style.display = 'none';
            changePanel('settings');
        });

        // Refrescar vista activa
        requestAnimationFrame(() => {
            document.querySelectorAll('.login-tabs').forEach(el => {
                if (getComputedStyle(el).display !== 'none' || el.classList.contains('is-active'))
                    el.classList.add('is-active');
            });
        });
    }

    /* ===================== Microsoft ===================== */
    async getMicrosoft() {
        console.log('Iniciando sesión Microsoft...');
        const pop = new popup();
        showView('.login-home');

        const microsoftBtn = document.querySelector('.connect-home');
        microsoftBtn.addEventListener('click', () => {
            pop.openPopup({
                title: 'Conectando con Microsoft',
                content: 'Por favor, espera...',
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id)
                .then(async account_connect => {
                    if (account_connect === 'cancel' || !account_connect) {
                        pop.closePopup();
                        return;
                    }
                    await this.saveData(account_connect);
                    pop.closePopup();
                })
                .catch(err => {
                    pop.openPopup({
                        title: 'Error',
                        content: err,
                        options: true
                    });
                });
        }, { once: true });
    }

    /* ===================== Offline ===================== */
    async getCrack() {
        console.log('Iniciando sesión offline...');
        const pop = new popup();
        showView('.login-offline');

        const emailOffline = document.querySelector('.email-offline');
        const connectOffline = document.querySelector('.connect-offline');

        connectOffline.addEventListener('click', async () => {
            const nick = (emailOffline.value || '').trim();
            if (nick.length < 3) return pop.openPopup({ title: 'Error', content: 'El apodo debe tener al menos 3 caracteres.', options: true });
            if (/\s/.test(nick)) return pop.openPopup({ title: 'Error', content: 'El apodo no puede contener espacios.', options: true });

            const MojangConnect = await Mojang.login(nick);
            if (MojangConnect.error)
                return pop.openPopup({ title: 'Error', content: MojangConnect.message, options: true });

            await this.saveData(MojangConnect);
            pop.closePopup();
        }, { once: true });
    }

    /* ===================== AZauth ===================== */
    async getAZauth() {
        console.log('Iniciando sesión AZauth...');
        const AZauthClient = new AZauth(this.config.online);
        const Pop = new popup();

        const AZauthEmail = document.querySelector('.email-AZauth');
        const AZauthPassword = document.querySelector('.password-AZauth');
        const AZauthA2F = document.querySelector('.A2F-AZauth');

        const AZauthConnectBTN = document.querySelector('.connect-AZauth');
        const connectAZauthA2F = document.querySelector('.connect-AZauth-A2F');
        const AZauthCancelA2F = document.querySelector('.cancel-AZauth-A2F');

        showView('.login-AZauth');

        AZauthConnectBTN.addEventListener('click', async () => {
            Pop.openPopup({
                title: 'Conectando...',
                content: 'Por favor, espera...',
                color: 'var(--color)'
            });

            if (!AZauthEmail.value || !AZauthPassword.value)
                return Pop.openPopup({ title: 'Error', content: 'Completa todos los campos.', options: true });

            let AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value);

            if (AZauthConnect.error)
                return Pop.openPopup({ title: 'Error', content: AZauthConnect.message, options: true });

            if (AZauthConnect.A2F) {
                showView('.login-AZauth-A2F');
                Pop.closePopup();

                AZauthCancelA2F.addEventListener('click', () => showView('.login-AZauth'), { once: true });

                connectAZauthA2F.addEventListener('click', async () => {
                    Pop.openPopup({
                        title: 'Conectando...',
                        content: 'Por favor, espera...',
                        color: 'var(--color)'
                    });

                    if (!AZauthA2F.value)
                        return Pop.openPopup({ title: 'Error', content: 'Ingresa el código de seguridad.', options: true });

                    AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value, AZauthA2F.value);
                    if (AZauthConnect.error)
                        return Pop.openPopup({ title: 'Error', content: AZauthConnect.message, options: true });

                    await this.saveData(AZauthConnect);
                    Pop.closePopup();
                }, { once: true });

            } else {
                await this.saveData(AZauthConnect);
                Pop.closePopup();
            }
        }, { once: true });
    }

    /* ===================== Guardar cuenta ===================== */
    async saveData(connectionData) {
        const configClient = await this.db.readData('configClient');
        const account = await this.db.createData('accounts', connectionData);
        const instanceSelect = configClient.instance_selct;
        const instancesList = await config.getInstanceList();

        configClient.account_selected = account.ID;

        // Verificar whitelist
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

export default Login;
