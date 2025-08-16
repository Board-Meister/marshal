export interface EntryConfig {
  source: string|object;
  namespace: string;
  name: string;
  version: string;
  arguments?: unknown[];
}

export interface RegisterConfig {
  entry: EntryConfig;
  type: 'scope'|'module';
  scope?: boolean; // @deprecated
  tags?: string[];
  requires?: string[];
  lazy?: boolean;
  asset?: {
    src: string;
  }
  resource?: {
    src: string;
  }
}

export declare class CModule<T = any> {
  constructor(...args: unknown[]);
  inject?: (injections: T) => void;
}

export type Module<T = any> = CModule<T>|Record<string, unknown>;

export interface IModuleImportObject {
  default?: Module|((...args: unknown[]) => void);
}

export interface IModuleImport {
  config: RegisterConfig;
  module: IModuleImportObject | (() => Promise<Module>)
}

// https://stackoverflow.com/a/66947291/11495586 - Static methods interface
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
declare class _IInjectable<T = object> {
  constructor(...args: unknown[]);
  inject(injections: T): void;
  scope?(): Record<string, unknown>;
  static inject: Record<string, string>;
}
export type IInjectable<T> = typeof _IInjectable<T>;

export default class Marshal {
  static version = '0.0.2';
  registered: Record<string, RegisterConfig> = {};
  loaded: Record<string, object> = {};
  scope: Record<string, unknown> = {};
  tagMap: Record<string, IModuleImport[]> = {};
  instanceMap = new WeakMap<Module, RegisterConfig>();

  constructor() {
    this.register({
      type: 'module',
      entry: {
        name: 'marshal',
        namespace: 'boardmeister',
        version: Marshal.version,
        source: this,
      }
    })
  }

  addScope(name: string, value: unknown): void {
    if (this.scope[name]) {
      throw new Error('Variable with name "' + name + '" already exists');
    }

    this.scope[name] = value;
  }

  register(config: RegisterConfig): void {
    this.registered[this.getModuleConstraint(config)] = config;
  }

  getModuleConstraint(config: RegisterConfig): string {
    // TODO create few registration for one module:
    //  - just namespace + name
    //  - namespace + name + version
    return config.entry.namespace + '/' + config.entry.name;
  }

  get<Type>(key: string): Type|null {
    return this.loaded[key] as Type ?? null;
  }

  async load(): Promise<void> {
    const modules = await Promise.all<IModuleImport>(this.#generateLoadGroups(await this.#loadScopes()));
    modules.forEach(this.#tagModules.bind(this));
    modules.forEach(this.#instantiateModule.bind(this));
    this.#updateTagModules();
  }

  getResourceUrl(module: Module, suffix: string): string {
    const config = this.getMappedInstance(module);

    if (!config?.resource) {
      throw new Error('Provided module configuration is missing resource definition');
    }

    return (config.resource as { src: string }).src + suffix;
  }

  asset(module: Module, suffix: string): string {
    const config = this.getMappedInstance(module);

    if (!config?.asset) {
      throw new Error('Provided module configuration is missing asset definition');
    }

    return config.asset.src + suffix;
  }

  getMappedInstance(module: Module): RegisterConfig | undefined {
    return this.instanceMap.get(module);
  }

  async import(source: string, addScope: Record<string, unknown> = {}): Promise<IModuleImportObject> {
    const tmpName = String(Math.random().toString(36).substring(2)),
      scope = Object.assign({}, this.scope, addScope)
    ;

    // @ts-expect-error TS7015: Element implicitly has an 'any' type because index expression is not of type 'number'.
    window[tmpName] = scope;

    let variables = '';
    for (const varName in scope) {
      variables += 'const ' + varName + ' = window["' + tmpName + '"]["' + varName + '"];';
    }

    let module = await(await fetch(source)).text();
    module = variables + module;
    const script = new Blob([module], {
        type: 'text/javascript'
      }),
      url = URL.createObjectURL(script),
      exports = await import(/* @vite-ignore */url) as Promise<IModuleImportObject>
    ;

    // @ts-expect-error TS7015: Element implicitly has an 'any' type because index expression is not of type 'number'.
    delete window[tmpName];
    URL.revokeObjectURL(url);

    return exports;
  }

  async #loadScopes(): Promise<Record<string, RegisterConfig>> {
    const modules: Record<string, RegisterConfig> = {},
      scopes: Record<string, RegisterConfig> = {}
    ;
    for (const key in this.registered) {
      const module = this.registered[key];
      if (module.type === 'scope') {
        scopes[key] = module;
      } else {
        modules[key] = module;
      }
    }

    // @TODO implement grouping for scopes.
    // We are currently loading one scope after another, which might not be the best solution
    // if we have 10 scope but only depend on the first one (which means we can load 9 of them at once)
    const ordered = this.#orderModules(scopes);
    for (const scope of ordered) {
      const moduleImport = await this.#retrieveModulePromise(scope),
        imported = moduleImport.module as IModuleImportObject|null,
        { module, config } = moduleImport
      ;
      this.#mapInstance(config, module as Module);
      if (typeof imported?.default === 'object') {
        for (const key in imported?.default) {
          this.addScope(key, (imported?.default as Record<string, unknown>)[key]);
        }
      }
    }

    return modules
  }

  #updateTagModules(): void {
    for (const tagKey in this.tagMap) {
      const tags = this.tagMap[tagKey];
      tags.forEach(tag => {
        tag.module = this.get(this.getModuleConstraint(tag.config))!;
      })
    }
  }

  #tagModules(moduleImport: IModuleImport): void {
    (moduleImport.config.tags ?? []).forEach(tag => {
      if (typeof this.tagMap[tag] == 'undefined') {
        this.tagMap[tag] = [];
      }

      if (this.#isESClass((moduleImport.module as IModuleImportObject).default)) {
        this.tagMap[tag].push({
          config: moduleImport.config,
          module: ((moduleImport.module as IModuleImportObject).default! as any) as IModuleImportObject
        });
        return;
      }

      this.tagMap[tag].push(moduleImport);
    })
  }

