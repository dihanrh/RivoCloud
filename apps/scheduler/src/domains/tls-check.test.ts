import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as tls from 'node:tls';
import { checkTlsCertificate } from './tls-check.js';

const MATCH_CERT = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUM8SXiBgTsQZAu9YRc8AtO3o7d5wwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMB4XDTI2MDgzMDA5MzA1MFoX
DTM2MDgyNzA5MzA1MFowGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsdAEXPR1pZ34SbRWJ0Zlh2miJB0/
pwW7ySAs7p8tPhspdfj3Ddzm1/TFspE3z8zppVOFVlNqqDdT3YQT2XHgWABhb9mW
Gr0VuVrhJ3lEeDRt8NWyn8M76I/16QtTVLa35elY8ErnHQOKGIEYJh8yrpjhXOEi
I4Jw8vQJCoCBiTNFMcJ+AUfpqG4ezqaeQs62YudxTgqw3oBQ/Stnta6vBfRD2dBc
eUjkljlpBMSJ+KnCjTwcbqns43LwyUgBQ1GKCNmw3r+5PksNmXN7GaEQEn4tZkWF
QHos+329JfO4SSSQQII+f15mbuM791kp9ASDuqCCGZwFQ608ZmhlDKy7EQIDAQAB
o28wbTAdBgNVHQ4EFgQUfU1BMPSqb1ganbxQiriKuS0+dFkwHwYDVR0jBBgwFoAU
fU1BMPSqb1ganbxQiriKuS0+dFkwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzAR
gg9jZG4uZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBAEPBPEKmWaUiYJPI
vJw+0g4P11MlewMFR1V/fOmQB5tQOvgUlXijIme1t7FmQZsbbuQ+ZU1xuod5gDvu
VGarov0DKhItq8xX+PYa306V4ZIauPUb/f0aSgoxdCCFqdOqSXq7tUZRBRzh+r5o
O8RjmdcqHpzXqk/jEssEwYCk9NXah5WUl4+J8dKvb+MUfQgs+f2zi8X/BfB+l6Lo
oiXZAGiCdIUsE7y/bWDnDLIKCaB094XAjPU7MLicVRBrj8363zj2X3VPJiDPMeuv
2/S8YJsC1JvwAKHEFjVYvdW5wzuZx4GMIj8Db4wF8C5R/7ZPRnwuybdNIo6rh/BL
YegI07g=
-----END CERTIFICATE-----`;

const MATCH_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCx0ARc9HWlnfhJ
tFYnRmWHaaIkHT+nBbvJICzuny0+Gyl1+PcN3ObX9MWykTfPzOmlU4VWU2qoN1Pd
hBPZceBYAGFv2ZYavRW5WuEneUR4NG3w1bKfwzvoj/XpC1NUtrfl6VjwSucdA4oY
gRgmHzKumOFc4SIjgnDy9AkKgIGJM0Uxwn4BR+mobh7Opp5CzrZi53FOCrDegFD9
K2e1rq8F9EPZ0Fx5SOSWOWkExIn4qcKNPBxuqezjcvDJSAFDUYoI2bDev7k+Sw2Z
c3sZoRASfi1mRYVAeiz7fb0l87hJJJBAgj5/XmZu4zv3WSn0BIO6oIIZnAVDrTxm
aGUMrLsRAgMBAAECggEABeiZaIRYD3WRHVPghAQXFhmYwXX2WkS6wXtv+srvzC9H
YKvx+7QyOI1h72XbcqyGvA9rMBvsAKR8BTGhHjnmQE5c7oROtFtBqEvgjPj+4Tau
y5CyU5Q/fqIgBAs0DO3YbQukwLFgfiqSsW9Cv+uL+djLLlSt13u7aJta3I46H7a1
/2thRNhZr5X1yBCJuc7v+C2TmrXULbdGhxnNY5KjFf7t987sqb+mQUi9sL//C8LP
cjF0Rj0ESrr5v+fLFz+wmbJt4XiatDsO1ZpsiywWzERsm2ZaP1K/D+HuwoYGvySf
L3A3y4gUgHq6cR01TOoOFDUA7fBjG0n3X06yDmcGBQKBgQDcMSm1XHGihLwXD7gt
Pa0CIx4bBJojqZSnjkHZx24xOrrZsPbLbP/zXlBJPKoQw1MAG4HRxDX+1DQFbkRA
4QGrjeoidRF7uAkr+WZgZB6fBunfn75Dmc5wieW+/gi2FgWyfB/E067GRFkFHxtE
R0xRxAPPKAWLvdpMA6QMGjuOZQKBgQDOuozFcYpsaT1vCs2rQYjS4y3XNVEPgihv
72rN+2osqr+icHO18GrqHUGOV0KryNNPvfFea+F0t1+K42Zg5aTZDoT8XZMQqwzE
8+yGZ7uiZ6BPFtnR3gnwROykrJnlHWsPfBnq/cghpK3mkyl7gqcXkkV1f/coAj6o
LSeyAs1JPQKBgEo/nbPVJ1BI9+/C0jUXLgahdt5fb+aEoWbatmPMNuEMz8LmRGIW
MDyNWf9IIISkiJFptR3ZzudOAPiv1P4XoWuK4B+cYDfat+UHJTltqVGwkB5jDFJZ
Q9548Wq02JUl2ef0qPXC95VNqMLsWVJtxFNyCGLLOQuFCl5FgATAt8JtAoGBAKJu
hcllqyP/lNu5G1zig0VgZ1ZfeC+9T1SUQ9FRKF2sVCKoROLB4t/M2QOkoKglhZN0
ZUCRd3aj1phkkL618c7yz58TT0ibfc8K8d+xhgbXcWhzRfbWheyZ226Qh+M0ODjU
g/DWMvfsUw+GteNsBypILfdi8qonCWBPCo+eD/rpAoGBANeQrnNPUYGafxoyao65
61EpDwukiO/x/7brnI2b3lgvZKFerlGhrkwr9NnwqhyUURf2aDnNE0pc6qq06EYJ
DKeio5iLNsVoi2EgoEAKQqlLusS4OZFzWmY9qRdvnv49H8WGrSp/0asQIcMVmiIo
8/sJVeDs0E+sVz2cHH62lWsb
-----END PRIVATE KEY-----`;

