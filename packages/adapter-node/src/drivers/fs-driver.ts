
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { type StorageDriver } from '@package-broker/core';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class FileSystemDriver implements StorageDriver {
    private basePath: string;

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    private getPath(key: string): string {
        // Prevent directory traversal
        const safeKey = key.replace(/\.\./g, '');
        return path.join(this.basePath, safeKey);
    }

    async get(key: string): Promise<ReadableStream | null> {
        const filePath = this.getPath(key);
        try {
            await fs.access(filePath);
            // Convert Node.js Readable to Web ReadableStream
            const nodeStream = createReadStream(filePath);
            return Readable.toWeb(nodeStream) as unknown as ReadableStream;
        } catch {
            return null;
        }
    }

    async put(key: string, data: ReadableStream | ArrayBuffer | Uint8Array): Promise<void> {
        const filePath = this.getPath(key);
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        if (data instanceof ReadableStream) {
            const nodeStream = Readable.fromWeb(data as any);
            const writeStream = createWriteStream(filePath);
            await pipeline(nodeStream, writeStream);
        } else {
            await fs.writeFile(filePath, Buffer.from(data as any));
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await fs.unlink(this.getPath(key));
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            await fs.access(this.getPath(key));
            return true;
        } catch {
            return false;
        }
    }
}
