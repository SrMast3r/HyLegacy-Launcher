/**
 * Discord Rich Presence — muestra el estado del jugador (menú, instancia
 * seleccionada, jugando) en su perfil de Discord. Corre en el proceso
 * principal (Electron) porque discord-rpc necesita acceso directo al socket
 * IPC local de Discord, no disponible desde el renderer.
 */

const { Client } = require('@xhayper/discord-rpc');

let client = null;
let ready = false;
let startTimestamp = null;

async function init(clientId) {
    if (!clientId || client) return;

    client = new Client({ clientId });

    client.on('ready', () => {
        ready = true;
        console.log('[DiscordRPC] conectado');
    });

    client.on('disconnected', () => {
        ready = false;
        console.log('[DiscordRPC] desconectado');
    });

    try {
        await client.login();
    } catch (err) {
        // Discord no está abierto, o no se pudo conectar — no es un error fatal,
        // el launcher debe seguir funcionando igual sin Rich Presence.
        console.log('[DiscordRPC] no se pudo conectar:', err.message);
    }
}

async function setActivity({ details, state, resetTimer, smallImageKey, smallImageText } = {}) {
    if (!client || !ready) return;
    if (resetTimer || !startTimestamp) startTimestamp = Date.now();

    try {
        await client.user?.setActivity({
            details: details || 'En el menú principal',
            state: state || undefined,
            startTimestamp,
            largeImageKey: 'hylegacy-4k',
            largeImageText: 'HyLegacy Launcher',
            // Insignia circular con la skin del jugador (URL externa — Discord
            // no acepta data: URIs acá, tiene que poder ir a buscarla él mismo).
            smallImageKey: smallImageKey || undefined,
            smallImageText: smallImageText || undefined,
            instance: false,
        });
    } catch (err) {
        console.log('[DiscordRPC] setActivity error:', err.message);
    }
}

async function clearActivity() {
    if (!client || !ready) return;
    try {
        await client.user?.clearActivity();
    } catch { /* noop */ }
}

function destroy() {
    if (!client) return;
    try { client.destroy(); } catch { /* noop */ }
    client = null;
    ready = false;
}

module.exports = { init, setActivity, clearActivity, destroy };
