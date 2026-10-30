import { KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { DeviceInfo, PublicInfo } from '@agent-hub/shared/client';
import { Button, Card, Field, Spinner, inputCls } from '../components/ui';
import { api, post } from '../lib/api';
import { guessDeviceName } from '../lib/format';
import { useHub } from '../lib/store';

export function PairPage() {
  const navigate = useNavigate();
  const setToken = useHub((s) => s.setToken);
  const existing = useHub((s) => s.token);
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [code] = useState(() => new URLSearchParams(location.hash.slice(1)).get('code') ?? '');
  const [pin, setPin] = useState('');
  const [name, setName] = useState(guessDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PublicInfo>('/api/public/info').then(setInfo).catch(() => undefined);
    if (code) history.replaceState(null, '', '/pair');
  }, [code]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ token: string; device: DeviceInfo }>('/api/pairing/complete', {
        deviceName: name.trim() || guessDeviceName(),
        ...(code ? { code } : { pin }),
      });
      setToken(res.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-5 p-6">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold">Pair with Agent Hub</h1>
            <p className="text-sm text-slate-400">{info ? `on ${info.hostname}` : 'Connecting…'}</p>
          </div>
        </div>
        {existing && (
          <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-200">
            This device is already paired. <Link to="/" className="underline">Open the dashboard</Link>
          </p>
        )}
        <Field label="Name this device">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        {code ? (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Pairing code from QR detected
          </p>
        ) : (
          <Field label="6-digit PIN" hint="Shown on the host computer under Settings → Devices → Pair a new device.">
            <input
              className={`${inputCls} text-center font-mono text-2xl tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        )}
        {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={busy || (!code && pin.length !== 6)} onClick={submit}>
          {busy ? <Spinner /> : <KeyRound className="h-4 w-4" />} Pair this device
        </Button>
        {info?.caFingerprint && (
          <p className="text-xs text-slate-400">
            Verify the hub certificate fingerprint starts with <code className="text-slate-300">{info.caFingerprint.slice(0, 17)}</code>.{' '}
            <Link to="/setup" className="text-blue-200 underline hover:text-white">
              Trust the certificate
            </Link>{' '}
            to enable notifications.
          </p>
        )}
      </Card>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const setToken = useHub((s) => s.setToken);
  const [missing, setMissing] = useState(false);
  // Depends on the hash so a login link opened while already on /login (same-document navigation) still works.
  useEffect(() => {
    const token = new URLSearchParams(hash.slice(1)).get('token');
    if (token) {
      setToken(token);
      history.replaceState(null, '', '/login');
      navigate('/', { replace: true });
    } else {
      setMissing(true);
    }
  }, [hash, navigate, setToken]);
  if (!missing) return null;
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="max-w-md space-y-3 p-6 text-sm text-slate-300">
        <h1 className="text-lg font-semibold text-slate-100">Sign in to Agent Hub</h1>
        <p>
          On the host computer, open the link printed by <code>agent-hub serve</code> (or use the desktop app). On other devices,{' '}
          <Link to="/pair" className="text-blue-200 underline hover:text-white">
            pair with a PIN
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}

export function SetupPage() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    api<PublicInfo>('/api/public/info').then(setInfo).catch(() => undefined);
  }, []);
  const steps: [string, string[]][] = [
    [
      'iPhone / iPad',
      [
        'Open this page in Safari and tap “Download certificate”, then Allow.',
        'Settings → General → VPN & Device Management → Agent Hub Local CA → Install.',
        'Settings → General → About → Certificate Trust Settings → enable full trust for Agent Hub Local CA.',
        'Reload, tap Share → Add to Home Screen, and enable notifications in Settings inside the app.',
      ],
    ],
    [
      'Android',
      [
        'Tap “Download certificate”.',
        'Settings → Security → Encryption & credentials → Install a certificate → CA certificate → pick the file.',
        'Reopen the hub address in Chrome, then use “Install app” from the menu.',
      ],
    ],
    [
      'Windows',
      [
        'Download the certificate and double-click it → Install Certificate → Current User.',
        'Choose “Place all certificates in the following store” → Trusted Root Certification Authorities.',
        'Restart the browser.',
      ],
    ],
    [
      'macOS',
      [
        'Download the certificate and open it in Keychain Access (login keychain).',
        'Double-click “Agent Hub Local CA” → Trust → When using this certificate: Always Trust.',
      ],
    ],
  ];
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
        <h1 className="text-xl font-semibold">Trust the hub on this device</h1>
      </div>
      <p className="text-sm text-slate-400">
        Agent Hub uses a private certificate authority created on {info?.hostname ?? 'the host'}. Installing it lets this device open the hub
        without warnings, install it as an app and receive push notifications. Only install it on devices you own.
      </p>
      <Card className="space-y-2 p-4">
        <a href="/ca.crt" download>
          <Button variant="primary">Download certificate</Button>
        </a>
        <p className="break-all font-mono text-xs text-slate-400">SHA-256 {info?.caFingerprint}</p>
      </Card>
      {steps.map(([title, list]) => (
        <Card key={title} className="p-4">
          <h2 className="mb-2 font-semibold">{title}</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
            {list.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Card>
      ))}
      <Link to="/pair" className="inline-block text-sm text-blue-200 underline hover:text-white">
        Continue to pairing →
      </Link>
    </div>
  );
}
