class Marshal {
    constructor() {
        this.renderCount = 0;
        this.registered = {};
        this.loaded = {};
        this.tagMap = {};
        this.scope = {};
        this.instanceMap = new WeakMap();
        this.register({
            type: 'module',
            entry: {
                name: 'marshal',
                namespace: 'boardmeister',
                version: Marshal.version,
                source: this,
            }
        });
    }
    addScope(name, value) {
        if (this.scope[name]) {
            throw new Error('Variable with name "' + name + '" already exists');
        }
        this.scope[name] = value;
    }
    render() {
        this.renderCount++;
    }
    register(config) {
        this.registered[this.getModuleConstraint(config)] = config;
    }
    getModuleConstraint(config) {
        // TODO create few registration for one module:
        //  - just namespace + name
        //  - namespace + name + version
        return config.entry.namespace + '/' + config.entry.name;
    }
    get(key) {
        return this.loaded[key] ?? null;
    }
    async load() {
        const modules = await Promise.all(this.generateLoadGroups(await this.loadScopes()));
        modules.forEach(this.tagModules.bind(this));
        modules.forEach(this.instantiateModule.bind(this));
        this.updateTagModules();
    }
    async loadScopes() {
        const modules = {}, scopes = {};
        for (const key in this.registered) {
            const module = this.registered[key];
            if (module.type === 'scope') {
                scopes[key] = module;
            }
            else {
                modules[key] = module;
            }
        }
        const loaded = await Promise.all(this.generateLoadGroups(scopes));
        loaded.forEach(moduleImport => {
            const imported = moduleImport.module, { module, config } = moduleImport;
            this.mapInstance(config, module);
            if (typeof imported?.default === 'object') {
                for (const key in imported?.default) {
                    this.addScope(key, imported?.default[key]);
                }
            }
        });
        return modules;
    }
    updateTagModules() {
        for (const tagKey in this.tagMap) {
            const tags = this.tagMap[tagKey];
            tags.forEach(tag => {
                tag.module = this.get(this.getModuleConstraint(tag.config));
            });
        }
    }
    tagModules(moduleImport) {
        (moduleImport.config.tags ?? []).forEach(tag => {
            if (typeof this.tagMap[tag] == 'undefined') {
                this.tagMap[tag] = [];
            }
            if (this.isESClass(moduleImport.module.default)) {
                this.tagMap[tag].push({
                    config: moduleImport.config,
                    module: moduleImport.module.default
                });
                return;
            }
            this.tagMap[tag].push(moduleImport);
        });
    }
    instantiateModule(moduleImport) {
        const { module, config } = moduleImport;
        if (typeof module == 'function' || !module.default || !this.isESClass(module.default)) {
            this.mapInstance(config, module);
            return module;
        }
        const injectList = this.loadDependencies(module.default, config);
        if (false === injectList) {
            this.mapInstance(config, module);
            return module;
        }
        // @ts-expect-error TS2351 "This expression is not constructable"
        // TS has issues with dynamically loaded generic classes which is normal (I think)
        const instance = new module.default(...(config.entry.arguments ?? []));
        typeof instance.inject == 'function' && injectList && instance.inject(injectList);
        this.mapInstance(config, instance);
        return instance;
    }
    mapInstance(config, module) {
        const constraint = this.getModuleConstraint(config);
        delete this.registered[constraint];
        this.loaded[constraint] = module;
        this.instanceMap.set(module, config);
    }
    getMappedInstance(module) {
        return this.instanceMap.get(module);
    }
    loadDependencies(module, config) {
        if (typeof module.inject != 'object') {
            return undefined;
        }
        const toInjectList = module.inject, injectList = {};
        for (const name in toInjectList) {
            if (this.isTag(toInjectList[name])) {
                // Make sure that we are using the same array for all tags, otherwise if tag was empty we might create
                // different pointers
                const tagName = toInjectList[name].substring(1);
                if (typeof this.tagMap[tagName] == 'undefined') {
                    this.tagMap[tagName] = [];
                }
                injectList[name] = this.tagMap[tagName];
                continue;
            }
            const moduleConstraint = toInjectList[name];
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (!this.loaded[moduleConstraint]) {
                console.error('Module ' + this.getModuleConstraint(config) + ' could not be loaded due to missing dependency: '
                    + moduleConstraint);
                return false;
            }
            injectList[name] = this.loaded[moduleConstraint];
        }
        return injectList;
    }
    isESClass(fn) {
        return typeof fn === 'function'
            && Object.getOwnPropertyDescriptor(fn, 'prototype')?.writable === false;
    }
    generateLoadGroups(toSend) {
        const loadGroups = [], prepared = {};
        let tries = Object.keys(toSend).length ** 2;
        while (!this.isObjectEmpty(toSend)) {
            tries--;
            if (tries < 0) {
                console.warn('Not registered in load groups', toSend);
                throw new Error('Infinite dependency detected, stopping script...');
            }
            toSendLoop: for (const name in toSend) {
                const moduleConfig = toSend[name], requires = moduleConfig.requires ?? [];
                for (const required of requires) {
                    if (this.isTag(required)) {
                        continue;
                    }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (!prepared[required] && !toSend[required] && !this.loaded[required]) {
                        throw new Error('Module ' + name + ' is requesting not present dependency: ' + required);
                    }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (toSend[required]) {
                        continue toSendLoop;
                    }
                }
                loadGroups.push(this.retrieveModulePromise(moduleConfig));
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete toSend[name];
                prepared[name] = true;
            }
        }
        return loadGroups;
    }
    isTag(string) {
        return /^![^\W.].*$/.test(string);
    }
    async import(source, addScope = {}) {
        const tmpName = String(Math.random().toString(36).substring(2)), scope = Object.assign({}, this.scope, addScope);
        // @ts-expect-error TS7015: Element implicitly has an 'any' type because index expression is not of type 'number'.
        window[tmpName] = scope;
        let variables = '';
        for (const varName in scope) {
            variables += 'const ' + varName + ' = window["' + tmpName + '"]["' + varName + '"];';
        }
        let module = await (await fetch(source)).text();
        module = variables + module;
        const script = new Blob([module], {
            type: 'text/javascript'
        }), url = URL.createObjectURL(script), exports = await import(/* @vite-ignore */ url);
        // @ts-expect-error TS7015: Element implicitly has an 'any' type because index expression is not of type 'number'.
        delete window[tmpName];
        URL.revokeObjectURL(url);
        return exports;
    }
    importModule(config) {
        return typeof config.entry.source == 'string'
            ? this.import(config.entry.source)
            : Promise.resolve(config.entry.source);
    }
    async retrieveModulePromise(config) {
        if (config.lazy) {
            return new Promise(resolve => {
                resolve({ module: () => new Promise(resolve => {
                        void this.importModule(config)
                            .then((module) => {
                            resolve(this.instantiateModule({ module, config }));
                        });
                    }), config });
            });
        }
        return new Promise(resolve => {
            void this.importModule(config)
                .then(module => {
                resolve({ module, config });
            });
        });
    }
    isObjectEmpty(obj) {
        for (const prop in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, prop))
                return false;
        }
        return true;
    }
}
Marshal.version = '1.0.0';
export default Marshal;
// ** SAVED FOR FUTURE USE ** //
// export declare type InjectReturnType = Function;
// export declare type InjectConfigType = Record<string, string>;
// declare function inject(injectables: InjectConfigType): InjectReturnType;
// export function inject(injectables: InjectConfigType): Function {
//   console.log('constructor', injectables)
//
//   return (target: Function) => {
//     for (const key in injectables) {
//       (target.prototype as Record<string, unknown>)[key] = injectables[key];
//     }
//     console.log('new constructor', target)
//     return target;
//   };
// }
// ** SAVED FOR FUTURE USE ** //
