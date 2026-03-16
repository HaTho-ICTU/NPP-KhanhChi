/**
 * Shared UI components: toast, modal, autocomplete, formatters.
 */
const UI = (() => {

  // === Toast ===
  let toastTimer = null;
  function toast(message, duration = 2000) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  // === Modal ===
  function showModal(html) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    // Close on backdrop click
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-content').innerHTML = '';
  }

  // === Number formatting ===
  function formatCurrency(amount) {
    return Number(amount).toLocaleString('vi-VN');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.replace(' ', 'T'));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  }

  function nowString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // === Autocomplete search ===
  /**
   * Setup autocomplete on an input element.
   * @param {HTMLInputElement} input
   * @param {HTMLElement} resultsContainer - div.search-results
   * @param {Function} searchFn - async (keyword) => [{...}]
   * @param {Function} renderItem - (item) => { html, sub }
   * @param {Function} onSelect - (item) => void
   */
  function autocomplete(input, resultsContainer, searchFn, renderItem, onSelect) {
    let debounceTimer = null;
    let items = [];

    async function doSearch() {
      const keyword = input.value.trim();
      items = await searchFn(keyword);
      if (items.length === 0) {
        resultsContainer.innerHTML = '<div class="search-item text-secondary">Không tìm thấy</div>';
        resultsContainer.classList.add('show');
        return;
      }
      resultsContainer.innerHTML = items.map((item, i) => {
        const r = renderItem(item);
        return `<div class="search-item" data-index="${i}">
          <div>${r.html}</div>
          ${r.sub ? `<div class="search-item-sub">${r.sub}</div>` : ''}
        </div>`;
      }).join('');
      resultsContainer.classList.add('show');

      // Bind clicks
      resultsContainer.querySelectorAll('.search-item[data-index]').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.index);
          onSelect(items[idx]);
          resultsContainer.classList.remove('show');
        });
      });
    }

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doSearch, 150);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim() === '' || items.length > 0) {
        doSearch();
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !resultsContainer.contains(e.target)) {
        resultsContainer.classList.remove('show');
      }
    });
  }

  // === Confirm dialog ===
  function confirm(message, onYes) {
    showModal(`
      <div class="modal-title">${message}</div>
      <div class="action-row">
        <button class="btn btn-outline" id="modal-cancel">Huỷ</button>
        <button class="btn btn-danger" id="modal-confirm">Xoá</button>
      </div>
    `);
    document.getElementById('modal-cancel').onclick = closeModal;
    document.getElementById('modal-confirm').onclick = () => {
      closeModal();
      onYes();
    };
  }

  return { toast, showModal, closeModal, formatCurrency, formatDate, nowString, autocomplete, confirm };
})();
