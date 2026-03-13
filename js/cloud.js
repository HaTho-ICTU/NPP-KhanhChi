/**
 * Supabase REST client for cloud sync.
 * Auto-upload orders, download master data, offline fallback.
 */
const Cloud = (() => {
  // === Config ===
  const CONFIG = {
    url: 'https://pkiqvhckeymplqmnitns.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBraXF2aGNrZXltcGxxbW5pdG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDc4ODAsImV4cCI6MjA4ODkyMzg4MH0.Qhn7ZE5FZ_-MELPZXH3YaJDg9bopBpus-RIrKvMZ_Js',
  };

  function headers() {
    return {
      'apikey': CONFIG.anonKey,
      'Authorization': `Bearer ${CONFIG.anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  async function request(method, path, body) {
    const url = `${CONFIG.url}/rest/v1/${path}`;
    const opts = { method, headers: headers() };
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
      // Upload order header
      await request('POST', 'cloud_orders', {
        temp_id: invoice.temp_id,
        customer_id: invoice.customer_id,
        customer_name: invoice.customer_name,
        guest_name: invoice.guest_name,
        guest_address: invoice.guest_address,
        created_date: invoice.created_date,
        total: invoice.total,
        note: invoice.note || ''
      });

      // Upload order details
      if (invoice.details && invoice.details.length > 0) {
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

  return { downloadMasterData, uploadOrder, syncPending, startAutoSync, isConfigured, getPendingCount };
})();
