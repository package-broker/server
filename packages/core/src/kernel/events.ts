export type EventMap = Record<string, unknown>;

export type EventHandler<
    Events extends EventMap,
    Name extends keyof Events,
> = (payload: Events[Name]) => void | Promise<void>;

export class EventBus<Events extends EventMap = EventMap> {
    private readonly listeners = new Map<keyof Events, Set<EventHandler<Events, keyof Events>>>();

    /** Subscribe to an event. Returns an unsubscribe function. */
    on<Name extends keyof Events>(event: Name, handler: EventHandler<Events, Name>): () => void {
        const handlers = this.listeners.get(event);
        const typedHandler = handler as EventHandler<Events, keyof Events>;
        if (handlers) {
            handlers.add(typedHandler);
        } else {
            this.listeners.set(event, new Set([typedHandler]));
        }

        return () => this.off(event, handler);
    }

    off<Name extends keyof Events>(event: Name, handler: EventHandler<Events, Name>): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;

        handlers.delete(handler as EventHandler<Events, keyof Events>);
        if (handlers.size === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Emit an event to all subscribers.
     * Uses Promise.allSettled so one failing handler doesn't prevent others from running.
     * Throws the first failure after all handlers have completed.
     */
    async emit<Name extends keyof Events>(event: Name, payload: Events[Name]): Promise<void> {
        const handlers = this.listeners.get(event) as Set<EventHandler<Events, Name>> | undefined;
        if (!handlers || handlers.size === 0) return;

        const results = await Promise.allSettled(
            Array.from(handlers, (handler) => {
                try {
                    return handler(payload);
                } catch (err) {
                    return Promise.reject(err);
                }
            }),
        );

        const failures = results.filter(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (failures.length > 0) {
            const first = failures[0].reason;
            throw first instanceof Error
                ? first
                : new Error(`Event handler for "${String(event)}" failed: ${String(first)}`);
        }
    }

    /** Remove all listeners. */
    clear(): void {
        this.listeners.clear();
    }
}
