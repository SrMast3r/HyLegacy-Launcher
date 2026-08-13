// src/utils.js
/**
 * Utilidades compartidas del launcher
 * - Barra superior minimal: "Nombre de la instancia | Jugadores"
 * - Helpers de tema, paneles, cuentas y estado del server
 */

const { ipcRenderer } = require('electron');
const { Status } = require('minecraft-java-core');
const fs = require('fs');
const pkg = require('../package.json');

// Imports ESM del proyecto (ajusta las rutas si difieren)
import config from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';

/* =================== Tema / Fondo =================== */
async function setBackground(theme) {
    if (typeof theme === 'undefined') {
        const db = new database();
        const cfg = await db.readData('configClient');
        theme = cfg?.launcher_config?.theme || 'auto';
        theme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res);
    }

    const body = document.body;
    body.className = theme ? 'dark global' : 'light global';

    // Fondo de arte: SOLO estas dos imágenes, elegidas al azar
    // (cambia cada vez que se abre el launcher o se cambia de tema)
    const BACKGROUNDS = ['background_01.png', 'background_02.png'];
    let background;
    const bgDir = `${__dirname}/assets/images/background`;
    const available = BACKGROUNDS.filter(f => fs.existsSync(`${bgDir}/${f}`));
    if (available.length) {
        const pick = available[Math.floor(Math.random() * available.length)];
        // Ruta absoluta file:// — una relativa aquí se resuelve distinto según
        // quién la consuma y rompía la carga.
        const absPath = `${bgDir}/${pick}`.replace(/\\/g, '/');
        background = `url('file:///${absPath.replace(/^\/+/, '')}')`;
    }

    // Se pinta en un <div> real aparte (#app-bg, ver launcher.css) para poder
    // desenfocarlo con filter sin desenfocar la interfaz encima.
    let bgEl = document.getElementById('app-bg');
    if (!bgEl) {
        bgEl = document.createElement('div');
        bgEl.id = 'app-bg';
        body.insertBefore(bgEl, body.firstChild);
    }

    if (background) {
        bgEl.style.backgroundImage = background;
        body.style.backgroundColor = '';
    } else {
        bgEl.style.backgroundImage = 'none';
        body.style.backgroundColor = theme ? '#000' : '#fff';
    }
}

/* =================== Paneles =================== */
async function changePanel(id) {
    const panel = document.querySelector(`.${id}`);
    const active = document.querySelector(`.active`);
    if (active) active.classList.toggle('active');
    if (panel) panel.classList.add('active');
}

/* =================== Sistema =================== */
async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path);
}

/* =================== Cuentas =================== */
async function addAccount(data) {
    let skin = false;
    if (data?.profile?.skins?.[0]?.base64) {
        skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    }

    const div = document.createElement('div');
    div.classList.add('account');
    div.id = data.ID;
    div.innerHTML = `
    <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
    <div class="profile-infos">
      <div class="profile-pseudo">${data.name}</div>
      <div class="profile-uuid">${data.uuid}</div>
    </div>
    <div class="delete-profile" id="${data.ID}">
      <div class="icon-account-delete delete-profile-icon"></div>
    </div>
  `;
    return document.querySelector('.accounts-list')?.appendChild(div);
}

async function accountSelect(data) {
    const account = document.getElementById(`${data.ID}`);
    const active = document.querySelector('.account-select');
    if (active) active.classList.toggle('account-select');
    if (account) account.classList.add('account-select');

    if (data?.profile?.skins?.[0]?.base64) {
        headplayer(data.profile.skins[0].base64);
    }
}

async function headplayer(skinBase64) {
    const skin = await new skin2D().creatHeadTexture(skinBase64);
    const el = document.querySelector('.player-head');
    if (el) el.style.backgroundImage = `url(${skin})`;
}

/* =================== Estado del servidor (barra superior minimal) =================== */
/**
 * Actualiza la barra superior con "Nombre de la instancia | X jugadores"
 * SIN logo, SIN ping.
 * Espera un objeto opt.status como:
 *   { nameServer, ip, port }
 */
async function setStatus(opt) {
    const nameEl = document.querySelector('.server-status-name');
    const playersEl = document.querySelector('.server-players');

    // Si no existe el DOM correspondiente, no hacemos nada
    if (!nameEl && !playersEl) return;

    // Estado base si no hay configuración
    if (!opt) {
        if (nameEl) nameEl.textContent = 'Servidor';
        if (playersEl) playersEl.textContent = '0 jugadores';
        return;
    }

    const { ip, port, nameServer } = opt;
    if (nameEl) nameEl.textContent = nameServer || 'Servidor';

    try {
        const status = new Status(ip, port);
        const res = await status.getStatus().then(r => r).catch(() => null);
        const count = (res && !res.error) ? (res.playersConnect ?? 0) : 0;
        if (playersEl) playersEl.textContent = `${count} ${count === 1 ? 'jugador' : 'jugadores'}`;
    } catch {
        if (playersEl) playersEl.textContent = '0 jugadores';
    }
}

/* =================== Exports =================== */
export {
    appdata,
    changePanel,
    config,
    database,
    logger,
    popup,
    setBackground,
    skin2D,
    addAccount,
    accountSelect,
    slider as Slider,
    pkg,
    setStatus
};
