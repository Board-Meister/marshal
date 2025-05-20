import Marshal, { RegisterConfig } from "index";
import { generateConfig } from "test/helpers/modules.helper";

interface IInjectedDependenciesMain {
    inj1: object;
    inj2: object;
}

interface IInjectedDependenciesInj2 {
    inj1: object;
}

describe('Marshal', () => {
    let marshal: Marshal;
    beforeEach(() => {
        marshal = new Marshal();
    })

    it('registers modules properly', () => {
        const config: RegisterConfig = {
            entry: {
                source: 'source.js',
                name: 'test',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            type: 'module',
        };
        expect(marshal.getModuleConstraint(config)).toBe('testsuite/test');

        marshal.register(config);
        expect(marshal.registered).toEqual(jasmine.objectContaining({
            'testsuite/test': jasmine.objectContaining({
                ...config,
                entry: jasmine.objectContaining({
                    ...config.entry,
                }),
            }),
            'boardmeister/marshal': jasmine.objectContaining({
                type: 'module',
                entry: jasmine.objectContaining({
                    name: 'marshal',
                    namespace: 'boardmeister',
                    version: Marshal.version,
                }),
            }),
        }));
    });

    it('instantiate modules properly', async () => {
        marshal.register(generateConfig({
            source: 'es_module.js',
            name: 'es_module',
        }));
        marshal.register(generateConfig({
            source: 'object.js',
            name: 'object',
        }));
        marshal.register(generateConfig({
            source: {
                getC: () => 'c',
            },
            name: 'native',
        }));


        await marshal.load();
        expect(marshal.get<{ getA: () => 'a'}>('testsuite/es_module')?.getA()).withContext('Load ES').toBe('a');
        expect(marshal.get<{ getB: () => 'b'}>('testsuite/object')?.getB()).withContext('Load object').toBe('b');
        expect(marshal.get<{ getC: () => 'c'}>('testsuite/native')?.getC()).withContext('Native').toBe('c');
    });

    it('instantiate module with arguments properly', async () => {
        const argument1 = Math.random();
        const argument2 = Math.random();
        const argument3 = Math.random();
        marshal.register({
            entry: {
                source: class {
                    arg1: number;
                    arg2: number;
                    arg3: number;
                    constructor(arg1: number, arg2: number, arg3: number) {
                        this.arg1 = arg1;
                        this.arg2 = arg2;
                        this.arg3 = arg3;
                    }
                },
                name: 'class',
                namespace: 'testsuite',
                version: '1.0.0',
                arguments: [
                    argument1,
                    argument2,
                    argument3,
                ]
            },
            type: 'module',
        });

        await marshal.load();
        const module = marshal.get<{ arg1: number, arg2: number, arg3: number }>('testsuite/class')
        expect(module?.arg1).toBe(argument1);
        expect(module?.arg2).toBe(argument2);
        expect(module?.arg3).toBe(argument3);
    });

    it('dependencies are resolved properly and injected', async () => {
        class main {
            injected?: IInjectedDependenciesMain;
            static inject: Record<string, string> = {
                inj1: 'testsuite/inj1',
                inj2: 'testsuite/inj2',
            }
            inject(injections: IInjectedDependenciesMain): void {
                this.injected = injections;
            }
        };
         marshal.register({
            entry: {
                source: main,
                name: 'main',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            requires: [
                'testsuite/inj1',
                'testsuite/inj2',
            ],
            type: 'module',
        });


        class inj2 {
            injected?: IInjectedDependenciesInj2;
            static inject: Record<string, string> = {
                inj1: 'testsuite/inj1',
            }
            inject(injections: IInjectedDependenciesInj2): void {
                this.injected = injections;
            }
        };
         marshal.register({
            entry: {
                source: inj2,
                name: 'inj2',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            requires: [
                'testsuite/inj1',
            ],
            type: 'module',
        });


        class inj1 {};
         marshal.register({
            entry: {
                source: inj1,
                name: 'inj1',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            type: 'module',
        });

        await marshal.load();
        const mainIns = marshal.get<main>('testsuite/main');
        const inj2Ins = marshal.get<inj2>('testsuite/inj2');
        const inj1Ins = marshal.get<inj1>('testsuite/inj1');

        expect(mainIns).withContext('Main instance').toBeInstanceOf(main);
        expect(inj2Ins).withContext('Inj2 instance').toBeInstanceOf(inj2);
        expect(inj1Ins).withContext('Inj1 instance').toBeInstanceOf(inj1);
        expect(mainIns?.injected?.inj1).toBeInstanceOf(inj1);
        expect(mainIns?.injected?.inj2).toBeInstanceOf(inj2);
        expect(inj2Ins?.injected?.inj1).toBeInstanceOf(inj1);
    });

    it('tags are resolved properly and injected', async () => {
        class main {
            injected?: { tagged: object[] };
            static inject: Record<string, string> = {
                tagged: '!tag',
            }
            inject(injections: { tagged: object[] }): void {
                this.injected = injections;
            }
        };
         marshal.register({
            entry: {
                source: main,
                name: 'main',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            type: 'module',
        });


        class tag1 {};
         marshal.register({
            entry: {
                source: tag1,
                name: 'tag1',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            tags: ['tag'],
            type: 'module',
        });


        class tag2 {};
        marshal.register({
            entry: {
                source: tag2,
                name: 'tag2',
                namespace: 'testsuite',
                version: '1.0.0',
            },
            tags: ['tag'],
            type: 'module',
        });

        await marshal.load();
        const mainIns = marshal.get<main>('testsuite/main');
        const tag1Ins = marshal.get<tag1>('testsuite/tag1');
        const tag2Ins = marshal.get<tag2>('testsuite/tag2');

        expect(mainIns).withContext('Main instance').toBeInstanceOf(main);
        expect(mainIns?.injected?.tagged).toEqual(jasmine.objectContaining([
            jasmine.objectContaining({
                module: tag1Ins,
                config: marshal.getMappedInstance(tag1Ins as any),
            }),
            jasmine.objectContaining({
                module: tag2Ins,
                config: marshal.getMappedInstance(tag2Ins as any),
            }),
        ]));
    });
});