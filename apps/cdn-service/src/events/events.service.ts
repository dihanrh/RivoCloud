import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { connect, JSONCodec, type NatsConnection } from 'nats';

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly codec = JSONCodec();
  private connectionPromise: Promise<NatsConnection | null> | null = null;
  private readonly lastPublished = new Map<string, unknown>();

  constructor(private readonly natsUrl: string) {}

  private async getConnection(): Promise<NatsConnection | null> {
    if (!this.connectionPromise) {
      this.connectionPromise = connect({ servers: this.natsUrl }).catch((error) => {
        this.logger.warn(`NATS unavailable, events will be dropped: ${error.message}`);
        return null;
      });
    }
    return this.connectionPromise;
  }

  async publish(subject: string, payload: unknown): Promise<void> {
    this.lastPublished.set(subject, payload);
    const connection = await this.getConnection();
    if (!connection) {
      return;
    }
    connection.publish(subject, this.codec.encode(payload));
  }

  getLastPublished<T>(subject: string): T | undefined {
    return this.lastPublished.get(subject) as T | undefined;
  }

  async onModuleDestroy() {
    const connection = await this.getConnection();
    await connection?.close();
  }
}
