import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';

export interface TlsMaterial {
  key: string;
  cert: string;
  caCert: string;
  caFingerprint: string;
}

interface StoredLeafMeta {
  hosts: string[];
  notAfter: number;
}

function newKeyPair(): { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey; pem: string } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  const publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  return { privateKey: forgeKey, publicKey, pem };
}

function serial(): string {
  // Positive serial number (leading byte < 0x80).
  return `01${randomBytes(15).toString('hex')}`;
}

function fingerprint(certPem: string): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))).getBytes();
  return createHash('sha256')
    .update(Buffer.from(der, 'binary'))
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');
}

/**
 * Maintains a private local CA plus a server certificate covering localhost, the host name and all
 * LAN addresses. Devices install the CA once so the hub's HTTPS endpoint (needed for PWA install,
 * service workers and push notifications) is trusted.
 */
export function ensureTls(dataDir: string, lanIps: string[]): TlsMaterial {
  const dir = path.join(dataDir, 'tls');
  fs.mkdirSync(dir, { recursive: true });
  const caKeyPath = path.join(dir, 'ca.key');
  const caCertPath = path.join(dir, 'ca.crt');
  const keyPath = path.join(dir, 'server.key');
  const certPath = path.join(dir, 'server.crt');
  const metaPath = path.join(dir, 'server.json');

  const hostname = os.hostname();
  if (!fs.existsSync(caKeyPath) || !fs.existsSync(caCertPath)) {
    const keys = newKeyPair();
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = serial();
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600_000);
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600_000);
    const attrs = [
      { name: 'commonName', value: `Agent Hub Local CA (${hostname})` },
      { name: 'organizationName', value: 'Agent Hub' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    fs.writeFileSync(caKeyPath, keys.pem, { mode: 0o600 });
    fs.writeFileSync(caCertPath, forge.pki.certificateToPem(cert));
    for (const p of [keyPath, certPath, metaPath]) if (fs.existsSync(p)) fs.rmSync(p);
  }
  const caCertPem = fs.readFileSync(caCertPath, 'utf8');

  const hosts = [...new Set(['localhost', '127.0.0.1', hostname, `${hostname}.local`, 'agenthub.local', ...lanIps])].sort();
  let needLeaf = !fs.existsSync(keyPath) || !fs.existsSync(certPath) || !fs.existsSync(metaPath);
  if (!needLeaf) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as StoredLeafMeta;
    const covered = hosts.every((h) => meta.hosts.includes(h));
    needLeaf = !covered || meta.notAfter - Date.now() < 30 * 24 * 3600_000;
  }
  if (needLeaf) {
    const caKey = forge.pki.privateKeyFromPem(fs.readFileSync(caKeyPath, 'utf8'));
    const caCert = forge.pki.certificateFromPem(caCertPem);
    const keys = newKeyPair();
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = serial();
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600_000);
    // Apple platforms reject server certificates valid for more than 398 days.
    cert.validity.notAfter = new Date(Date.now() + 397 * 24 * 3600_000);
    cert.setSubject([{ name: 'commonName', value: `Agent Hub (${hostname})` }]);
    cert.setIssuer(caCert.subject.attributes);
    const altNames = hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? { type: 7, ip: h } : { type: 2, value: h }));
    altNames.push({ type: 7, ip: '::1' } as never);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
      { name: 'subjectKeyIdentifier' },
      { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
    ]);
    cert.sign(caKey, forge.md.sha256.create());
    fs.writeFileSync(keyPath, keys.pem, { mode: 0o600 });
    fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
    fs.writeFileSync(metaPath, JSON.stringify({ hosts, notAfter: cert.validity.notAfter.getTime() } satisfies StoredLeafMeta));
  }

  return {
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8') + caCertPem,
    caCert: caCertPem,
    caFingerprint: fingerprint(caCertPem),
  };
}
