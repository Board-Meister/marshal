import type React from "react";

export interface EntryConfig {
  source: string|object;
  namespace: string;
  name: string;
  version: string;
}

export interface RegisterConfig {
  entry: EntryConfig;
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

export type Module = Record<string, unknown>;

interface IModuleImportObject {
  default?: Module;
}

interface IModuleImport {
  config: RegisterConfig;
  module: IModuleImportObject | (() => Promise<Module>)
}

export interface IExecutable {
  exec: () => void ;
}

export interface ILazy {
  page: () => React.ReactNode ;
}

// https://stackoverflow.com/a/66947291/11495586 - Static methods interface
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
declare class _IInjectable {
  constructor(injections: Record<string, object>);
  static inject: () => Record<string, string>;
}
export type IInjectable = typeof _IInjectable;

export default class Marshal {
  registered: Record<string, RegisterConfig> = {};
  loaded: Record<string, object> = {};
  tagMap: Record<string, IModuleImport[]> = {};
  instanceMap = new WeakMap<Module, RegisterConfig>();

  register(config: RegisterConfig): void {
    this.registered[this.getModuleConstraint(config)] = config;
  }

  getModuleConstraint(config: RegisterConfig): string {
    return config.entry.namespace + '/' + config.entry.name + ':' + config.entry.version;
  }

  get(key: string): Module|null {
    return this.loaded[key] as Module ?? null;
  }

  async load(): Promise<void> {
    const modules = await Promise.all<IModuleImport>(this.generateLoadGroups());
    modules.forEach(this.tagModules.bind(this));
    modules.forEach(this.instantiateModule.bind(this));
  }

  tagModules(moduleImport: IModuleImport): void {
    (moduleImport.config.tags ?? []).forEach(tag => {
      if (!this.tagMap[tag]) {
        this.tagMap[tag] = [];
      }

      if (this.isESClass((moduleImport.module as IModuleImportObject).default)) {
        this.tagMap[tag].push({
          config: moduleImport.config,
          module: (moduleImport.module as IModuleImportObject).default!
        });
        return;
      }

      this.tagMap[tag].push(moduleImport);
    })
  }

  instantiateModule(moduleImport: IModuleImport): Module {
    const { module, config } = moduleImport
    if (typeof module == 'function' || !module.default || !this.isESClass(module.default)) {
      this.mapInstance(config, module as Module);
      return module as Module;
    }

    const injectList = this.loadDependencies(module.default, config);
    if (false === injectList) {
      this.mapInstance(config, module as Module);
      return module as Module;
    }
    // @ts-expect-error TS2351 "This expression is not constructable"
    // TS has issues with dynamically loaded generic classes which is normal (I think)
    const instance = injectList ? new module.default(injectList) as Module : new module.default as Module;
    this.mapInstance(config, instance);

    typeof instance.exec == 'function' && instance.exec();

    return instance;
  }

  mapInstance(config: RegisterConfig, module: Module): void {
    this.loaded[this.getModuleConstraint(config)] = module;
    this.instanceMap.set(module, config);
  }

  loadDependencies(module: Module, config: RegisterConfig): Record<string, object>|undefined|false {
    if (typeof module.inject != 'function') {
      return undefined;
    }

    const toInjectList = module.inject() as Record<string, string>,
      injectList: Record<string, object> = {};
    for (const name in toInjectList) {
      if (this.isTag(toInjectList[name])) {
        injectList[name] = this.tagMap[toInjectList[name].substring(1)] ?? [];
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

  isESClass (fn: unknown): boolean {
    return typeof fn === 'function'
      && Object.getOwnPropertyDescriptor(
        fn,
        'prototype'
      )?.writable === false
    ;
  }

  generateLoadGroups(): Promise<IModuleImport>[] {
    const loadGroups: Promise<IModuleImport>[] = [],
      prepared: Record<string, boolean> = {},
      toSend: Record<string, RegisterConfig> = Object.assign({}, this.registered)
    ;

    while (!this.isObjectEmpty(toSend)) {
      toSendLoop: for (const name in toSend) {

        const moduleConfig = toSend[name],
          requires = moduleConfig.requires ?? []
        ;

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

  isTag(string: string): boolean {
    return /^![^\W]+$/.test(string);
  }

  importModule(config: RegisterConfig): Promise<IModuleImportObject> {
    return typeof config.entry.source == 'string'
      ? import(/* @vite-ignore */ config.entry.source) as Promise<IModuleImportObject>
      : Promise.resolve(config.entry.source) as Promise<IModuleImportObject>
    ;
  }

  async retrieveModulePromise(config: RegisterConfig): Promise<IModuleImport> {
    if (config.lazy) {
      return new Promise(resolve => {
        resolve({ module: () => new Promise(resolve => {
          void this.importModule(config)
            .then((module: IModuleImportObject) => {
              resolve(this.instantiateModule({ module, config }))
            })
          ;
        }), config });
      });
    }

    return new Promise(resolve => {
      void this.importModule(config)
        .then(module => {
          resolve({ module , config });
        })
    });
  }

  isObjectEmpty(obj: object): boolean {
    for(const prop in obj) {
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
