/**
 * Supabase REST client for cloud sync.
 * Auto-upload orders, download master data, offline fallback.
 */
const Cloud = (() => {
  // Config được load từ config.js (window.CLOUD_CONFIG)
  // File config.js không push lên GitHub, GitHub Actions tạo từ Secrets
  const CONFIG = window.CLOUD_CONFIG || { url: '', anonKey: '' };

  function headers() {
    return {
      'apikey': CONFIG.anonKey,
      'Authorization': `Bearer ${CONFIG.anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  async function request(method, path, body) {
    return requestWithHeaders(method, path, body);
  }

  async function requestWithHeaders(method, path, body, extraHeaders) {
    const url = `${CONFIG.url}/rest/v1/${path}`;
    const hdrs = { ...headers(), ...extraHeaders };
    const opts = { method, headers: hdrs };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Supabase ${resp.status}: ${text}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  // === Download master data from cloud ===
  async function downloadMasterData() {
    const rows = await request('GET', 'cloud_master_data?id=eq.1&select=data_json,updated_at');
    if (!rows || rows.length === 0) {
      throw new Error('Chưa có dữ liệu trên cloud. Hãy đẩy từ desktop trước.');
    }

    const dataJson = rows[0].data_json;
    if (!dataJson || dataJson === '{}') {
      throw new Error('Dữ liệu cloud rỗng. Hãy đẩy master data từ desktop.');
    }

    const data = JSON.parse(dataJson);

    // Import vào IndexedDB
    if (data.regions && data.regions.length) {
      await DB.regions.clear();
      await DB.regions.importAll(data.regions);
    }
    if (data.customers && data.customers.length) {
      await DB.customers.importAll(data.customers);
    }
    if (data.products) {
      await DB.products.importAll(data.products || [], data.product_prices || []);
    }

    return {
      customers: data.customers ? data.customers.length : 0,
      products: data.products ? data.products.length : 0,
      updated_at: rows[0].updated_at || data.exported_at
    };
  }

  // === Upload a single order to cloud ===
  async function uploadOrder(invoice) {
    if (!navigator.onLine) {
      // Mark as pending — will retry when online
      invoice.cloud_status = 'pending';
      await DB.invoices.save(invoice);
      return false;
    }

    try {
      // Upload order header (upsert by temp_id to prevent duplicates on retry)
      await requestWithHeaders('POST', 'cloud_orders', {
        temp_id: invoice.temp_id,
        customer_id: invoice.customer_id,
        customer_name: invoice.customer_name,
        guest_name: invoice.guest_name,
        guest_address: invoice.guest_address,
        created_date: invoice.created_date,
        total: invoice.total,
        note: invoice.note || ''
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      // Upload order details (delete old + re-insert to avoid partial duplicates)
      if (invoice.details && invoice.details.length > 0) {
        // Xoá details cũ nếu có (retry case)
        await request('DELETE', `cloud_order_details?order_temp_id=eq.${invoice.temp_id}`);

        const details = invoice.details.map((d) => ({
          order_temp_id: invoice.temp_id,
          product_id: d.product_id,
          product_name: d.product_name || '',
          quantity: d.quantity,
          price: d.price,
          subtotal: d.subtotal,
          item_type: d.item_type || 'product',
          note: d.note || '',
          unit: d.unit || ''
        }));
        await request('POST', 'cloud_order_details', details);
      }

      // Mark as synced in IndexedDB
      invoice.cloud_status = 'synced';
      await DB.invoices.save(invoice);
      return true;

    } catch (err) {
      // If conflict (duplicate temp_id) → already uploaded
      if (err.message && err.message.includes('409')) {
        invoice.cloud_status = 'synced';
        await DB.invoices.save(invoice);
        return true;
      }
      // Otherwise mark pending for retry
      invoice.cloud_status = 'pending';
      await DB.invoices.save(invoice);
      console.warn('Cloud upload failed:', err.message);
      return false;
    }
  }

  // === Sync all pending orders ===
  async function syncPending() {
    const pending = await DB.invoices.getPending();
    if (pending.length === 0) return 0;

    let synced = 0;
    for (const inv of pending) {
      const ok = await uploadOrder(inv);
      if (ok) synced++;
    }
    return synced;
  }

  // === Auto-sync: retry pending when coming online ===
  function startAutoSync() {
    window.addEventListener('online', async () => {
      const count = await syncPending();
      if (count > 0) {
        UI.toast(`Đã đồng bộ ${count} đơn lên cloud`);
      }
    });

    // Also try syncing immediately if online
    if (navigator.onLine) {
      syncPending().then((count) => {
        if (count > 0) UI.toast(`Đã đồng bộ ${count} đơn lên cloud`);
      }).catch(() => {});
    }
  }

  // === Check if cloud is configured ===
  function isConfigured() {
    return CONFIG.url && CONFIG.anonKey && !CONFIG.anonKey.includes('PLACEHOLDER');
  }

  // === Get pending order count ===
  async function getPendingCount() {
    const pending = await DB.invoices.getPending();
    return pending.length;
  }

  // === Download invoice history from cloud ===
  async function downloadHistory(startDate, endDate) {
    if (!isConfigured()) throw new Error('Cloud chưa được cấu hình');
    if (!navigator.onLine) throw new Error('Cần kết nối internet để xem lịch sử');

    let path = 'cloud_orders?select=*&order=created_date.desc';
    if (startDate) path += `&created_date=gte.${startDate}`;
    if (endDate) path += `&created_date=lte.${endDate} 23:59:59`;
    path += '&limit=200';

    const orders = await request('GET', path) || [];

    // Fetch details in batches of 50
    const tempIds = orders.map(o => o.temp_id);
    let allDetails = [];
    for (let i = 0; i < tempIds.length; i += 50) {
      const batch = tempIds.slice(i, i + 50);
      const inList = batch.join(',');
      const details = await request('GET',
        `cloud_order_details?order_temp_id=in.(${inList})`
      ) || [];
      allDetails = allDetails.concat(details);
    }

    // Merge details into orders
    const detailMap = {};
    for (const d of allDetails) {
      if (!detailMap[d.order_temp_id]) detailMap[d.order_temp_id] = [];
      detailMap[d.order_temp_id].push(d);
    }
    for (const order of orders) {
      order.details = detailMap[order.temp_id] || [];
    }

    return orders;
  }

  return { downloadMasterData, uploadOrder, syncPending, startAutoSync, isConfigured, getPendingCount, downloadHistory };
})();
