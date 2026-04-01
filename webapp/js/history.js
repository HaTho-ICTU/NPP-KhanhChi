/**
 * Invoice history page — displays all orders from cloud (desktop + webapp).
 * Read-only viewing, requires internet connection.
 */
const History = (() => {
  let currentOrders = [];

  function formatDateHeader(dateStr) {
    const d = new Date(dateStr);
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const pad = n => String(n).padStart(2, '0');
    return `${days[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  async function render(container) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const wa = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const weekAgo = `${wa.getFullYear()}-${pad(wa.getMonth() + 1)}-${pad(wa.getDate())}`;

    container.innerHTML = `
      <div class="card">
        <div class="card-title">Lịch sử đơn hàng</div>
        <div class="history-filter">
          <div class="form-group" style="flex:1;margin-bottom:0;">
            <label class="form-label">Từ ngày</label>
            <input type="date" class="form-input" id="history-start" value="${weekAgo}">
          </div>
          <div class="form-group" style="flex:1;margin-bottom:0;">
            <label class="form-label">Đến ngày</label>
            <input type="date" class="form-input" id="history-end" value="${today}">
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="history-load-btn" style="margin-top:12px;">
          Tải lịch sử
        </button>
        <div id="history-status" style="font-size:0.85rem;margin-top:8px;"></div>
      </div>
      <div id="history-list"></div>
    `;

    document.getElementById('history-load-btn').onclick = loadHistory;

    // Auto-load if online
    if (navigator.onLine && typeof Cloud !== 'undefined' && Cloud.isConfigured()) {
      loadHistory();
    } else if (!navigator.onLine) {
      document.getElementById('history-status').innerHTML =
        '<span style="color:var(--amber);">Cần kết nối internet để xem lịch sử.</span>';
    }
  }

  async function loadHistory() {
    const startDate = document.getElementById('history-start').value;
    const endDate = document.getElementById('history-end').value;
    const status = document.getElementById('history-status');
    const listEl = document.getElementById('history-list');

    if (!startDate || !endDate) {
      UI.toast('Chọn ngày trước');
      return;
    }

    try {
      status.innerHTML = '<span style="color:var(--blue);">Đang tải...</span>';
      listEl.innerHTML = '';

      currentOrders = await Cloud.downloadHistory(startDate, endDate);

      if (currentOrders.length === 0) {
        status.innerHTML = '<span style="color:var(--amber);">Không có đơn hàng nào.</span>';
        listEl.innerHTML = '<div class="empty-state"><p>Không có đơn hàng trong khoảng thời gian này</p></div>';
        return;
      }

      const grandTotal = currentOrders.reduce((s, o) => s + (o.total || 0), 0);
      status.innerHTML = `<span style="color:var(--green);">${currentOrders.length} đơn hàng · ${UI.formatCurrency(grandTotal)}</span>`;
      renderOrderList(currentOrders, listEl);

    } catch (err) {
      status.innerHTML = `<span style="color:var(--red);">Lỗi: ${err.message}</span>`;
    }
  }

  function renderOrderList(orders, container) {
    // Group by date
    const grouped = {};
    for (const order of orders) {
      const date = order.created_date.slice(0, 10);
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(order);
    }

    let html = '';
    for (const [date, dateOrders] of Object.entries(grouped)) {
      const dayTotal = dateOrders.reduce((s, o) => s + (o.total || 0), 0);
      html += `
        <div class="card">
          <div class="flex-between" style="margin-bottom:8px;">
            <div class="card-title" style="margin-bottom:0;">${formatDateHeader(date)}</div>
            <span class="text-secondary" style="font-size:0.8rem;">
              ${dateOrders.length} đơn · ${UI.formatCurrency(dayTotal)}
            </span>
          </div>
          ${dateOrders.map(o => renderHistoryCard(o)).join('')}
        </div>
      `;
    }
    container.innerHTML = html;

    // Click handlers
    container.querySelectorAll('.history-order-card').forEach(card => {
      card.onclick = () => {
        const tempId = card.dataset.tempId;
        const order = currentOrders.find(o => o.temp_id === tempId);
        if (order) showDetail(order);
      };
    });
  }

  function renderHistoryCard(order) {
    const name = order.customer_name || order.guest_name || 'Khách lạ';
    const isGuest = !order.customer_id;
    const itemCount = order.details ? order.details.length : 0;
    const source = order.source || 'webapp';
    const sourceBadge = source === 'desktop'
      ? '<span class="source-badge source-desktop">Máy tính</span>'
      : '<span class="source-badge source-webapp">Webapp</span>';

    return `
      <div class="history-order-card order-card" data-temp-id="${order.temp_id}">
        <div class="order-header">
          <div>
            <span class="order-customer">${name}</span>
            ${isGuest ? ' <span class="guest-tag">Khách lạ</span>' : ''}
            ${sourceBadge}
          </div>
          <span class="order-total">${UI.formatCurrency(order.total)}</span>
        </div>
        <div class="order-meta">${itemCount} sản phẩm · ${UI.formatDate(order.created_date)}</div>
      </div>
    `;
  }

  function showDetail(order) {
    const name = order.customer_name || order.guest_name || 'Khách lạ';
    const source = order.source || 'webapp';
    const sourceLabel = source === 'desktop' ? 'Máy tính' : 'Webapp';

    const detailsHtml = (order.details || []).map(d => `
      <div class="item-row">
        <div class="item-info">
          <div class="item-name">${d.product_name || 'Sản phẩm'}</div>
          <div class="item-detail">${d.quantity} x ${UI.formatCurrency(d.price)}</div>
        </div>
        <div class="item-subtotal">${UI.formatCurrency(d.subtotal)}</div>
      </div>
    `).join('');

    UI.showModal(`
      <div class="modal-title">${name}</div>
      <div class="text-secondary" style="text-align:center;font-size:0.8rem;margin-bottom:12px;">
        ${UI.formatDate(order.created_date)} · ${sourceLabel}
      </div>
      ${order.note ? `<div style="font-size:0.85rem;margin-bottom:12px;"><b>Ghi chú:</b> ${order.note}</div>` : ''}
      ${detailsHtml}
      <div class="total-bar">
        <span class="total-label">Tổng cộng</span>
        <span class="total-amount">${UI.formatCurrency(order.total)}</span>
      </div>
    `);
  }

  return { render };
})();
