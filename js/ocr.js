// ocr.js - レシートOCR & 食材自動抽出・確認モーダル制御
import { ApiClient } from './api.js';
import { Store } from './store.js';

export const Ocr = {
  extractedItems: [],

  init() {
    const fileInput = document.getElementById('receipt-file-input');
    if (!fileInput) return;

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      this.showLoading(true);
      try {
        const base64 = await this.fileToBase64(file);
        const results = await ApiClient.extractGroceriesFromReceipt(base64, file.type);
        this.extractedItems = results;
        this.showConfirmModal(results);
      } catch (err) {
        alert('レシートの読み取りに失敗しました: ' + err.message);
      } finally {
        this.showLoading(false);
        fileInput.value = ''; // リセット
      }
    });
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  showLoading(isLoading) {
    const spinner = document.getElementById('global-loading');
    const loadingText = document.getElementById('global-loading-text');
    if (spinner) {
      if (isLoading) {
        if (loadingText) loadingText.textContent = 'AIがレシートから食品のみを抽出中...';
        spinner.classList.remove('hidden');
      } else {
        spinner.classList.add('hidden');
      }
    }
  },

  showConfirmModal(items) {
    const modal = document.getElementById('receipt-confirm-modal');
    const listContainer = document.getElementById('receipt-items-list');
    if (!modal || !listContainer) return;

    if (!items || items.length === 0) {
      alert('食品・食材が見つかりませんでした。');
      return;
    }

    listContainer.innerHTML = items.map((item, idx) => `
      <div class="p-3 bg-gray-50 rounded-xl flex items-center justify-between space-x-3 border border-gray-200">
        <input type="checkbox" id="ocr_item_${idx}" checked class="w-5 h-5 rounded text-orange-500 focus:ring-orange-400">
        <div class="flex-1 min-w-0">
          <input type="text" value="${item.name}" id="ocr_name_${idx}" class="w-full text-sm font-bold bg-transparent border-b border-transparent focus:border-orange-400 focus:bg-white px-1 py-0.5 rounded">
          <div class="flex items-center space-x-2 mt-1 text-xs text-gray-500">
            <span>数量: <input type="text" value="${item.quantity}" id="ocr_qty_${idx}" class="w-20 bg-white border border-gray-200 px-1.5 py-0.5 rounded text-center"></span>
            <span>目安: <input type="number" value="${item.expiryDays}" id="ocr_exp_${idx}" class="w-12 bg-white border border-gray-200 px-1 py-0.5 rounded text-center">日</span>
          </div>
        </div>
      </div>
    `).join('');

    modal.classList.remove('hidden');

    // 一括登録ボタン
    const saveBtn = document.getElementById('receipt-confirm-save-btn');
    saveBtn.onclick = () => {
      let count = 0;
      items.forEach((_, idx) => {
        const check = document.getElementById(`ocr_item_${idx}`);
        if (check && check.checked) {
          const name = document.getElementById(`ocr_name_${idx}`).value;
          const quantity = document.getElementById(`ocr_qty_${idx}`).value;
          const expiryDays = parseInt(document.getElementById(`ocr_exp_${idx}`).value, 10) || 3;
          Store.addInventoryItem({ name, quantity, expiryDays, category: items[idx].category || '食品' });
          count++;
        }
      });
      modal.classList.add('hidden');
      alert(`${count}件の食材を在庫に追加しました！`);
    };

    // キャンセルボタン
    const cancelBtn = document.getElementById('receipt-confirm-cancel-btn');
    cancelBtn.onclick = () => {
      modal.classList.add('hidden');
    };
  }
};
