/**
 * @author Luuxis
 * Licencia Luuxis v1.0 (ver archivo LICENSE para detalles en FR/ES)
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

/* ===================== Helpers de vista (sin scroll, con animación) ===================== */
const VIEWS = ['.login-home', '.login-offline', '.login-AZauth', '.login-AZauth-A2F'];
const showView = (sel) => {
    VIEWS.forEach(s => {
        const el = document.querySelector(s);
        if (!el) return;
        if (s === sel) el.classList.add('is-active');
        else el.classList.remove('is-active');
    });
};

class Login {
    static id = "login";

    async init(configIn) {
        this.config = configIn;
        this.db = new database();

        // Determinar flujo según config.online
        if (typeof this.config.online === 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack();
        } else if (typeof this.config.online === 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) this.getAZauth();
        }

        // Botón cancelar (abre Settings como en tu base)
        document.querySelector('.cancel-home')?.addEventListener('click', () => {
            document.querySelector('.cancel-home').style.display = 'none';
            changePanel('settings');
        });

        // Mostrar la vista activa (si alguna se marcó programáticamente)
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
        console.log('Inicializando inicio de sesión Microsoft…');
        const pop = new popup();
        const loginHome = document.querySelector('.login-home');
        const microsoftBtn = document.querySelector('.connect-home');

        showView('.login-home');

        microsoftBtn.addEventListener('click', () => {
            pop.openPopup({
                title: 'Conexión',
                content: 'Por favor, espera…',
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

    /* ===================== Offline (Crack) ===================== */
    async getCrack() {
        console.log('Inicializando inicio de sesión offline…');
        const pop = new popup();
        const loginOffline = document.querySelector('.login-offline');
        const emailOffline = document.querySelector('.email-offline');
        const connectOffline = document.querySelector('.connect-offline');

        showView('.login-offline');

        connectOffline.addEventListener('click', async () => {
            const nick = (emailOffline.value || '').trim();

            if (nick.length < 3) {
                pop.openPopup({
                    title: 'Error',
                    content: 'Tu apodo debe tener al menos 3 caracteres.',
                    options: true
                });
                return;
            }

            if (/\s/.test(nick)) {
                pop.openPopup({
                    title: 'Error',
                    content: 'Tu apodo no debe contener espacios.',
                    options: true
                });
                return;
            }

            const MojangConnect = await Mojang.login(nick);

            if (MojangConnect.error) {
                pop.openPopup({
                    title: 'Error',
                    content: MojangConnect.message,
                    options: true
                });
                return;
            }

            await this.saveData(MojangConnect);
            pop.closePopup();
        }, { once: true });
    }

    /* ===================== AZauth (con 2FA) ===================== */
    async getAZauth() {
        console.log('Inicializando inicio de sesión AZauth…');
        const AZauthClient = new AZauth(this.config.online);
        const Pop = new popup();

        const loginAZauth = document.querySelector('.login-AZauth');
        const loginAZauthA2F = document.querySelector('.login-AZauth-A2F');

        const AZauthEmail = document.querySelector('.email-AZauth');
        const AZauthPassword = document.querySelector('.password-AZauth');
        const AZauthA2F = document.querySelector('.A2F-AZauth');

        const AZauthConnectBTN = document.querySelector('.connect-AZauth');
        const connectAZauthA2F = document.querySelector('.connect-AZauth-A2F');
        const AZauthCancelA2F = document.querySelector('.cancel-AZauth-A2F');

        showView('.login-AZauth');

        AZauthConnectBTN.addEventListener('click', async () => {
            Pop.openPopup({
                title: 'Conectando…',
                content: 'Por favor, espera…',
                color: 'var(--color)'
            });

            if (!AZauthEmail.value || !AZauthPassword.value) {
                Pop.openPopup({
                    title: 'Error',
                    content: 'Completa todos los campos.',
                    options: true
                });
                return;
            }

            let AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value);

            if (AZauthConnect.error) {
                Pop.openPopup({
                    title: 'Error',
                    content: AZauthConnect.message,
                    options: true
                });
                return;
            }

            if (AZauthConnect.A2F) {
                // Pedir código A2F
                showView('.login-AZauth-A2F');
                Pop.closePopup();

                AZauthCancelA2F.addEventListener('click', () => {
                    showView('.login-AZauth');
                }, { once: true });

                connectAZauthA2F.addEventListener('click', async () => {
                    Pop.openPopup({
                        title: 'Conectando…',
                        content: 'Por favor, espera…',
                        color: 'var(--color)'
                    });

                    if (!AZauthA2F.value) {
                        Pop.openPopup({
                            title: 'Error',
                            content: 'Ingresa el código de seguridad.',
                            options: true
                        });
                        return;
                    }

                    AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value, AZauthA2F.value);

                    if (AZauthConnect.error) {
                        Pop.openPopup({
                            title: 'Error',
                            content: AZauthConnect.message,
                            options: true
                        });
                        return;
                    }

                    await this.saveData(AZauthConnect);
                    Pop.closePopup();
                }, { once: true });

            } else {
                await this.saveData(AZauthConnect);
                Pop.closePopup();
            }
        }, { once: true });
    }

    /* ===================== Guardar cuenta y selección de instancia ===================== */
    async saveData(connectionData) {
        const configClient = await this.db.readData('configClient');
        const account = await this.db.createData('accounts', connectionData);
        const instanceSelect = configClient.instance_selct; // compat con tu key existente
        const instancesList = await config.getInstanceList();

        configClient.account_selected = account.ID;

        // Si la instancia seleccionada requiere whitelist y el jugador no está, elegir otra
        for (const instance of instancesList) {
            if (instance.whitelistActive) {
                const allowed = Array.isArray(instance.whitelist) && instance.whitelist.includes(account.name);
                if (!allowed && instance.name === instanceSelect) {
                    const fallback = instancesList.find(i => i.whitelistActive === false) || instancesList[0];
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
