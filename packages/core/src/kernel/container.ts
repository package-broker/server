export type ServiceFactory<
    Services extends Record<string, unknown>,
    Name extends keyof Services,
> = (container: ServiceContainer<Services>) => Services[Name];

export class ServiceContainer<Services extends Record<string, unknown> = Record<string, unknown>> {
    private readonly factories = new Map<keyof Services, ServiceFactory<Services, keyof Services>>();
    private readonly instances = new Map<keyof Services, Services[keyof Services]>();
    private readonly resolving = new Set<keyof Services>();

    register<Name extends keyof Services>(name: Name, factory: ServiceFactory<Services, Name>): void {
        this.factories.set(name, factory as ServiceFactory<Services, keyof Services>);
        this.instances.delete(name);
    }

    get<Name extends keyof Services>(name: Name): Services[Name] {
        if (this.instances.has(name)) {
            return this.instances.get(name) as Services[Name];
        }

        const factory = this.factories.get(name) as ServiceFactory<Services, Name> | undefined;
        if (!factory) {
            throw new Error(`Service "${String(name)}" is not registered`);
        }

        if (this.resolving.has(name)) {
            throw new Error(`Circular dependency detected while resolving "${String(name)}"`);
        }

        this.resolving.add(name);
        try {
            const instance = factory(this);
            this.instances.set(name, instance);
            return instance;
        } finally {
            this.resolving.delete(name);
        }
    }

    has<Name extends keyof Services>(name: Name): boolean {
        return this.factories.has(name);
    }

    delete<Name extends keyof Services>(name: Name): void {
        this.factories.delete(name);
        this.instances.delete(name);
    }

    clear(): void {
        this.factories.clear();
        this.instances.clear();
        this.resolving.clear();
    }
}
