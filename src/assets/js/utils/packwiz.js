/**
 * packwiz — instala/actualiza los mods de una instancia antes de lanzar el juego,
 * corriendo packwiz-installer-bootstrap.jar como paso previo (igual que hacen
 * Prism/MultiMC/ATLauncher por debajo). Los mods se descargan del CDN de
 * Modrinth/CurseForge referenciado en el pack.toml, no de nuestro servidor.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

// __dirname no está confiablemente enlazado a este archivo cuando se carga
// como módulo ES (import), así que se deriva de import.meta.url en vez de
// depender del global de CommonJS.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_JAR = path.join(currentDir, '../../java/packwiz-installer-bootstrap.jar');

function findJavaInDir(dir) {
    if (!dir || !fs.existsSync(dir)) return null;
    const names = process.platform === 'win32' ? ['javaw.exe', 'java.exe'] : ['java'];
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop();
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (names.includes(entry.name)) return full;
        }
    }
    return null;
}

/**
 * Resuelve una ruta de Java usable, en cascada:
 * 1) la que el usuario configuró en Ajustes (java_config.java_path)
 * 2) el runtime que minecraft-java-core ya descargó (carpeta runtime/ del launcher)
 * 3) java del PATH del sistema, como último recurso
 */
function resolveJavaPath(configuredPath, runtimeRoot) {
    if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;
    const fromRuntime = findJavaInDir(runtimeRoot);
    if (fromRuntime) return fromRuntime;
    return process.platform === 'win32' ? 'javaw.exe' : 'java';
}

/**
 * @param {object} opts
 * @param {string} opts.packwizUrl    URL pública del pack.toml de la instancia
 * @param {string} opts.instancePath  Carpeta de la instancia (cwd de packwiz-installer)
 * @param {string} [opts.javaPath]    Ruta de java configurada por el usuario
 * @param {string} [opts.runtimeRoot] Carpeta runtime/ gestionada por minecraft-java-core
 * @param {string} [opts.cacheDir]    Dónde cachear packwiz-installer.jar (compartido
 *                                    entre instancias, en vez de uno por carpeta)
 * @param {(text: string) => void} [opts.onProgress] callback con líneas de salida crudas
 * @returns {Promise<void>}
 */
async function installPackwiz({ packwizUrl, instancePath, javaPath, runtimeRoot, cacheDir, onProgress }) {
    if (!packwizUrl) throw new Error('Falta packwizUrl');
    if (!fs.existsSync(BOOTSTRAP_JAR)) {
        throw new Error(`No se encontró packwiz-installer-bootstrap.jar en ${BOOTSTRAP_JAR}`);
    }
    fs.mkdirSync(instancePath, { recursive: true });
    if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });

    const java = resolveJavaPath(javaPath, runtimeRoot);
    const installerCache = cacheDir ? path.join(cacheDir, 'packwiz-installer.jar') : null;

    // -g: sin ventana de progreso propia (usamos la UI del launcher)
    // -s client: no instalar mods marcados solo-servidor
    const args = ['-jar', BOOTSTRAP_JAR, '-g'];
    if (installerCache) args.push('--bootstrap-main-jar', installerCache);
    args.push('-s', 'client', packwizUrl);

    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(java, args, { cwd: instancePath, windowsHide: true });
        } catch (err) {
            reject(new Error(`No se pudo iniciar Java (${java}): ${err.message}`));
            return;
        }

        let lastLine = '';
        const track = (chunk) => {
            const text = chunk.toString();
            const trimmed = text.trim();
            if (trimmed) lastLine = trimmed.split(/\r?\n/).pop();
            onProgress?.(text);
        };

        child.stdout?.on('data', track);
        child.stderr?.on('data', track);

        child.on('error', (err) => reject(new Error(`No se pudo iniciar Java (${java}): ${err.message}`)));
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`packwiz-installer terminó con código ${code}${lastLine ? `: ${lastLine}` : ''}`));
        });
    });
}

export { installPackwiz, resolveJavaPath };
