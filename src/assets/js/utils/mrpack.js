/**
 * mrpack — instala/actualiza una instancia a partir de un .mrpack de Modrinth
 * (el mismo archivo que exporta Modrinth App), sin packwiz ni Java de por medio:
 *
 *  1. Descarga el .mrpack del servidor (solo si cambió: se compara su sha1).
 *  2. Baja en paralelo los archivos de modrinth.index.json directo del CDN de
 *     Modrinth, verificando el sha1 de cada uno; los que ya están bien no se tocan.
 *  3. Borra los que instaló una versión anterior del pack y ya no vienen.
 *  4. Copia overrides/ y client-overrides/ (configs, jars que no están en
 *     Modrinth...). options.txt y compañía solo se copian si el jugador no los
 *     tiene, para no pisarle sus ajustes.
 *
 * El estado de lo instalado se guarda en <instancia>/.hylegacy-mrpack.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodeFetch = require('node-fetch');
const AdmZip = require('adm-zip');

const STATE_FILE = '.hylegacy-mrpack.json';
const CONCURRENCY = 8;
const RETRIES = 3;

// Ajustes del jugador: se instalan una sola vez, nunca se sobrescriben
const PRESERVE = new Set([
    'options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat', 'servers.dat_old'
]);
// Carpetas donde un override que desaparece del pack sí se borra del cliente
// (en config/ y demás se deja: puede haberlo editado el jugador)
const PRUNE_OVERRIDE_DIRS = ['mods/', 'resourcepacks/', 'shaderpacks/'];

const LOADER_DEPS = {
    'fabric-loader': 'fabric',
    'quilt-loader': 'quilt',
    'neoforge': 'neoforge',
    'forge': 'forge',
};

function sha1File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha1');
        fs.createReadStream(file)
            .on('error', reject)
            .on('data', d => hash.update(d))
            .on('end', () => resolve(hash.digest('hex')));
    });
}

function readState(instancePath) {
    try { return JSON.parse(fs.readFileSync(path.join(instancePath, STATE_FILE), 'utf8')); }
    catch { return null; }
}

function writeState(instancePath, state) {
    fs.writeFileSync(path.join(instancePath, STATE_FILE), JSON.stringify(state, null, 1));
}

/** Ruta dentro de la instancia; rechaza rutas que intenten salirse (../). */
function safeJoin(root, rel) {
    const full = path.resolve(root, rel);
    const base = path.resolve(root) + path.sep;
    if (!full.startsWith(base)) throw new Error(`Ruta no permitida en el mrpack: ${rel}`);
    return full;
}

/** Descarga url → dest (vía archivo .part), comprobando el sha1 si se da. */
async function download(urls, dest, sha1) {
    let lastErr;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
        for (const url of urls) {
            const tmp = `${dest}.part`;
            try {
                const res = await nodeFetch(url, { timeout: 30000 });
                if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                await new Promise((resolve, reject) => {
                    const out = fs.createWriteStream(tmp);
                    res.body.on('error', reject);
                    out.on('error', reject);
                    out.on('finish', resolve);
                    res.body.pipe(out);
                });
                if (sha1 && (await sha1File(tmp)) !== sha1.toLowerCase()) {
                    throw new Error(`Hash incorrecto en ${path.basename(dest)}`);
                }
                fs.rmSync(dest, { force: true });
                fs.renameSync(tmp, dest);
                return;
            } catch (err) {
                lastErr = err;
                fs.rmSync(tmp, { force: true });
            }
        }
    }
    throw lastErr || new Error(`No se pudo descargar ${path.basename(dest)}`);
}

async function runPool(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await worker(item);
        }
    });
    await Promise.all(runners);
}

/** Loader de modrinth.index.json → formato de la instancia (loadder_*). */
function loaderFromIndex(index) {
    const deps = index?.dependencies || {};
    if (!deps.minecraft) return null;
    let type = 'none', version = '';
    for (const [dep, name] of Object.entries(LOADER_DEPS)) {
        if (deps[dep]) { type = name; version = deps[dep]; break; }
    }
    // minecraft-java-core espera Forge como "<mc>-<forge>"
    if (type === 'forge' && !version.startsWith(`${deps.minecraft}-`)) version = `${deps.minecraft}-${version}`;
    return { minecraft_version: deps.minecraft, loadder_type: type, loadder_version: version };
}

