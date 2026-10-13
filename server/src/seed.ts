import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, withTransaction, nextSequence } from './db';
import { PERMISSION_TEMPLATES } from './permissions';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

async function seed() {
  const existing = await pool.query(`select count(*) c from users where deleted_at is null`);
  if (Number(existing.rows[0].c) > 0 && !process.env.FORCE) {
    console.log('Database already seeded — skipping (set FORCE=1 to reseed).');
    await pool.end();
    return;
  }
  if (process.env.FORCE) {
    await pool.query(`truncate users, user_permissions, customers, categories, warehouses, items, item_units,
      stock_movements, assignments, payments, accounts, transaction_categories, transactions, transfers,
      closed_periods, daily_closes, installment_plans, installment_schedule, audit_logs, sequences, settings,
      password_resets restart identity cascade`);
    await pool.query(`insert into sequences (name) values ('receipt')`);
    await pool.query(`insert into settings (id) values (1)`);
    console.log('FORCE: tables truncated.');
  }

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  await withTransaction(async (c) => {
    // ---------- Staff ----------
    const admin = (
      await c.query(
        `insert into users (name, email, phone, password_hash, role) values ($1,$2,$3,$4,'super_admin') returning id`,
        ['أمين النظام — Super Admin', 'admin@warehouse.local', '01000000001', hash('Admin@123')]
      )
    ).rows[0].id;
    const accountant = (
      await c.query(
        `insert into users (name, email, phone, password_hash, role) values ($1,$2,$3,$4,'accountant') returning id`,
        ['هاني المحاسب — Accountant', 'accountant@warehouse.local', '01000000002', hash('Accountant@123')]
      )
    ).rows[0].id;
    const managerPerms = [
      'dashboard.view',
      'inventory.view', 'inventory.export',
      'customers.view', 'customers.create', 'customers.edit', 'customers.view_financials',
      'assignments.view', 'assignments.create', 'assignments.export',
      'payments.view', 'payments.create',
      'reports.view',
    ];
    const manager = (
      await c.query(
        `insert into users (name, email, phone, password_hash, role) values ($1,$2,$3,$4,'staff') returning id`,
        ['منى المديرة — Manager', 'manager@warehouse.local', '01000000003', hash('Manager@123')]
      )
    ).rows[0].id;
    await c.query(
      `insert into user_permissions (user_id, permission, granted_by) select $1, p, $2 from unnest($3::text[]) p`,
      [manager, admin, managerPerms]
    );
    console.log('✔ staff: admin / accountant / manager');

    // ---------- Settings ----------
    await c.query(
      `update settings set company_name='مستودع النيل للتقنية', company_name_en='Nile Tech Warehouse',
       company_phone='01000000000', company_address='القاهرة، مصر', receipt_footer='شكراً لتعاملكم معنا — Thank you for your business'
       where id=1`
    );

    // ---------- Warehouses & categories ----------
    const mainWh = (await c.query(
      `insert into warehouses (name, name_ar, location, is_default) values ('Main Warehouse','المخزن الرئيسي','القاهرة - العاصمة الإدارية',true) returning id`
    )).rows[0].id;
    const branchWh = (await c.query(
      `insert into warehouses (name, name_ar, location) values ('Branch Warehouse','مخزن الفرع','الجيزة - فيصل') returning id`
    )).rows[0].id;

    const catNames: [string, string][] = [
      ['Screens', 'شاشات'], ['Routers', 'راوترات'], ['Tablets', 'أجهزة لوحية'],
      ['Accessories', 'ملحقات'], ['Cameras', 'كاميرات'], ['Networking', 'أجهزة شبكات'],
    ];
    const cats: Record<string, string> = {};
    for (const [en, ar] of catNames) {
      cats[en] = (await c.query(`insert into categories (name, name_ar) values ($1,$2) returning id`, [en, ar])).rows[0].id;
    }

    // ---------- Accounts & transaction categories ----------
    const cashAcc = (await c.query(
      `insert into accounts (name, name_ar, type) values ('Cash Box','الصندوق النقدي','cash') returning id`
    )).rows[0].id;
    const bankAcc = (await c.query(
      `insert into accounts (name, name_ar, type) values ('National Bank of Egypt','البنك الأهلي المصري','bank') returning id`
    )).rows[0].id;

    const txCats: [string, string, string, string][] = [
      ['customer_collections', 'تحصيلات العملاء', 'income', 'true'],
      ['other_income', 'إيرادات أخرى', 'income', 'true'],
      ['supplier_payment', 'مدفوعات موردين', 'expense', 'true'],
      ['salaries', 'رواتب', 'expense', 'true'],
      ['rent', 'إيجار', 'expense', 'true'],
      ['transport', 'نقل ومواصلات', 'expense', 'true'],
      ['other_expense', 'مصروفات أخرى', 'expense', 'true'],
      ['transfers', 'تحويلات داخلية', 'both', 'true'],
    ];
    const txc: Record<string, string> = {};
    for (const [key, ar, kind, def] of txCats) {
      txc[key] = (
        await c.query(
          `insert into transaction_categories (name, name_ar, kind, is_default) values ($1,$2,$3,$4) returning id`,
          [key, ar, kind, def === 'true']
        )
      ).rows[0].id;
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
    const custIds: string[] = [];
    for (let i = 0; i < customerNames.length; i++) {
      const [name, phone, address] = customerNames[i];
      custIds.push(
        (
          await c.query(
            `insert into customers (name, phone, national_id, address, notes, created_by, created_at)
             values ($1,$2,$3,$4,$5,$6, $7) returning id`,
            [name, phone, `2${(90000000000 + i * 111111).toString().slice(0, 12)}`, address,
             i % 3 === 0 ? 'عميل مميز' : null, admin, iso(daysAgo(150 - i * 10))]
          )
        ).rows[0].id
      );
    }
    console.log('✔ 10 customers');

    // ---------- Items (20) ----------
    const items: { name: string; name_ar: string; cat: string; brand: string; cost: number; price: number; qty: number; min: number; wh: string }[] = [
      { name: 'Dell 24" Monitor P2422H', name_ar: 'شاشة ديل 24 بوصة P2422H', cat: 'Screens', brand: 'Dell', cost: 3800, price: 4950, qty: 14, min: 3, wh: mainWh },
      { name: 'LG 27" Monitor 27UP550', name_ar: 'شاشة LG 27 بوصة 27UP550', cat: 'Screens', brand: 'LG', cost: 5200, price: 6800, qty: 8, min: 2, wh: mainWh },
      { name: 'Samsung 32" Curved C32R500', name_ar: 'شاشة سامسونج منحنية 32 بوصة', cat: 'Screens', brand: 'Samsung', cost: 6400, price: 8300, qty: 5, min: 2, wh: branchWh },
      { name: 'TP-Link Archer AX23 Router', name_ar: 'راوتر TP-Link AX23', cat: 'Routers', brand: 'TP-Link', cost: 1450, price: 2100, qty: 25, min: 5, wh: mainWh },
      { name: 'Huawei H122-373 Router', name_ar: 'راوتر هواوي H122-373', cat: 'Routers', brand: 'Huawei', cost: 1900, price: 2700, qty: 18, min: 5, wh: mainWh },
      { name: 'Mikrotik hAP ax2', name_ar: 'ميكروتيك hAP ax2', cat: 'Routers', brand: 'Mikrotik', cost: 3200, price: 4200, qty: 2, min: 4, wh: branchWh },
      { name: 'Samsung Galaxy Tab A9+', name_ar: 'تابلت سامسونج جالاكسي A9+', cat: 'Tablets', brand: 'Samsung', cost: 8900, price: 11200, qty: 7, min: 2, wh: mainWh },
      { name: 'Lenovo Tab M11', name_ar: 'تابلت لينوفو M11', cat: 'Tablets', brand: 'Lenovo', cost: 6700, price: 8600, qty: 4, min: 2, wh: mainWh },
      { name: 'iPad 10th Gen 64GB', name_ar: 'آيباد الجيل العاشر 64GB', cat: 'Tablets', brand: 'Apple', cost: 17500, price: 21000, qty: 3, min: 1, wh: mainWh },
      { name: 'Logitech MK270 Keyboard+Mouse', name_ar: 'طقم لوحة مفاتيح وماوس لوجيتك', cat: 'Accessories', brand: 'Logitech', cost: 850, price: 1250, qty: 30, min: 8, wh: mainWh },
      { name: 'Anker 65W GaN Charger', name_ar: 'شاحن أنكر 65 واط', cat: 'Accessories', brand: 'Anker', cost: 950, price: 1450, qty: 22, min: 6, wh: mainWh },
      { name: 'APC Back-UPS 700VA', name_ar: 'UPS إيه بي سي 700 فولت', cat: 'Accessories', brand: 'APC', cost: 2400, price: 3100, qty: 9, min: 3, wh: branchWh },
      { name: 'Cat6 Cable 305m Box', name_ar: 'كابل شبكات Cat6 بكرة 305 متر', cat: 'Networking', brand: 'Generic', cost: 3600, price: 4700, qty: 12, min: 4, wh: mainWh },
      { name: 'TP-Link 8-Port Gigabit Switch', name_ar: 'سويتش 8 منافذ TP-Link', cat: 'Networking', brand: 'TP-Link', cost: 1050, price: 1550, qty: 16, min: 4, wh: mainWh },
      { name: 'Netgear GS324 24-Port Switch', name_ar: 'سويتش 24 منفذ نيت جير', cat: 'Networking', brand: 'Netgear', cost: 6800, price: 8900, qty: 1, min: 2, wh: branchWh },
      { name: 'Hikvision 4MP Dome Camera', name_ar: 'كاميرا هيك فيجن 4 ميجا', cat: 'Cameras', brand: 'Hikvision', cost: 1250, price: 1900, qty: 20, min: 6, wh: mainWh },
      { name: 'Dahua 5MP Bullet Camera', name_ar: 'كاميرا داهوا 5 ميجا', cat: 'Cameras', brand: 'Dahua', cost: 1400, price: 2100, qty: 11, min: 4, wh: branchWh },
      { name: 'Hikvision NVR 8CH', name_ar: 'مسجل شبكة هيك فيجن 8 قنوات', cat: 'Cameras', brand: 'Hikvision', cost: 4200, price: 5600, qty: 6, min: 2, wh: mainWh },
      { name: 'Ubiquiti UniFi 6 Lite AP', name_ar: 'نقطة وصول Ubiquiti U6 Lite', cat: 'Networking', brand: 'Ubiquiti', cost: 3900, price: 5100, qty: 4, min: 2, wh: mainWh },
      { name: 'JBL Flip 6 Speaker', name_ar: 'سماعة JBL Flip 6', cat: 'Accessories', brand: 'JBL', cost: 3200, price: 4300, qty: 0, min: 3, wh: mainWh },
    ];
    const itemIds: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const initial = it.qty + (i < 14 ? 2 + (i % 4) : 0); // some already assigned out
      const row = (
        await c.query(
          `insert into items (name, name_ar, sku, barcode, category_id, brand, model, cost_price, selling_price,
            quantity, min_stock_level, warehouse_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [it.name, it.name_ar, `SKU-${1001 + i}`, `62${(2000000 + i * 7331).toString()}`, cats[it.cat], it.brand,
           it.name.split(' ').slice(-1)[0], it.cost, it.price, it.qty, it.min, it.wh]
        )
      ).rows[0];
      itemIds.push(row.id);
      await c.query(
        `insert into stock_movements (item_id, movement_type, quantity, to_warehouse_id, reason, performed_by, reference_type, created_at)
         values ($1,'purchase',$2,$3,'Initial purchase order',$4,'seed', $5)`,
        [row.id, initial, it.wh, admin, iso(daysAgo(160 - i * 3))]
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
      const a = (
        await c.query(
          `insert into assignments (customer_id, item_id, item_text, quantity, unit_price, amount, assigned_at, notes, created_by, created_at)
           values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9) returning id, amount`,
          [custIds[ci], itemIds[ii], qty, it.price, amount, assigned, 'توريد جهاز للعميل', manager, assigned]
        )
      ).rows[0];
      await c.query(
        `insert into stock_movements (item_id, movement_type, quantity, reason, performed_by, reference_type, reference_id, created_at)
         values ($1,'assignment',$2,'Assigned to customer',$3,'assignment_out',$4,$5)`,
        [itemIds[ii], -qty, manager, a.id, assigned]
      );
      if (paid && paid > 0) {
        const seq = await nextSequence(c, 'receipt');
        const receipt = `R-${assigned.slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;
        const p = (
          await c.query(
            `insert into payments (customer_id, amount, method, paid_at, receipt_number, received_by, notes, created_at)
             values ($1,$2,'cash',$3,$4,$5,$6,$7) returning id`,
            [custIds[ci], paid, assigned, receipt, manager, 'دفعة أولى', assigned]
          )
        ).rows[0];
        const t = (
          await c.query(
            `insert into transactions (type, amount, category_id, occurred_at, method, account_id, customer_id, payment_id, notes, created_by, created_at)
             values ('income',$1,$2,$3,'cash',$4,$5,$6,$7,$8,$9) returning id`,
            [paid, txc.customer_collections, assigned, cashAcc, custIds[ci], p.id, `تحصيل من العميل`, manager, assigned]
          )
        ).rows[0];
        await c.query(`update payments set transaction_id=$2 where id=$1`, [p.id, t.id]);
        await c.query(`update accounts set balance = balance + $2 where id=$1`, [cashAcc, paid]);
      }
    }

    // A returned assignment (returned item → stock restored, credited)
    const retAmount = 1 * items[3].price; // router 2100
    const retAssigned = iso(daysAgo(60));
    const retAssignment = (
      await c.query(
        `insert into assignments (customer_id, item_id, item_text, quantity, unit_price, amount, credited_amount, assigned_at, returned_at, status, notes, created_by)
         values ($1,$2,null,1,$3,$4,$4,$5, now(), 'returned', 'تم استرجاع الجهاز', $6) returning id`,
        [custIds[5], itemIds[3], items[3].price, retAmount, retAssigned, manager]
      )
    ).rows[0].id;
    await c.query(
      `insert into stock_movements (item_id, movement_type, quantity, reason, performed_by, reference_type, reference_id)
       values ($1,'return',1,'Customer return',$2,'assignment_return',$3)`,
      [itemIds[3], manager, retAssignment]
    );
    await c.query(`update items set quantity = quantity + 1 where id = $1`, [itemIds[3]]);
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
      await c.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, notes, created_by, created_at)
         values ('expense',$1,$2,$3,'cash',$4,$5,$6,$7)`,
        [amount, txc[key], when, key === 'salaries' || amount > 20000 ? bankAcc : cashAcc, note, accountant, when]
      );
      await c.query(`update accounts set balance = balance - $2 where id=$1`, [
        key === 'salaries' || amount > 20000 ? bankAcc : cashAcc,
        amount,
      ]);
    }
    const otherIncome: [number, number, string][] = [
      [8500, 100, 'بيع خردة وتغليف'],
      [12000, 70, 'خدمة تركيب وتشغيل لعميل'],
      [6400, 35, 'عقد صيانة سنوي'],
    ];
    for (const [amount, ago, note] of otherIncome) {
      const when = iso(daysAgo(ago));
      await c.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, notes, created_by, created_at)
         values ('income',$1,$2,$3,'cash',$4,$5,$6,$7)`,
        [amount, txc.other_income, when, cashAcc, note, accountant, when]
      );
      await c.query(`update accounts set balance = balance + $2 where id=$1`, [cashAcc, amount]);
    }
    console.log('✔ accounting transactions');

    // ---------- Installment plans (one overdue) ----------
    const plan1 = (
      await c.query(
        `insert into installment_plans (customer_id, total_amount, installments_count, start_date, interval_days, notes, created_by)
         values ($1, 8400, 4, $2, 30, 'تقسيط راوترين', $3) returning id`,
        [custIds[4], iso(daysAgo(95)), manager]
      )
    ).rows[0].id;
    for (let i = 1; i <= 4; i++) {
      const due = daysAgo(95 - (i - 1) * 30);
      await c.query(
        `insert into installment_schedule (plan_id, installment_no, due_date, amount, paid_amount, status)
         values ($1,$2,$3,2100,$4,$5)`,
        [plan1, i, iso(due), i === 1 ? 2100 : 0, i === 1 ? 'paid' : 'pending']
      );
    }
    const plan2 = (
      await c.query(
        `insert into installment_plans (customer_id, total_amount, installments_count, start_date, interval_days, notes, created_by)
         values ($1, 16800, 6, $2, 30, 'تقسيط تابلت', $3) returning id`,
        [custIds[2], iso(daysAgo(10)), manager]
      )
    ).rows[0].id;
    for (let i = 1; i <= 6; i++) {
      const due = daysAgo(10 - (i - 1) * 30);
      await c.query(
        `insert into installment_schedule (plan_id, installment_no, due_date, amount) values ($1,$2,$3,2800)`,
        [plan2, i, iso(due)]
      );
    }
    console.log('✔ installment plans');

    await c.query(
      `insert into audit_logs (user_id, user_name, action, entity, new_value, ip) values ($1,'system','seed','system',$2,'local')`,
      [admin, JSON.stringify({ seeded: true, at: new Date().toISOString() })]
    );
  });

  console.log('\nSeed complete. Login accounts:');
  console.log('  Super Admin : admin@warehouse.local      / Admin@123');
  console.log('  Accountant  : accountant@warehouse.local / Accountant@123');
  console.log('  Manager     : manager@warehouse.local    / Manager@123');
  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
