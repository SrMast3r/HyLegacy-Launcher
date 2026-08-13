/**
 * Mods efímeros — se piden cifrados al servidor justo antes de lanzar,
 * se descifran en memoria y se escriben en mods/ solo por la ventana de
 * arranque del juego; se borran apenas la JVM ya los cargó. Evita que el
 * .jar quede permanentemente descargable en el listado público del
 * servidor. Ver docs/dev/ephemeral-mods-plan.md (arquitectura completa) —
 * esta es la variante V1 (archivo temporal cifrado, no la de agente Java
 * en memoria, descartada por fragilidad con mods que usan Mixins).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodeFetch = require('node-fetch');

// Sustituido en build time por build.js/Obfuscate() (mismo patrón que
// GH_UPDATE_TOKEN en app.js) — nunca queda en texto plano en el repo.
const EPHEMERAL_CLIENT_KEY = 'EPHEMERAL_CLIENT_KEY_PLACEHOLDER';

function resolveClientKey() {
    if (EPHEMERAL_CLIENT_KEY && EPHEMERAL_CLIENT_KEY !== 'EPHEMERAL_CLIENT_KEY_PLACEHOLDER') {
        return EPHEMERAL_CLIENT_KEY;
    }
    // En dev (sin build) no hay sustitución — se usa la variable de entorno
    // para poder probar el flujo completo localmente.
    return process.env.EPHEMERAL_CLIENT_KEY || null;
}

function decryptFile(f) {
    const key = Buffer.from(f.key, 'base64');
    const iv = Buffer.from(f.iv, 'base64');
    const tag = Buffer.from(f.tag, 'base64');
    const ciphertext = Buffer.from(f.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Reintenta borrar archivos que puedan seguir bloqueados por la JVM
 * (frecuente en Windows si Fabric/Knot mantiene el jar abierto para
 * carga perezosa de recursos). Si tras los reintentos sigue bloqueado,
 * queda como red de seguridad el borrado-antes-de-escribir del próximo
 * lanzamiento — no es un borrado instantáneo garantizado.
 */
function deleteWithRetry(filePaths, attemptsLeft = 5, delayMs = 1500) {
    const remaining = [];
    for (const p of filePaths) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {
            remaining.push(p);
        }
    }
    if (remaining.length && attemptsLeft > 0) {
        setTimeout(() => deleteWithRetry(remaining, attemptsLeft - 1, delayMs), delayMs);
    }
}

/**
 * @param {object} opts
 * @param {string} opts.instance      nombre de la instancia
 * @param {string} opts.instancePath  carpeta de la instancia (mods/ va ahí dentro)
 * @param {string} opts.apiBase       base del servidor, p.ej. http://localhost:8080
 * @returns {Promise<{ cleanup: () => void }>}
 */
async function installEphemeralMods({ instance, instancePath, apiBase }) {
    const clientKey = resolveClientKey();
    if (!clientKey) throw new Error('Mods protegidos no disponibles en este build (falta EPHEMERAL_CLIENT_KEY)');

    const url = `${apiBase.replace(/\/$/, '')}/files/php/ephemeral.php?action=fetch&instance=${encodeURIComponent(instance)}`;
    const res = await nodeFetch(url, { headers: { 'X-Client-Key': clientKey } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || `El servidor respondió ${res.status} al pedir mods protegidos`);
    }
    if (!body.files?.length) throw new Error('El servidor no devolvió mods protegidos para esta instancia');

    const modsDir = path.join(instancePath, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });

    const writtenPaths = [];
    try {
        for (const f of body.files) {
            const plaintext = decryptFile(f);
            const dest = path.join(modsDir, f.filename);
            fs.writeFileSync(dest, plaintext);
            writtenPaths.push(dest);
        }
    } catch (err) {
        deleteWithRetry(writtenPaths, 1, 0);
        throw new Error(`No se pudo descifrar/escribir un mod protegido: ${err.message}`);
    }

    return { cleanup: () => deleteWithRetry(writtenPaths) };
}

export { installEphemeralMods };
