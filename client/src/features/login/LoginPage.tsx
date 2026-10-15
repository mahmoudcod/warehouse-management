import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn, Languages, Moon, Sun, Boxes, KeyRound } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Button, Input, Field, Modal, Toasts } from '../../components/ui/kit';
import { AuthUser } from '../../context/AppContext';

export default function LoginPage() {
  const { t, locale, setLocale, dark, toggleDark, setUser, toast } = useApp();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [forgot, setForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api.post('/auth/login', { identifier: identifier.trim(), password });
      localStorage.setItem('wh_token', r.data.token);
      localStorage.setItem('wh_user', JSON.stringify(r.data.user));
      setUser(r.data.user as AuthUser);
      navigate('/');
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      toast(t('reset_link_sent'));
      setForgot(false);
    } catch (e2) {
      toast(errMsg(e2), 'err');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 via-slate-100 to-primary-100 p-4 dark:from-slate-950 dark:via-slate-900 dark:to-primary-950/60">
      <div className="absolute top-4 end-4 flex gap-1">
        <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-xl bg-white/80 p-2.5 text-slate-600 shadow-sm backdrop-blur dark:bg-slate-800/80 dark:text-slate-300">
          <Languages size={17} />
        </button>
        <button onClick={toggleDark} className="rounded-xl bg-white/80 p-2.5 text-slate-600 shadow-sm backdrop-blur dark:bg-slate-800/80 dark:text-slate-300">
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>

      <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 md:grid md:grid-cols-2">
        {/* Brand side */}
        <div className="hidden flex-col justify-between bg-gradient-to-br from-primary-600 to-primary-800 p-10 text-white md:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black backdrop-blur">م</div>
            <div>
              <div className="text-lg font-extrabold">{t('app_name')}</div>
              <div className="text-xs text-primary-200">Warehouse Management System</div>
            </div>
          </div>
          <div className="space-y-4">
            <Boxes size={44} strokeWidth={1.4} className="text-primary-200" />
            <p className="text-xl font-bold leading-relaxed">
              {locale === 'ar'
                ? 'إدارة كاملة للمخزون والعملاء والأجهزة المأخوذة والتحصيلات والحسابات — في مكان واحد.'
                : 'Complete control of inventory, customers, devices taken, collections and accounting — in one place.'}
            </p>
          </div>
          <div className="text-xs text-primary-200">© 2026 Moaz AIR</div>
        </div>

        {/* Form side */}
        <div className="p-7 sm:p-10">
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t('login_title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('login_sub')}</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field label={t('email_or_phone')} required>
              <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} dir="ltr" autoComplete="username" required />
            </Field>
            <Field label={t('password')} required>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            {err && <div className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">{err}</div>}
            <Button type="submit" size="lg" disabled={busy} className="w-full" icon={LogIn}>
              {busy ? t('loading') : t('login')}
            </Button>
          </form>

          <button onClick={() => setForgot(true)} className="mt-4 flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:underline dark:text-primary-400">
            <KeyRound size={13} /> {t('forgot_password')}
          </button>

          <div className="mt-7 rounded-2xl bg-slate-50 p-4 text-xs dark:bg-slate-800/60">
            <div className="mb-2 font-extrabold text-slate-600 dark:text-slate-300">{t('demo_accounts')}</div>
            {[
              ['admin@warehouse.local', 'Admin@123', t('role_super_admin')],
              ['accountant@warehouse.local', 'Accountant@123', t('role_accountant')],
              ['manager@warehouse.local', 'Manager@123', t('role_staff')],
            ].map(([em, pw, role]) => (
              <button
                key={em}
                type="button"
                onClick={() => {
                  setIdentifier(em);
                  setPassword(pw);
                }}
                className="mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-white dark:hover:bg-slate-700"
                dir="ltr"
              >
                <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{em}</span>
                <span className="font-mono text-[11px] text-slate-400">{pw}</span>
                <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400">{role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Modal open={forgot} onClose={() => setForgot(false)} title={t('reset_password')}>
        <Field label={t('email_or_phone')} required>
          <Input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} dir="ltr" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setForgot(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={sendReset}>{t('send_reset_link')}</Button>
        </div>
      </Modal>
      <Toasts />
    </div>
  );
}
