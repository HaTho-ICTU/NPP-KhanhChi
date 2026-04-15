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

      <!-- Import section (file backup) -->
      <div class="card">
        <div class="card-title">Nhập dữ liệu từ file (backup)</div>
        <p class="text-secondary mb-12" style="font-size:0.85rem;">
          Chọn file JSON đã xuất từ phần mềm desktop (khách hàng, sản phẩm, giá).
        </p>
        <input type="file" id="import-file" accept=".json" class="hidden">
        <button class="btn btn-outline btn-block" id="import-btn">
          Chọn file để nhập
        </button>
        <div id="import-status" class="mt-8" style="font-size:0.85rem;"></div>
      </div>

      <!-- Export section (file backup) -->
      <div class="card">
        <div class="card-title">Xuất đơn hàng qua file (backup)</div>
        <p class="text-secondary mb-12" style="font-size:0.85rem;">
          Xuất tất cả đơn hàng thành file JSON để nhập vào phần mềm desktop.
        </p>
        <div class="form-group">
          <label class="form-label">Từ ngày</label>
          <input type="date" class="form-input" id="export-start" value="${todayStr()}">
        </div>
        <div class="form-group">
          <label class="form-label">Đến ngày</label>
          <input type="date" class="form-input" id="export-end" value="${todayStr()}">
        </div>
        <button class="btn btn-success btn-block" id="export-btn">
          Xuất đơn hàng
        </button>
        <div id="export-status" class="mt-8" style="font-size:0.85rem;"></div>
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
    setupImport();
    setupExport();
    setupClear();
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
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

  // === Import master data ===
  function setupImport() {
    const fileInput = document.getElementById('import-file');
    const btn = document.getElementById('import-btn');
    const status = document.getElementById('import-status');

    btn.onclick = () => fileInput.click();

    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        status.textContent = 'Đang đọc file...';
        const text = await file.text();
        const data = JSON.parse(text);

        // Import regions
        if (data.regions && data.regions.length) {
          await DB.regions.clear();
          await DB.regions.importAll(data.regions);
        }

        // Import customers
        if (data.customers && data.customers.length) {
          await DB.customers.importAll(data.customers);
        }

        // Import products + prices
        if (data.products) {
          await DB.products.importAll(
            data.products || [],
            data.product_prices || []
          );
        }

        const cCount = data.customers ? data.customers.length : 0;
        const pCount = data.products ? data.products.length : 0;

        status.innerHTML = `<span style="color:var(--green);">Thành công! Đã nhập ${cCount} khách hàng, ${pCount} sản phẩm.</span>`;
        UI.toast('Nhập dữ liệu thành công');

        // Update stat boxes
        setTimeout(() => Sync.render(document.getElementById('app-content')), 1500);
      } catch (err) {
        status.innerHTML = `<span style="color:var(--red);">Lỗi: ${err.message}</span>`;
        UI.toast('Lỗi khi nhập dữ liệu');
      }

      // Reset file input
      fileInput.value = '';
    };
  }

  // === Export orders ===
  function setupExport() {
    document.getElementById('export-btn').onclick = async () => {
      const startDate = document.getElementById('export-start').value;
      const endDate = document.getElementById('export-end').value;
      const status = document.getElementById('export-status');

      if (!startDate || !endDate) {
        UI.toast('Chọn ngày trước');
        return;
      }

      const invoices = await DB.invoices.getByDateRange(startDate, endDate);

      if (invoices.length === 0) {
        status.innerHTML = '<span style="color:var(--amber);">Không có đơn hàng nào trong khoảng thời gian này.</span>';
        return;
      }

      const exportData = {
        exported_at: UI.nowString(),
        invoices: invoices.map((inv) => ({
          temp_id: inv.temp_id,
          customer_id: inv.customer_id,
          guest_name: inv.guest_name,
          guest_address: inv.guest_address,
          created_date: inv.created_date,
          total: inv.total,
          note: inv.note || '',
          details: (inv.details || []).map((d) => ({
            product_id: d.product_id,
            quantity: d.quantity,
            price: d.price,
            subtotal: d.subtotal,
            item_type: d.item_type || 'product',
            note: d.note || ''
          }))
        }))
      };

      // Download JSON - dùng Web Share API trên iOS, fallback blob download
      const jsonStr = JSON.stringify(exportData, null, 2);
      const fileName = `orders_${startDate}_${endDate}.json`;

      if (navigator.share && navigator.canShare) {
        // iOS/mobile: dùng Share API để lưu vào Files hoặc gửi đi
        const file = new File([jsonStr], fileName, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Xuất đơn hàng' });
            status.innerHTML = `<span style="color:var(--green);">Đã xuất ${invoices.length} đơn hàng.</span>`;
            UI.toast('Xuất đơn hàng thành công');
            return;
          } catch (e) {
            if (e.name === 'AbortError') return; // user cancelled
          }
        }
      }

      // Fallback: blob download (Android/desktop)
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      status.innerHTML = `<span style="color:var(--green);">Đã xuất ${invoices.length} đơn hàng.</span>`;
      UI.toast('Xuất đơn hàng thành công');
    };
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
