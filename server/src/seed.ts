import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {
  connectDB, mongoose, Sequence, Setting, User, Customer, Category, Warehouse, Item,
  ItemUnit, StockMovement, Assignment, Payment, Transaction, Account, TransactionCategory,
  ClosedPeriod, DailyClose, InstallmentPlan, InstallmentSchedule, AuditLog, PasswordReset,
  createWithId, nextSequence, withTransaction, r2,
} from './db';
import { PERMISSION_TEMPLATES } from './permissions';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const COLLECTIONS = [
  User, Customer, Category, Warehouse, Item, ItemUnit, StockMovement, Assignment, Payment,
  Account, TransactionCategory, Transaction, ClosedPeriod, DailyClose,
  InstallmentPlan, InstallmentSchedule, AuditLog, PasswordReset,
];

async function seed() {
  await connectDB();

  const existing = await User.countDocuments({ deleted_at: null });
  if (existing > 0 && !process.env.FORCE) {
    console.log('Database already seeded — skipping (set FORCE=1 to reseed).');
    await mongoose.disconnect();
    return;
  }
  if (process.env.FORCE) {
    for (const c of COLLECTIONS) await (c as any).deleteMany({});
    await Setting.deleteMany({});
    await Sequence.deleteMany({});
    console.log('FORCE: collections cleared.');
  }

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  await Setting.updateOne({ id: 1 }, { $setOnInsert: { id: 1 } }, { upsert: true });

  await withTransaction(async (session) => {
    // ---------- Staff ----------
    const admin: any = await createWithId(
      User,
      { name: 'أمين النظام — Super Admin', email: 'admin@warehouse.local', phone: '01000000001', password_hash: hash('Admin@123'), role: 'super_admin' },
      session
    );
    await createWithId(
      User,
      { name: 'هاني المحاسب — Accountant', email: 'accountant@warehouse.local', phone: '01000000002', password_hash: hash('Accountant@123'), role: 'accountant' },
      session
    );
    const managerPerms = PERMISSION_TEMPLATES.sales.permissions;
    const manager: any = await createWithId(
      User,
      { name: 'منى المديرة — Manager', email: 'manager@warehouse.local', phone: '01000000003', password_hash: hash('Manager@123'), role: 'staff', permissions: managerPerms },
      session
    );
    console.log('✔ staff: admin / accountant / manager');

    // ---------- Settings ----------
    await Setting.updateOne(
      { id: 1 },
      {
        company_name: 'Moaz AIR',
        company_name_en: 'Moaz AIR',
        company_phone: '01000000000',
        company_address: 'القاهرة، مصر',
        receipt_footer: 'شكراً لتعاملكم معنا — Thank you for your business',
      }
    ).session(session);

    // ---------- Warehouses & categories ----------
    const mainWh: any = await createWithId(
      Warehouse,
      { name: 'Main Warehouse', name_ar: 'المخزن الرئيسي', location: 'القاهرة - العاصمة الإدارية', is_default: true },
      session
    );
    const branchWh: any = await createWithId(
      Warehouse,
      { name: 'Branch Warehouse', name_ar: 'مخزن الفرع', location: 'الجيزة - فيصل' },
      session
    );

    const catNames: [string, string][] = [
      ['Split AC', 'سبليت'], ['Window AC', 'شباك'], ['Cassette AC', 'كاسيت'],
      ['Ducted AC', 'دكت مخفي'], ['Portable AC', 'متنقل'], ['Spares', 'قطع غيار ومستلزمات'],
    ];
    const cats: Record<string, number> = {};
    for (const [en, ar] of catNames) {
      const c: any = await createWithId(Category, { name: en, name_ar: ar }, session);
      cats[en] = c.id;
    }

    // ---------- Accounts & transaction categories ----------
    const cashAcc: any = await createWithId(Account, { name: 'Cash Box', name_ar: 'الصندوق النقدي', type: 'cash' }, session);
    const bankAcc: any = await createWithId(Account, { name: 'National Bank of Egypt', name_ar: 'البنك الأهلي المصري', type: 'bank' }, session);

    const txCats: [string, string, string, boolean][] = [
      ['customer_collections', 'تحصيلات العملاء', 'income', true],
      ['other_income', 'إيرادات أخرى', 'income', true],
      ['supplier_payment', 'مدفوعات موردين', 'expense', true],
      ['salaries', 'رواتب', 'expense', true],
      ['rent', 'إيجار', 'expense', true],
      ['transport', 'نقل ومواصلات', 'expense', true],
      ['other_expense', 'مصروفات أخرى', 'expense', true],
      ['transfers', 'تحويلات داخلية', 'both', true],
    ];
    const txc: Record<string, number> = {};
    for (const [key, ar, kind, def] of txCats) {
      const c: any = await createWithId(TransactionCategory, { name: key, name_ar: ar, kind, is_default: def }, session);
      txc[key] = c.id;
    }

    // ---------- Customers (10) ----------
    const customerNames = [
      ['محمد أحمد السيد', '01011110001', 'القاهرة - مدينة نصر'],
      ['فاطمة محمود علي', '01011110002', 'الجيزة - الدقي'],
      ['أحمد عبد الرحمن', '01011110003', 'الإسكندرية - سموحة'],
      ['سارة إبراهيم حسن', '01011110004', 'القاهرة - المعادي'],
      ['خالد سمير فؤاد', '01011110005', 'المنصورة'],
      ['منى صلاح الدين', '01011110006', 'طنطا'],
      ['ياسر عبد العال', '01011110007', 'القاهرة - الزمالك'],
      ['نورهان جمال', '01011110008', 'بورسعيد'],
      ['عمرو حسين الشافعي', '01011110009', 'القاهرة - مصر الجديدة'],
      ['دينا مصطفى كامل', '01011110010', 'أسيوط'],
    ];
    const custIds: number[] = [];
    for (let i = 0; i < customerNames.length; i++) {
      const [name, phone, address] = customerNames[i];
      const c: any = await createWithId(
        Customer,
        {
          name, phone, national_id: `2${(90000000000 + i * 111111).toString().slice(0, 12)}`,
          address, notes: i % 3 === 0 ? 'عميل مميز' : null, created_by: admin.id,
          created_at: daysAgo(150 - i * 10),
        },
        session
      );
      custIds.push(c.id);
    }
    console.log('✔ 10 customers');

    // ---------- Items (20) ----------
    const items: { name: string; name_ar: string; model: string; cat: string; brand: string; cost: number; price: number; qty: number; min: number; wh: number }[] = [
      { name: 'Carrier Split 1.5HP Inverter', name_ar: 'كاريير سبليت 1.5 حصان إنفرتر', model: 'Optima', cat: 'Split AC', brand: 'Carrier', cost: 34000, price: 41500, qty: 12, min: 3, wh: mainWh.id },
      { name: 'LG Split 1.5HP Inverter', name_ar: 'LG سبليت 1.5 حصان إنفرتر', model: 'DualCool', cat: 'Split AC', brand: 'LG', cost: 39000, price: 47000, qty: 8, min: 2, wh: mainWh.id },
      { name: 'Samsung Split 2HP WindFree', name_ar: 'سامسونج سبليت 2 حصان ويند فري', model: 'WindFree', cat: 'Split AC', brand: 'Samsung', cost: 52000, price: 63000, qty: 5, min: 2, wh: branchWh.id },
      { name: 'Gree Split 1HP Inverter', name_ar: 'جري سبليت 1 حصان إنفرتر', model: 'Bora', cat: 'Split AC', brand: 'Gree', cost: 26000, price: 32000, qty: 15, min: 4, wh: mainWh.id },
      { name: 'Unionaire Split 2.25HP', name_ar: 'يونيون إير سبليت 2.25 حصان', model: 'Infinity', cat: 'Split AC', brand: 'Unionaire', cost: 48000, price: 58000, qty: 6, min: 2, wh: mainWh.id },
      { name: 'Fresh Split 1.5HP', name_ar: 'فريش سبليت 1.5 حصان', model: 'Dynamic', cat: 'Split AC', brand: 'Fresh', cost: 31000, price: 38000, qty: 9, min: 3, wh: branchWh.id },
      { name: 'Daikin Split 2HP Inverter', name_ar: 'دايكن سبليت 2 حصان إنفرتر', model: 'FTKM', cat: 'Split AC', brand: 'Daikin', cost: 58000, price: 69000, qty: 3, min: 1, wh: mainWh.id },
      { name: 'Mitsubishi Split 1.5HP', name_ar: 'ميتسوبيشي سبليت 1.5 حصان', model: 'MSY-GS', cat: 'Split AC', brand: 'Mitsubishi', cost: 45000, price: 54000, qty: 2, min: 3, wh: branchWh.id },
      { name: 'TCL Split 1HP', name_ar: 'TCL سبليت 1 حصان', model: 'T-Pro', cat: 'Split AC', brand: 'TCL', cost: 23000, price: 28500, qty: 18, min: 5, wh: mainWh.id },
      { name: 'Haier Split 1.5HP Inverter', name_ar: 'هاير سبليت 1.5 حصان إنفرتر', model: 'Flexis', cat: 'Split AC', brand: 'Haier', cost: 33000, price: 40000, qty: 7, min: 2, wh: mainWh.id },
      { name: 'Carrier Window 1.5HP', name_ar: 'كاريير شباك 1.5 حصان', model: 'Window', cat: 'Window AC', brand: 'Carrier', cost: 19000, price: 24000, qty: 10, min: 3, wh: mainWh.id },
      { name: 'Fresh Window 1HP', name_ar: 'فريش شباك 1 حصان', model: 'Window', cat: 'Window AC', brand: 'Fresh', cost: 15500, price: 19500, qty: 14, min: 4, wh: branchWh.id },
      { name: 'Gree Cassette 2HP', name_ar: 'جري كاسيت 2 حصان', model: 'U-Match', cat: 'Cassette AC', brand: 'Gree', cost: 56000, price: 68000, qty: 4, min: 1, wh: mainWh.id },
      { name: 'Midea Cassette 3HP', name_ar: 'ميدا كاسيت 3 حصان', model: 'MCA3', cat: 'Cassette AC', brand: 'Midea', cost: 72000, price: 86000, qty: 2, min: 1, wh: branchWh.id },
      { name: 'Carrier Ducted 4HP', name_ar: 'كاريير دكت مخفي 4 حصان', model: 'Duct', cat: 'Ducted AC', brand: 'Carrier', cost: 98000, price: 118000, qty: 2, min: 1, wh: mainWh.id },
      { name: 'Midea Portable 1HP', name_ar: 'ميدا تكييف متنقل 1 حصان', model: 'Portable', cat: 'Portable AC', brand: 'Midea', cost: 21000, price: 26500, qty: 6, min: 2, wh: mainWh.id },
      { name: 'Copper Pipe Kit 5m', name_ar: 'طقم مواسير نحاس للتكييف 5 متر', model: '5m', cat: 'Spares', brand: 'Generic', cost: 1200, price: 1800, qty: 30, min: 8, wh: mainWh.id },
      { name: 'AC Wall Bracket Heavy Duty', name_ar: 'حامل تكييف حديدي مقوى', model: 'HD', cat: 'Spares', brand: 'Generic', cost: 450, price: 750, qty: 40, min: 10, wh: mainWh.id },
      { name: 'AC Drain Hose + Cover Set', name_ar: 'خرطوم صرف + غطاء تكييف', model: 'Set', cat: 'Spares', brand: 'Generic', cost: 300, price: 550, qty: 25, min: 6, wh: branchWh.id },
      { name: 'AC Voltage Stabilizer 2000W', name_ar: 'مثبت جهد للتكييف 2000 واط', model: '2000W', cat: 'Spares', brand: 'Generic', cost: 1400, price: 2000, qty: 0, min: 4, wh: mainWh.id },
    ];
    const itemIds: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const initial = it.qty + (i < 14 ? 2 + (i % 4) : 0); // some already assigned out
      const row: any = await createWithId(
        Item,
        {
          name: it.name, name_ar: it.name_ar, sku: `SKU-${1001 + i}`,
          barcode: `62${(2000000 + i * 7331).toString()}`, category_id: cats[it.cat], brand: it.brand,
          model: it.model, cost_price: it.cost, selling_price: it.price,
          quantity: it.qty, min_stock_level: it.min, warehouse_id: it.wh,
        },
        session
      );
      itemIds.push(row.id);
      await createWithId(
        StockMovement,
        {
          item_id: row.id, movement_type: 'purchase', quantity: initial, to_warehouse_id: it.wh,
          reason: 'Initial purchase order', performed_by: admin.id, reference_type: 'seed',
          created_at: daysAgo(160 - i * 3),
        },
        session
      );
    }
    console.log('✔ 20 items');

    // ---------- Assignments + payments + stock-out movements ----------
    // [customerIdx, itemIdx, qty, daysAgoAssigned, paidAmountOrNull]
    const flows: [number, number, number, number, number | null][] = [
      [0, 0, 1, 55, 41500],      // fully paid — Carrier 1.5HP
      [0, 3, 2, 40, 21000],      // partial — 2× Gree 1HP (64000)
      [1, 6, 1, 38, 25000],      // partial — Daikin 2HP (69000)
      [2, 15, 4, 33, 40000],     // partial — 4× portable (106000)
      [3, 9, 2, 25, 80000],      // full — 2× Haier 1.5HP
      [4, 13, 1, 21, 0],         // unpaid — Midea cassette 3HP
      [5, 16, 2, 18, 2100],      // partial — 2× copper kits (3600)
      [6, 1, 1, 14, 47000],      // full — LG 1.5HP
      [7, 18, 1, 11, 300],       // partial — drain+cover set (550)
      [8, 4, 2, 8, 0],           // unpaid — 2× Unionaire 2.25HP
      [9, 7, 1, 5, 54000],       // full — Mitsubishi 1.5HP
      [1, 10, 1, 3, 0],          // unpaid, recent — Carrier window
    ];
    for (const [ci, ii, qty, ago, paid] of flows) {
      const it = items[ii];
      const amount = qty * it.price;
      const assigned = iso(daysAgo(ago));
      const a: any = await createWithId(
        Assignment,
        {
          customer_id: custIds[ci], item_id: itemIds[ii], item_text: null, quantity: qty,
          unit_price: it.price, amount, assigned_at: assigned, notes: 'توريد جهاز للعميل',
          created_by: manager.id, created_at: daysAgo(ago),
        },
        session
      );
      await createWithId(
        StockMovement,
        {
          item_id: itemIds[ii], movement_type: 'assignment', quantity: -qty,
          reason: 'Assigned to customer', performed_by: admin.id, reference_type: 'assignment_out',
          reference_id: a.id, created_at: daysAgo(ago),
        },
        session
      );
      if (paid && paid > 0) {
        const seq = await nextSequence('receipt', session);
        const receipt = `R-${assigned.slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;
        const p: any = await createWithId(
          Payment,
          {
            customer_id: custIds[ci], amount: paid, method: 'cash', paid_at: assigned,
            receipt_number: receipt, received_by: manager.id, notes: 'دفعة أولى', created_at: daysAgo(ago),
          },
          session
        );
        const t: any = await createWithId(
          Transaction,
          {
            type: 'income', amount: paid, category_id: txc.customer_collections, occurred_at: assigned,
            method: 'cash', account_id: cashAcc.id, customer_id: custIds[ci], payment_id: p.id,
            notes: 'تحصيل من العميل', created_by: admin.id, created_at: daysAgo(ago),
          },
          session
        );
        await Payment.updateOne({ id: p.id }, { transaction_id: t.id }, { session });
        await Account.updateOne({ id: cashAcc.id }, { $inc: { balance: paid } }, { session });
      }
    }

    // A returned assignment (returned item → stock restored, credited)
    const retAmount = 1 * items[3].price; // Gree 1HP
    const retAssigned = iso(daysAgo(60));
    const retAssignment: any = await createWithId(
      Assignment,
      {
        customer_id: custIds[5], item_id: itemIds[3], item_text: null, quantity: 1,
        unit_price: items[3].price, amount: retAmount, credited_amount: retAmount,
        assigned_at: retAssigned, returned_at: new Date(), status: 'returned',
        notes: 'تم استرجاع الجهاز', created_by: admin.id,
      },
      session
    );
    await createWithId(
      StockMovement,
      {
        item_id: itemIds[3], movement_type: 'return', quantity: 1, reason: 'Customer return',
        performed_by: admin.id, reference_type: 'assignment_return', reference_id: retAssignment.id,
      },
      session
    );
    await Item.updateOne({ id: itemIds[3] }, { $inc: { quantity: 1 } }, { session });
    console.log('✔ assignments + payments');

    // ---------- Operating expenses / income ----------
    const expenses: [string, number, number, string][] = [
      // [categoryKey, amount, daysAgo, note]
      ['rent', 12000, 150, 'إيجار المخزن - دفعة أولى'],
      ['salaries', 21000, 148, 'رواتب فريق التشغيل'],
      ['supplier_payment', 45000, 140, 'سداد فاتورة مورد شاشات'],
      ['transport', 1800, 120, 'نقل أجهزة للفرع'],
      ['rent', 12000, 120, 'إيجار المخزن - الشهر الثاني'],
      ['salaries', 21500, 118, 'رواتب شهرية'],
      ['supplier_payment', 28000, 95, 'سداد مورد كاميرات'],
      ['transport', 2200, 90, 'توصيل طلبية عملاء'],
      ['rent', 12000, 90, 'إيجار المخزن - الشهر الثالث'],
      ['salaries', 21900, 88, 'رواتب شهرية'],
      ['supplier_payment', 32000, 65, 'سداد مورد شبكات'],
      ['transport', 1500, 60, 'مصاريف نقل'],
      ['rent', 12000, 60, 'إيجار المخزن - الشهر الرابع'],
      ['salaries', 22300, 58, 'رواتب شهرية'],
      ['other_expense', 3400, 45, 'صيانة تكييفات المخزن'],
      ['rent', 12000, 30, 'إيجار المخزن - الشهر الخامس'],
      ['salaries', 22600, 28, 'رواتب شهرية'],
      ['transport', 1900, 15, 'نقل أجهزة'],
      ['rent', 12000, 2, 'إيجار المخزن - الشهر الحالي'],
      ['salaries', 22800, 1, 'رواتب الشهر الحالي'],
    ];
    for (const [key, amount, ago, note] of expenses) {
      const when = iso(daysAgo(ago));
      const accId = key === 'salaries' || amount > 20000 ? bankAcc.id : cashAcc.id;
      await createWithId(
        Transaction,
        {
          type: 'expense', amount, category_id: txc[key], occurred_at: when, method: 'cash',
          account_id: accId, notes: note, created_by: admin.id, created_at: daysAgo(ago),
        },
        session
      );
      await Account.updateOne({ id: accId }, { $inc: { balance: -amount } }, { session });
    }
    const otherIncome: [number, number, string][] = [
      [8500, 100, 'بيع خردة وتغليف'],
      [12000, 70, 'خدمة تركيب وتشغيل لعميل'],
      [6400, 35, 'عقد صيانة سنوي'],
    ];
    for (const [amount, ago, note] of otherIncome) {
      const when = iso(daysAgo(ago));
      await createWithId(
        Transaction,
        {
          type: 'income', amount, category_id: txc.other_income, occurred_at: when, method: 'cash',
          account_id: cashAcc.id, notes: note, created_by: admin.id, created_at: daysAgo(ago),
        },
        session
      );
      await Account.updateOne({ id: cashAcc.id }, { $inc: { balance: amount } }, { session });
    }
    console.log('✔ accounting transactions');

    // ---------- Installment plans (one overdue) ----------
    const plan1: any = await createWithId(
      InstallmentPlan,
      {
        customer_id: custIds[4], total_amount: 32000, installments_count: 4,
        start_date: iso(daysAgo(95)), interval_days: 30, notes: 'تقسيط تكييف سبليت', created_by: admin.id,
      },
      session
    );
    for (let i = 1; i <= 4; i++) {
      const due = daysAgo(95 - (i - 1) * 30);
      await createWithId(
        InstallmentSchedule,
        { plan_id: plan1.id, installment_no: i, due_date: iso(due), amount: 8000, paid_amount: i === 1 ? 8000 : 0, status: i === 1 ? 'paid' : 'pending' },
        session
      );
    }
    const plan2: any = await createWithId(
      InstallmentPlan,
      {
        customer_id: custIds[2], total_amount: 27000, installments_count: 6,
        start_date: iso(daysAgo(10)), interval_days: 30, notes: 'تقسيط تكييف شباك', created_by: admin.id,
      },
      session
    );
    for (let i = 1; i <= 6; i++) {
      const due = daysAgo(10 - (i - 1) * 30);
      await createWithId(
        InstallmentSchedule,
        { plan_id: plan2.id, installment_no: i, due_date: iso(due), amount: 4500 },
        session
      );
    }
    console.log('✔ installment plans');

    await createWithId(
      AuditLog,
      {
        user_id: admin.id, user_name: 'system', action: 'seed', entity: 'system',
        new_value: { seeded: true, at: new Date().toISOString() }, ip: 'local',
      },
      session
    );
  });

  console.log('\nSeed complete. Login accounts:');
  console.log('  Super Admin : admin@warehouse.local      / Admin@123');
  console.log('  Accountant  : accountant@warehouse.local / Accountant@123');
  console.log('  Manager     : manager@warehouse.local    / Manager@123');
  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
