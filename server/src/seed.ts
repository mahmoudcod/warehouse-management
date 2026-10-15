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
        company_name: 'مستودع النيل للتقنية',
        company_name_en: 'Nile Tech Warehouse',
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
      ['Screens', 'شاشات'], ['Routers', 'راوترات'], ['Tablets', 'أجهزة لوحية'],
      ['Accessories', 'ملحقات'], ['Cameras', 'كاميرات'], ['Networking', 'أجهزة شبكات'],
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
    const items: { name: string; name_ar: string; cat: string; brand: string; cost: number; price: number; qty: number; min: number; wh: number }[] = [
      { name: 'Dell 24" Monitor P2422H', name_ar: 'شاشة ديل 24 بوصة P2422H', cat: 'Screens', brand: 'Dell', cost: 3800, price: 4950, qty: 14, min: 3, wh: mainWh.id },
      { name: 'LG 27" Monitor 27UP550', name_ar: 'شاشة LG 27 بوصة 27UP550', cat: 'Screens', brand: 'LG', cost: 5200, price: 6800, qty: 8, min: 2, wh: mainWh.id },
      { name: 'Samsung 32" Curved C32R500', name_ar: 'شاشة سامسونج منحنية 32 بوصة', cat: 'Screens', brand: 'Samsung', cost: 6400, price: 8300, qty: 5, min: 2, wh: branchWh.id },
      { name: 'TP-Link Archer AX23 Router', name_ar: 'راوتر TP-Link AX23', cat: 'Routers', brand: 'TP-Link', cost: 1450, price: 2100, qty: 25, min: 5, wh: mainWh.id },
      { name: 'Huawei H122-373 Router', name_ar: 'راوتر هواوي H122-373', cat: 'Routers', brand: 'Huawei', cost: 1900, price: 2700, qty: 18, min: 5, wh: mainWh.id },
      { name: 'Mikrotik hAP ax2', name_ar: 'ميكروتيك hAP ax2', cat: 'Routers', brand: 'Mikrotik', cost: 3200, price: 4200, qty: 2, min: 4, wh: branchWh.id },
      { name: 'Samsung Galaxy Tab A9+', name_ar: 'تابلت سامسونج جالاكسي A9+', cat: 'Tablets', brand: 'Samsung', cost: 8900, price: 11200, qty: 7, min: 2, wh: mainWh.id },
      { name: 'Lenovo Tab M11', name_ar: 'تابلت لينوفو M11', cat: 'Tablets', brand: 'Lenovo', cost: 6700, price: 8600, qty: 4, min: 2, wh: mainWh.id },
      { name: 'iPad 10th Gen 64GB', name_ar: 'آيباد الجيل العاشر 64GB', cat: 'Tablets', brand: 'Apple', cost: 17500, price: 21000, qty: 3, min: 1, wh: mainWh.id },
      { name: 'Logitech MK270 Keyboard+Mouse', name_ar: 'طقم لوحة مفاتيح وماوس لوجيتك', cat: 'Accessories', brand: 'Logitech', cost: 850, price: 1250, qty: 30, min: 8, wh: mainWh.id },
      { name: 'Anker 65W GaN Charger', name_ar: 'شاحن أنكر 65 واط', cat: 'Accessories', brand: 'Anker', cost: 950, price: 1450, qty: 22, min: 6, wh: mainWh.id },
      { name: 'APC Back-UPS 700VA', name_ar: 'UPS إيه بي سي 700 فولت', cat: 'Accessories', brand: 'APC', cost: 2400, price: 3100, qty: 9, min: 3, wh: branchWh.id },
      { name: 'Cat6 Cable 305m Box', name_ar: 'كابل شبكات Cat6 بكرة 305 متر', cat: 'Networking', brand: 'Generic', cost: 3600, price: 4700, qty: 12, min: 4, wh: mainWh.id },
      { name: 'TP-Link 8-Port Gigabit Switch', name_ar: 'سويتش 8 منافذ TP-Link', cat: 'Networking', brand: 'TP-Link', cost: 1050, price: 1550, qty: 16, min: 4, wh: mainWh.id },
      { name: 'Netgear GS324 24-Port Switch', name_ar: 'سويتش 24 منفذ نيت جير', cat: 'Networking', brand: 'Netgear', cost: 6800, price: 8900, qty: 1, min: 2, wh: branchWh.id },
      { name: 'Hikvision 4MP Dome Camera', name_ar: 'كاميرا هيك فيجن 4 ميجا', cat: 'Cameras', brand: 'Hikvision', cost: 1250, price: 1900, qty: 20, min: 6, wh: mainWh.id },
      { name: 'Dahua 5MP Bullet Camera', name_ar: 'كاميرا داهوا 5 ميجا', cat: 'Cameras', brand: 'Dahua', cost: 1400, price: 2100, qty: 11, min: 4, wh: branchWh.id },
      { name: 'Hikvision NVR 8CH', name_ar: 'مسجل شبكة هيك فيجن 8 قنوات', cat: 'Cameras', brand: 'Hikvision', cost: 4200, price: 5600, qty: 6, min: 2, wh: mainWh.id },
      { name: 'Ubiquiti UniFi 6 Lite AP', name_ar: 'نقطة وصول Ubiquiti U6 Lite', cat: 'Networking', brand: 'Ubiquiti', cost: 3900, price: 5100, qty: 4, min: 2, wh: mainWh.id },
      { name: 'JBL Flip 6 Speaker', name_ar: 'سماعة JBL Flip 6', cat: 'Accessories', brand: 'JBL', cost: 3200, price: 4300, qty: 0, min: 3, wh: mainWh.id },
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
          model: it.name.split(' ').slice(-1)[0], cost_price: it.cost, selling_price: it.price,
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
      [0, 0, 1, 55, 4950],       // fully paid
      [0, 3, 2, 40, 2100],       // partial
      [1, 6, 1, 38, 5600],       // partial
      [2, 15, 4, 33, 3800],      // partial
      [3, 9, 2, 25, 2500],       // full
      [4, 13, 1, 21, 0],         // unpaid
      [5, 16, 2, 18, 2100],      // partial
      [6, 1, 1, 14, 6800],       // full
      [7, 17, 1, 11, 2800],      // partial
      [8, 4, 2, 8, 0],           // unpaid
      [9, 7, 1, 5, 8600],        // full
      [1, 18, 1, 3, 0],          // unpaid, recent
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
    const retAmount = 1 * items[3].price; // router 2100
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
        customer_id: custIds[4], total_amount: 8400, installments_count: 4,
        start_date: iso(daysAgo(95)), interval_days: 30, notes: 'تقسيط راوترين', created_by: admin.id,
      },
      session
    );
    for (let i = 1; i <= 4; i++) {
      const due = daysAgo(95 - (i - 1) * 30);
      await createWithId(
        InstallmentSchedule,
        { plan_id: plan1.id, installment_no: i, due_date: iso(due), amount: 2100, paid_amount: i === 1 ? 2100 : 0, status: i === 1 ? 'paid' : 'pending' },
        session
      );
    }
    const plan2: any = await createWithId(
      InstallmentPlan,
      {
        customer_id: custIds[2], total_amount: 16800, installments_count: 6,
        start_date: iso(daysAgo(10)), interval_days: 30, notes: 'تقسيط تابلت', created_by: admin.id,
      },
      session
    );
    for (let i = 1; i <= 6; i++) {
      const due = daysAgo(10 - (i - 1) * 30);
      await createWithId(
        InstallmentSchedule,
        { plan_id: plan2.id, installment_no: i, due_date: iso(due), amount: 2800 },
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
