import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api/client';
import { translate, Locale } from '../i18n/translations';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: 'super_admin' | 'accountant' | 'staff';
  permissions: string[];
}

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
}

interface AppState {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  logout: () => Promise<void>;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  dark: boolean;
  toggleDark: () => void;
  can: (perm: string) => boolean;
  toasts: Toast[];
  toast: (text: string, kind?: 'ok' | 'err') => void;
  settings: any;
  setSettings: (s: any) => void;
  refreshSettings: () => Promise<void>;
}

const Ctx = createContext<AppState>(null as any);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('wh_user') || 'null');
    } catch {
      return null;
    }
  });
  const [locale, setLocaleState] = useState<Locale>(() => (localStorage.getItem('wh_locale') as Locale) || 'ar');
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem('wh_theme') === 'dark');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settings, setSettings] = useState<any>(null);

  // refresh user (permissions may change server-side)
  useEffect(() => {
    if (!localStorage.getItem('wh_token')) return;
    api.get('/auth/me')
      .then((r) => {
        setUser(r.data.user);
        localStorage.setItem('wh_user', JSON.stringify(r.data.user));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('wh_locale', locale);
  }, [locale]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('wh_theme', dark ? 'dark' : 'light');
  }, [dark]);

  const refreshSettings = useCallback(async () => {
    try {
      const r = await api.get('/settings');
      setSettings(r.data);
    } catch {}
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // token may already be invalid — proceed with local logout
    }
    localStorage.removeItem('wh_token');
    localStorage.removeItem('wh_user');
    setUser(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      user,
      setUser,
      logout,
      locale,
      setLocale: setLocaleState,
      t: (key: string) => translate(locale, key),
      dark,
      toggleDark: () => setDark((d) => !d),
      can: (perm: string) => !!user && (user.role === 'super_admin' || user.permissions.includes(perm)),
      toasts,
      toast,
      settings,
      setSettings,
      refreshSettings,
    }),
    [user, locale, dark, toasts, settings, toast, logout, refreshSettings]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  return useContext(Ctx);
}

export { errMsg };
