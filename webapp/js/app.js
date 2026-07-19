/**
 * Main app: routing, navigation, initialization, cổng đăng nhập.
 */
const App = (() => {
  let currentPage = 'invoice';

  const PAGE_TITLES = {
    invoice: 'Ghi đơn',
    orders: 'Đơn hàng',
    history: 'Lịch sử',
    sync: 'Đồng bộ',
  };

  function navigate(page) {
    currentPage = page;
    const content = document.getElementById('app-content');
    const title = document.getElementById('header-title');
    title.textContent = PAGE_TITLES[page] || '';

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    content.scrollTop = 0;
    window.scrollTo(0, 0);

    switch (page) {
      case 'invoice': Invoice.render(content); break;
      case 'orders': Sync.renderOrders(content); break;
      case 'history': History.render(content); break;
      case 'sync': Sync.render(content); break;
    }
  }

  // === Màn đăng nhập ===
  function showLogin() {
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('header-title').textContent = 'Đăng nhập';
    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="card">
        <div class="card-title">Đăng nhập</div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" class="form-input" id="login-email" autocomplete="username" inputmode="email">
        </div>
        <div class="form-group">
          <label class="form-label">Mật khẩu</label>
          <input type="password" class="form-input" id="login-password" autocomplete="current-password">
        </div>
        <div id="login-status" style="font-size:0.85rem;margin-bottom:10px;color:var(--red);"></div>
        <button class="btn btn-primary btn-block" id="login-btn">Đăng nhập</button>
      </div>
      <div class="text-secondary text-center" style="font-size:0.75rem;margin-top:10px;">
        ${window.APP_VERSION || ''}
      </div>
    `;

    const emailEl = document.getElementById('login-email');
    const pwEl = document.getElementById('login-password');
    const btn = document.getElementById('login-btn');
    const status = document.getElementById('login-status');

    async function submit() {
      const email = emailEl.value.trim();
      const pw = pwEl.value;
      if (!email || !pw) { status.textContent = 'Nhập email và mật khẩu.'; return; }
      btn.disabled = true;
      btn.textContent = 'Đang đăng nhập...';
      status.textContent = '';
      try {
        await Auth.login(email, pw);
        startApp();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Đăng nhập';
        status.textContent = friendlyError(err.message);
      }
    }

    btn.onclick = submit;
    pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    emailEl.focus();
  }

  function friendlyError(msg) {
    const low = (msg || '').toLowerCase();
    if (low.includes('invalid') || low.includes('credentials') || low.includes('grant') || low.includes('password')) {
      return 'Email hoặc mật khẩu không đúng.';
    }
    if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed')) {
      return 'Không kết nối được máy chủ. Kiểm tra internet.';
    }
    return `Đăng nhập thất bại: ${msg}`;
  }

  // === Vào app sau khi đã đăng nhập ===
  function startApp() {
    document.getElementById('bottom-nav').style.display = '';

    if (typeof Cloud !== 'undefined' && Cloud.isConfigured()) {
      Cloud.startAutoSync();
      DB.customers.count().then((c) => {
        if (c === 0 && navigator.onLine) {
          Cloud.downloadMasterData()
            .then(() => UI.toast('Đã tải dữ liệu từ cloud'))
            .catch(() => {});
        }
      });
    }

    navigate('invoice');
  }

  async function init() {
    await DB.open();

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Cổng đăng nhập: còn phiên (kể cả offline) thì vào thẳng, không thì hiện login
    if (Auth.isLoggedIn()) {
      startApp();
    } else {
      showLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { navigate };
})();
