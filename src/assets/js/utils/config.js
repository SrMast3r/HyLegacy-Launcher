/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const pkg = require('../package.json');
const nodeFetch = require("node-fetch");
const convert = require('xml-js');
let url = pkg.user ? `${pkg.url}/${pkg.user}` : pkg.url

let config = `${url}/launcher/config-launcher/config.json`;
let news = `${url}/launcher/news-launcher/news.json`;

// Sustituido en build time por build.js/Obfuscate() (mismo patrón que en
// ephemeralMods.js) — el servidor exige esta clave en /files y /launcher
// para que nadie fuera del propio launcher pueda leer esas rutas.
const EPHEMERAL_CLIENT_KEY = 'EPHEMERAL_CLIENT_KEY_PLACEHOLDER';
function resolveClientKey() {
    if (EPHEMERAL_CLIENT_KEY && EPHEMERAL_CLIENT_KEY !== 'EPHEMERAL_CLIENT_KEY_PLACEHOLDER') return EPHEMERAL_CLIENT_KEY;
    return process.env.EPHEMERAL_CLIENT_KEY || null;
}
const authHeaders = () => {
    const key = resolveClientKey();
    return key ? { 'X-Client-Key': key } : {};
};

class Config {
    GetConfig() {
        return new Promise((resolve, reject) => {
            nodeFetch(config, { headers: authHeaders() }).then(async config => {
                if (config.status === 200) return resolve(config.json());
                else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
            }).catch(error => {
                return reject({ error });
            })
        })
    }

    async getInstanceList() {
        let urlInstance = `${url}/files`
        let instances = await nodeFetch(urlInstance, { headers: authHeaders() }).then(res => res.json()).catch(err => err)
        let instancesList = []
        instances = Object.entries(instances)

        for (let [name, data] of instances) {
            let instance = data
            instance.name = name
            instancesList.push(instance)
        }
        return instancesList
    }
}

export default new Config;