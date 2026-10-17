import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, Users, PackageSearch, Wallet, Landmark, BarChart3, UserCog,
  ScrollText, Settings as SettingsIcon, Menu, X, Moon, Sun, Languages, LogOut, Search,
  Plus, ChevronRight, ChevronLeft, User, Factory,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api, errMsg } from '../../api/client';
import { Badge, Toasts } from '../ui/kit';

interface NavItem {
  path: string;
  labelKey: string;
  icon: React.ElementType;
  perm?: string;
}

const NAV: NavItem[] = [
  { path: '/', labelKey: 'nav_dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
  { path: '/customers', labelKey: 'nav_customers', icon: Users, perm: 'customers.view' },
  { path: '/inventory', labelKey: 'nav_inventory', icon: Boxes, perm: 'inventory.view' },
  { path: '/assignments', labelKey: 'nav_assignments', icon: PackageSearch, perm: 'assignments.view' },
  { path: '/payments', labelKey: 'nav_payments', icon: Wallet, perm: 'payments.view' },
  { path: '/suppliers', labelKey: 'nav_suppliers', icon: Factory, perm: 'suppliers.view' },
  { path: '/accounting', labelKey: 'nav_accounting', icon: Landmark, perm: 'accounting.view' },
  { path: '/reports', labelKey: 'nav_reports', icon: BarChart3, perm: 'reports.view' },
  { path: '/staff', labelKey: 'nav_staff', icon: UserCog, perm: 'staff.view' },
  { path: '/audit', labelKey: 'nav_audit', icon: ScrollText, perm: 'audit.view' },
  { path: '/settings', labelKey: 'nav_settings', icon: SettingsIcon, perm: 'settings.view' },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, t, can, locale, settings } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.perm || can(n.perm) || user?.role === 'super_admin');
  const companyName = locale === 'ar' ? settings?.company_name : settings?.company_name_en;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-lg font-black text-white shadow-md">
          {locale === 'ar' ? 'م' : 'W'}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-slate-900 dark:text-white">{companyName || t('app_name')}</div>
          <div className="truncate text-[11px] text-slate-400">{t('app_name')}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {items.map((n) => {
          const active = n.path === '/' ? location.pathname === '/' : location.pathname.startsWith(n.path);
          return (
            <button
              key={n.path}
              onClick={() => {
                navigate(n.path);
                onNavigate?.();
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
                active
                  ? 'bg-primary-600 text-white shadow-md shadow-primary-600/25'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              }`}
            >
              <n.icon size={18} strokeWidth={2.2} />
              {t(n.labelKey)}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
        <button
          onClick={() => {
            navigate('/profile');
            onNavigate?.();
          }}
          className="flex w-full items-center gap-3 rounded-xl p-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-sm font-black text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
            {user?.name?.trim()?.[0] || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{user?.name}</div>
            <div className="truncate text-[11px] text-slate-400">{t(`role_${user?.role}`)}</div>
          </div>
        </button>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const { t, can, locale } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const id = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`).then((r) => {
        setResults(r.data);
        setOpen(true);
      });
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={boxRef} className="relative hidden flex-1 max-w-md md:block">
      <Search size={16} className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder={t('search')}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 ps-9 pe-3 text-sm text-slate-800 placeholder-slate-400 focus:border-primary-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      {open && results && (results.customers?.length || results.items?.length) ? (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          {results.customers?.map((c: any) => (
            <button
              key={c.id}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => {
                navigate(`/customers/${c.id}`);
                setOpen(false);
                setQ('');
              }}
            >
              <Users size={14} className="text-primary-500" />
              <span className="font-semibold text-slate-700 dark:text-slate-200">{c.name}</span>
              <span className="text-xs text-slate-400" dir="ltr">{c.phone}</span>
            </button>
          ))}
          {results.items?.map((i: any) => (
            <button
              key={i.id}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => {
                navigate('/inventory');
                setOpen(false);
                setQ('');
              }}
            >
              <Boxes size={14} className="text-emerald-500" />
              <span className="font-semibold text-slate-700 dark:text-slate-200">{locale === 'ar' && i.name_ar ? i.name_ar : i.name}</span>
              <span className="text-xs text-slate-400" dir="ltr">{i.sku}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AppLayout() {
  const { t, locale, setLocale, dark, toggleDark, logout, user, can } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);

  const mobileNav = NAV.filter((n) => !n.perm || can(n.perm) || user?.role === 'super_admin').slice(0, 5);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar (start side: right in RTL, left in LTR) */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-white shadow-2xl dark:bg-slate-900">
            <button onClick={() => setDrawer(false)} className="absolute top-4 end-3 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={18} />
            </button>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="lg:ms-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-5">
          <button className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden" onClick={() => setDrawer(true)}>
            <Menu size={20} />
          </button>
          <GlobalSearch />
          <div className="flex-1 md:hidden" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Language"
            >
              <Languages size={17} />
              {locale === 'ar' ? 'EN' : 'ع'}
            </button>
            <button onClick={toggleDark} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Theme">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="relative">
              <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-black text-white">
                  {user?.name?.trim()?.[0] || 'U'}
                </div>
                <span className="hidden max-w-28 truncate text-xs font-bold text-slate-700 dark:text-slate-200 sm:block">{user?.name}</span>
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                  <div className="absolute z-40 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900 end-0">
                    <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                      <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{user?.name}</div>
                      <Badge color={user?.role === 'super_admin' ? 'violet' : user?.role === 'accountant' ? 'blue' : 'slate'}>
                        {t(`role_${user?.role}`)}
                      </Badge>
                    </div>
                    <button
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                      onClick={() => {
                        setMenu(false);
                        navigate('/profile');
                      }}
                    >
                      <User size={15} /> {t('nav_profile')}
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                      onClick={async () => {
                        await logout();
                        navigate('/login');
                      }}
                    >
                      <LogOut size={15} /> {t('logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-3 pb-24 sm:p-5 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden">
        {mobileNav.map((n) => {
          const active = n.path === '/' ? location.pathname === '/' : location.pathname.startsWith(n.path);
          return (
            <button
              key={n.path}
              onClick={() => navigate(n.path)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`}
            >
              <n.icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span className="max-w-16 truncate">{t(n.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Floating quick action (mobile) */}
      {(can('customers.create') || can('payments.create') || can('assignments.create')) && (
        <button
          onClick={() => navigate('/quick')}
          className="fixed bottom-20 end-4 z-30 flex h-13 w-13 items-center justify-center rounded-full bg-primary-600 p-3.5 text-white shadow-xl shadow-primary-600/40 transition active:scale-95 lg:hidden"
          title={t('quick_actions')}
        >
          <Plus size={22} />
        </button>
      )}

      <Toasts />
    </div>
  );
}
