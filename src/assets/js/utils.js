// src/utils.js
/**
 * Utilidades compartidas del launcher
 * - Barra superior minimal: "Nombre de la instancia | Jugadores"
 * - Helpers de tema, paneles, cuentas y estado del server
 */

const { ipcRenderer } = require('electron');
const { Status } = require('minecraft-java-core');
const fs = require('fs');
const crypto = require('crypto');
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
/**
 * Cuenta offline (no premium) con UUID fijo: el mismo que calcula un servidor
 * en modo offline (UUID v3 de "OfflinePlayer:<nick>"). Mojang.login() de
 * minecraft-java-core genera uno al azar en cada inicio, y eso cambiaba la
 * identidad del jugador (inventario, permisos...) cada vez que abría el launcher.
 */
function offlineAccount(name) {
    const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
    hash[6] = (hash[6] & 0x0f) | 0x30; // versión 3
    hash[8] = (hash[8] & 0x3f) | 0x80; // variante RFC 4122
    const uuid = hash.toString('hex');
    return {
        access_token: uuid,
        client_token: uuid,
        uuid,
        name,
        user_properties: '{}',
        meta: { online: false, type: 'Mojang' }
    };
}

/**
 * Cabeza (avatar) de la cuenta. Premium: se recorta de la skin que ya viene en
 * el perfil (base64). Si no hay (cuentas offline o perfil sin skin), se pide a
 * mc-heads.net por nick (offline) o por UUID (premium); devuelve Steve/Alex
 * cuando ese nick no tiene skin propia.
 */
async function accountHead(data) {
    const base64 = data?.profile?.skins?.[0]?.base64;
    if (base64) {
        try { return await new skin2D().creatHeadTexture(base64); } catch {}
    }
    const id = data?.meta?.online === false ? data?.name : (data?.uuid || data?.name);
    return id ? `https://mc-heads.net/avatar/${encodeURIComponent(id)}/64` : null;
}

async function addAccount(data) {
    const div = document.createElement('div');
    div.classList.add('account');
    div.id = data.ID;
    div.innerHTML = `
    <div class="profile-image"></div>
    <div class="profile-infos">
      <div class="profile-pseudo"></div>
      <div class="profile-uuid"></div>
    </div>
    <div class="delete-profile" id="${data.ID}">
      <div class="icon-account-delete delete-profile-icon"></div>
    </div>
  `;
    div.querySelector('.profile-pseudo').textContent = data.name ?? '';
    div.querySelector('.profile-uuid').textContent = data.uuid ?? '';

    // Si la cuenta ya tenía tarjeta (re-login), se reemplaza en vez de duplicarla
    const list = document.querySelector('.accounts-list');
    const old = list?.querySelector(`.account[id="${data.ID}"]`);
    if (old) old.replaceWith(div);
    else list?.appendChild(div);

    const head = await accountHead(data);
    if (head) div.querySelector('.profile-image').style.backgroundImage = `url("${head}")`;
    return div;
}

async function accountSelect(data) {
    if (!data || typeof data !== 'object') return;
    const account = document.getElementById(`${data.ID}`);
    const active = document.querySelector('.account-select');
    if (active) active.classList.toggle('account-select');
    if (account) account.classList.add('account-select');

    // Footer de Inicio y de Ajustes: nick + cabeza
    document.querySelectorAll('.player-nick').forEach(el => { el.textContent = data.name || 'Jugador'; });
    const head = await accountHead(data);
    document.querySelectorAll('.player-head').forEach(el => {
        el.style.backgroundImage = head ? `url("${head}")` : '';
    });

    document.dispatchEvent(new CustomEvent('hy:account-selected', { detail: { account: data } }));
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

    const players = await getServerPlayerCount(opt);
    const count = players?.count ?? 0;
    if (playersEl) playersEl.textContent = `${count} ${count === 1 ? 'jugador' : 'jugadores'}`;
}

/**
 * Ping directo al servidor de Minecraft — igual que setStatus() pero sin
 * tocar el DOM, para reusar el conteo en otros lados (Discord Rich Presence).
 * @param {{ip:string, port:number}} opt
 * @returns {Promise<{count:number, max:number}|null>}
 */
async function getServerPlayerCount(opt) {
    if (!opt?.ip) return null;
    try {
        const status = new Status(opt.ip, opt.port);
        const res = await status.getStatus().then(r => r).catch(() => null);
        if (!res || res.error) return null;
        return { count: res.playersConnect ?? 0, max: res.playersMax ?? 0 };
    } catch {
        return null;
    }
}

/**
 * URL pública de la cabeza de la skin del jugador (Minotar) — para la
 * insignia circular de Discord Rich Presence, que necesita una URL externa
 * de verdad, no un data: URI como el que se usa para el avatar del footer.
 */
function getSkinHeadUrl(playerName) {
    if (!playerName) return null;
    return `https://minotar.net/avatar/${encodeURIComponent(playerName)}/128.png`;
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
    offlineAccount,
    slider as Slider,
    pkg,
    setStatus,
    getServerPlayerCount,
    getSkinHeadUrl
};
