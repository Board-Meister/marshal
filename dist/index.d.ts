import type React from "react";
export interface EntryConfig {
    source: string | object;
    namespace: string;
    name: string;
    version: string;
}
export interface RegisterConfig {
    entry: EntryConfig;
    tags?: string[];
    requires?: string[];
    lazy?: boolean;
}
export declare class Module {
    ['constructor']: typeof Module;
    constructor();
    [key: string]: unknown;
}
interface IModuleImportObject {
    default?: Module;
}
interface IModuleImport {
    config: RegisterConfig;
    module: IModuleImportObject | (() => Promise<Module>);
}
export interface IExecutable {
    exec: () => void;
}
export interface ILazy {
    page: () => React.ReactNode;
}
declare class _IInjectable {
    constructor(injections: Record<string, object>);
    static inject: () => Record<string, string>;
}
export type IInjectable = typeof _IInjectable;
export default class Marshal {
    registered: Record<string, RegisterConfig>;
    loaded: Record<string, object>;
    tagMap: Record<string, IModuleImport[]>;
    register(config: RegisterConfig): void;
    getModuleConstraint(config: RegisterConfig): string;
    load(): Promise<void>;
    tagModules(moduleImport: IModuleImport): void;
    instantiateModule(moduleImport: IModuleImport): Module;
    loadDependencies(module: Module, config: RegisterConfig): Record<string, object> | undefined | false;
    isESClass(fn: unknown): boolean;
    generateLoadGroups(): Promise<IModuleImport>[];
    isTag(string: string): boolean;
    importModule(config: RegisterConfig): Promise<IModuleImportObject>;
    retrieveModulePromise(config: RegisterConfig): Promise<IModuleImport>;
    isObjectEmpty(obj: object): boolean;
}
export {};
