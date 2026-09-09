// store.js - データ永続化・状態管理・バックアップ復元モジュール
const STORAGE_KEYS = {
  SETTINGS: 'meal_app_settings',
  INVENTORY: 'meal_app_inventory',
  DELICIOUS_RECIPES: 'meal_app_delicious_recipes',
  MEAL_LOGS: 'meal_app_logs',
  API_KEY: 'meal_app_gemini_api_key'
};

const DEFAULT_SETTINGS = {
  theme: 'orange', // 'orange' | 'green' | 'modern'
  handMode: 'right', // 'right' | 'left'
  initialTab: 'nutrition', // 'nutrition' | 'recipe' | 'inventory' | 'settings' (システム初期表示はダッシュボード)
  adultGoal: 'general', // 'general' | 'athlete' | 'diet' | 'health'
  childEnabled: true,
  childStage: 'toddler', // 'early' | 'mid' | 'late' | 'complete' | 'toddler'
  childAllergies: [],
  childNgFoods: ['ハチミツ', 'ナッツ類'],
  dailyMoods: []
};

export const Store = {
  // --- 設定 (Settings) ---
  getSettings() {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        initialTab: parsed.initialTab || DEFAULT_SETTINGS.initialTab
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('app:settings-updated', { detail: settings }));
  },

  // --- APIキー (BYOK) ---
  getApiKey() {
    return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  },

  saveApiKey(key) {
    localStorage.setItem(STORAGE_KEYS.API_KEY, key.trim());
    window.dispatchEvent(new CustomEvent('app:api-key-updated'));
  },

  // --- 食材在庫 (Inventory) ---
  getInventory() {
    const raw = localStorage.getItem(STORAGE_KEYS.INVENTORY);
    if (!raw) return this.getDefaultInventory();
    try {
      return JSON.parse(raw);
    } catch {
      return this.getDefaultInventory();
    }
  },

  saveInventory(inventory) {
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventory));
    window.dispatchEvent(new CustomEvent('app:inventory-updated', { detail: inventory }));
  },

  addInventoryItem(item) {
    const list = this.getInventory();
    const newItem = {
      id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      name: item.name.trim(),
      category: item.category || 'その他',
      quantity: item.quantity || '1パック',
      expiryDays: typeof item.expiryDays === 'number' ? item.expiryDays : 3,
      createdAt: new Date().toISOString()
    };
    list.unshift(newItem);
    this.saveInventory(list);
    return newItem;
  },

  updateInventoryItem(id, updates) {
    const list = this.getInventory().map(item => item.id === id ? { ...item, ...updates } : item);
    this.saveInventory(list);
  },

  deleteInventoryItem(id) {
    const list = this.getInventory().filter(item => item.id !== id);
    this.saveInventory(list);
  },

  consumeInventoryItem(id) {
    this.deleteInventoryItem(id);
  },

  // --- おいしかった・殿堂入りレシピ (Delicious Recipes) ---
  getDeliciousRecipes() {
    const raw = localStorage.getItem(STORAGE_KEYS.DELICIOUS_RECIPES);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  saveDeliciousRecipe(recipe, rating = 5, note = '') {
    const list = this.getDeliciousRecipes();
    const existingIndex = list.findIndex(r => r.title === recipe.title);
    const record = {
      ...recipe,
      id: 'delic_' + Date.now(),
      rating,
      note,
      savedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      list[existingIndex] = record;
    } else {
      list.unshift(record);
    }
    localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
    return record;
  },

  removeDeliciousRecipe(id) {
    const list = this.getDeliciousRecipes().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
  },

  // --- 食事ログ (Meal Logs) ---
  getMealLogs() {
    const raw = localStorage.getItem(STORAGE_KEYS.MEAL_LOGS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  addMealLog(log) {
    const list = this.getMealLogs();
    const newLog = {
      ...log,
      id: 'log_' + Date.now(),
      loggedAt: new Date().toISOString()
    };
    list.unshift(newLog);
    localStorage.setItem(STORAGE_KEYS.MEAL_LOGS, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:logs-updated', { detail: list }));
    return newLog;
  },

  // --- バックアップ & 復元 ---
  exportBackup() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      inventory: this.getInventory(),
      deliciousRecipes: this.getDeliciousRecipes(),
      mealLogs: this.getMealLogs()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meal_app_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importBackup(jsonData) {
    try {
      const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      if (data.settings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));
      if (data.inventory) localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(data.inventory));
      if (data.deliciousRecipes) localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(data.deliciousRecipes));
      if (data.mealLogs) localStorage.setItem(STORAGE_KEYS.MEAL_LOGS, JSON.stringify(data.mealLogs));
      window.dispatchEvent(new CustomEvent('app:data-imported'));
      return { success: true };
    } catch (err) {
      console.error('Backup import error:', err);
      return { success: false, error: err.message };
    }
  },

  // 初期サンプル食材
  getDefaultInventory() {
    return [
      { id: 'sample_1', name: '豚バラ肉', category: '肉類', quantity: '200g', expiryDays: 1, createdAt: new Date().toISOString() },
      { id: 'sample_2', name: 'キャベツ', category: '野菜', quantity: '1/4個', expiryDays: 3, createdAt: new Date().toISOString() },
      { id: 'sample_3', name: '卵', category: '卵・大豆', quantity: '4個', expiryDays: 7, createdAt: new Date().toISOString() },
      { id: 'sample_4', name: '豆腐', category: '卵・大豆', quantity: '1丁', expiryDays: 2, createdAt: new Date().toISOString() },
      { id: 'sample_5', name: '玉ねぎ', category: '野菜', quantity: '2個', expiryDays: 8, createdAt: new Date().toISOString() },
      { id: 'sample_6', name: 'にんじん', category: '野菜', quantity: '1本', expiryDays: 6, createdAt: new Date().toISOString() }
    ];
  }
};