/**
 * @param {object} opts
 * @param {string} opts.url            URL pública del .mrpack
 * @param {string} [opts.sha1]         sha1 del .mrpack que anuncia el servidor
 * @param {string} opts.instancePath   Carpeta de la instancia
 * @param {string} opts.cacheDir       Dónde guardar el .mrpack descargado
 * @param {(text: string, done?: number, total?: number) => void} [opts.onProgress]
 * @returns {Promise<{loader: object|null, name: string, version: string}>}
 */
async function installMrpack({ url, sha1, instancePath, cacheDir, onProgress }) {
    if (!url) throw new Error('Falta la URL del mrpack');
    const progress = (text, done, total) => { try { onProgress?.(text, done, total); } catch {} };

    fs.mkdirSync(instancePath, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    // === 1. El .mrpack (solo si cambió) ===
    const packFile = path.join(cacheDir, `${path.basename(instancePath)}.mrpack`);
    let packOk = fs.existsSync(packFile) && (!sha1 || (await sha1File(packFile)) === sha1.toLowerCase());
    if (!packOk) {
        progress('Descargando modpack…');
        await download([url], packFile, sha1);
    }

    const zip = new AdmZip(packFile);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) throw new Error('El .mrpack no tiene modrinth.index.json');
    const index = JSON.parse(indexEntry.getData().toString('utf8'));
    const packSha1 = sha1 || (await sha1File(packFile));

    const prev = readState(instancePath) || { files: {}, overrides: [] };
    const state = { pack: packSha1, name: index.name, version: index.versionId, files: {}, overrides: [] };

    // === 2. Archivos de Modrinth ===
    const wanted = (index.files || []).filter(f => f?.env?.client !== 'unsupported');
    const toDownload = [];
    let checked = 0;
    for (const f of wanted) {
        const dest = safeJoin(instancePath, f.path);
        const hash = f.hashes?.sha1?.toLowerCase();
        state.files[f.path] = hash;
        progress('Verificando mods…', ++checked, wanted.length);

        if (fs.existsSync(dest)) {
            // Atajo: mismo archivo que dejamos la última vez (tamaño y fecha
            // intactos) → no hace falta volver a calcular su hash
            const st = fs.statSync(dest);
            const old = prev.files?.[f.path];
            const same = old && typeof old === 'object' && old.sha1 === hash && old.size === st.size && old.mtime === st.mtimeMs;
            if (same || (await sha1File(dest)) === hash) continue;
        }
        toDownload.push({ f, dest, hash });
    }

    let done = 0;
    if (toDownload.length) progress(`Descargando mods… 0/${toDownload.length}`, 0, toDownload.length);
    await runPool(toDownload, CONCURRENCY, async ({ f, dest, hash }) => {
        await download(f.downloads || [], dest, hash);
        done++;
        progress(`Descargando mods… ${done}/${toDownload.length}`, done, toDownload.length);
    });

    // Guardar tamaño/fecha para el atajo del próximo arranque
    for (const f of wanted) {
        const dest = safeJoin(instancePath, f.path);
        const st = fs.statSync(dest);
        state.files[f.path] = { sha1: state.files[f.path], size: st.size, mtime: st.mtimeMs };
    }

    // === 3. Lo que quitaste del pack ===
    for (const rel of Object.keys(prev.files || {})) {
        if (state.files[rel]) continue;
        try { fs.rmSync(safeJoin(instancePath, rel), { force: true }); } catch {}
    }

    // === 4. overrides/ y client-overrides/ ===
    progress('Aplicando configuración…');
    const packChanged = prev.pack !== packSha1;
    const seen = new Set();
    // client-overrides va después para que gane sobre overrides
    for (const prefix of ['overrides/', 'client-overrides/']) {
        for (const entry of zip.getEntries()) {
            if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
            const rel = entry.entryName.slice(prefix.length);
            if (!rel) continue;
            const dest = safeJoin(instancePath, rel);
            seen.add(rel);

            const exists = fs.existsSync(dest);
            if (exists && PRESERVE.has(rel)) continue;   // ajustes del jugador
            if (exists && !packChanged) continue;        // pack igual: no re-copiar
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, entry.getData());
        }
    }
    state.overrides = [...seen];
    for (const rel of prev.overrides || []) {
        if (seen.has(rel) || state.files[rel]) continue;
        if (!PRUNE_OVERRIDE_DIRS.some(d => rel.startsWith(d))) continue;
        try { fs.rmSync(safeJoin(instancePath, rel), { force: true }); } catch {}
    }

    writeState(instancePath, state);
    return { loader: loaderFromIndex(index), name: index.name, version: index.versionId };
}

export { installMrpack, loaderFromIndex };
