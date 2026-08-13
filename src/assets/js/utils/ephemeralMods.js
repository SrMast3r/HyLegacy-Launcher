/**
 * Mods efímeros — se piden cifrados al servidor y se descifran en memoria
 * con tiempo de sobra (mientras el juego todavía se está descargando/
 * verificando), pero el .jar en texto plano solo se escribe a disco en el
 * instante sincrónico exacto en que minecraft-java-core arma el spawn de
 * la JVM (ver Launch.js: emite 'data' con "Launching with arguments" y en
 * la siguiente línea, sin ningún await de por medio, hace spawn()). Como
 * los listeners de EventEmitter corren sincrónicamente, escribir el archivo
 * dentro de ese listener garantiza que exista en disco por el mínimo tiempo
 * posible antes de que la JVM lo abra — nada de esperar minutos de descarga
 * con el mod ya expuesto. Se borra apenas Fabric ya tuvo tiempo de leerlo.
 * Ver docs/dev/ephemeral-mods-plan.md — sigue siendo la variante V1 (archivo
 * temporal, no el classloader en memoria, descartado por los Mixins).
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
 * Pide y descifra los mods protegidos de una instancia — todo en memoria,
 * nada toca disco todavía. Se llama con anticipación (mientras el juego
 * arranca/descarga), para que el único trabajo que quede pendiente para el
 * instante de escritura sea el propio fs sincrónico, sin red ni cripto.
 *
 * @param {object} opts
 * @param {string} opts.instance  nombre de la instancia
 * @param {string} opts.apiBase   base del servidor, p.ej. http://localhost:8080
 * @returns {Promise<Array<{ filename: string, plaintext: Buffer }>>}
 */
async function fetchEphemeralMods({ instance, apiBase }) {
    const clientKey = resolveClientKey();
    if (!clientKey) throw new Error('Mods protegidos no disponibles en este build (falta EPHEMERAL_CLIENT_KEY)');

    const url = `${apiBase.replace(/\/$/, '')}/files/php/ephemeral.php?action=fetch&instance=${encodeURIComponent(instance)}`;
    const res = await nodeFetch(url, { headers: { 'X-Client-Key': clientKey } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || `El servidor respondió ${res.status} al pedir mods protegidos`);
    }
    if (!body.files?.length) throw new Error('El servidor no devolvió mods protegidos para esta instancia');

    return body.files.map(f => ({ filename: f.filename, plaintext: decryptFile(f) }));
}

/**
 * Escribe los mods ya descifrados a mods/ — SINCRÓNICO a propósito, para
 * poder llamarse desde dentro de un listener de 'data' de minecraft-java-core
 * justo antes de que haga spawn() de la JVM (ver cabecera del archivo).
 * Escritura atómica (temp + rename): nada puede ver el archivo a medio
 * escribir, ni Fabric ni un escaneo de Windows Defender que lo agarre
 * apenas aparece con el nombre final.
 *
 * @param {string} instancePath
 * @param {Array<{ filename: string, plaintext: Buffer }>} decryptedFiles
 * @returns {string[]} rutas escritas
 */
function writeEphemeralModsSync(instancePath, decryptedFiles) {
    const modsDir = path.join(instancePath, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });

    const writtenPaths = [];
    for (const f of decryptedFiles) {
        const dest = path.join(modsDir, f.filename);
        const tmpDest = `${dest}.tmp-${crypto.randomBytes(4).toString('hex')}`;
        const fd = fs.openSync(tmpDest, 'w');
        try {
            fs.writeSync(fd, f.plaintext);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmpDest, dest);
        writtenPaths.push(dest);
    }
    return writtenPaths;
}

/**
 * Reintenta borrar archivos que puedan seguir bloqueados por la JVM
 * (frecuente en Windows si Fabric/Knot mantiene el jar abierto para
 * carga perezosa de recursos). Si tras los reintentos sigue bloqueado,
 * queda como red de seguridad el borrado-antes-de-escribir del próximo
 * lanzamiento — no es un borrado instantáneo garantizado.
 */
function deleteEphemeralMods(filePaths, attemptsLeft = 5, delayMs = 1500) {
    const remaining = [];
    for (const p of filePaths) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {
            remaining.push(p);
        }
    }
    if (remaining.length && attemptsLeft > 0) {
        setTimeout(() => deleteEphemeralMods(remaining, attemptsLeft - 1, delayMs), delayMs);
    }
}

export { fetchEphemeralMods, writeEphemeralModsSync, deleteEphemeralMods };