  #instantiateModule(moduleImport: IModuleImport): Module {
    const { module, config } = moduleImport
    let mInstance;
    if (typeof module != 'function' && module.default) {
      mInstance = module.default as Module;
    } else {
      mInstance = module;
    }
    if (!this.#isESClass(mInstance)) {
      this.#mapInstance(config, mInstance as Module);
      return mInstance as Module;
    }

    const injectList = this.#loadDependencies(mInstance as Module, config);
    if (false === injectList) {
      this.#mapInstance(config, mInstance as Module);
      return mInstance as Module;
    }
    // @ts-expect-error TS2351 "This expression is not constructable"
    // TS has issues with dynamically loaded generic classes which is normal (I think)
    const instance = new mInstance(...(config.entry.arguments ?? [])) as Module;
    typeof instance.inject == 'function' && injectList && instance.inject(injectList);

    this.#mapInstance(config, instance);

    return instance;
  }

  #mapInstance(config: RegisterConfig, module: Module): void {
    const constraint = this.getModuleConstraint(config);
    delete this.registered[constraint];
    this.loaded[constraint] = module;
    this.instanceMap.set(module, config);
  }

  #loadDependencies(module: Module, config: RegisterConfig): Record<string, object>|undefined|false {
    if (typeof module.inject != 'object') {
      return undefined;
    }

    const toInjectList = module.inject as Record<string, string>,
      injectList: Record<string, object> = {}
    ;
    for (const name in toInjectList) {
      if (this.#isTag(toInjectList[name])) {
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
        console.error(
          'Module ' + this.getModuleConstraint(config) + ' could not be loaded due to missing dependency: '
          + moduleConstraint
        );
        return false;
      }

      injectList[name] = this.loaded[moduleConstraint];
    }

    return injectList;
  }

  #isESClass(fn: unknown): boolean {
    return typeof fn === 'function'
      && Object.getOwnPropertyDescriptor(
        fn,
        'prototype'
      )?.writable === false
    ;
  }

  #orderModules(moduleRegistry: Record<string, RegisterConfig>): RegisterConfig[] {
    const sorted: RegisterConfig[] = [],
      prepared: Record<string, boolean> = {}
    ;

    let tries = Object.keys(moduleRegistry).length*2;
    while (!this.#isObjectEmpty(moduleRegistry)) {
      tries--;
      if (tries < 0) {
        console.warn('Not registered in load groups', moduleRegistry)
        throw new Error('Infinite dependency detected, stopping script...')
      }
      toSendLoop: for (const name in moduleRegistry) {

        const moduleConfig = moduleRegistry[name],
          requires = moduleConfig.requires ?? []
        ;

        for (const required of requires) {
          if (this.#isTag(required)) {
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!prepared[required] && !moduleRegistry[required] && !this.loaded[required]) {
            throw new Error('Module ' + name + ' is requesting not present dependency: ' + required);
          }

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (moduleRegistry[required]) {
            continue toSendLoop;
          }
        }

        sorted.push(moduleConfig);

        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete moduleRegistry[name];
        prepared[name] = true;
      }
    }

    return sorted;
  }

  #generateLoadGroups(toSend: Record<string, RegisterConfig>): Promise<IModuleImport>[] {
    const loadGroups: Promise<IModuleImport>[] = [];
    this.#orderModules(toSend).forEach(module => {
      loadGroups.push(this.#retrieveModulePromise(module));
    })

    return loadGroups;
  }

  #isTag(string: string): boolean {
    return /^![^\W.].*$/.test(string);
  }

  #importModule(config: RegisterConfig): Promise<IModuleImportObject> {
    return typeof config.entry.source == 'string'
      ? this.import(config.entry.source)
      : Promise.resolve(config.entry.source) as Promise<IModuleImportObject>
    ;
  }

  async #retrieveModulePromise(config: RegisterConfig): Promise<IModuleImport> {
    if (config.lazy) {
      return new Promise(resolve => {
        resolve({ module: () => new Promise(resolve => {
          void this.#importModule(config)
            .then((module: IModuleImportObject) => {
              resolve(this.#instantiateModule({ module, config }))
            })
          ;
        }), config });
      });
    }

    return new Promise(resolve => {
      void this.#importModule(config)
        .then(module => {
          resolve({ module, config });
        })
    });
  }

  #isObjectEmpty(obj: object): boolean {
    for(const prop in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, prop))
        return false;
    }

    return true;
  }
}
