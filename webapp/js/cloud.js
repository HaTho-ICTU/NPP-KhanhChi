/**
 * Supabase REST client (cloud-only, schema chuẩn hoá).
 * Đọc master data + ghi đơn thẳng vào bảng invoices/invoice_details.
 * Xác thực bằng user JWT (Auth). Có đệm offline: đơn lưu tạm, tự gửi khi có mạng.
 */
const Cloud = (() => {
  const CONFIG = window.CLOUD_CONFIG || { url: '', anonKey: '' };

  async function authHeaders(extra) {
    const token = await Auth.getAccessToken();
    return {
      'apikey': CONFIG.anonKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(extra || {}),
    };
  }

  async function requestWithHeaders(method, path, body, extraHeaders) {
    const url = `${CONFIG.url}/rest/v1/${path}`;
    const doFetch = async () => {
      const opts = { method, headers: await authHeaders(extraHeaders) };
      if (body) opts.body = JSON.stringify(body);
      return fetch(url, opts);
    };
    let resp = await doFetch();
    if (resp.status === 401) {
      // access token có thể vừa hết hạn → refresh rồi thử lại 1 lần
      await Auth.refresh();
      resp = await doFetch();
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Supabase ${resp.status}: ${text}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  function request(method, path, body) {
    return requestWithHeaders(method, path, body);
  }

  function nextDay(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // === Tải master data từ cloud (các bảng chuẩn hoá) ===
  async function downloadMasterData() {
    const regions = await request('GET', 'regions?select=*&order=name') || [];
    const customers = await request('GET', 'customers?select=*&order=name') || [];
    const products = await request('GET', 'products?select=*&order=name') || [];
    const prices = await request('GET', 'product_prices?select=*') || [];

    await DB.regions.clear();
    if (regions.length) await DB.regions.importAll(regions);
    await DB.customers.importAll(customers);
    await DB.products.importAll(products, prices);

    return { customers: customers.length, products: products.length };
  }

  // === Gửi 1 đơn lên cloud (upsert theo client_uuid) ===
  async function uploadOrder(invoice) {
    if (!navigator.onLine) {
      invoice.cloud_status = 'pending';
      await DB.invoices.save(invoice);
      return false;
    }

    try {
      // Upsert header, lấy lại id để ghi chi tiết
      const rows = await requestWithHeaders('POST', 'invoices?on_conflict=client_uuid', {
        client_uuid: invoice.temp_id,
        customer_id: invoice.customer_id,
        guest_name: invoice.guest_name,
        guest_address: invoice.guest_address,
        created_date: invoice.created_date,
        total: invoice.total,
        note: invoice.note || '',
        source: 'webapp',
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      const invoiceId = rows && rows[0] && rows[0].id;
      if (!invoiceId) throw new Error('Không lấy được id hóa đơn');

      // Ghi lại chi tiết: xoá cũ + chèn mới (tránh trùng khi gửi lại)
      await request('DELETE', `invoice_details?invoice_id=eq.${invoiceId}`);
      if (invoice.details && invoice.details.length > 0) {
        const details = invoice.details.map((d) => ({
          invoice_id: invoiceId,
          product_id: d.product_id,
          quantity: d.quantity,
          price: d.price,
          subtotal: d.subtotal,
          item_type: d.item_type || 'product',
          note: d.note || '',
        }));
        await request('POST', 'invoice_details', details);
      }

      invoice.cloud_status = 'synced';
      await DB.invoices.save(invoice);
      return true;
    } catch (err) {
      invoice.cloud_status = 'pending';
      await DB.invoices.save(invoice);
      console.warn('Cloud upload failed:', err.message);
      return false;
    }
  }

  // === Gửi tất cả đơn còn chờ ===
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

  // === Tự gửi lại đơn chờ khi có mạng ===
  function startAutoSync() {
    window.addEventListener('online', async () => {
      const count = await syncPending();
      if (count > 0) UI.toast(`Đã đồng bộ ${count} đơn lên cloud`);
    });
    if (navigator.onLine) {
      syncPending().then((count) => {
        if (count > 0) UI.toast(`Đã đồng bộ ${count} đơn lên cloud`);
      }).catch(() => {});
    }
  }

  function isConfigured() {
    return CONFIG.url && CONFIG.anonKey && !CONFIG.anonKey.includes('PLACEHOLDER');
  }

  async function getPendingCount() {
    const pending = await DB.invoices.getPending();
    return pending.length;
  }

  // === Xoá đơn trên cloud (chi tiết cascade) ===
  async function deleteOrder(clientUuid) {
    if (!isConfigured() || !navigator.onLine) return false;
    try {
      await request('DELETE', `invoices?client_uuid=eq.${clientUuid}`);
      return true;
    } catch (err) {
      console.warn('Cloud delete failed:', err.message);
      return false;
    }
  }

  // === Tải lịch sử đơn từ cloud (1 query, nhúng khách + chi tiết + sản phẩm) ===
  async function downloadHistory(startDate, endDate) {
    if (!isConfigured()) throw new Error('Cloud chưa được cấu hình');
    if (!navigator.onLine) throw new Error('Cần kết nối internet để xem lịch sử');

    let path = 'invoices?select=id,client_uuid,customer_id,guest_name,guest_address,'
      + 'created_date,total,note,source,customers(name),'
      + 'invoice_details(product_id,quantity,price,subtotal,item_type,note,products(name,unit))'
      + '&order=created_date.desc';
    if (startDate) path += `&created_date=gte.${startDate}`;
    if (endDate) path += `&created_date=lt.${nextDay(endDate)}`;
    path += '&limit=300';

    const rows = await request('GET', path) || [];
    return rows.map(shapeHistoryOrder);
  }

  function shapeHistoryOrder(o) {
    const custName = (o.customers && o.customers.name) || o.guest_name || 'Khách lạ';
    const details = (o.invoice_details || []).map((d) => {
      let pname = (d.products && d.products.name) || '';
      if (d.item_type === 'other' && d.note) {
        pname = d.note.startsWith('Khuyến mãi')
          ? `[Khuyến mãi] ${d.note.slice('Khuyến mãi'.length).trim()}`
          : `[Khác] ${d.note}`;
      }
      return {
        product_id: d.product_id, product_name: pname, quantity: d.quantity,
        price: d.price, subtotal: d.subtotal, item_type: d.item_type, note: d.note,
      };
    });
    return {
      temp_id: o.client_uuid,   // history.js dùng temp_id làm khóa
      customer_id: o.customer_id,
      customer_name: custName,
      guest_name: o.guest_name,
      created_date: o.created_date,
      total: o.total,
      note: o.note,
      source: o.source || 'webapp',
      details,
    };
  }

  return {
    downloadMasterData, uploadOrder, deleteOrder, syncPending, startAutoSync,
    isConfigured, getPendingCount, downloadHistory,
  };
})();
