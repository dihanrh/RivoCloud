import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { connect, createInbox, JSONCodec, type NatsConnection } from 'nats';

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

  // Scatter-gather: publish once with a reply inbox, then collect however
  // many replies arrive before timeoutMs. Unlike nc.request() (exactly one
  // reply), invalidation needs replies from an unknown number of Edge
  // Proxies (EDD Section 4.4, Step 4: "Wait 5 seconds for replies from all
  // known edge nodes"). sub.unsubscribe() ends the subscription's async
  // iterator cleanly (no error) once the timer fires, so the for-await loop
  // below simply completes rather than throwing.
  //
  // Note on NATS control messages: When a message is published with a reply
  // inbox but no subscribers are listening on the target subject, NATS sends
  // a control message to the reply inbox with empty data and only a
  // Nats-Subject header. This message is skipped (not decoded or added to
  // replies) since it's not a real reply from an Edge Proxy. Genuine decode
  // failures on non-empty payloads are logged at WARN level since a corrupted
  // Edge Proxy reply is operationally significant.
  async requestMany<T>(subject: string, payload: unknown, timeoutMs: number): Promise<T[]> {
    const connection = await this.getConnection();
    if (!connection) {
      return [];
    }
    const inbox = createInbox();
    const sub = connection.subscribe(inbox);
    connection.publish(subject, this.codec.encode(payload), { reply: inbox });

    const replies: T[] = [];
    const timer = setTimeout(() => sub.unsubscribe(), timeoutMs);
    try {
      for await (const msg of sub) {
        // Skip NATS "no responders" control message: empty data with only Nats-Subject header
        if (msg.data.length === 0 && msg.headers?.has('Nats-Subject')) {
          continue;
        }

        try {
          replies.push(this.codec.decode(msg.data) as T);
        } catch (error) {
          // A real reply had invalid JSON - this is operationally significant
          this.logger.warn(
            `Failed to decode reply in requestMany for subject "${subject}": ${error}. Data length: ${msg.data.length}`,
          );
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return replies;
  }

  async onModuleDestroy() {
    const connection = await this.getConnection();
    await connection?.close();
  }
}
