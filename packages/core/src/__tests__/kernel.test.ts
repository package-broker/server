import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    EventBus,
    HookRegistry,
    ServiceContainer,
    loadPlugin,
    resetPluginRegistry,
    type BrokerPlugin,
    type PluginContext,
} from '../kernel';

interface TestServices extends Record<string, unknown> {
    config: { env: string };
    counter: { value: number };
    a: string;
    b: string;
}

interface TestEvents extends Record<string, unknown> {
    synced: { repository: string };
    failed: { message: string };
}

interface TestPackage {
    name: string;
}

interface TestSyncPayload {
    repository: string;
}

beforeEach(() => {
    resetPluginRegistry();
});

// ─── ServiceContainer ─────────────────────────────────────────────

describe('ServiceContainer', () => {
    it('registers and resolves services lazily', () => {
        const container = new ServiceContainer<TestServices>();
        const factory = vi.fn(() => ({ env: 'test' }));

        container.register('config', factory);

        expect(factory).not.toHaveBeenCalled();
        expect(container.get('config')).toEqual({ env: 'test' });
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('returns singleton instances by default', () => {
        const container = new ServiceContainer<TestServices>();
        container.register('counter', () => ({ value: 1 }));

        const first = container.get('counter');
        const second = container.get('counter');
        expect(first).toBe(second);
    });

    it('throws when resolving a missing service', () => {
        const container = new ServiceContainer<TestServices>();
        expect(() => container.get('config')).toThrow('Service "config" is not registered');
    });

    it('reports whether a service is registered', () => {
        const container = new ServiceContainer<TestServices>();
        expect(container.has('config')).toBe(false);
        container.register('config', () => ({ env: 'test' }));
        expect(container.has('config')).toBe(true);
    });

    it('detects circular dependencies', () => {
        const container = new ServiceContainer<TestServices>();
        container.register('a', (c) => c.get('b'));
        container.register('b', (c) => c.get('a'));

        expect(() => container.get('a')).toThrow('Circular dependency detected');
    });

    it('delete removes a service', () => {
        const container = new ServiceContainer<TestServices>();
        container.register('config', () => ({ env: 'test' }));
        container.get('config'); // instantiate
        container.delete('config');
        expect(container.has('config')).toBe(false);
    });

    it('clear removes all services', () => {
        const container = new ServiceContainer<TestServices>();
        container.register('config', () => ({ env: 'test' }));
        container.register('counter', () => ({ value: 1 }));
        container.clear();
        expect(container.has('config')).toBe(false);
        expect(container.has('counter')).toBe(false);
    });
});

// ─── EventBus ─────────────────────────────────────────────────────

describe('EventBus', () => {
    it('emits events to subscribers', async () => {
        const events = new EventBus<TestEvents>();
        const handler = vi.fn();

        events.on('synced', handler);
        await events.emit('synced', { repository: 'packages/demo' });

        expect(handler).toHaveBeenCalledWith({ repository: 'packages/demo' });
    });

    it('emits to multiple subscribers', async () => {
        const events = new EventBus<TestEvents>();
        const first = vi.fn();
        const second = vi.fn();

        events.on('synced', first);
        events.on('synced', second);
        await events.emit('synced', { repository: 'packages/demo' });

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('on() returns an unsubscribe function', async () => {
        const events = new EventBus<TestEvents>();
        const handler = vi.fn();

        const unsub = events.on('failed', handler);
        unsub();
        await events.emit('failed', { message: 'boom' });

        expect(handler).not.toHaveBeenCalled();
    });

    it('removes unsubscribed handlers via off()', async () => {
        const events = new EventBus<TestEvents>();
        const handler = vi.fn();

        events.on('failed', handler);
        events.off('failed', handler);
        await events.emit('failed', { message: 'boom' });

        expect(handler).not.toHaveBeenCalled();
    });

    it('runs all handlers even when one throws (allSettled)', async () => {
        const events = new EventBus<TestEvents>();
        const good = vi.fn();

        events.on('synced', () => { throw new Error('boom'); });
        events.on('synced', good);

        await expect(events.emit('synced', { repository: 'x' })).rejects.toThrow('boom');
        // The good handler still ran despite the first one throwing
        expect(good).toHaveBeenCalledTimes(1);
    });

    it('propagates async handler rejection', async () => {
        const events = new EventBus<TestEvents>();
        events.on('synced', async () => { throw new Error('async boom'); });

        await expect(events.emit('synced', { repository: 'x' })).rejects.toThrow('async boom');
    });

    it('does not throw when emitting with no subscribers', async () => {
        const events = new EventBus<TestEvents>();
        await expect(events.emit('synced', { repository: 'x' })).resolves.toBeUndefined();
    });

    it('clear removes all listeners', async () => {
        const events = new EventBus<TestEvents>();
        const handler = vi.fn();
        events.on('synced', handler);
        events.clear();
        await events.emit('synced', { repository: 'x' });
        expect(handler).not.toHaveBeenCalled();
    });
});

// ─── HookRegistry ─────────────────────────────────────────────────

describe('HookRegistry', () => {
    it('is empty by default', () => {
        const hooks = new HookRegistry<TestPackage, TestSyncPayload>();
        expect(hooks.packageTransformers()).toEqual([]);
        expect(hooks.syncObservers()).toEqual([]);
    });

    it('adds and returns package transformers', async () => {
        const hooks = new HookRegistry<TestPackage, TestSyncPayload>();
        const transformer = vi.fn(async (pkg: TestPackage) => ({ ...pkg, name: `${pkg.name}-x` }));

        hooks.addPackageTransformer(transformer);
        const [registered] = hooks.packageTransformers();
        expect(registered).toBe(transformer);
        await expect(registered({ name: 'demo' })).resolves.toEqual({ name: 'demo-x' });
    });

    it('removes a package transformer', () => {
        const hooks = new HookRegistry<TestPackage, TestSyncPayload>();
        const t = (pkg: TestPackage) => pkg;
        hooks.addPackageTransformer(t);
        hooks.removePackageTransformer(t);
        expect(hooks.packageTransformers()).toHaveLength(0);
    });

    it('adds and returns sync observers', async () => {
        const hooks = new HookRegistry<TestPackage, TestSyncPayload>();
        const observer = vi.fn(async (_payload: TestSyncPayload) => undefined);

        hooks.addSyncObserver(observer);
        const [registered] = hooks.syncObservers();
        expect(registered).toBe(observer);
        await registered({ repository: 'packages/demo' });
        expect(observer).toHaveBeenCalledWith({ repository: 'packages/demo' });
    });

    it('removes a sync observer', () => {
        const hooks = new HookRegistry<TestPackage, TestSyncPayload>();
        const o = (_p: TestSyncPayload) => {};
        hooks.addSyncObserver(o);
        hooks.removeSyncObserver(o);
        expect(hooks.syncObservers()).toHaveLength(0);
    });

    it('clear removes all hooks', () => {
        const hooks = new HookRegistry<TestPackage, TestSyncPayload>();
        hooks.addPackageTransformer((p) => p);
        hooks.addSyncObserver(() => {});
        hooks.clear();
        expect(hooks.packageTransformers()).toHaveLength(0);
        expect(hooks.syncObservers()).toHaveLength(0);
    });
});

// ─── Plugin ───────────────────────────────────────────────────────

describe('Plugin', () => {
    it('loadPlugin calls register with the provided context', async () => {
        const context: PluginContext<TestServices, TestEvents, TestPackage, TestSyncPayload> = {
            services: new ServiceContainer<TestServices>(),
            events: new EventBus<TestEvents>(),
            hooks: new HookRegistry<TestPackage, TestSyncPayload>(),
        };
        const register = vi.fn();
        const plugin: BrokerPlugin<TestServices, TestEvents, TestPackage, TestSyncPayload> = {
            name: 'demo-plugin',
            version: '1.0.0',
            register,
        };

        await loadPlugin(plugin, context);
        expect(register).toHaveBeenCalledWith(context);
    });

    it('wraps registration errors with plugin name', async () => {
        const context: PluginContext = {
            services: new ServiceContainer(),
            events: new EventBus(),
            hooks: new HookRegistry(),
        };
        const plugin: BrokerPlugin = {
            name: 'broken-plugin',
            version: '0.1.0',
            register() { throw new Error('init failed'); },
        };

        await expect(loadPlugin(plugin, context)).rejects.toThrow(
            'Plugin "broken-plugin@0.1.0" failed to register: init failed'
        );
    });

    it('rejects duplicate plugin loading', async () => {
        const context: PluginContext = {
            services: new ServiceContainer(),
            events: new EventBus(),
            hooks: new HookRegistry(),
        };
        const plugin: BrokerPlugin = {
            name: 'once-only',
            version: '1.0.0',
            register() {},
        };

        await loadPlugin(plugin, context);
        await expect(loadPlugin(plugin, context)).rejects.toThrow(
            'Plugin "once-only" is already loaded'
        );
    });

    it('returns a dispose handle that calls plugin.dispose', async () => {
        const context: PluginContext = {
            services: new ServiceContainer(),
            events: new EventBus(),
            hooks: new HookRegistry(),
        };
        const dispose = vi.fn();
        const plugin: BrokerPlugin = {
            name: 'disposable',
            version: '1.0.0',
            register() {},
            dispose,
        };

        const handle = await loadPlugin(plugin, context);
        await handle.dispose();
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});
