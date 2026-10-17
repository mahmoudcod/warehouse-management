/**
 * End-to-end API smoke tests — validates the acceptance criteria at the API level.
 * Usage: node scripts/smoke.mjs   (server must be running on :4000, DB seeded)
 */
const BASE = process.env.API_URL || 'http://localhost:4000';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ FAIL: ${name}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

async function login(identifier, password) {
  const r = await api('POST', '/api/auth/login', { body: { identifier, password } });
  if (r.status !== 200) throw new Error(`login failed for ${identifier}: ${JSON.stringify(r.json)}`);
  return { token: r.json.token, user: r.json.user };
}

const run = async () => {
  console.log('— Auth & roles —');
  const admin = await login('admin@warehouse.local', 'Admin@123');
  const accountant = await login('accountant@warehouse.local', 'Accountant@123');
  const manager = await login('manager@warehouse.local', 'Manager@123');

  // Reset any leftover locked period so reruns are deterministic
  await api('DELETE', `/api/accounting/periods/${new Date().toISOString().slice(0, 7)}`, { token: admin.token });
  ok(!!admin.token && admin.user.role === 'super_admin', 'super admin login');
  ok(!!accountant.token && accountant.user.role === 'accountant', 'accountant login');
  ok(!!manager.token && manager.user.role === 'staff', 'manager (staff) login');

  const bad = await api('POST', '/api/auth/login', { body: { identifier: 'admin@warehouse.local', password: 'wrong' } });
  ok(bad.status === 401, 'wrong password rejected');

  const me = await api('GET', '/api/auth/me', { token: manager.token });
  ok(me.status === 200 && me.json.user.permissions.includes('customers.view'), 'manager /me returns permissions');
  ok(!me.json.user.permissions.includes('staff.view'), 'manager lacks staff.view');

  const anon = await api('GET', '/api/customers');
  ok(anon.status === 401, 'unauthenticated request rejected');

  console.log('— Permission enforcement —');
  ok((await api('GET', '/api/users', { token: manager.token })).status === 403, 'manager cannot list staff');
  ok((await api('GET', '/api/audit', { token: manager.token })).status === 403, 'manager cannot read audit log');
  ok((await api('GET', '/api/audit', { token: accountant.token })).status === 403, 'accountant cannot read audit log');
  ok((await api('POST', '/api/users', { token: accountant.token, body: { name: 'x', email: 'x@x.com', role: 'staff' } })).status === 403, 'accountant cannot create staff');
  ok((await api('GET', '/api/settings/backup', { token: manager.token })).status === 403, 'backup is super-admin only');
  ok((await api('GET', '/api/audit', { token: admin.token })).status === 200, 'super admin reads audit log');

  console.log('— Stage 2: customers & inventory —');
  const customers = await api('GET', '/api/customers?pageSize=50', { token: manager.token });
  ok(customers.status === 200 && customers.json.rows.length >= 10, 'customers list with balances');
  const custWithBalance = customers.json.rows.find((c) => c.balance > 0);
  ok(!!custWithBalance, 'server-computed balances present');

  const items = await api('GET', '/api/items?pageSize=50', { token: manager.token });
  ok(items.status === 200 && items.json.rows.length >= 1 && items.json.total >= items.json.rows.length, 'items list');
  const target = items.json.rows.find((i) => i.quantity >= 2 && i.status === 'active');
  ok(!!target, 'item with stock found');
  const noCreate = await api('POST', '/api/items', { token: accountant.token, body: { name: 'nope' } });
  ok(noCreate.status === 403, 'accountant cannot create items');

  const lookup = await api('GET', `/api/items/lookup/${encodeURIComponent(target.sku)}`, { token: manager.token });
  ok(lookup.status === 200 && lookup.json.item?.id === target.id, 'SKU lookup works');

  console.log('— Stage 3: assignment + payment flows —');
  const custId = custWithBalance.id;
  const beforeCust = (await api('GET', `/api/customers/${custId}`, { token: manager.token })).json;
  const beforeQty = Number(
    (await api('GET', `/api/items/${target.id}`, { token: manager.token })).json.quantity
  );

  // Manager with assignments.create records "took device X for amount Y"
  const asg = await api('POST', '/api/assignments', {
    token: manager.token,
    body: {
      customer_id: custId,
      item_id: target.id,
      quantity: 2,
      amount: 3000,
      notes: 'smoke test assignment',
    },
  });
  ok(asg.status === 201, 'record device taken');

  const afterQty = Number((await api('GET', `/api/items/${target.id}`, { token: manager.token })).json.quantity);
  ok(afterQty === beforeQty - 2, `stock decremented ${beforeQty} → ${afterQty}`);

  const oversell = await api('POST', '/api/assignments', {
    token: manager.token,
    body: { customer_id: custId, item_id: target.id, quantity: 99999, amount: 1 },
  });
  ok(oversell.status === 400, 'overselling rejected');

  const afterCust = (await api('GET', `/api/customers/${custId}`, { token: manager.token })).json;
  ok(
    Math.abs(afterCust.balance - (Number(beforeCust.balance) + 3000)) < 0.01,
    `balance increased by 3000 (${beforeCust.balance} → ${afterCust.balance})`
  );

  // Manager records a payment
  const accountsBefore = await api('GET', '/api/accounting/accounts', { token: accountant.token });
  const cashBefore = accountsBefore.json.find((a) => a.type === 'cash').balance;
  const pay = await api('POST', '/api/payments', {
    token: manager.token,
    body: { customer_id: custId, amount: 1200, method: 'cash', notes: 'smoke payment' },
  });
  ok(pay.status === 201 && !!pay.json.payment.receipt_number, 'payment recorded with receipt number');

  const afterPayCust = (await api('GET', `/api/customers/${custId}`, { token: manager.token })).json;
  ok(
    Math.abs(afterPayCust.balance - (Number(afterCust.balance) - 1200)) < 0.01,
    'balance decreased after payment'
  );

  const linked = await api('GET', `/api/accounting?search=${encodeURIComponent(pay.json.payment.receipt_number)}`, { token: accountant.token });
  ok(
    linked.status === 200 && linked.json.rows.some((t) => t.type === 'income' && Number(t.amount) === 1200 && t.payment_id === pay.json.payment.id),
    'payment auto-created linked income entry in accounting'
  );

  const accountsAfter = await api('GET', '/api/accounting/accounts', { token: accountant.token });
  const cashAfter = accountsAfter.json.find((a) => a.type === 'cash').balance;
  ok(Math.abs(cashAfter - (cashBefore + 1200)) < 0.01, 'cash account balance updated');

  const voidNoReason = await api('POST', `/api/payments/${pay.json.payment.id}/void`, { token: admin.token, body: {} });
  ok(voidNoReason.status === 400, 'void without reason rejected');

  console.log('— Stage 4: accounting —');
  const exp = await api('POST', '/api/accounting', {
    token: accountant.token,
    body: { type: 'expense', amount: 500, occurred_at: new Date().toISOString().slice(0, 10), method: 'cash', notes: 'smoke expense' },
  });
  ok(exp.status === 201, 'accountant records expense');

  const expMgr = await api('POST', '/api/accounting', {
    token: manager.token,
    body: { type: 'expense', amount: 100, occurred_at: new Date().toISOString().slice(0, 10) },
  });
  ok(expMgr.status === 403, 'manager cannot create accounting entries');

  const pl = await api('GET', '/api/reports/income-statement', { token: accountant.token });
  ok(pl.status === 200 && pl.json.totalIncome > 0 && pl.json.totalExpense > 0 && typeof pl.json.netProfit === 'number', 'income statement computed');

  const daily = await api('GET', '/api/accounting/daily-close', { token: accountant.token });
  ok(daily.status === 200 && typeof daily.json.closing_balance === 'number', 'daily close computed');

  // Locked periods: close current month, then accountant edit must fail; super admin can
  const thisMonth = new Date().toISOString().slice(0, 7);
  await api('POST', '/api/accounting/periods', { token: admin.token, body: { month: thisMonth } });
  const lockedEdit = await api('PATCH', `/api/accounting/${exp.json.id}`, {
    token: accountant.token,
    body: { amount: 501 },
  });
  ok(lockedEdit.status === 403, 'locked period blocks accountant edits');
  const adminEdit = await api('PATCH', `/api/accounting/${exp.json.id}`, { token: admin.token, body: { amount: 501 } });
  ok(adminEdit.status === 200, 'super admin can edit in locked period');
  await api('DELETE', `/api/accounting/periods/${thisMonth}`, { token: admin.token });

  console.log('— Permission matrix updates apply immediately —');
  const keeperEmail = `keeper-${Date.now()}@test.local`;
  const newMgr = await api('POST', '/api/users', {
    token: admin.token,
    body: { name: 'Test Storekeeper', email: keeperEmail, password: 'Keeper@123', role: 'staff', permissions: ['inventory.view'] },
  });
  ok(newMgr.status === 201, 'super admin creates manager with permissions');
  let keeper = await login(keeperEmail, 'Keeper@123');
  ok(
    (await api('GET', '/api/items?pageSize=5', { token: keeper.token })).status === 200 &&
      (await api('GET', '/api/customers', { token: keeper.token })).status === 403,
    'new manager sees only allowed module'
  );
  await api('PUT', `/api/users/${newMgr.json.id}/permissions`, {
    token: admin.token,
    body: { permissions: ['inventory.view', 'customers.view'] },
  });
  ok(
    (await api('GET', '/api/customers?pageSize=5', { token: keeper.token })).status === 200,
    'permission change applies to live session immediately'
  );
  await api('POST', `/api/users/${newMgr.json.id}/deactivate`, { token: admin.token });
  ok((await api('GET', '/api/items?pageSize=5', { token: keeper.token })).status === 401, 'deactivated account rejected immediately');

  console.log('— Audit log —');
  const auditList = await api('GET', '/api/audit?pageSize=10', { token: admin.token });
  ok(auditList.status === 200 && auditList.json.rows.length > 0, 'audit log has entries');
  const actions = new Set(auditList.json.rows.map((r) => r.action));
  ok(actions.has('login') && actions.has('create'), 'audit records logins and creates');

  console.log('— Dashboard & reports —');
  const dash = await api('GET', '/api/dashboard/summary', { token: admin.token });
  ok(dash.status === 200 && dash.json.kpis.items_in_stock > 0 && dash.json.charts.income_vs_expense.length > 0, 'dashboard summary');
  const inv = await api('GET', '/api/reports/inventory-valuation', { token: admin.token });
  ok(inv.status === 200 && inv.json.totals.cost_value > 0, 'inventory valuation report');
  const aging = await api('GET', '/api/reports/receivables-aging', { token: admin.token });
  ok(aging.status === 200, 'receivables aging report');
  const stmt = await api('GET', `/api/customers/${custId}/statement`, { token: admin.token });
  ok(stmt.status === 200 && stmt.json.entries.length > 0 && typeof stmt.json.entries[0].running_balance === 'number', 'customer statement with running balance');

  console.log('— Suppliers & purchase orders —');
  const epoch = Date.now();
  const supName = `Test Supplier ${epoch}`;
  const supCreate = await api('POST', '/api/suppliers', { token: admin.token, body: { name: supName } });
  ok(supCreate.status === 201 && !!supCreate.json.id, 'supplier created');
  const supId = supCreate.json.id;

  const poItemRow = items.json.rows.find((i) => i.status === 'active' && i.id !== target.id) || target;
  const poItemBefore = Number((await api('GET', `/api/items/${poItemRow.id}`, { token: admin.token })).json.quantity);

  const po = await api('POST', `/api/suppliers/${supId}/orders`, {
    token: admin.token,
    body: {
      items: [
        { item_id: poItemRow.id, quantity: 2, unit_cost: 100 },
        { item_text: 'smoke line', quantity: 1, unit_cost: 50 },
      ],
    },
  });
  ok(po.status === 201 && Number(po.json.total) === 250, `PO created with total 250 (got ${po.json?.total})`);
  const poId = po.json.id;

  const recv1 = await api('POST', `/api/suppliers/orders/${poId}/receive`, {
    token: admin.token,
    body: { lines: [{ index: 0, received_qty: 2 }] },
  });
  ok(recv1.status === 200 && recv1.json.status === 'partial', `partial receive accepted (${recv1.json?.status})`);

  const poItemAfter = Number((await api('GET', `/api/items/${poItemRow.id}`, { token: admin.token })).json.quantity);
  ok(poItemAfter === poItemBefore + 2, `PO receive increased stock by 2 (${poItemBefore} → ${poItemAfter})`);

  const movs = await api('GET', `/api/movements?item_id=${poItemRow.id}`, { token: admin.token });
  ok(
    movs.status === 200 && movs.json.rows.some((m) => m.movement_type === 'purchase' && m.reference_type === 'purchase_order' && Number(m.reference_id) === poId),
    'purchase movement with purchase_order reference logged'
  );

  const recv2 = await api('POST', `/api/suppliers/orders/${poId}/receive`, {
    token: admin.token,
    body: { lines: [{ index: 1, received_qty: 1 }] },
  });
  ok(recv2.status === 200 && recv2.json.status === 'received', `second receive completes PO (${recv2.json?.status})`);

  const supAfter = (await api('GET', `/api/suppliers/${supId}`, { token: admin.token })).json;
  ok(Number(supAfter.balance) === 250, `supplier balance is 250 (got ${supAfter.balance})`);

  const supPay = await api('POST', `/api/suppliers/${supId}/payments`, {
    token: admin.token,
    body: { amount: 250, method: 'cash', paid_at: new Date().toISOString().slice(0, 10) },
  });
  ok(
    supPay.status === 201 && Number(supPay.json.balance) === 0 && !!supPay.json.transaction_id,
    `supplier payment recorded, balance 0, transaction linked (balance=${supPay.json?.balance}, tx=${supPay.json?.transaction_id})`
  );

  const accLink = await api('GET', `/api/accounting?search=${encodeURIComponent(supName)}`, { token: accountant.token });
  ok(
    accLink.status === 200 && accLink.json.rows.some((t) => t.type === 'expense' && Number(t.amount) === 250),
    'supplier payment auto-created 250 expense entry in accounting'
  );

  const supDelete = await api('DELETE', `/api/suppliers/${supId}`, { token: admin.token });
  ok(supDelete.status === 200 && supDelete.json.ok === true, 'supplier with zero balance deleted');

  console.log('— Excel/CSV import —');
  const impItems = await api('POST', '/api/import', {
    token: admin.token,
    body: {
      type: 'items',
      rows: [
        { name: `Import Test A ${epoch}`, sku: `IMP-${epoch}a`, cost_price: 10, selling_price: 15, quantity: 3 },
        { name: `Import Test B ${epoch}`, sku: `IMP-${epoch}b`, cost_price: 5, selling_price: 8, quantity: 0 },
        { name: 'Import Test Dup', sku: target.sku },
      ],
    },
  });
  ok(
    impItems.status === 200 && impItems.json.inserted === 2 && impItems.json.errors.length === 1,
    `items import: 2 inserted, 1 duplicate-SKU error (got ${impItems.json?.inserted} inserted, ${impItems.json?.errors?.length} errors)`
  );

  let dupPhone = customers.json.rows.map((c) => c.phone).find((p) => p);
  if (!dupPhone) {
    const seed = await api('POST', '/api/customers', {
      token: admin.token,
      body: { name: `Phone Seed ${epoch}`, phone: `0188${String(epoch).slice(-8)}` },
    });
    dupPhone = seed.status === 201 ? seed.json.phone : null;
  }
  ok(!!dupPhone, 'existing customer phone found for duplicate test');
  if (dupPhone) {
    const impCusts = await api('POST', '/api/import', {
      token: admin.token,
      body: {
        type: 'customers',
        rows: [
          { name: `Import Cust ${epoch}`, phone: `0199${String(epoch).slice(-8)}` },
          { name: 'Import Dup', phone: dupPhone },
        ],
      },
    });
    ok(
      impCusts.status === 200 && impCusts.json.inserted === 1 && impCusts.json.errors.length === 1,
      `customers import: 1 inserted, 1 duplicate-phone error (got ${impCusts.json?.inserted} inserted, ${impCusts.json?.errors?.length} errors)`
    );
  }

  console.log('— Warehouses: capacity & detail —');
  const whEpoch = Date.now();
  const whCreate = await api('POST', '/api/warehouses', {
    token: admin.token,
    body: { name: `Test WH ${whEpoch}`, location: 'Cairo', capacity: 100 },
  });
  ok(
    whCreate.status === 201 && Number(whCreate.json.capacity) === 100,
    `warehouse created with capacity 100 (got ${whCreate.status}, capacity=${whCreate.json?.capacity})`
  );
  const whId = whCreate.json.id;

  const whList = await api('GET', '/api/warehouses', { token: admin.token });
  const whRow = Array.isArray(whList.json) ? whList.json.find((w) => w.id === whId) : null;
  ok(
    !!whRow &&
      Number(whRow.capacity) === 100 &&
      (whRow.utilization === null || typeof whRow.utilization === 'number') &&
      typeof whRow.units_in_stock === 'number',
    `warehouses list row: capacity 100, utilization number|null (${whRow?.utilization}), units_in_stock number (${whRow?.units_in_stock})`
  );

  let whDetail = await api('GET', `/api/warehouses/${whId}`, { token: admin.token });
  ok(
    whDetail.status === 200 &&
      whDetail.json.stats?.items_count === 0 &&
      Array.isArray(whDetail.json.items) &&
      whDetail.json.items.length === 0 &&
      Array.isArray(whDetail.json.movements),
    `warehouse detail empty: items_count 0, items [], movements present (items_count=${whDetail.json?.stats?.items_count})`
  );

  const whItem = await api('POST', '/api/items', {
    token: admin.token,
    body: { name: `WH Test Item ${whEpoch}`, cost_price: 10, selling_price: 20, initial_quantity: 5, warehouse_id: whId },
  });
  ok(whItem.status === 201 && !!whItem.json.id, `item created inside new warehouse (got ${whItem.status})`);

  whDetail = await api('GET', `/api/warehouses/${whId}`, { token: admin.token });
  ok(
    whDetail.status === 200 && whDetail.json.stats?.total_quantity === 5 && whDetail.json.items?.length === 1,
    `warehouse detail after item: total_quantity 5, 1 item (got ${whDetail.json?.stats?.total_quantity}, ${whDetail.json?.items?.length})`
  );

  const whItemDelete = await api('DELETE', `/api/items/${whItem.json.id}`, { token: admin.token });
  ok(whItemDelete.status === 200 && whItemDelete.json.ok === true, 'warehouse test item deleted');

  const whPatch = await api('PATCH', `/api/warehouses/${whId}`, { token: admin.token, body: { capacity: 200 } });
  ok(
    whPatch.status === 200 && Number(whPatch.json.capacity) === 200,
    `warehouse capacity patched to 200 (got ${whPatch.status}, capacity=${whPatch.json?.capacity})`
  );

  const whDelete = await api('DELETE', `/api/warehouses/${whId}`, { token: admin.token });
  ok(whDelete.status === 200 && whDelete.json.ok === true, 'empty warehouse deleted');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

run().catch((e) => {
  console.error('smoke crashed:', e);
  process.exit(1);
});
