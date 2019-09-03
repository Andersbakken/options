/*global require,module,process*/

const fs = require("fs");
const path = require("path");
const appPath = require("app-root-path");
const xdg = require('xdg-basedir');

function split(data)
{
    const pre = data.split("\n");
    // rejoin with lines that starts with a whitespace
    const out = [];
    let cur = "";
    for (let i = 0; i < pre.length; ++i) {
        let line = pre[i].replace(/\t/g, "  ");
        if (!line.length)
            continue;
        if (!cur.length || /\s/.test(line[0])) {
            let idx = 0;
            while (/\s/.test(line[idx]))
                ++idx;
            cur += line.substr(idx ? idx - 1 : 0);
            idx = cur.length - 1;
            while (idx >= 0 && /\s/.test(cur[idx]))
                --idx;
            if (idx < cur.length - 1)
                cur = cur.substr(0, idx + 1);
        } else if (cur.length > 0) {
            out.push(cur.trim());
            cur = line.trim();
        }
    }
    if (cur.length > 0) {
        out.push(cur.trim());
    }
    return out;
}

function realValue(v)
{
    if (typeof v !== "string")
        return v;
    if (/^[-0-9.]+$/.exec(v)) {
        const vf = parseFloat(v);
        if (!isNaN(vf))
            return vf;
    }
    switch (v) {
    case "true":
        return true;
    case "false":
        return false;
    }
    return v;
}

class Options {
    constructor(options, argv) {
        this.argv = Object.assign({}, argv);
        this.prefix = options.prefix;
        this.additionalFiles = options.additionalFiles || [];
        this.applicationPath = options.noApplicationPath ? "" : appPath.toString();
        this.debug = options.debug;
        this.options = {};
        this.configDirs = this.argv["config-dir"] ||  options.configDirs || xdg.configDirs;
        this._read();
    }

    value(name) {
        // foo-bar becomes FOO_BAR as env
        if (name in this.argv)
            return this.argv[name];
        const envname = (this.prefix + "_" + name).replace(/-/g, "_").toUpperCase();
        if (envname in process.env)
            return realValue(process.env[envname]);

        if (name in this.options)
            return this.options[name];
        return undefined;
    }

    _homedir() {
        let home = process.env.home;
        if (home) {
            return path.join(home, ".config");
        }
        return undefined;
    }

    _log(...args) {
        if (this.debug)
            console.log(...args);
    }

    _read() {
        // if we have a config file passed, read it
        let file = this.value("config-file");
        if (!file && this.prefix)
            file = this.prefix + ".conf";
        if (!file)
            return;

        let data = [];
        let seen = new Set();
        const Failed = 0;
        const Success = 1;
        const Seen = 2;
        const read = file => {
            if (seen.has(file))
                return Seen;
            seen.add(file);
            try {
                const contents = fs.readFileSync(file, "utf8");
                this._log(`Loaded ${contents.length} bytes from ${file}`);

                if (contents) {
                    data.push({ file: file, contents: contents });
                    return Success;
                }
            } catch (e) {
                this._log(`Failed to load ${file}`);
            }
            return Failed;
        };

        // console.log("about to read file", file, "additionalFiles", this.additionalFiles, "configDirs", this.configDirs, "applicationPath", this.applicationPath, "homedir", this._homedir());
        if (path.isAbsolute(file)) {
            read(file);
        } else {
            this.additionalFiles.forEach(file => {
                if (path.isAbsolute(file) && read(file) == Failed)
                    read(file + ".conf");
            });
            ([this.applicationPath, this._homedir()].concat(this.configDirs)).forEach(root => {
                // in case we appended with undefined
                if (!root)
                    return;
                this.additionalFiles.forEach(additional => {
                    if (!path.isAbsolute(additional)) {
                        let file = path.join(root, additional);
                        if (read(file) == Failed)
                            read(file + ".conf");
                    }
                });

                let filePath = path.join(root, file);
                if (read(filePath) == Failed)
                    read(filePath + ".conf");
            });
        }
        for (let i = data.length - 1; i >= 0; --i) {
            let str = data[i].contents;
            if (!str)
                continue;
            try {
                let obj = JSON.parse(str);
                for (let key in obj) {
                    this._log(`Assigning ${obj[key]} over ${this.options[key]} for ${key} from ${data[i].file} (JSON)`);
                    this.options[key] = obj[key];
                }
            } catch (err) {
                const items = split(str);
                for (let i = 0; i < items.length; ++i) {
                    const item = items[i].trim();
                    if (!item.length)
                        continue;
                    if (item[0] === "#")
                        continue;
                    const eq = item.indexOf("=");
                    if (eq === -1) {
                        this._log("Couldn't find =", item);
                        continue;
                    }
                    const key = item.substr(0, eq).trim();
                    if (!key.length) {
                        this._log("empty key", item);
                        continue;
                    }
                    const value = item.substr(eq + 1).trim();
                    this._log(`Assigning ${value} over ${this.options[key]} for ${key} from ${data[i].file} (INI)`);
                    this.options[key] = value;
                }
            }
        }
    }
}

const data = {};

module.exports = function(options, argv) {
    if (!argv)
        argv = require("minimist")(process.argv.slice(2));
    if (!(options instanceof Object))
        options = { prefix: options || "" };

    data.options = new Options(options, argv);
    let ret = function(name, defaultValue) {
        const val = data.options.value(name);
        if (typeof val === "undefined")
            return defaultValue;
        return val;
    };
    ret.prefix = options.prefix;
    ret.int = function(name, defaultValue) {
        const v = parseInt(data.options.value(name));
        if (typeof v === "number" && !isNaN(v))
            return v;
        return defaultValue;
    };
    ret.float = function(name, defaultValue) {
        const v = parseFloat(data.options.value(name));
        if (typeof v === "number" && !isNaN(v))
            return v;
        return defaultValue;
    };
    ret.json = function(name, defaultValue) {
        const opt = data.options.value(name);
        if (!opt)
            return defaultValue;
        try {
            const json = JSON.parse(opt);
            return json;
        } catch (e) {
        }
        return defaultValue;
    };
    return ret;
};
