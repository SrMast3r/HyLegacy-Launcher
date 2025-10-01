/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const ORIG = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    debug: console.debug,
    error: console.error
};

class Logger {
    constructor(name, color = "#00aaff", level = "debug") {
        this.name = name;
        this.color = color;
        this.level = level;
        this.levels = ["debug", "info", "warn", "error"];

        this.patchConsole();
    }

    patchConsole() {
        const prefix = (lvl) =>
            `%c[${this.name}]%c [${lvl.toUpperCase()}] %c${new Date().toISOString()}%c`;

        const styleName = `color: ${this.color}; font-weight: bold;`;
        const styleLvl = "color: gray;";
        const styleTime = "color: #aaa;";
        const reset = "";

        // 🔹 Debug
        console.debug = (...args) => {
            if (this.shouldLog("debug")) {
                ORIG.debug.call(console, prefix("debug"), styleName, styleLvl, styleTime, reset, ...args);
            }
        };

        // 🔹 Info
        console.info = (...args) => {
            if (this.shouldLog("info")) {
                ORIG.info.call(console, prefix("info"), styleName, styleLvl, styleTime, reset, ...args);
            }
        };

        // 🔹 Warn
        console.warn = (...args) => {
            if (this.shouldLog("warn")) {
                ORIG.warn.call(console, prefix("warn"), styleName, styleLvl, styleTime, reset, ...args);
            }
        };

        // 🔹 Error
        console.error = (...args) => {
            if (this.shouldLog("error")) {
                ORIG.error.call(console, prefix("error"), styleName, styleLvl, styleTime, reset, ...args);
                // Opcional: stack trace
                console.trace();
            }
        };

        // 🔹 Log (alias de info)
        console.log = (...args) => {
            if (this.shouldLog("info")) {
                ORIG.log.call(console, prefix("log"), styleName, styleLvl, styleTime, reset, ...args);
            }
        };
    }

    shouldLog(lvl) {
        return this.levels.indexOf(lvl) >= this.levels.indexOf(this.level);
    }
}

export default Logger;
