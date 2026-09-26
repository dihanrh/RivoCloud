import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, DebugEvents, Events, type ConnectionOptions, type NatsConnection, type Subscription } from 'nats';
import { parseEdgeRequestEvent } from './parse-event.js';
import type { EdgeRequestEvent } from './edge-request-event.js';
import { RequestLogWriter } from './request-log-writer.js';

// EDD Section 2.5: flush at 1,000 buffered events or 5 seconds, whichever
// first — fixed constants, not configurable (this plan's Global Constraints).
const FLUSH_BATCH_SIZE = 1000;
const FLUSH_INTERVAL_MS = 5000;
// Matches nats.js's own default reconnectTimeWait, used for later outages.
const INITIAL_CONNECT_RETRY_MS = 2000;

/** Snapshot of the NATS side of the ingestion pipeline, surfaced on /health. */
export interface IngestionHealth {
  natsConnected: boolean;
  /** ISO timestamp of the most recent (re)connect, or null if never connected. */
  lastConnectedAt: string | null;
}

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private buffer: EdgeRequestEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private connection: NatsConnection | null = null;
  private subscription: Subscription | null = null;
  private natsConnected = false;
  private lastConnectedAt: Date | null = null;
  private destroyed = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryWake: (() => void) | null = null;

  constructor(
    private readonly natsUrl: string,
    private readonly writer: RequestLogWriter,
  ) {}

  async onModuleInit(): Promise<void> {
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // The first attempt is awaited so that, in the normal case (NATS already
    // up), the edge.request subscription is live by the time bootstrap
    // finishes. It fails fast instead of blocking bootstrap if NATS isn't up
    // yet, and hands over to a background retry that never gives up.
    try {
      this.attach(await connect(this.connectOptions()));
    } catch (error) {
      this.logger.warn(
        `INGESTION UNHEALTHY: NATS unreachable at startup (${(error as Error).message}); ` +
          'edge.request events are not being ingested — retrying in the background',
      );
      void this.connectInBackground();
    }
  }

  /** Current NATS connectivity, for the health endpoint. */
  health(): IngestionHealth {
    return {
      natsConnected: this.natsConnected,
      lastConnectedAt: this.lastConnectedAt ? this.lastConnectedAt.toISOString() : null,
    };
  }

  private connectOptions(): ConnectionOptions {
    return {
      servers: this.natsUrl,
      // Retry a later outage forever instead of the client's default of 10
      // attempts, after which the subscription iterator would end gracefully
      // and ingestion would silently stop for good. (`reconnect` already
      // defaults to true in nats.js; set explicitly for clarity.)
      reconnect: true,
      maxReconnectAttempts: -1,
    };
  }

  // Retries the initial connection forever, every INITIAL_CONNECT_RETRY_MS,
  // until it succeeds or the module is destroyed. This is deliberately an
  // explicit loop rather than nats.js's `waitOnFirstConnect: true`: that
  // option makes connect() retry internally, but its promise only settles on
  // success and there is no handle to cancel it — a NATS that never comes up
  // would keep dialing (and keep the process alive) after onModuleDestroy.
  private async connectInBackground(): Promise<void> {
    let attempts = 0;
    while (!this.destroyed) {
      await new Promise<void>((resolve) => {
        this.retryWake = resolve;
        this.retryTimer = setTimeout(resolve, INITIAL_CONNECT_RETRY_MS);
      });
      this.retryTimer = null;
      this.retryWake = null;
      if (this.destroyed) return;
      attempts++;
      try {
        const connection = await connect(this.connectOptions());
        if (this.destroyed) {
          await connection.close();
          return;
        }
        this.logger.log(`NATS reachable after ${attempts} retr${attempts === 1 ? 'y' : 'ies'}; edge.request ingestion started`);
        this.attach(connection);
        return;
      } catch (error) {
        // Log every attempt at first, then roughly once a minute, so an
        // operator scanning logs sees a sustained outage without log spam.
        if (attempts <= 3 || attempts % 30 === 0) {
          this.logger.warn(
            `INGESTION UNHEALTHY: NATS still unreachable (attempt ${attempts}): ${(error as Error).message}`,
          );
        }
      }
    }
  }

  private attach(connection: NatsConnection): void {
    this.connection = connection;
    this.markConnected();
    void this.watchStatus(connection);
    void connection.closed().then((error) => {
      this.natsConnected = false;
      if (this.destroyed) return;
      this.logger.error(
        `INGESTION UNHEALTHY: NATS connection closed permanently${error ? ` (${error.message})` : ''}; ` +
          'edge.request events are no longer being ingested',
      );
    });
    this.subscription = connection.subscribe('edge.request');
    void this.consume(this.subscription);
  }

  private markConnected(): void {
    this.natsConnected = true;
    this.lastConnectedAt = new Date();
  }

  private async watchStatus(connection: NatsConnection): Promise<void> {
    try {
      for await (const status of connection.status()) {
        switch (status.type) {
          case Events.Disconnect:
            this.natsConnected = false;
            this.logger.warn('INGESTION UNHEALTHY: NATS disconnected; edge.request ingestion paused until reconnect');
            break;
          case DebugEvents.Reconnecting:
            this.natsConnected = false;
            break;
          case Events.Reconnect:
            this.markConnected();
            this.logger.log('NATS reconnected; edge.request ingestion resumed');
            break;
          default:
            break;
        }
      }
    } catch (error) {
      this.logger.error(`NATS status monitor ended unexpectedly: ${(error as Error).message}`);
    }
  }

  private async consume(subscription: Subscription): Promise<void> {
    // Contain any abrupt failure of the subscription's async iterator (e.g. a
    // dropped NATS connection rather than a graceful unsubscribe/close) here.
    // This runs fire-and-forget from attach() (`void this.consume(...)`),
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
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryWake?.();
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    this.subscription?.unsubscribe();
    await this.connection?.close();
  }
}
