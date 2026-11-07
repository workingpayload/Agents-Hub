import { QrCodeIcon, XIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import type { PairingTicket } from '@agent-hub/shared/client';
import { del, post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { NetworkCheck } from './NetworkCheck';
import { Button, Dots, pressable } from './ui';

/** Shows a QR code + PIN that a phone/tablet/laptop on the LAN can use to pair with the hub. */
export function PairingPanel() {
  const server = useHub((s) => s.server);
  const [ticket, setTicket] = useState<PairingTicket | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!ticket) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticket]);

  const start = async () => {
    setBusy(true);
    try {
      setTicket(await post<PairingTicket>('/api/pairing/start'));
      setIndex(0);
    } catch (err) {
      toastError(err, 'Could not start pairing');
    } finally {
      setBusy(false);
    }
  };

  const remaining = ticket ? Math.max(0, Math.round((ticket.expiresAt - now) / 1000)) : 0;
  if (!ticket || remaining === 0) {
    return (
      <div className="space-y-2">
        <Button variant="primary" onClick={start} disabled={busy}>
          {busy ? <Dots label="Starting pairing" /> : <QrCodeIcon className="h-4 w-4" />} Pair a new device
        </Button>
        <p className="caption-2 text-neutral-400">
          The device must be on the same network. You will get a QR code and a six digit PIN valid for 5 minutes.
        </p>
      </div>
    );
  }

  const link = ticket.links[index];
  return (
    <div className="surface-inset animate-rise space-y-4 rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="title-3 text-white">Scan with the device you want to pair</p>
        <button
          className={clsx('rounded-lg p-2 text-neutral-400 hover:bg-surface-3 hover:text-white', pressable)}
          aria-label="Cancel pairing"
          onClick={() => {
            setTicket(null);
            void del('/api/pairing').catch(() => undefined);
          }}
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      {link ? (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <img src={link.qrDataUrl} alt="Pairing QR code" width={224} height={224} className="h-56 w-56 rounded-xl bg-white p-2" />
          <div className="body-6 space-y-4">
            <div className="space-y-1">
              <p className="caption-2 text-neutral-400">Or open this address and enter the PIN</p>
              <code className="break-all font-mono text-neutral-100">{link.url.split('#')[0]}</code>
            </div>
            <div className="space-y-1">
              <p className="caption-2 text-neutral-400">PIN</p>
              <p className="heading-4 font-mono tracking-widest text-white">{ticket.pin}</p>
            </div>
            <p className="caption-2 text-neutral-400">
              Expires in{' '}
              <span className="font-mono tabular-nums">
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </span>
            </p>
            {ticket.links.length > 1 && (
              <div className="space-y-2">
                <p className="caption-2 text-neutral-400">Wrong network? Try another address:</p>
                <div className="flex flex-wrap gap-1">
                  {ticket.links.map((l, i) => (
                    <button
                      key={l.url}
                      aria-pressed={i === index}
                      onClick={() => setIndex(i)}
                      className={clsx(
                        'caption-3 rounded-lg px-2 py-1 font-mono',
                        pressable,
                        i === index ? 'bg-white text-black' : 'bg-surface-3 text-neutral-200 hover:bg-surface-4',
                      )}
                    >
                      {new URL(l.url).hostname}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="body-6 text-amber-300">No local network address found. Connect this computer to a network and try again.</p>
      )}
      {server?.caFingerprint && (
        <p className="caption-2 text-neutral-400">
          First time? The device will warn about the certificate. For notifications and app install, open <code className="font-mono">/setup</code> on
          the device to install the hub certificate (fingerprint <span className="font-mono">{server.caFingerprint.slice(0, 23)}…</span>).
        </p>
      )}
      <NetworkCheck />
    </div>
  );
}
