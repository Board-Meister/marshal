import type React from "react";
export interface EntryConfig {
    source: string | object;
    namespace: string;
    name: string;
    version: string;
    arguments?: any[];
}
export interface RegisterConfig {
    entry: EntryConfig;
    scope?: boolean;
    tags?: string[];
    requires?: string[];
    lazy?: boolean;
    asset?: {
        src: string;
    };
    resource?: {
        src: string;
    };
}
export type Module = Record<string, unknown>;
export interface IModuleImportObject {
    default?: Module | React.FC;
}
export interface IModuleImport {
    config: RegisterConfig;
    module: IModuleImportObject | (() => Promise<Module>);
}
/**
 * Initializer is a kernel class of application, manually called by the app.
 * This is just a helper interface to keep all initializers united
 */
export interface IInitializer {
    init: (global: any) => Promise<void>;
}
export interface ILazy {
    page: () => React.ReactNode;
}
declare class _IInjectable {
    constructor(...args: any[]);
    inject(injections: Record<string, object>): void;
    static inject: Record<string, string>;
}
export type IInjectable = typeof _IInjectable;
export default class Marshal {
    static version: string;
    renderCount: number;
    registered: Record<string, RegisterConfig>;
    loaded: Record<string, object>;
    tagMap: Record<string, IModuleImport[]>;
    scope: Record<string, any>;
    instanceMap: WeakMap<Module, RegisterConfig>;
    constructor();
    addScope(name: string, value: any): void;
    render(): void;
    register(config: RegisterConfig): void;
    getModuleConstraint(config: RegisterConfig): string;
    get<Type>(key: string): Type | null;
    load(): Promise<void>;
    updateTagModules(): void;
    tagModules(moduleImport: IModuleImport): void;
    instantiateModule(moduleImport: IModuleImport): Module;
    mapInstance(config: RegisterConfig, module: Module): void;
    getMappedInstance(module: Module): RegisterConfig | undefined;
    loadDependencies(module: Module, config: RegisterConfig): Record<string, object> | undefined | false;
    isESClass(fn: unknown): boolean;
    generateLoadGroups(): Promise<IModuleImport>[];
    isTag(string: string): boolean;
    import(source: string): Promise<IModuleImportObject>;
    importModule(config: RegisterConfig): Promise<IModuleImportObject>;
    retrieveModulePromise(config: RegisterConfig): Promise<IModuleImport>;
    isObjectEmpty(obj: object): boolean;
}
export {};
