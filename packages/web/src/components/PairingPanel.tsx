import { QrCode, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PairingTicket } from '@agent-hub/shared/client';
import { del, post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { NetworkCheck } from './NetworkCheck';
import { Button, Spinner } from './ui';

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
          {busy ? <Spinner /> : <QrCode className="h-4 w-4" />} Pair a new device
        </Button>
        <p className="text-xs text-slate-400">
          The device must be on the same network. You will get a QR code and a 6-digit PIN valid for 5 minutes.
        </p>
      </div>
    );
  }

  const link = ticket.links[index];
  return (
    <div className="glass-inset space-y-3 rounded-3xl !border-blue-300/25 bg-blue-400/[0.05] p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Scan with the device you want to pair</p>
        <button
          className="rounded p-1 text-slate-400 hover:bg-white/[0.08]"
          aria-label="Cancel pairing"
          onClick={() => {
            setTicket(null);
            void del('/api/pairing').catch(() => undefined);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {link ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <img src={link.qrDataUrl} alt="Pairing QR code" className="h-56 w-56 rounded-lg bg-white p-2" />
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">Or open this address and enter the PIN</p>
              <code className="break-all text-blue-100">{link.url.split('#')[0]}</code>
            </div>
            <div>
              <p className="text-xs text-slate-400">PIN</p>
              <p className="font-mono text-3xl font-bold tracking-[0.3em] text-slate-50">{ticket.pin}</p>
            </div>
            <p className="text-xs text-slate-400">Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>
            {ticket.links.length > 1 && (
              <div className="space-y-1">
                <p className="text-xs text-slate-400">Wrong network? Try another address:</p>
                <div className="flex flex-wrap gap-1">
                  {ticket.links.map((l, i) => (
                    <button
                      key={l.url}
                      onClick={() => setIndex(i)}
                      className={`rounded px-2 py-0.5 font-mono text-xs ${i === index ? 'bg-blue-500/80 text-white ring-1 ring-blue-300/50' : 'bg-white/[0.08] text-slate-300 hover:bg-white/[0.14]'}`}
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
        <p className="text-sm text-amber-300">No LAN address found. Connect this computer to a network and try again.</p>
      )}
      {server?.caFingerprint && (
        <p className="text-xs text-slate-400">
          First time? The device will warn about the certificate. For notifications and app install, open <code>/setup</code> on the device
          to install the hub certificate (fingerprint {server.caFingerprint.slice(0, 23)}…).
        </p>
      )}
      <NetworkCheck />
    </div>
  );
}
