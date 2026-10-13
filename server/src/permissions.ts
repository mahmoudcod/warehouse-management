/**
 * Central permission model. The same constants drive:
 *  - server-side enforcement (middleware)
 *  - the staff-management permission matrix UI
 *  - the client's effective permission set (returned by /api/auth/me)
 */

export const MODULES = [
  'dashboard',
  'inventory',
  'customers',
  'assignments',
  'payments',
  'accounting',
  'reports',
  'staff',
  'settings',
  'audit',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve'] as const;
export type ActionKey = (typeof ACTIONS)[number];

export type Permission = string; // "module.action"

export const MODULE_LABELS: Record<ModuleKey, { en: string; ar: string }> = {
  dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
  inventory: { en: 'Inventory / Devices', ar: 'المخزون / الأجهزة' },
  customers: { en: 'Customers', ar: 'العملاء' },
  assignments: { en: 'Assignments (Devices Taken)', ar: 'التوريدات (أجهزة لدى العملاء)' },
  payments: { en: 'Payments', ar: 'المدفوعات' },
  accounting: { en: 'Accounting', ar: 'الحسابات' },
  reports: { en: 'Reports', ar: 'التقارير' },
  staff: { en: 'Staff Management', ar: 'إدارة الموظفين' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  audit: { en: 'Audit Log', ar: 'سجل التدقيق' },
};

/** Granular extras that are not plain module.action pairs. */
export const EXTRA_PERMISSIONS: { key: string; en: string; ar: string }[] = [
  {
    key: 'customers.view_financials',
    en: 'View financial totals & balances',
    ar: 'عرض الإجماليات المالية والأرصدة',
  },
  { key: 'data.own_only', en: 'View only own records', ar: 'عرض السجلات التي أنشأها فقط' },
];

export function allModulePermissions(): Permission[] {
  const out: Permission[] = [];
  for (const m of MODULES) for (const a of ACTIONS) out.push(`${m}.${a}`);
  return out;
}

/** Built-in permission set for the accountant role. */
export const ACCOUNTANT_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'accounting.view',
  'accounting.create',
  'accounting.edit',
  'accounting.export',
  'customers.view',
  'customers.view_financials',
  'customers.export',
  'payments.view',
  'payments.export',
  'reports.view',
  'reports.export',
];

/** Ready-made templates the Super Admin can apply then tweak. */
export const PERMISSION_TEMPLATES: Record<string, { en: string; ar: string; permissions: Permission[] }> = {
  storekeeper: {
    en: 'Storekeeper',
    ar: 'أمين مخزن',
    permissions: [
      'dashboard.view',
      'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.export',
      'customers.view', 'customers.create', 'customers.view_financials',
      'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.export',
      'reports.view', 'reports.export',
    ],
  },
  sales: {
    en: 'Sales',
    ar: 'مبيعات',
    permissions: [
      'dashboard.view',
      'inventory.view', 'inventory.export',
      'customers.view', 'customers.create', 'customers.edit', 'customers.view_financials', 'customers.export',
      'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.export',
      'payments.view', 'payments.create', 'payments.edit', 'payments.export',
      'reports.view', 'reports.export',
    ],
  },
  supervisor: {
    en: 'Supervisor',
    ar: 'مشرف',
    permissions: [
      'dashboard.view', 'dashboard.export',
      'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.export',
      'customers.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.view_financials', 'customers.export',
      'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.delete', 'assignments.approve', 'assignments.export',
      'payments.view', 'payments.create', 'payments.edit', 'payments.delete', 'payments.approve', 'payments.export',
      'accounting.view', 'accounting.export',
      'reports.view', 'reports.export',
    ],
  },
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: 'super_admin' | 'accountant' | 'staff';
  is_active: boolean;
  permissions: Permission[];
}

/** Effective permissions by role: super_admin = everything, accountant = fixed set, staff = stored rows. */
export function effectivePermissions(role: AuthUser['role'], stored: Permission[]): Permission[] {
  if (role === 'super_admin') return [...allModulePermissions(), ...EXTRA_PERMISSIONS.map((e) => e.key)];
  if (role === 'accountant') return [...ACCOUNTANT_PERMISSIONS];
  return stored;
}

export function hasPermission(user: AuthUser, perm: Permission): boolean {
  return user.permissions.includes(perm);
}