const OTHER_CERT = `-----BEGIN CERTIFICATE-----
MIIDNzCCAh+gAwIBAgIUP3eWiDfB/4xN6dFB7GVcIRcufIkwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRb3RoZXIuZXhhbXBsZS5jb20wHhcNMjYwODMwMDkzMDUw
WhcNMzYwODI3MDkzMDUwWjAcMRowGAYDVQQDDBFvdGhlci5leGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK6Z0De4ewiK8aSXq8qUvIol
sJM98SM0y0N5uLM1AnOscaVjlvKf+iMQnDcts5iGztZa93Ienf4ckB3PcEJSUZ79
PoBhw6nB65nw7yx/qfgldEKESUrp8mr8piQInKAqAjq0VVkGjMnfyPWqOVsvhUap
85oR99As/LV41WMxvyk4XsqhvgOKRPp52oM04kgyxgbVcJpIHO6HmpHcaMASc8QO
YeJ6/p58e6FYEe8n9PoAYDaStotEVHCngGR++elhi8rja/MPwgUjmYP5poIp6piT
TiP0IbOf/9kTnVKPF2uzt+KFQun+nAXpbLsKygELiXG5t6XmZ1mrZp+34TtFD2EC
AwEAAaNxMG8wHQYDVR0OBBYEFO+VnyflluZ/kE1Wit6/NXgm4GxHMB8GA1UdIwQY
MBaAFO+VnyflluZ/kE1Wit6/NXgm4GxHMA8GA1UdEwEB/wQFMAMBAf8wHAYDVR0R
BBUwE4IRb3RoZXIuZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBAE2CiwgI
O+kAq0P/xlcUY5ADsliaxwEqBAsKMH+qCzPR6d61XjrKstf0teVnDgg1TUti4Nwo
04B5T3acU6kS8Bp1LtJqmAnJZvB45hW8lVep2hvkCCr2YzI0bsekUIIcu2tVOuqF
n3eVZ55255mqn2CFE3eBlYCbWDgC+RMFTIJK14dfqvHjUgGmp79akB3z5uhoGnxq
h5y0jaS/Q1vgm7CS6WUcSXe8qCsi43Lsx/GtckYvdI+yhTecMnfcvVTVofTukHWO
puSSJdBgOlKM8cye375zdDXEusf+e6rDxy+u1QO5uImn/fP7TFb5+V8Gla4ApZeB
niCnqW8IXyc6GmI=
-----END CERTIFICATE-----`;

