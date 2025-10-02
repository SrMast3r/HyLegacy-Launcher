/**
 * @author Luuxis
 * Licencia Luuxis v1.0 (ver archivo LICENSE para detalles en FR/ES)
 */
const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import { popup, database, changePanel, accountSelect, addAccount, config, setStatus } from '../utils.js';

class Login {
    static id = "login";

    async init(configIn){
        this.config = configIn;
        this.db = new database();

        // Decide flujo: Microsoft / Offline / AZauth (URL)
        if (typeof this.config.online === 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack();
        } else if (typeof this.config.online === 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) this.getAZauth();
        }

        // Botón "cancel-home" abre settings (como en tu base)
        document.querySelector('.cancel-home')?.addEventListener('click', () => {
            document.querySelector('.cancel-home').style.display = 'none';
            changePanel('settings');
        });

        // Aparece suavemente la tarjeta activa
        requestAnimationFrame(() => {
            document.querySelectorAll('.login-tabs').forEach(el => {
                if (el.style.display === 'block') el.classList.add('show');
            });
        });
    }

    /* ================= Microsoft ================= */
    async getMicrosoft(){
        console.log('Inicializando login Microsoft…');
        const pop = new popup();
        const view = document.querySelector('.login-home');
        const btn = document.querySelector('.connect-home');
        view.style.display = 'block'; view.classList.add('show');

        btn.addEventListener('click', () => {
            pop.openPopup({
                title: 'Conexión',
                content: 'Por favor, espera…',
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id)
                .then(async acc => {
                    if (acc === 'cancel' || !acc) { pop.closePopup(); return; }
                    await this.saveData(acc);
                    pop.closePopup();
                })
                .catch(err => {
                    pop.openPopup({ title: 'Error', content: err, options: true });
                });
        });
    }

    /* ================= Offline (Crack) ================= */
    async getCrack(){
        console.log('Inicializando login offline…');
        const pop = new popup();
        const view = document.querySelector('.login-offline');
        const input = document.querySelector('.email-offline');
        const btn = document.querySelector('.connect-offline');

        view.style.display = 'block'; view.classList.add('show');

        btn.addEventListener('click', async () => {
            const nick = (input.value || '').trim();

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

            const res = await Mojang.login(nick);
            if (res.error) {
                pop.openPopup({ title: 'Error', content: res.message, options: true });
                return;
            }
            await this.saveData(res);
            pop.closePopup();
        });
    }

    /* ================= AZauth (con A2F) ================= */
    async getAZauth(){
        console.log('Inicializando login AZauth…');
        const client = new AZauth(this.config.online);
        const pop = new popup();

        const view = document.querySelector('.login-AZauth');
        const view2FA = document.querySelector('.login-AZauth-A2F');

        const $email = document.querySelector('.email-AZauth');
        const $pass  = document.querySelector('.password-AZauth');
        const $code  = document.querySelector('.A2F-AZauth');

        const btnLogin  = document.querySelector('.connect-AZauth');
        const btn2F     = document.querySelector('.connect-AZauth-A2F');
        const btn2FCxl  = document.querySelector('.cancel-AZauth-A2F');

        view.style.display = 'block'; view.classList.add('show');

        btnLogin.addEventListener('click', async () => {
            pop.openPopup({
                title: 'Conectando…',
                content: 'Por favor, espera…',
                color: 'var(--color)'
            });

            if (!$email.value || !$pass.value) {
                pop.openPopup({ title: 'Error', content: 'Completa todos los campos.', options: true });
                return;
            }

            let res = await client.login($email.value, $pass.value);

            if (res.error) {
                pop.openPopup({ title: 'Error', content: res.message, options: true });
                return;
            } else if (res.A2F) {
                // Pedir código 2FA
                view.style.display = 'none';
                view2FA.style.display = 'block';
                view2FA.classList.add('show');
                pop.closePopup();

                btn2FCxl.addEventListener('click', () => {
                    view2FA.style.display = 'none';
                    view.style.display = 'block';
                    view.classList.add('show');
                }, { once:true });

                btn2F.addEventListener('click', async () => {
                    pop.openPopup({
                        title: 'Conectando…',
                        content: 'Por favor, espera…',
                        color: 'var(--color)'
                    });

                    if (!$code.value) {
                        pop.openPopup({ title: 'Error', content: 'Ingresa el código de seguridad.', options: true });
                        return;
                    }

                    res = await client.login($email.value, $pass.value, $code.value);
                    if (res.error) {
                        pop.openPopup({ title: 'Error', content: res.message, options: true });
                        return;
                    }
                    await this.saveData(res);
                    pop.closePopup();
                }, { once:true });

            } else {
                await this.saveData(res);
                pop.closePopup();
            }
        });
    }

    /* ================= Persistencia y selección ================= */
    async saveData(connectionData){
        const configClient = await this.db.readData('configClient');
        const account = await this.db.createData('accounts', connectionData);
        const instanceSelect = configClient.instance_selct;
        const instancesList = await config.getInstanceList();

        configClient.account_selected = account.ID;

        // Ajustar instancia seleccionada si la whitelist no lo permite
        for (const instance of instancesList) {
            if (instance.whitelistActive) {
                const ok = Array.isArray(instance.whitelist) && instance.whitelist.includes(account.name);
                if (!ok && instance.name === instanceSelect) {
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
