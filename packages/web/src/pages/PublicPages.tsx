import { ArrowRightIcon, DownloadSimpleIcon, KeyIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { DeviceInfo, PublicInfo } from '@agent-hub/shared/client';
import { Button, Card, Dots, Field, Reveal, inputCls, pressable } from '../components/ui';
import { api, post } from '../lib/api';
import { guessDeviceName } from '../lib/format';
import { useHub } from '../lib/store';

function Brand({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
      <div className="min-w-0">
        <h1 className="heading-5 text-white">{title}</h1>
        {subtitle && <p className="body-6 text-neutral-400">{subtitle}</p>}
      </div>
    </div>
  );
}

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
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <Card className="animate-rise w-full max-w-md space-y-6 p-6">
        <Brand title="Pair with Agent Hub" subtitle={info ? `On ${info.hostname}` : 'Connecting…'} />
        {existing && (
          <p className="surface-inset body-6 rounded-xl p-3 text-emerald-300">
            This device is already paired.{' '}
            <Link to="/" className="link">
              Open the dashboard
            </Link>
          </p>
        )}
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name this device">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          {code ? (
            <p className="body-6 flex items-center gap-2 text-neutral-300">
              <ShieldCheckIcon className="h-4 w-4 text-emerald-400" /> Pairing code from QR detected
            </p>
          ) : (
            <Field label="Six digit PIN" hint="Shown on the host computer under Settings → Devices → Pair a new device.">
              <input
                className={clsx(inputCls, 'heading-5 text-center font-mono tracking-widest sm:heading-5')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={pin}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'pair-error' : undefined}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          )}
          {error && (
            <p id="pair-error" role="alert" className="body-6 text-red-300">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || (!code && pin.length !== 6)}>
            {busy ? <Dots label="Pairing" /> : <KeyIcon className="h-5 w-5" />} Pair this device
          </Button>
        </form>
        {info?.caFingerprint && (
          <p className="caption-4 text-neutral-400">
            Check that the hub certificate fingerprint starts with <code className="font-mono text-neutral-200">{info.caFingerprint.slice(0, 17)}</code>.{' '}
            <Link to="/setup" className="link">
              Trust the certificate
            </Link>{' '}
            to turn on notifications.
          </p>
        )}
      </Card>
    </main>
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
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <Card className="animate-rise w-full max-w-md space-y-4 p-6">
        <Brand title="Sign in to Agent Hub" />
        <p className="body-6 text-neutral-300">
          On the host computer, open the link printed by <code className="font-mono">agent-hub serve</code>, or use the desktop app. On other devices,{' '}
          <Link to="/pair" className="link">
            pair with a PIN
          </Link>
          .
        </p>
      </Card>
    </main>
  );
}

export function SetupPage() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    api<PublicInfo>('/api/public/info').then(setInfo).catch(() => undefined);
  }, []);
  const steps: [string, string[]][] = [
    [
      'iPhone and iPad',
      [
        'Open this page in Safari and tap “Download certificate”, then Allow.',
        'Settings → General → VPN & Device Management → Agent Hub Local CA → Install.',
        'Settings → General → About → Certificate Trust Settings → turn on full trust for Agent Hub Local CA.',
        'Reload, tap Share → Add to Home Screen, and turn on notifications in Settings inside the app.',
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
        'Download the certificate and double click it → Install Certificate → Current User.',
        'Choose “Place all certificates in the following store” → Trusted Root Certification Authorities.',
        'Restart the browser.',
      ],
    ],
    [
      'macOS',
      [
        'Download the certificate and open it in Keychain Access (login keychain).',
        'Double click “Agent Hub Local CA” → Trust → When using this certificate: Always Trust.',
      ],
    ],
  ];
  return (
    <main id="main" className="mx-auto max-w-2xl space-y-8 px-4 py-16">
      <div className="animate-rise space-y-4">
        <Brand title="Trust the hub on this device" />
        <p className="body-5 text-neutral-300">
          Agent Hub uses a private certificate authority created on {info?.hostname ?? 'the host'}. Installing it lets this device open the hub
          without warnings, install it as an app and receive push notifications. Only install it on devices you own.
        </p>
        <Card className="space-y-3 p-4">
          <a
            href="/ca.crt"
            download
            className={clsx('button-sm inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-black hover:bg-neutral-200', pressable)}
          >
            <DownloadSimpleIcon className="h-4 w-4" /> Download certificate
          </a>
          <p className="caption-4 break-all font-mono text-neutral-400">SHA-256 {info?.caFingerprint}</p>
        </Card>
      </div>
      {steps.map(([title, list]) => (
        <Reveal key={title} as="section" aria-label={title}>
          <Card className="space-y-3 p-4">
            <h2 className="title-2 text-white">{title}</h2>
            <ol className="body-6 list-decimal space-y-2 pl-6 text-neutral-300">
              {list.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Card>
        </Reveal>
      ))}
      <Link to="/pair" className="link button-sm inline-flex items-center gap-2">
        Continue to pairing <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </main>
  );
}