const OTHER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCumdA3uHsIivGk
l6vKlLyKJbCTPfEjNMtDebizNQJzrHGlY5byn/ojEJw3LbOYhs7WWvdyHp3+HJAd
z3BCUlGe/T6AYcOpweuZ8O8sf6n4JXRChElK6fJq/KYkCJygKgI6tFVZBozJ38j1
qjlbL4VGqfOaEffQLPy1eNVjMb8pOF7Kob4DikT6edqDNOJIMsYG1XCaSBzuh5qR
3GjAEnPEDmHiev6efHuhWBHvJ/T6AGA2kraLRFRwp4BkfvnpYYvK42vzD8IFI5mD
+aaCKeqYk04j9CGzn//ZE51Sjxdrs7fihULp/pwF6Wy7CsoBC4lxubel5mdZq2af
t+E7RQ9hAgMBAAECggEACJvY4lvG5TLvRdhHRiPImrR6XP2EMuIwK3wy7n3B8zDL
dwYkCS54x4XSzf2uNJULrxH+erKmbkMQ8AdXAk4gwXVnFtll1lbou5xfjpLKL0wE
IXYi+aid+pxzwfm9ZJWYVTX9sfgFX7wYTSnpeLotGMDZxqegJQmIJEJ4SFMe7nSe
KFVM7La4q51/yVJ521o2OSoiYP7E+jOnhCElyxKzyolV975R21/gg9vQWuTeRkp3
3BI/Os7lvBkd3FIutngVID5w2S15dSTqjUIVEkmHW696xDrZ0l2cIyVwXCtbp6qC
yu7p/DnJB4xzQMub3jo+rC/9BQykBbOM2c2lpYXBKQKBgQDk+fqJ2reCpsO0PliJ
rMlLaVqYu4jZqjqO5+F/SQ01QyEOtqHTCN9Lv2s7EHcFMzaF+0ujWu36KqKfrtg0
CV4RAIuc1D4P9C27Fk5Nn6rnUFb53t1wxFQGUx66LzfFuP+sYquRzAK/momZohn7
knGuy3Rlh0eo24RIwNjjXXYRZwKBgQDDNP52SMCWF9t8MEtgwR4Jy+B/a049Aqc5
oZUkLdSwwKPDy6W0xbKjn6roZs6h4u74ZlB6knWus1V6gIPVFlnrQ1OM0EGCiRZt
flyf/7VxCyqnG9ETSahPcrZW1iVr+OIC7zXIh6/q5Bm6EcuEtq+mECrsNTMSmhLY
JtHv1I9z9wKBgFWIb6dJNV2vr9FHrMkY60SpQTdmblNovGEfi2OBxVZNEi8t17s+
SDNCeOriVqNxov9fhLyrvdPCU2c05/xgN2xAeOaHfft1qhOF3JAwgaXQo/zI3I1A
OWb3a7X+52WLmq4pWY+n1qr+LkJehDguVxsFUyCN7R3Nilem+h3MjssnAoGAOAt/
A3bf1DgFTCKRgbXwad+fFPY6AEpCuMkriLef2R915UES0lPwdgnhh9f8e34sHiVB
9e8W2pGieQls0EEaj/FEi6k/Jbs2NTmSXl2MOmh6VoAmBuOe7zCAKW5SUC2ktjL3
vhs25rmWqVVymSfaRlNd/3NGtpCF2IlMvQ7KIQECgYEA3SqcfM8mQpdHSviuKHr5
9p3dxgnqX2GPL+D7NkWMhy2o6g8/f3S+DVSEayd3ELaSiGPxCt1YYm+IcMiVGzWG
cPYJ5AEy9MpSvsecMzgi1eo51HlcW59q0WFYbBCEEhGZ3TjbCfLZbqox3mcSs2cz
J8Gp7mKjq6ef9xW/W9JJtLA=
-----END PRIVATE KEY-----`;

// Two small standalone TLS servers stand in for what Traefik would present:
// one server's certificate matches the domain under test (representing an
// issued ACME cert), the other doesn't (representing Traefik's fallback
// cert, or another domain's cert) — this never touches a real network
// domain.
describe('checkTlsCertificate', () => {
  let matchServer: tls.Server;
  let mismatchServer: tls.Server;
  let matchPort: number;
  let mismatchPort: number;

  beforeAll(async () => {
    matchServer = tls.createServer({ cert: MATCH_CERT, key: MATCH_KEY }, (socket) => socket.end());
    mismatchServer = tls.createServer({ cert: OTHER_CERT, key: OTHER_KEY }, (socket) => socket.end());

    await Promise.all([
      new Promise<void>((resolve) => matchServer.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => mismatchServer.listen(0, '127.0.0.1', resolve)),
    ]);

    const matchAddress = matchServer.address();
    const mismatchAddress = mismatchServer.address();
    if (matchAddress === null || typeof matchAddress === 'string' || mismatchAddress === null || typeof mismatchAddress === 'string') {
      throw new Error('expected network addresses');
    }
    matchPort = matchAddress.port;
    mismatchPort = mismatchAddress.port;
  });

  afterAll(() => {
    matchServer.close();
    mismatchServer.close();
  });

  it('reports valid with the certificate expiry when the served cert matches the domain', async () => {
    const result = await checkTlsCertificate('cdn.example.com', { host: '127.0.0.1', port: matchPort });
    expect(result.valid).toBe(true);
    expect(result.validTo?.getFullYear()).toBeGreaterThan(2030);
  });

  it('reports invalid when the served certificate does not match the requested domain', async () => {
    const result = await checkTlsCertificate('cdn.example.com', { host: '127.0.0.1', port: mismatchPort });
    expect(result.valid).toBe(false);
  });

  it('reports invalid when the connection fails outright', async () => {
    const result = await checkTlsCertificate('cdn.example.com', { host: '127.0.0.1', port: 1, timeoutMs: 500 });
    expect(result.valid).toBe(false);
  });
});
