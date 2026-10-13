import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, Field, Input, PageHeader } from '../../components/ui/kit';

export default function ProfilePage() {
  const { t, user, logout, toast } = useApp();
  const navigate = useNavigate();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');

  const change = async () => {
    if (nw.length < 8) return toast(t('required_field'), 'err');
    if (nw !== nw2) return toast(t('required_field'), 'err');
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: nw });
      toast(t('password_changed_ok'));
      setCur('');
      setNw('');
      setNw2('');
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  return (
    <>
      <PageHeader title={t('nav_profile')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 text-xl font-black text-white">
              {user?.name?.trim()?.[0] || 'U'}
            </div>
            <div>
              <div className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{user?.name}</div>
              <div className="text-xs text-slate-400" dir="ltr">{user?.email}</div>
              <Badge color={user?.role === 'super_admin' ? 'violet' : user?.role === 'accountant' ? 'blue' : 'slate'}>{t(`role_${user?.role}`)}</Badge>
            </div>
          </div>
          {user?.role === 'staff' && (
            <div>
              <div className="mb-2 text-xs font-bold text-slate-400">{t('permissions')} ({user.permissions.length})</div>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {user.permissions.map((p) => (
                  <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400" dir="ltr">{p}</span>
                ))}
              </div>
            </div>
          )}
          <Button
            variant="danger"
            icon={LogOut}
            className="mt-5"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            {t('logout')}
          </Button>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">
            <KeyRound size={15} /> {t('change_password')}
          </h3>
          <div className="space-y-4">
            <Field label={t('current_password')} required>
              <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} dir="ltr" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('new_password')} required>
                <Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} dir="ltr" />
              </Field>
              <Field label={t('new_password')} required>
                <Input type="password" value={nw2} onChange={(e) => setNw2(e.target.value)} dir="ltr" />
              </Field>
            </div>
            <Button onClick={change}>{t('save')}</Button>
          </div>
        </Card>
      </div>
    </>
  );
}
