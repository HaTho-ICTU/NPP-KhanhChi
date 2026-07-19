/**
 * Sync module: import master data, export orders.
 */
const Sync = (() => {

  // === Render sync page ===
  async function render(container) {
    const customerCount = await DB.customers.count();
    const productCount = await DB.products.count();
    const orderCount = await DB.invoices.count();
    const pendingCount = (typeof Cloud !== 'undefined') ? await Cloud.getPendingCount() : 0;
    const isOnline = navigator.onLine;
    const cloudReady = (typeof Cloud !== 'undefined') && Cloud.isConfigured();

    container.innerHTML = `
      <!-- Current data stats -->
      <div class="card">
        <div class="card-title">Dữ liệu hiện tại</div>
        <div class="sync-stat">
          <div class="stat-box">
            <div class="stat-number">${customerCount}</div>
            <div class="stat-label">Khách hàng</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${productCount}</div>
            <div class="stat-label">Sản phẩm</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${orderCount}</div>
            <div class="stat-label">Đơn hàng</div>
          </div>
        </div>
      </div>

      <!-- Cloud sync section -->
      <div class="card">
        <div class="card-title">Đồng bộ Cloud</div>
        <div class="flex-between mb-12">
          <span class="text-secondary" style="font-size:0.85rem;">
            Trạng thái: <span style="color:${isOnline ? 'var(--green)' : 'var(--red)'};">${isOnline ? 'Online' : 'Offline'}</span>
            ${pendingCount > 0 ? ` · <span style="color:var(--amber);">${pendingCount} đơn chờ gửi</span>` : ''}
          </span>
        </div>
        <button class="btn btn-primary btn-block mb-8" id="cloud-download-btn" ${!cloudReady ? 'disabled' : ''}>
          Tải dữ liệu từ cloud
        </button>
        ${pendingCount > 0 ? `
          <button class="btn btn-success btn-block mb-8" id="cloud-retry-btn">
            Gửi ${pendingCount} đơn chờ lên cloud
          </button>
        ` : ''}
        <div id="cloud-status" class="mt-8" style="font-size:0.85rem;"></div>
        ${!cloudReady ? '<p class="text-secondary" style="font-size:0.8rem;">Cloud chưa được cấu hình.</p>' : ''}
      </div>

      <!-- Account -->
      <div class="card">
        <div class="card-title">Tài khoản</div>
        <p class="text-secondary" style="font-size:0.85rem;margin-bottom:4px;">
          Đăng nhập: ${Auth.email() || '—'}
        </p>
        <p class="text-secondary mb-12" style="font-size:0.8rem;">
          Phiên bản: ${window.APP_VERSION || ''}
        </p>
        <button class="btn btn-outline btn-block" id="logout-btn">Đăng xuất</button>
      </div>

      <!-- Danger zone -->
      <div class="card">
        <div class="card-title" style="color:var(--red);">Xoá dữ liệu</div>
        <button class="btn btn-danger btn-outline btn-block btn-sm" id="clear-orders-btn" style="color:var(--red);border-color:var(--red);">
          Xoá tất cả đơn hàng
        </button>
      </div>
    `;

    setupCloud();
    setupAccount();
    setupClear();
  }

  // === Account / logout ===
  function setupAccount() {
    const btn = document.getElementById('logout-btn');
    if (!btn) return;
    btn.onclick = () => {
      UI.confirm('Đăng xuất khỏi tài khoản?', () => {
        Auth.logout();
        location.reload();
      });
    };
  }

  // === Cloud sync ===
  function setupCloud() {
    const downloadBtn = document.getElementById('cloud-download-btn');
    const retryBtn = document.getElementById('cloud-retry-btn');
    const status = document.getElementById('cloud-status');

    if (downloadBtn) {
      downloadBtn.onclick = async () => {
        if (typeof Cloud === 'undefined' || !Cloud.isConfigured()) {
          UI.toast('Cloud chưa cấu hình');
          return;
        }
        try {
          status.innerHTML = '<span style="color:var(--blue);">Đang tải...</span>';
          const result = await Cloud.downloadMasterData();
          status.innerHTML = `<span style="color:var(--green);">Thành công! ${result.customers} khách hàng, ${result.products} sản phẩm.</span>`;
          UI.toast('Đã tải dữ liệu từ cloud');
          setTimeout(() => Sync.render(document.getElementById('app-content')), 1500);
        } catch (err) {
          status.innerHTML = `<span style="color:var(--red);">Lỗi: ${err.message}</span>`;
          UI.toast('Lỗi tải dữ liệu');
        }
      };
    }

    if (retryBtn) {
      retryBtn.onclick = async () => {
        try {
          status.innerHTML = '<span style="color:var(--blue);">Đang gửi...</span>';
          const count = await Cloud.syncPending();
          status.innerHTML = `<span style="color:var(--green);">Đã gửi ${count} đơn lên cloud.</span>`;
          UI.toast(`Đã gửi ${count} đơn`);
          setTimeout(() => Sync.render(document.getElementById('app-content')), 1500);
        } catch (err) {
          status.innerHTML = `<span style="color:var(--red);">Lỗi: ${err.message}</span>`;
        }
      };
    }
  }

  // === Clear orders ===
  function setupClear() {
    document.getElementById('clear-orders-btn').onclick = () => {
      UI.confirm('Xoá tất cả đơn hàng đã ghi?', async () => {
        await DB.invoices.clear();
        UI.toast('Đã xoá tất cả đơn hàng');
        Sync.render(document.getElementById('app-content'));
      });
    };
  }

  // === Orders list page ===
  async function renderOrders(container) {
    const invoices = await DB.invoices.getToday();
    const allInvoices = await DB.invoices.getAll();

    // Date filter
    container.innerHTML = `
      <div class="card">
        <div class="flex-between mb-8">
          <div class="card-title" style="margin-bottom:0;">Đơn hàng hôm nay</div>
          <button class="btn btn-outline btn-xs" id="show-all-orders">Tất cả (${allInvoices.length})</button>
        </div>
        <div id="orders-list">
          ${invoices.length === 0
            ? '<div class="empty-state"><p>Chưa có đơn hàng nào hôm nay</p></div>'
            : invoices.map((inv) => renderOrderCard(inv)).join('')
          }
        </div>
      </div>
    `;

    bindOrderCards();

    document.getElementById('show-all-orders').onclick = () => {
      renderAllOrders(container);
    };
  }

  async function renderAllOrders(container) {
    const invoices = await DB.invoices.getAll();

    container.innerHTML = `
      <div class="card">
        <div class="flex-between mb-8">
          <div class="card-title" style="margin-bottom:0;">Tất cả đơn hàng</div>
          <button class="btn btn-outline btn-xs" id="show-today-orders">Hôm nay</button>
        </div>
        <div id="orders-list">
          ${invoices.length === 0
            ? '<div class="empty-state"><p>Chưa có đơn hàng nào</p></div>'
            : invoices.map((inv) => renderOrderCard(inv)).join('')
          }
        </div>
      </div>
    `;

    bindOrderCards();

    document.getElementById('show-today-orders').onclick = () => {
      renderOrders(container);
    };
  }

  function renderOrderCard(inv) {
    const name = inv.customer_name || inv.guest_name || 'Khách lạ';
    const isG = !inv.customer_id;
    const itemCount = inv.details ? inv.details.length : 0;

    return `
      <div class="order-card" data-id="${inv.temp_id}">
        <div class="order-header">
          <div>
            <span class="order-customer">${name}</span>
            ${isG ? ' <span class="guest-tag">Khách lạ</span>' : ''}
          </div>
          <span class="order-total">${UI.formatCurrency(inv.total)}</span>
        </div>
        <div class="order-meta">${itemCount} sản phẩm &middot; ${UI.formatDate(inv.created_date)}</div>
      </div>
    `;
  }

  function bindOrderCards() {
    document.querySelectorAll('.order-card').forEach((card) => {
      card.onclick = () => showOrderDetail(card.dataset.id);
    });
  }

  async function showOrderDetail(tempId) {
    const inv = await DB.invoices.get(tempId);
    if (!inv) return;

    const name = inv.customer_name || inv.guest_name || 'Khách lạ';

    const detailsHtml = (inv.details || []).map((d) => `
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
      <div class="text-secondary text-center mb-12" style="font-size:0.8rem;">${UI.formatDate(inv.created_date)}</div>
      ${inv.note ? `<div class="mb-12" style="font-size:0.85rem;"><b>Ghi chú:</b> ${inv.note}</div>` : ''}
      ${detailsHtml}
      <div class="total-bar">
        <span class="total-label">Tổng cộng</span>
        <span class="total-amount">${UI.formatCurrency(inv.total)}</span>
      </div>
      <div class="action-row">
        <button class="btn btn-outline" id="modal-edit-btn">Sửa đơn</button>
        <button class="btn btn-danger" id="modal-delete-btn">Xoá</button>
      </div>
    `);

    document.getElementById('modal-edit-btn').onclick = () => {
      UI.closeModal();
      Invoice.edit(tempId);
    };

    document.getElementById('modal-delete-btn').onclick = () => {
      UI.confirm('Xoá đơn hàng này?', async () => {
        // Xoá trên cloud trước (nếu online) để desktop không thấy đơn đã xoá
        let cloudOk = true;
        if (typeof Cloud !== 'undefined' && Cloud.isConfigured()) {
          cloudOk = await Cloud.deleteOrder(tempId);
        }
        await DB.invoices.delete(tempId);
        UI.toast(cloudOk ? 'Đã xoá đơn hàng' : 'Đã xoá nhưng chưa đồng bộ cloud');
        App.navigate('orders');
      });
    };
  }

  return { render, renderOrders };
})();
