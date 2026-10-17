import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext';
import AppLayout from './components/layout/AppLayout';
import { Spinner } from './components/ui/kit';
import LoginPage from './features/login/LoginPage';
import DashboardPage from './features/dashboard/DashboardPage';
import CustomersPage from './features/customers/CustomersPage';
import CustomerProfilePage from './features/customers/CustomerProfilePage';
import InventoryPage from './features/inventory/InventoryPage';
import WarehouseDetailPage from './features/warehouses/WarehouseDetailPage';
import AssignmentsPage from './features/assignments/AssignmentsPage';
import PaymentsPage from './features/payments/PaymentsPage';
import SuppliersPage from './features/suppliers/SuppliersPage';
import AccountingPage from './features/accounting/AccountingPage';
import ReportsPage from './features/reports/ReportsPage';
import StaffPage from './features/staff/StaffPage';
import AuditPage from './features/audit/AuditPage';
import SettingsPage from './features/settings/SettingsPage';
import ProfilePage from './features/settings/ProfilePage';
import QuickPage from './features/shared/QuickPage';

function Protected({ perm, children }: { perm?: string; children: React.ReactNode }) {
  const { user, can } = useApp();
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm) && user.role !== 'super_admin') {
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">🔒</div>
        <p className="mt-3 font-bold text-slate-500 dark:text-slate-400">
          {can(perm) ? '' : '403 — ' }
          {perm.replace('.', '::')}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function Shell() {
  const { user } = useApp();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Protected perm="dashboard.view"><DashboardPage /></Protected>} />
        <Route path="/customers" element={<Protected perm="customers.view"><CustomersPage /></Protected>} />
        <Route path="/customers/:id" element={<Protected perm="customers.view"><CustomerProfilePage /></Protected>} />
        <Route path="/inventory" element={<Protected perm="inventory.view"><InventoryPage /></Protected>} />
        <Route path="/warehouses/:id" element={<Protected perm="inventory.view"><WarehouseDetailPage /></Protected>} />
        <Route path="/assignments" element={<Protected perm="assignments.view"><AssignmentsPage /></Protected>} />
        <Route path="/payments" element={<Protected perm="payments.view"><PaymentsPage /></Protected>} />
        <Route path="/suppliers" element={<Protected perm="suppliers.view"><SuppliersPage /></Protected>} />
        <Route path="/accounting" element={<Protected perm="accounting.view"><AccountingPage /></Protected>} />
        <Route path="/reports" element={<Protected perm="reports.view"><ReportsPage /></Protected>} />
        <Route path="/staff" element={<Protected perm="staff.view"><StaffPage /></Protected>} />
        <Route path="/audit" element={<Protected perm="audit.view"><AuditPage /></Protected>} />
        <Route path="/settings" element={<Protected perm="settings.view"><SettingsPage /></Protected>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/quick" element={<QuickPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { user } = useApp();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
