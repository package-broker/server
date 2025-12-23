
import type { QueuePort } from '../ports';

/**
 * In-memory queue driver
 * Drains immediately or stores in array (simple implementation)
 * For this implementation, we'll just log and maybe process if we had a processor interface,
 * but since the Port only defines `send`, we effectively just "ack" it.
 */
export class MemoryQueueDriver implements QueuePort {
    private messages: any[] = [];

    async send(message: any): Promise<void> {
        // In a real local setup, you might want to process this immediately 
        // or have a background loop. For now, we store it.
        this.messages.push({ message, timestamp: Date.now() });
        // Simulate processing logging
        console.log('[MemoryQueue] Message received:', message);
    }

    async sendBatch(messages: any[]): Promise<void> {
        for (const msg of messages) {
            await this.send(msg);
        }
    }
}
