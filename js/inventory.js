// inventory.js - 食材在庫管理（CRUD、賞味期限アラート、消費引き算）
import { Store } from './store.js';

export const Inventory = {
  render(container) {
    const items = Store.getInventory();
    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
          <p class="text-3xl mb-2">🥗</p>
          <p class="font-medium text-gray-600">食材が登録されていません</p>
          <p class="text-xs mt-1 text-gray-400">レシートを撮影するか、右下の「＋」ボタンから追加してください</p>
        </div>
      `;
      return;
    }

    // 賞味期限順にソート（残り日数が少ないものを上へ）
    const sorted = [...items].sort((a, b) => a.expiryDays - b.expiryDays);

    container.innerHTML = `
      <div class="grid grid-cols-1 gap-2.5">
        ${sorted.map(item => this.renderCard(item)).join('')}
      </div>
    `;

    // イベントバインド
    container.querySelectorAll('[data-action="consume"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        Store.consumeInventoryItem(id);
      });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm(`「${e.currentTarget.dataset.name}」を削除しますか？`)) {
          Store.deleteInventoryItem(id);
        }
      });
    });
  },

  renderCard(item) {
    // 賞味期限アラートのカラー判定
    let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    let alertText = `あと${item.expiryDays}日`;
    let isUrgent = false;

    if (item.expiryDays <= 1) {
      badgeClass = 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse font-bold';
      alertText = item.expiryDays === 0 ? '本日中！' : 'あと1日！急いで！';
      isUrgent = true;
    } else if (item.expiryDays <= 3) {
      badgeClass = 'bg-amber-50 text-amber-700 border-amber-200 font-semibold';
      alertText = `あと${item.expiryDays}日 (早めに消費)`;
    }

    return `
      <div class="bg-white p-3.5 rounded-xl border ${isUrgent ? 'border-rose-300 shadow-sm' : 'border-gray-100'} flex items-center justify-between transition-all">
        <div class="flex-1 min-w-0 pr-3">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-gray-800 text-base truncate">${item.name}</span>
            <span class="text-xs px-2 py-0.5 rounded-full border ${badgeClass}">${alertText}</span>
          </div>
          <div class="flex items-center space-x-3 text-xs text-gray-500 mt-1">
            <span class="bg-gray-100 px-2 py-0.5 rounded">${item.category || 'その他'}</span>
            <span>数量: <strong>${item.quantity}</strong></span>
          </div>
        </div>

        <div class="flex items-center space-x-1.5 shrink-0">
          <button data-action="consume" data-id="${item.id}" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all">
            使った
          </button>
          <button data-action="delete" data-id="${item.id}" data-name="${item.name}" class="p-1.5 text-xs rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-all">
            🗑️
          </button>
        </div>
      </div>
    `;
  }
};
