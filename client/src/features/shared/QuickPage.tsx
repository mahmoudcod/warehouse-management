import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, PlusCircle, Wallet, Truck, Landmark } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button, Card, PageHeader } from '../../components/ui/kit';
import { RecordTakenModal, RecordPaymentModal } from '../shared/forms';

/** Mobile floating-action target: hub of quick actions. */
export default function QuickPage() {
  const { t, can } = useApp();
  const navigate = useNavigate();
  const [takenOpen, setTakenOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const actions = [
    can('customers.create') && { icon: UserPlus, label: t('quick_add_customer'), go: () => navigate('/customers?new=1') },
    can('inventory.create') && { icon: PlusCircle, label: t('quick_add_device'), go: () => navigate('/inventory?new=1') },
    can('assignments.create') && { icon: Truck, label: t('record_taken'), go: () => setTakenOpen(true) },
    can('payments.create') && { icon: Wallet, label: t('record_payment'), go: () => setPayOpen(true) },
    can('accounting.create') && { icon: Landmark, label: t('quick_record_tx'), go: () => navigate('/accounting?new=1') },
  ].filter(Boolean) as { icon: React.ElementType; label: string; go: () => void }[];

  return (
    <>
      <PageHeader title={t('quick_actions')} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {actions.map((a, i) => (
          <Card key={i} className="p-0">
            <button onClick={a.go} className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl p-4 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 active:scale-[.98] dark:text-slate-300 dark:hover:bg-slate-800">
              <a.icon size={26} className="text-primary-500" />
              {a.label}
            </button>
          </Card>
        ))}
      </div>
      <RecordTakenModal open={takenOpen} onClose={() => setTakenOpen(false)} />
      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)} />
    </>
  );
}
