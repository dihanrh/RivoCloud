import { describe, expect, it, afterEach } from 'vitest';
import { connect, type NatsConnection } from 'nats';
import { EventsService } from './events.service.js';

const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222';

describe('EventsService.requestMany', () => {
  let responders: NatsConnection[] = [];

  afterEach(async () => {
    await Promise.all(responders.map((nc) => nc.close()));
    responders = [];
  });

  async function startResponder(subject: string, reply: unknown): Promise<void> {
    const nc = await connect({ servers: natsUrl });
    responders.push(nc);
    const sub = nc.subscribe(subject);
    (async () => {
      for await (const msg of sub) {
        if (msg.reply) {
          nc.publish(msg.reply, new TextEncoder().encode(JSON.stringify(reply)));
        }
      }
    })();
  }

  it('collects replies from every responder within the timeout window', async () => {
    const subject = `cache.invalidate.test-${Date.now()}`;
    await startResponder(subject, { datacenter: 'a', keysPurged: 3 });
    await startResponder(subject, { datacenter: 'b', keysPurged: 5 });

    const events = new EventsService(natsUrl);
    const replies = await events.requestMany<{ datacenter: string; keysPurged: number }>(
      subject,
      { zoneId: 'z1' },
      1000,
    );

    expect(replies).toHaveLength(2);
    expect(replies.map((r) => r.keysPurged).sort()).toEqual([3, 5]);
  });

  it('returns an empty array when nobody replies before the timeout', async () => {
    const events = new EventsService(natsUrl);
    const replies = await events.requestMany('cache.invalidate.nobody-listening', { zoneId: 'z2' }, 300);
    expect(replies).toEqual([]);
  });
});
