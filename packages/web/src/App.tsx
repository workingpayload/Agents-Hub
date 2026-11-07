import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { NotifyPayload } from '@agent-hub/shared/client';
import { Layout } from './components/Layout';
import { Toasts } from './components/Toasts';
import { EmptyState } from './components/ui';
import { desktopBridge, isDesktopShell } from './lib/format';
import { useHub } from './lib/store';
import { hubSocket } from './lib/ws';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { Dashboard } from './pages/Dashboard';
import { LoginPage, PairPage, SetupPage } from './pages/PublicPages';
import { SessionPage } from './pages/SessionPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';

function useNotifications() {
  const navigate = useNavigate();
  useEffect(() => {
    useHub.setState({
      onNotify: (n: NotifyPayload) => {
        const state = useHub.getState();
        const visible = document.visibilityState === 'visible' && document.hasFocus();
        // Skip the toast when the user is already looking at the session it refers to.
        const viewingTarget = visible && Boolean(n.url) && location.pathname === n.url;
        if (!viewingTarget) {
          state.toast({
            tone: n.kind === 'error' ? 'error' : n.kind === 'permission' ? 'warn' : 'info',
            title: n.title,
            body: n.body,
            url: n.url,
          });
        }
        // The desktop shell has no push service; use native notifications when the window is in the background.
        if (isDesktopShell() && !visible && 'Notification' in window && Notification.permission !== 'denied') {
          const show = () => {
            const notification = new Notification(n.title, { body: n.body, tag: n.tag, icon: '/icons/icon-192.png' });
            notification.onclick = () => {
              window.focus();
              if (n.url) navigate(n.url);
            };
          };
          if (Notification.permission === 'granted') show();
          else void Notification.requestPermission().then((p) => p === 'granted' && show());
          if (n.kind === 'permission') desktopBridge()?.flash();
        }
      },
    });
    const onNavigate = (e: Event) => navigate((e as CustomEvent<string>).detail);
    window.addEventListener('agent-hub:navigate', onNavigate);
    return () => window.removeEventListener('agent-hub:navigate', onNavigate);
  }, [navigate]);

  const pending = useHub((s) => Object.keys(s.permissions).length);
  useEffect(() => {
    desktopBridge()?.setBadge(pending);
    document.title = pending ? `(${pending}) Agent Hub` : 'Agent Hub';
  }, [pending]);
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl pt-16">
      <EmptyState
        icon={<span className="heading-6 font-mono">404</span>}
        title="This page doesn't exist"
        action={
          <Link to="/" className="button-sm inline-flex rounded-xl bg-white px-3 py-2 text-black transition-colors duration-300 hover:bg-neutral-200">
            Back to your agents
          </Link>
        }
      >
        The link may be old, or the session it pointed to was deleted.
      </EmptyState>
    </div>
  );
}

function Authenticated() {
  const token = useHub((s) => s.token);
  useNotifications();
  useEffect(() => {
    if (!token) return;
    hubSocket.restart();
    return () => hubSocket.stop();
  }, [token]);
  if (!token) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return <Navigate to={local ? '/login' : '/pair'} replace />;
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/pair" element={<PairPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/*" element={<Authenticated />} />
      </Routes>
      <Toasts />
    </>
  );
}
