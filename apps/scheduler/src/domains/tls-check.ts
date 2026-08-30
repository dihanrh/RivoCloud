import * as tls from 'node:tls';

export interface TlsCertificateResult {
  valid: boolean;
  validTo?: Date;
}

export interface CheckTlsCertificateOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

// The only reliable way to confirm a Let's Encrypt certificate was actually
// issued and installed: connect with the domain as SNI (exactly what a real
// browser does) and check the certificate Traefik hands back. Traefik does
// not expose its ACME store's contents over its API (by design, for
// security), so there is no "ask Traefik whether it has a cert yet" call to
// make instead.
export function checkTlsCertificate(domain: string, opts: CheckTlsCertificateOptions = {}): Promise<TlsCertificateResult> {
  const { host = domain, port = 443, timeoutMs = 5000 } = opts;
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: domain, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        const names = [
          cert.subject?.CN,
          ...(cert.subjectaltname?.split(', ').map((entry) => entry.replace(/^DNS:/, '')) ?? []),
        ].filter((name): name is string => Boolean(name));
        const matches = names.includes(domain);
        socket.end();
        resolve(matches && cert.valid_to ? { valid: true, validTo: new Date(cert.valid_to) } : { valid: false });
      },
    );
    socket.on('error', () => resolve({ valid: false }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ valid: false });
    });
  });
}
