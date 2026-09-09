// app.js - アプリ統合コントローラー（タブ切替、利き手モード、テーマ設定、初期化）
import { Store } from './store.js';
import { ApiClient } from './api.js';
import { Inventory } from './inventory.js';
import { Ocr } from './ocr.js';
import { Recipe } from './recipe.js';
import { Nutrition } from './nutrition.js';

export const App = {
  activeTab: 'nutrition', // 'inventory' | 'recipe' | 'nutrition' | 'settings'

  init() {
    const settings = Store.getSettings();
    this.applySettings(settings);
    this.bindNavigation();
    this.bindSettingsForm();
    this.bindManualAddModal();

    // 各モジュール初期化
    Ocr.init();
    Recipe.init();
    Nutrition.init();

    // 在庫データ等の初期ロード
    this.renderInventory();

    // 初期表示タブの切り替え（システムデフォルト: nutrition / 栄養ダッシュボード）
    const startTab = settings.initialTab || 'nutrition';
    this.switchTab(startTab);

    // 在庫更新リスナー
    window.addEventListener('app:inventory-updated', () => {
      this.renderInventory();
    });

    window.addEventListener('app:settings-updated', (e) => {
      this.applySettings(e.detail);
    });

    window.addEventListener('app:data-imported', () => {
      this.applySettings();
      this.renderInventory();
      Recipe.render();
      Nutrition.renderLogs();
      alert('バックアップからすべてのデータを正常に復元しました！');
    });
  },

  renderInventory() {
    const container = document.getElementById('inventory-list-container');
    if (container) Inventory.render(container);
  },

  applySettings(settings = Store.getSettings()) {
    // 1. テーマ適用
    document.documentElement.setAttribute('data-theme', settings.theme || 'orange');

    // 2. 利き手モード適用
    const appWrapper = document.getElementById('app-wrapper');
    if (appWrapper) {
      appWrapper.classList.remove('hand-mode-right', 'hand-mode-left');
      appWrapper.classList.add(settings.handMode === 'left' ? 'hand-mode-left' : 'hand-mode-right');
    }

    // 3. 設定フォームの同期
    const initialTabSelect = document.getElementById('setting-initial-tab');
    const themeSelect = document.getElementById('setting-theme');
    const handSelect = document.getElementById('setting-hand-mode');
    const goalSelect = document.getElementById('setting-adult-goal');
    const stageSelect = document.getElementById('setting-child-stage');
    const ngInput = document.getElementById('setting-child-ng');
    const apiKeyInput = document.getElementById('setting-api-key');

    if (initialTabSelect) initialTabSelect.value = settings.initialTab || 'nutrition';
    if (themeSelect) themeSelect.value = settings.theme || 'orange';
    if (handSelect) handSelect.value = settings.handMode || 'right';
    if (goalSelect) goalSelect.value = settings.adultGoal || 'general';
    if (stageSelect) stageSelect.value = settings.childStage || 'toddler';
    if (ngInput) ngInput.value = (settings.childNgFoods || []).join(', ');
    if (apiKeyInput) apiKeyInput.value = Store.getApiKey();
  },

  bindNavigation() {
    const navButtons = document.querySelectorAll('[data-tab-target]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.tabTarget;
        this.switchTab(target);
      });
    });

    this.bindDrawerNavigation();
  },

  bindDrawerNavigation() {
    const overlay = document.getElementById('drawer-overlay');
    const closeBtn = document.getElementById('drawer-close-btn');
    const toggleLeft = document.getElementById('drawer-toggle-btn-left');
    const toggleRight = document.getElementById('drawer-toggle-btn-right');

    const openDrawer = () => overlay?.classList.remove('hidden');
    const closeDrawer = () => overlay?.classList.add('hidden');

    if (toggleLeft) toggleLeft.onclick = openDrawer;
    if (toggleRight) toggleRight.onclick = openDrawer;
    if (closeBtn) closeBtn.onclick = closeDrawer;

    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) closeDrawer();
      };
    }

    // ドロワー内の項目タップ
    document.querySelectorAll('[data-drawer-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.drawerTab;
        this.switchTab(target);
        closeDrawer();
      });
    });
  },

  switchTab(tabId) {
    this.activeTab = tabId;

    // タブパネルの切り替え
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.add('hidden');
    });
    const targetPanel = document.getElementById(`tab-panel-${tabId}`);
    if (targetPanel) {
      targetPanel.classList.remove('hidden');
    }

    // ナビアイコンのアクティブ表示
    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      const isCurrent = btn.dataset.tabTarget === tabId;
      if (isCurrent) {
        btn.classList.add('theme-primary-text', 'font-black');
        btn.classList.remove('text-gray-400', 'font-medium');
      } else {
        btn.classList.remove('theme-primary-text', 'font-black');
        btn.classList.add('text-gray-400', 'font-medium');
      }
    });

    // タブごとのFAB制御
    const invFab = document.getElementById('inventory-fab');
    if (invFab) {
      if (tabId === 'inventory') {
        invFab.classList.remove('hidden');
      } else {
        invFab.classList.add('hidden');
      }
    }
  },

  bindSettingsForm() {
    const form = document.getElementById('settings-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const current = Store.getSettings();
      const ngFoodsStr = document.getElementById('setting-child-ng')?.value || '';

      const updated = {
        ...current,
        initialTab: document.getElementById('setting-initial-tab')?.value || 'nutrition',
        theme: document.getElementById('setting-theme')?.value || 'orange',
        handMode: document.getElementById('setting-hand-mode')?.value || 'right',
        adultGoal: document.getElementById('setting-adult-goal')?.value || 'general',
        childStage: document.getElementById('setting-child-stage')?.value || 'toddler',
        childNgFoods: ngFoodsStr.split(/[,、]/).map(s => s.trim()).filter(Boolean)
      };

      Store.saveSettings(updated);
      alert('設定を保存しました！');
    });

    // APIキー保存
    const saveKeyBtn = document.getElementById('save-api-key-btn');
    if (saveKeyBtn) {
      saveKeyBtn.onclick = () => {
        const key = document.getElementById('setting-api-key')?.value || '';
        Store.saveApiKey(key);
        alert('Gemini APIキーを安全に保存しました！');
      };
    }

    // API接続テスト
    const testKeyBtn = document.getElementById('test-api-key-btn');
    if (testKeyBtn) {
      testKeyBtn.onclick = async () => {
        const key = document.getElementById('setting-api-key')?.value || '';
        testKeyBtn.disabled = true;
        testKeyBtn.textContent = '接続中...';
        const res = await ApiClient.testConnection(key);
        testKeyBtn.disabled = false;
        testKeyBtn.textContent = '接続テスト';
        alert(res.message);
      };
    }

    // バックアップ＆復元
    const backupBtn = document.getElementById('export-backup-btn');
    if (backupBtn) {
      backupBtn.onclick = () => Store.exportBackup();
    }

    const restoreInput = document.getElementById('import-backup-input');
    if (restoreInput) {
      restoreInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          Store.importBackup(event.target.result);
        };
        reader.readAsText(file);
      });
    }
  },

  bindManualAddModal() {
    const modal = document.getElementById('manual-add-modal');
    const openBtn = document.getElementById('open-manual-add-btn');
    const fabBtn = document.getElementById('inventory-fab');
    const cancelBtn = document.getElementById('manual-add-cancel-btn');
    const form = document.getElementById('manual-add-form');

    if (openBtn && modal) {
      openBtn.onclick = () => modal.classList.remove('hidden');
    }
    if (fabBtn && modal) {
      fabBtn.onclick = () => modal.classList.remove('hidden');
    }
    if (cancelBtn && modal) {
      cancelBtn.onclick = () => modal.classList.add('hidden');
    }
    if (form && modal) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById('manual-item-name').value;
        const category = document.getElementById('manual-item-cat').value;
        const quantity = document.getElementById('manual-item-qty').value;
        const expiryDays = parseInt(document.getElementById('manual-item-exp').value, 10) || 3;

        Store.addInventoryItem({ name, category, quantity, expiryDays });
        form.reset();
        modal.classList.add('hidden');
      };
    }
  }
};

// DOMロード後に起動
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
