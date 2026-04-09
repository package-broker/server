import type { ServiceContainer } from './container';
import type { EventBus, EventMap } from './events';
import type { HookRegistry } from './hooks';

export interface PluginContext<
    Services extends Record<string, unknown> = Record<string, unknown>,
    Events extends EventMap = EventMap,
    TPackage = unknown,
    TSyncPayload = unknown,
> {
    services: ServiceContainer<Services>;
    events: EventBus<Events>;
    hooks: HookRegistry<TPackage, TSyncPayload>;
}

export interface BrokerPlugin<
    Services extends Record<string, unknown> = Record<string, unknown>,
    Events extends EventMap = EventMap,
    TPackage = unknown,
    TSyncPayload = unknown,
> {
    name: string;
    version: string;
    dependencies?: string[];
    register(ctx: PluginContext<Services, Events, TPackage, TSyncPayload>): void | Promise<void>;
    dispose?(): void | Promise<void>;
}

/**
 * Load a plugin with error context and duplicate detection.
 * Returns a dispose handle for teardown.
 */
const loadedPlugins = new Set<string>();

export async function loadPlugin<
    Services extends Record<string, unknown>,
    Events extends EventMap,
    TPackage,
    TSyncPayload,
>(
    plugin: BrokerPlugin<Services, Events, TPackage, TSyncPayload>,
    ctx: PluginContext<Services, Events, TPackage, TSyncPayload>,
): Promise<{ dispose: () => Promise<void> }> {
    if (loadedPlugins.has(plugin.name)) {
        throw new Error(`Plugin "${plugin.name}" is already loaded`);
    }

    try {
        await plugin.register(ctx);
        loadedPlugins.add(plugin.name);
    } catch (err) {
        throw new Error(
            `Plugin "${plugin.name}@${plugin.version}" failed to register: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
        );
    }

    return {
        async dispose() {
            if (plugin.dispose) {
                await plugin.dispose();
            }
            loadedPlugins.delete(plugin.name);
        },
    };
}

/** Reset the loaded plugin tracker (for testing). */
export function resetPluginRegistry(): void {
    loadedPlugins.clear();
}
