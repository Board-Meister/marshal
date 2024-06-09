export default class Marshal {
    constructor() {
        this.registered = {};
        this.loaded = {};
        this.tagMap = {};
        this.instanceMap = new WeakMap();
    }
    register(config) {
        this.registered[this.getModuleConstraint(config)] = config;
    }
    getModuleConstraint(config) {
        return config.entry.namespace + '/' + config.entry.name + ':' + config.entry.version;
    }
    get(key) {
        return this.loaded[key] ?? null;
    }
    async load() {
        const modules = await Promise.all(this.generateLoadGroups());
        modules.forEach(this.tagModules.bind(this));
        modules.forEach(this.instantiateModule.bind(this));
        this.updateTagModules();
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
            if (!this.tagMap[tag]) {
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
        const instance = new module.default;
        typeof instance.inject == 'function' && injectList && instance.inject(injectList);
        this.mapInstance(config, instance);
        return instance;
    }
    mapInstance(config, module) {
        this.loaded[this.getModuleConstraint(config)] = module;
        this.instanceMap.set(module, config);
    }
    loadDependencies(module, config) {
        if (typeof module.inject != 'object') {
            return undefined;
        }
        const toInjectList = module.inject, injectList = {};
        for (const name in toInjectList) {
            if (this.isTag(toInjectList[name])) {
                injectList[name] = this.tagMap[toInjectList[name].substring(1)] ?? [];
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
    generateLoadGroups() {
        const loadGroups = [], prepared = {}, toSend = Object.assign({}, this.registered);
        while (!this.isObjectEmpty(toSend)) {
            toSendLoop: for (const name in toSend) {
                const moduleConfig = toSend[name], requires = moduleConfig.requires ?? [];
                for (const required of requires) {
                    if (this.isTag(required)) {
                        continue;
                    }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (!prepared[required] && !toSend[required]) {
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
    importModule(config) {
        return typeof config.entry.source == 'string'
            ? import(/* @vite-ignore */ config.entry.source)
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
