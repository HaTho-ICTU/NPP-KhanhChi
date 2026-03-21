/**
 * Main app: routing, navigation, initialization.
 */
const App = (() => {
  let currentPage = 'invoice';

  const PAGE_TITLES = {
    invoice: 'Ghi đơn',
    orders: 'Đơn hàng',
    history: 'Lịch sử',
    sync: 'Đồng bộ'
  };

  function navigate(page) {
    currentPage = page;
    const content = document.getElementById('app-content');
    const title = document.getElementById('header-title');
    title.textContent = PAGE_TITLES[page] || '';

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Scroll to top
    content.scrollTop = 0;
    window.scrollTo(0, 0);

    // Render page
    switch (page) {
      case 'invoice':
        Invoice.render(content);
        break;
      case 'orders':
        Sync.renderOrders(content);
        break;
      case 'history':
        History.render(content);
        break;
      case 'sync':
        Sync.render(content);
        break;
    }
  }

  async function init() {
    // Open database
    await DB.open();

    // Setup navigation
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Start cloud auto-sync (retry pending orders)
    if (typeof Cloud !== 'undefined' && Cloud.isConfigured()) {
      Cloud.startAutoSync();

      // Auto-download master data if IndexedDB is empty
      const customerCount = await DB.customers.count();
      if (customerCount === 0 && navigator.onLine) {
        Cloud.downloadMasterData().then(() => {
          UI.toast('Đã tải dữ liệu từ cloud');
        }).catch(() => {});
      }
    }

    // Start on invoice page
    navigate('invoice');
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return { navigate };
})();
