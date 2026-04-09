export type PackageTransformer<TPackage = unknown> = (
    pkg: TPackage,
) => TPackage | Promise<TPackage>;

export type SyncObserver<TSyncPayload = unknown> = (
    payload: TSyncPayload,
) => void | Promise<void>;

export class HookRegistry<TPackage = unknown, TSyncPayload = unknown> {
    private readonly transformers: PackageTransformer<TPackage>[] = [];
    private readonly observers: SyncObserver<TSyncPayload>[] = [];

    addPackageTransformer(transformer: PackageTransformer<TPackage>): void {
        this.transformers.push(transformer);
    }

    removePackageTransformer(transformer: PackageTransformer<TPackage>): void {
        const idx = this.transformers.indexOf(transformer);
        if (idx !== -1) this.transformers.splice(idx, 1);
    }

    packageTransformers(): PackageTransformer<TPackage>[] {
        return [...this.transformers];
    }

    addSyncObserver(observer: SyncObserver<TSyncPayload>): void {
        this.observers.push(observer);
    }

    removeSyncObserver(observer: SyncObserver<TSyncPayload>): void {
        const idx = this.observers.indexOf(observer);
        if (idx !== -1) this.observers.splice(idx, 1);
    }

    syncObservers(): SyncObserver<TSyncPayload>[] {
        return [...this.observers];
    }

    clear(): void {
        this.transformers.length = 0;
        this.observers.length = 0;
    }
}
