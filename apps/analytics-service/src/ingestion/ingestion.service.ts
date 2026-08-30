import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, type NatsConnection, type Subscription } from 'nats';
import { parseEdgeRequestEvent } from './parse-event.js';
import type { EdgeRequestEvent } from './edge-request-event.js';
import { RequestLogWriter } from './request-log-writer.js';

// EDD Section 2.5: flush at 1,000 buffered events or 5 seconds, whichever
// first — fixed constants, not configurable (this plan's Global Constraints).
const FLUSH_BATCH_SIZE = 1000;
const FLUSH_INTERVAL_MS = 5000;

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private buffer: EdgeRequestEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private connection: NatsConnection | null = null;
  private subscription: Subscription | null = null;

  constructor(
    private readonly natsUrl: string,
    private readonly writer: RequestLogWriter,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.connection = await connect({ servers: this.natsUrl });
    } catch (error) {
      this.logger.warn(`NATS unavailable, edge.request events will not be ingested: ${(error as Error).message}`);
      return;
    }
    this.subscription = this.connection.subscribe('edge.request');
    void this.consume(this.subscription);
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  private async consume(subscription: Subscription): Promise<void> {
    // Contain any abrupt failure of the subscription's async iterator (e.g. a
    // dropped NATS connection rather than a graceful unsubscribe/close) here.
    // This runs fire-and-forget from onModuleInit (`void this.consume(...)`),
    // so an unhandled rejection here would otherwise be an unhandled promise
    // rejection capable of crashing the process — an outage should degrade
    // ingestion, not the whole service, same principle as flush()'s catch.
    try {
      for await (const msg of subscription) {
        const event = parseEdgeRequestEvent(msg.data);
        if (!event) {
          this.logger.warn('dropping malformed edge.request event');
          continue;
        }
        this.enqueue(event);
      }
    } catch (error) {
      this.logger.error(`edge.request subscription ended unexpectedly: ${(error as Error).message}`);
    }
  }

  enqueue(event: EdgeRequestEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.writer.insertBatch(batch);
    } catch (error) {
      this.logger.error(`failed to flush ${batch.length} request_logs rows: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    this.subscription?.unsubscribe();
    await this.connection?.close();
  }
}
