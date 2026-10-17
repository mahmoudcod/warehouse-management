/** Client copy of the server permission model (kept in sync; used by the matrix UI). */

export const MODULES = ['dashboard', 'inventory', 'customers', 'assignments', 'payments', 'suppliers', 'accounting', 'reports', 'staff', 'settings', 'audit'] as const;
export type ModuleKey = (typeof MODULES)[number];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve'] as const;
export type ActionKey = (typeof ACTIONS)[number];

export const MODULE_LABELS: Record<ModuleKey, { en: string; ar: string }> = {
  dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
  inventory: { en: 'Inventory / Devices', ar: 'المخزون / الأجهزة' },
  customers: { en: 'Customers', ar: 'العملاء' },
  assignments: { en: 'Assignments (Devices Taken)', ar: 'التوريدات (أجهزة لدى العملاء)' },
  payments: { en: 'Payments', ar: 'المدفوعات' },
  suppliers: { en: 'Suppliers & Purchases', ar: 'الموردون والمشتريات' },
  accounting: { en: 'Accounting', ar: 'الحسابات' },
  reports: { en: 'Reports', ar: 'التقارير' },
  staff: { en: 'Staff Management', ar: 'إدارة الموظفين' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  audit: { en: 'Audit Log', ar: 'سجل التدقيق' },
};

export const EXTRA_PERMISSIONS: { key: string; en: string; ar: string }[] = [
  { key: 'customers.view_financials', en: 'View financial totals & balances', ar: 'عرض الإجماليات المالية والأرصدة' },
  { key: 'data.own_only', en: 'View only own records', ar: 'عرض السجلات التي أنشأها فقط' },
];

export const PERMISSION_TEMPLATES: Record<string, { en: string; ar: string; permissions: string[] }> = {
  storekeeper: {
    en: 'Storekeeper',
    ar: 'أمين مخزن',
    permissions: [
      'dashboard.view',
      'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.export',
      'customers.view', 'customers.create', 'customers.view_financials',
      'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.export',
      'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.export',
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
      'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete', 'suppliers.approve', 'suppliers.export',
      'reports.view', 'reports.export',
    ],
  },
};
