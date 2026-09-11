// app.bundle.js - スタンドアロン統合スクリプト (ダッシュボード分離・過去日チャート・Life Peak連携対応)

// ================= 1. Store (データ管理 & Life Peak 連携) =================
const STORAGE_KEYS = {
  SETTINGS: 'meal_app_settings',
  INVENTORY: 'meal_app_inventory',
  DELICIOUS_RECIPES: 'meal_app_delicious_recipes',
  MEAL_LOGS: 'meal_app_logs',
  API_KEY: 'meal_app_gemini_api_key',
  CURRENT_RECIPE: 'meal_app_current_recipe'
};

const DEFAULT_SETTINGS = {
  theme: 'orange',
  handMode: 'right',
  fontSize: 'large', // 文字サイズ: medium (標準) | large (見やすい大・推奨) | xlarge (特大)
  initialTab: 'dashboard', // システム初期表示はダッシュボード (5大栄養素)
  enableExternalSync: false, // 外部記録アプリ連携 (デフォルトOFF)
  cookingStepMode: 'combined', // 調理手順スタイル: combined (まとめて同時) | by_course (品目別ごと)
  defaultExpiryDays: 3, // 食材追加時の消費期限デフォルト日数 (1, 2, 3, 5, 7, 10, 14等)
  confirmBeforeDelete: true, // 食材削除時に確認メッセージを表示 (デフォルトON)
  defaultServings: 2.5, // 自動算出される世帯作成人数
  adultCount: 2, // 大人 (標準: 1.0人前)
  growthCount: 0, // 食べ盛り・アスリート (大盛り: 1.5人前)
  adultGoals: ['general'],
  children: [
    { id: 'child_1', name: '長男/長女', birthDate: '2024-03', stage: 'toddler', ngFoods: 'ハチミツ, ナッツ類' }
  ],
  dailyMoods: []
};

// トースト通知ヘルパー
window.showToast = function(message, icon = '⭐', duration = 2400) {
  const toast = document.getElementById('app-toast');
  const toastText = document.getElementById('app-toast-text');
  const toastIcon = document.getElementById('app-toast-icon');
  if (!toast) return;
  if (toastText) toastText.textContent = message;
  if (toastIcon) toastIcon.textContent = icon;
  toast.classList.add('show');
  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
};

// 家族構成・生年月からの月齢・食事ボリューム自動計算ヘルパー
const FamilyHelper = {
  // 生年月（YYYY-MM）から現在の年齢・月齢・取り分けステージ・食事係数を自動計算
  calculateChildInfo(birthDateStr) {
    if (!birthDateStr) {
      return { ageText: '未設定', stageKey: 'toddler', stageName: '幼児食 (1歳半〜5歳)', scale: 0.5 };
    }

    const [by, bm] = birthDateStr.split('-').map(Number);
    // 基準日（現在: 2026年9月）
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let totalMonths = (currentYear - by) * 12 + (currentMonth - bm);
    if (totalMonths < 0) totalMonths = 0;

    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    let ageText = '';
    if (years === 0) ageText = `${months}ヶ月`;
    else if (months === 0) ageText = `${years}歳`;
    else ageText = `${years}歳${months}ヶ月`;

    // 月齢によるステージと食事ボリューム係数の自動判定
    if (totalMonths < 5) {
      return { ageText, totalMonths, stageKey: 'milk', stageName: '授乳期 (離乳前)', scale: 0.0 };
    } else if (totalMonths <= 6) {
      return { ageText, totalMonths, stageKey: 'early', stageName: '離乳食初期 (5〜6ヶ月/ペースト)', scale: 0.1 };
    } else if (totalMonths <= 8) {
      return { ageText, totalMonths, stageKey: 'mid', stageName: '離乳食中期 (7〜8ヶ月/舌つぶし)', scale: 0.2 };
    } else if (totalMonths <= 11) {
      return { ageText, totalMonths, stageKey: 'late', stageName: '離乳食後期 (9〜11ヶ月/歯ぐき)', scale: 0.3 };
    } else if (totalMonths <= 18) {
      return { ageText, totalMonths, stageKey: 'complete', stageName: '離乳食完了期 (12〜18ヶ月/肉団子)', scale: 0.4 };
    } else if (years < 6) {
      return { ageText, totalMonths, stageKey: 'toddler', stageName: '幼児食 (1歳半〜5歳/薄味)', scale: 0.5 };
    } else if (years < 12) {
      return { ageText, totalMonths, stageKey: 'school', stageName: '小学生 (6〜11歳)', scale: 0.7 };
    } else {
      return { ageText, totalMonths, stageKey: 'growth', stageName: '中高生・食べ盛り (12歳〜)', scale: 1.2 };
    }
  },

  // 世帯構成から合計の推奨作成人数（係数）を算出
  calculateHouseholdServings(settings) {
    const adults = typeof settings.adultCount === 'number' ? settings.adultCount : 2;
    const growth = typeof settings.growthCount === 'number' ? settings.growthCount : 0;
    
    let totalScale = (adults * 1.0) + (growth * 1.5);
    (settings.children || []).forEach(c => {
      const info = this.calculateChildInfo(c.birthDate);
      totalScale += (info.scale || 0.5);
    });

    // 小数点第1位に丸める（例: 2.5人分）
    return Math.round(totalScale * 10) / 10;
  }
};

const Store = {
  getSettings() {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw);
      if (parsed.adultGoal && !parsed.adultGoals) parsed.adultGoals = [parsed.adultGoal];
      if (!parsed.children || !Array.isArray(parsed.children)) {
        parsed.children = [{ id: 'child_1', name: '子ども', stage: 'toddler', ngFoods: 'ハチミツ, ナッツ類' }];
      }
      let initTab = parsed.initialTab || 'dashboard';
      if (initTab === 'nutrition' && !parsed.initialTabMigrated) {
        initTab = 'dashboard';
      }

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        adultGoals: parsed.adultGoals?.length ? parsed.adultGoals : ['general'],
        initialTab: initTab
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('app:settings-updated', { detail: settings }));
  },

  getApiKey() {
    return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  },

  saveApiKey(key) {
    localStorage.setItem(STORAGE_KEYS.API_KEY, key.trim());
    window.dispatchEvent(new CustomEvent('app:api-key-updated'));
  },

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

  deleteInventoryItem(id) {
    const list = this.getInventory().filter(item => item.id !== id);
    this.saveInventory(list);
  },

  updateInventoryItem(id, updatedFields) {
    const list = this.getInventory();
    const idx = list.findIndex(item => item.id === id);
    if (idx !== -1) {
      list[idx] = {
        ...list[idx],
        ...updatedFields,
        name: (updatedFields.name !== undefined ? updatedFields.name : list[idx].name).trim()
      };
      this.saveInventory(list);
      return list[idx];
    }
    return null;
  },

  consumeInventoryItem(id) {
    this.deleteInventoryItem(id);
  },

  getDeliciousRecipes() {
    const raw = localStorage.getItem(STORAGE_KEYS.DELICIOUS_RECIPES);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  getCurrentRecipe() {
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_RECIPE);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  saveCurrentRecipe(recipe) {
    if (!recipe) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_RECIPE);
    } else {
      localStorage.setItem(STORAGE_KEYS.CURRENT_RECIPE, JSON.stringify(recipe));
    }
  },

  isDeliciousRecipe(title) {
    if (!title) return false;
    const list = this.getDeliciousRecipes();
    return list.some(r => (r.mealTitle || r.title) === title);
  },

  isCourseFavorite(courseName) {
    if (!courseName) return false;
    const list = this.getDeliciousRecipes();
    return list.some(r => r.itemType === 'course' && (r.courseName === courseName || r.title === courseName));
  },

  saveCourseFavorite(courseKey, courseItem, parentRecipe) {
    if (!courseItem || !courseItem.name) return null;
    const list = this.getDeliciousRecipes();
    const courseName = courseItem.name;
    const existingIndex = list.findIndex(r => r.itemType === 'course' && (r.courseName === courseName || r.title === courseName));
    const existing = existingIndex >= 0 ? list[existingIndex] : null;

    // 単品料理用の保存オブジェクト
    const typeLabelMap = { staple: '主食', main: '主菜', side: '副菜', soup: '汁物' };
    const typeLabel = typeLabelMap[courseKey] || 'おかず';

    const cleanItem = {
      id: existing ? existing.id : 'fav_course_' + Date.now(),
      itemType: 'course',
      courseKey: courseKey || 'main',
      courseType: typeLabel,
      courseName: courseName,
      title: courseName,
      mealTitle: `${courseName} (${typeLabel})`,
      parentMealTitle: parentRecipe?.mealTitle || parentRecipe?.title || 'おすすめ献立',
      cookingTime: parentRecipe?.cookingTime || '15分',
      servings: parentRecipe?.servings || 3,
      description: courseItem.note || `${typeLabel}のお気に入りレシピ`,
      note: courseItem.note || '',
      courses: {
        [courseKey || 'main']: courseItem
      },
      // 単品に該当する手順や材料があれば保持
      ingredientsWithAmounts: parentRecipe?.ingredientsWithAmounts || [],
      seasonings: parentRecipe?.seasonings || [],
      adultArrangements: parentRecipe?.adultArrangements || [],
      childSeparations: parentRecipe?.childSeparations || [],
      stepMode: parentRecipe?.stepMode || 'combined',
      baseSteps: parentRecipe?.baseSteps || [],
      courseSteps: parentRecipe?.courseSteps || {},
      cookCount: existing ? (existing.cookCount || 1) : 1,
      rating: 5,
      savedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    }
    list.unshift(cleanItem);

    try {
      localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
      return cleanItem;
    } catch (e) {
      console.error('Failed to save course favorite:', e);
      throw e;
    }
  },

  removeCourseFavoriteByName(courseName) {
    if (!courseName) return;
    const list = this.getDeliciousRecipes().filter(r => !(r.itemType === 'course' && (r.courseName === courseName || r.title === courseName)));
    localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
  },

  toggleCourseFavorite(courseKey, courseItem, parentRecipe) {
    if (!courseItem || !courseItem.name) return false;
    const isCurrentlyFav = this.isCourseFavorite(courseItem.name);
    if (isCurrentlyFav) {
      this.removeCourseFavoriteByName(courseItem.name);
      return false; // 解除された
    } else {
      this.saveCourseFavorite(courseKey, courseItem, parentRecipe);
      return true; // 保存された
    }
  },

  saveDeliciousRecipe(recipe, rating = 5, note = '') {
    if (!recipe) return null;
    const list = this.getDeliciousRecipes();
    const title = recipe.mealTitle || recipe.title || 'バランス献立';
    const existingIndex = list.findIndex(r => (r.mealTitle || r.title) === title && r.itemType !== 'course');
    const existing = existingIndex >= 0 ? list[existingIndex] : null;

    // 保存用にシリアライズ安全なクリーンオブジェクトを構築
    const cleanRecipe = {
      mealTitle: title,
      title: title,
      id: existing ? existing.id : 'delic_' + Date.now(),
      itemType: 'set',
      cookingTime: recipe.cookingTime || '20分',
      matchType: recipe.matchType || '1食分完成',
      servings: recipe.servings || 3,
      description: recipe.description || '',
      courses: recipe.courses || {},
      ingredientsWithAmounts: recipe.ingredientsWithAmounts || [],
      seasonings: recipe.seasonings || [],
      adultArrangements: recipe.adultArrangements || [],
      childSeparations: recipe.childSeparations || [],
      stepMode: recipe.stepMode || 'combined',
      baseSteps: recipe.baseSteps || [],
      courseSteps: recipe.courseSteps || {},
      rating,
      note: note || (existing ? existing.note : ''),
      cookCount: existing ? (existing.cookCount || 1) : 1,
      savedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      list.splice(existingIndex, 1); // 既存位置から削除し、常に最上部へ移動
    }
    list.unshift(cleanRecipe);

    try {
      localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
      console.log(`✅ [お気に入り保存完了] タイトル: "${cleanRecipe.mealTitle}", 合計件数: ${list.length}件`);
      return cleanRecipe;
    } catch (e) {
      console.error('Failed to save delicious recipe:', e);
      throw e;
    }
  },

  incrementCookCount(recipe) {
    if (!recipe) return;
    const list = this.getDeliciousRecipes();
    const title = recipe.mealTitle || recipe.title || 'バランス献立';
    const existingIndex = list.findIndex(r => (r.mealTitle || r.title) === title);
    if (existingIndex >= 0) {
      list[existingIndex].cookCount = (list[existingIndex].cookCount || 1) + 1;
      list[existingIndex].lastCookedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
      return list[existingIndex];
    } else {
      // お気に入り未登録の場合は自動でお気に入りに追加して調理回数1とする
      return this.saveDeliciousRecipe(recipe, 5, '調理完了');
    }
  },

  removeDeliciousRecipe(id) {
    const list = this.getDeliciousRecipes().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
  },

  getMealLogs() {
    const raw = localStorage.getItem(STORAGE_KEYS.MEAL_LOGS);
    if (!raw) return this.getDefaultMealLogs();
    try {
      return JSON.parse(raw);
    } catch {
      return this.getDefaultMealLogs();
    }
  },

  addMealLog(log) {
    const list = this.getMealLogs();
    const newLog = {
      ...log,
      id: 'log_' + Date.now(),
      loggedAt: log.loggedAt || new Date().toISOString()
    };
    list.unshift(newLog);
    localStorage.setItem(STORAGE_KEYS.MEAL_LOGS, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:logs-updated', { detail: list }));
    return newLog;
  },

  deleteMealLog(id) {
    const list = this.getMealLogs().filter(l => l.id !== id);
    localStorage.setItem(STORAGE_KEYS.MEAL_LOGS, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:logs-updated', { detail: list }));
  },

  getDefaultMealLogs() {
    const today = new Date().toISOString();
    return [
      { id: 'log_init', dishName: '朝食: 納豆ごはん・豆腐の味噌汁', calories: 420, protein: 18, fat: 9, carbs: 64, vitamins: 30, scale: 1.0, loggedAt: today }
    ];
  },

  // Life Peak 連携形式でのデータ書き出し (JSON)
  exportLifePeakFormat() {
    const logs = this.getMealLogs();
    const settings = this.getSettings();

    // Life Peak の Daily Log -> Entry 構造に準拠したスキーマ
    const lifePeakData = {
      appSource: 'OuchiGohanAI',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      userProfile: {
        adultGoals: settings.adultGoals,
        childrenCount: settings.children?.length || 0
      },
      // 日付ごとにEntryをまとめたコンテナ形式
      dailyLogs: logs.reduce((acc, log) => {
        const dateStr = log.loggedAt.slice(0, 10);
        if (!acc[dateStr]) acc[dateStr] = { date: dateStr, entries: [] };
        acc[dateStr].entries.push({
          entryId: log.id,
          timestamp: log.loggedAt,
          type: 'meal',
          title: log.dishName,
          metrics: {
            energy_kcal: log.calories,
            protein_g: log.protein,
            fat_g: log.fat,
            carbs_g: log.carbs,
            vitamins_pct: log.vitamins || 30
          },
          scale: log.scale || 1.0,
          tags: ['食事', 'AI推計']
        });
        return acc;
      }, {})
    };

    const blob = new Blob([JSON.stringify(lifePeakData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LifePeak_MealSync_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert('Life Peak連携用のJSONファイルを出力しました！');
  },

  exportBackup() {
    const data = {
      version: 2,
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


// ================= 2. ApiClient (Gemini 3.5 Flash-Lite BYOK & モック ハイブリッド) =================
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// 初期値: トークン使用量が最も少なくコスト効率最強の Gemini 3.5 Flash-Lite
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
let cachedActiveModel = 'gemini-3.5-flash-lite';

// トークン消費量を抑える省エネ生成設定 (出力を引き締めて無駄な消費をカット)
const EFFICIENT_GEN_CONFIG = {
  maxOutputTokens: 1500,
  temperature: 0.3
};

const ApiClient = {
  // 利用可能なモデルを取得
  async getActiveModel(key) {
    if (cachedActiveModel) return cachedActiveModel;
    return 'gemini-3.5-flash-lite';
  },

  // API接続テスト
  async testConnection(apiKey) {
    const key = apiKey || Store.getApiKey();
    if (!key) {
      return { success: false, message: 'APIキーが入力されていません。' };
    }

    let lastError = null;
    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond: OK' }] }],
            generationConfig: { maxOutputTokens: 10 }
          })
        });

        if (res.ok) {
          cachedActiveModel = model;
          return { success: true, message: `最新モデル「${model}」と接続成功！🎉\n（省トークン・高知能モードで稼働中）` };
        } else {
          const err = await res.json().catch(() => ({}));
          lastError = `(${res.status} ${model}): ${err.error?.message || res.statusText}`;
        }
      } catch (e) {
        lastError = `通信エラー (${model}): ${e.message}`;
      }
    }

    return { success: false, message: `接続失敗: ${lastError}` };
  },

  async extractGroceriesFromReceipt(base64Image, mimeType = 'image/jpeg') {
    const key = Store.getApiKey();
    if (!key) return this.mockReceiptExtraction();

    const prompt = `あなたは食料品の買い出しレシートから食材在庫を自動抽出・正規化するプロのエージェントです。
画像内のレシートから「食品・食材」のみを抽出してください。
【必須ルール】
- 料理・おかず作りに使わない品目は【完全に除外】すること:
  * お菓子類（スナック菓子、チョコレート、クッキー、飴、アイス、菓子パン等）
  * 飲料類（ジュース、清涼飲料水、炭酸飲料、コーヒー、お茶、ビール等の酒類）
  * 単品調味料（塩、砂糖、醤油、油等）や日用品（洗剤、レジ袋、ラップ等）
- 料理に使う「生鮮食品・おかず用食材」のみを抽出すること（例: 肉類、魚介、野菜、果物、きのこ、豆腐・卵、牛乳等の乳製品、主食食材等）。
- 商品の略称（例：「国産豚ﾊﾞﾗうす切」「有機ｷｬﾍﾞﾂ1/2」等）は、一般的な名詞（例：「豚バラ肉」「キャベツ」）へ正規化すること。
- 各食材の一般的な消費期限の目安日数（1〜14日程度）と数量、カテゴリ（肉類/魚介/野菜/卵・大豆/乳製品/その他）を推計すること。

以下の純粋なJSON配列形式のみで出力してください（Markdown装飾なし）:
[
  {"name": "豚バラ肉", "category": "肉類", "quantity": "1パック", "expiryDays": 2},
  {"name": "キャベツ", "category": "野菜", "quantity": "1/2個", "expiryDays": 5}
]`;

    try {
      const res = await fetch(`${GEMINI_API_BASE}/${cachedActiveModel || 'gemini-3.5-flash-lite'}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Image.split(',')[1] || base64Image } }
            ]
          }],
          generationConfig: EFFICIENT_GEN_CONFIG
        })
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.warn('Real Gemini API failed, fallback to mock:', err);
      return this.mockReceiptExtraction();
    }
  },

  async generateMealProposal(inventory, settings, genre = 'auto', stepMode = 'combined', servings = 3, mealTime = 'auto', selectedCourses = ['main', 'side', 'soup', 'staple'], stapleVariant = 'auto') {
    const key = Store.getApiKey();
    if (!key) return this.mockMealProposal(inventory, settings, genre, stepMode, servings, mealTime, selectedCourses, stapleVariant);

    // 時間帯の自動判定 (04:00-10:59: 朝食, 11:00-14:59: 昼食, その他: 夕食)
    let actualMealTime = mealTime;
    if (!actualMealTime || actualMealTime === 'auto') {
      const h = new Date().getHours();
      if (h >= 4 && h < 11) actualMealTime = 'breakfast';
      else if (h >= 11 && h < 15) actualMealTime = 'lunch';
      else actualMealTime = 'dinner';
    }

    const mealTimeInstructions = {
      breakfast: '【朝食向け】忙しい朝でも5〜10分で手軽に作れる時短・消化の良い軽食メニュー（トースト/卵料理/納豆ごはん/具だくさんスープ等）。加熱時間は極力短く設定してください。',
      lunch: '【昼食向け】10〜15分でサクッと食べられるワンプレート、麺類（うどん・パスタ等）、丼もの、チャーハンなどの軽快なランチメニュー。',
      dinner: '【夕食向け】1日の栄養バランスを整える、家族全員で囲む満足感の高いディナー。'
    };

    const adultGoalDescriptions = {
      general: '一般・健康バランス（栄養バランス重視・主食主菜副菜汁物の調和）',
      athlete: 'アスリート（高タンパク質・疲労回復・筋肉補修・ミネラル強化）',
      diet: 'ダイエット（糖質・脂質ひかえめ・食物繊維・満足感重視・ベジファースト）',
      health: '健康管理・生活習慣病対策（減塩・出汁活用・血糖値スパイク抑制）'
    };

    const stageDescriptions = {
      milk: '授乳・ミルク期（離乳食前・取り分け不要）',
      early: '離乳食初期（5〜6ヶ月頃・ごっくん期・滑らかなペースト）',
      mid: '離乳食中期（7〜8ヶ月頃・もぐもぐ期・舌でつぶせる固さ）',
      late: '離乳食後期（9〜11ヶ月頃・かみかみ期・歯ぐきでつぶせる固さ）',
      complete: '離乳食完了期（12〜18ヶ月頃・ぱくぱく期・歯ぐきで噛める固さ）',
      toddler: '幼児食（1歳半〜5歳頃・薄味・大人に近い一口サイズ）',
      child: '学童・成長期（しっかり栄養・大人と同じ）'
    };

    const courseNameMap = { main: '主菜(メインおかず)', side: '副菜(野菜小鉢)', soup: '汁物(味噌汁・スープ)', staple: '主食(ご飯・麺・パン)' };
    const targetCourseNames = selectedCourses.map(k => courseNameMap[k] || k).join('、');

    let stapleInstruction = '';
    if (selectedCourses.includes('staple')) {
      if (stapleVariant === 'bread') stapleInstruction = '主食は「パン・トースト・バゲット」に合うものにしてください。';
      else if (stapleVariant === 'noodles') stapleInstruction = '主食は「うどん・パスタ・そば等の麺類」にしてください。';
      else if (stapleVariant === 'rice') stapleInstruction = '主食は「白ごはん・炊き込みご飯等の米飯」にしてください。';
    } else {
      stapleInstruction = '【重要】主食は作らない設定のため、主食(staple)は提案せず、指定されたおかずのみに集中した手順と材料を出力してください。';
    }

    const prompt = `あなたは「一度の調理で家族全員分を作る」時短と安全を極めたプロの管理栄養士・AIシェフです。
手持ちの食材在庫をベースに、大人の健康目的と子どもの月齢に合わせた献立レシピを1セット提案してください。

【★最重要・提案対象の品目】
今回は以下の品目のみを提案してください: 【 ${targetCourseNames} 】
※指定されていない品目は "courses" オブジェクトに含めないでください。
${stapleInstruction}

作成人数目安: 約${servings}人前
食事タイミング指示: ${mealTimeInstructions[actualMealTime] || mealTimeInstructions.dinner}

【現在の冷蔵庫の食材】
${inventory.map(i => `- ${i.name} (${i.quantity}, 賞味期限目安あと${i.expiryDays}日)`).join('\n')}

【大人の健康目的】
${(settings.adultGoals || ['general']).map(g => adultGoalDescriptions[g] || g).join(', ')}

【家族の子ども構成】
${(settings.children || []).map(c => `- ${c.name}: ${c.birthDate}生 (${stageDescriptions[c.stage] || '幼児食'}), NG/アレルギー: ${c.ngFoods || 'なし'}`).join('\n')}

【★最重要の必須調理ルール】
1. 【調味料のインライン記載】: 各調理ステップの文章の中に、使う調味料と分量を必ず「【調味料: 醤油 大さじ1、みりん 小さじ2】」の形式で埋め込むこと。
2. 【手順の具体性】: 火加減（強火・中火・弱火）、加熱時間の目安（約○分）、具材の状態の変化を丁寧に明記すること。
3. 【子ども用の味付け＆仕上げ手順の完全明記】: 味付け前の取り分けだけでなく、取り分けた後の具体的な味付け（出汁大さじ1等）と加熱仕上げまで明記すること。
4. 【安全ガードレール】: 1歳未満へのハチミツ・黒糖は絶対禁止。

以下の純粋なJSONフォーマットのみを出力してください（Markdown装飾なし）:
{
  "title": "献立のタイトル（例: 豚バラとキャベツの重ね蒸し）",
  "genre": "${genre}",
  "servings": ${servings},
  "courses": {
    ${selectedCourses.map(k => `"${k}": {"type": "${k === 'main' ? '主菜' : k === 'side' ? '副菜' : k === 'soup' ? '汁物' : '主食'}", "name": "料理名", "note": "特徴"}`).join(',\n    ')}
  },
  "ingredientsWithAmounts": [
    {"name": "食材名", "amount": "分量"}
  ],
  "seasonings": [
    {"name": "調味料名", "amount": "分量"}
  ],
  "baseSteps": [
    "【調理ステップ】...【調味料: ...】...",
    "👶【子ども用取り分け＆味付け】..."
  ],
  "courseSteps": {
    ${selectedCourses.map(k => `"${k}": ["ステップ1", "ステップ2"]`).join(',\n    ')}
  },
  "stepMode": "${stepMode}",
  "childSeparations": [
    "取り分けアドバイス"
  ],
  "adultArrangements": [
    "大人アレンジ"
  ],
  "safetyAlert": "安全メモ"
}`;

    try {
      const res = await fetch(`${GEMINI_API_BASE}/${cachedActiveModel || 'gemini-3.5-flash-lite'}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: EFFICIENT_GEN_CONFIG
        })
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return this.filterProposalBySelectedCourses(parsed, selectedCourses, stapleVariant);
    } catch (err) {
      console.warn('Real Gemini API meal proposal failed, fallback to mock:', err);
      return this.mockMealProposal(inventory, settings, genre, stepMode, servings, actualMealTime, selectedCourses, stapleVariant);
    }
  },

  async analyzeMealImage(base64Image, mimeType = 'image/jpeg') {
    const key = Store.getApiKey();
    if (!key) return this.mockMealAnalysis();

    const prompt = `この食事写真から料理名を特定し、1人前あたりの推定カロリーとPFC（タンパク質・脂質・炭水化物）、栄養バランスのアドバイスを算出してください。
以下の純粋なJSONフォーマットのみを出力してください（Markdown装飾なし）:
{
  "dishName": "推定された料理名",
  "calories": 580,
  "protein": 24,
  "fat": 18,
  "carbs": 75,
  "feedback": "タンパク質と野菜がバランス良く摂れています。夜食の場合は主食（炭水化物）を少し控えめにするとさらに理想的です。"
}`;

    try {
      const res = await fetch(`${GEMINI_API_BASE}/${cachedActiveModel || 'gemini-3.5-flash-lite'}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Image.split(',')[1] || base64Image } }
            ]
          }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.2 }
        })
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.warn('Real Gemini API meal analysis failed, fallback to mock:', err);
      return this.mockMealAnalysis();
    }
  },

  filterProposalBySelectedCourses(proposal, selectedCourses = ['main', 'side', 'soup', 'staple'], stapleVariant = 'auto') {
    if (!proposal || !proposal.courses) return proposal;

    // 1. 指定された品目のみを抽出
    const filteredCourses = {};
    selectedCourses.forEach(key => {
      if (proposal.courses[key]) {
        filteredCourses[key] = proposal.courses[key];
      }
    });

    // 安全ガード（もし空なら主菜をデフォルト）
    if (Object.keys(filteredCourses).length === 0 && proposal.courses.main) {
      filteredCourses.main = proposal.courses.main;
    }

    // 2. 主食のバリエーション指定の適用
    if (filteredCourses.staple && stapleVariant && stapleVariant !== 'auto') {
      if (stapleVariant === 'bread') {
        filteredCourses.staple = { type: '主食', name: 'カリッと焼いたトースト または バゲット', note: '香ばしいパン' };
      } else if (stapleVariant === 'noodles') {
        filteredCourses.staple = { type: '主食', name: '温かい素うどん または パスタ', note: 'つるっと食べやすい' };
      } else if (stapleVariant === 'rice') {
        filteredCourses.staple = { type: '主食', name: 'ほかほか白ごはん', note: '炊きたて普通盛り' };
      }
    }
    proposal.courses = filteredCourses;

    // 3. 手順 courseSteps の絞り込み
    if (proposal.courseSteps) {
      const filteredSteps = {};
      selectedCourses.forEach(key => {
        if (proposal.courseSteps[key]) {
          filteredSteps[key] = proposal.courseSteps[key];
        }
      });
      proposal.courseSteps = filteredSteps;
    }

    // 4. タイトルと所要時間のスマート化
    const courseKeys = Object.keys(filteredCourses);
    if (courseKeys.length === 1) {
      const single = filteredCourses[courseKeys[0]];
      proposal.mealTitle = single.name;
      proposal.title = single.name;
      proposal.cookingTime = single.type === '副菜' ? '5分' : single.type === '汁物' ? '8分' : '12分';
      proposal.matchType = `${single.type}特化レシピ`;
    } else if (courseKeys.length === 2) {
      const c1 = filteredCourses[courseKeys[0]];
      const c2 = filteredCourses[courseKeys[1]];
      proposal.mealTitle = `${c1.name} ＆ ${c2.name}`;
      proposal.title = proposal.mealTitle;
      proposal.cookingTime = '15分';
      proposal.matchType = '2品の時短スピード献立';
    } else if (courseKeys.length === 3) {
      proposal.cookingTime = '18分';
      proposal.matchType = '3品バランス献立';
    }

    return proposal;
  },

  mockReceiptExtraction() {
    return [
      { name: '豚バラ肉', category: '肉類', quantity: '1パック(250g)', expiryDays: 2 },
      { name: 'キャベツ', category: '野菜', quantity: '1/2個', expiryDays: 5 },
      { name: '木綿豆腐', category: '卵・大豆', quantity: '1丁(300g)', expiryDays: 3 },
      { name: '卵', category: '卵・大豆', quantity: '1パック(10個)', expiryDays: 10 }
    ];
  },

  mockMealProposal(inventory, settings, genre = 'auto', stepMode = 'combined', servings = 3, mealTime = 'auto', selectedCourses = ['main', 'side', 'soup', 'staple'], stapleVariant = 'auto') {
    const sNum = parseInt(servings, 10) || 3;
    const adultGoals = settings.adultGoals || ['general'];
    const children = settings.children || [];

    // 時間帯の自動判定
    let actualMealTime = mealTime;
    if (!actualMealTime || actualMealTime === 'auto') {
      const h = new Date().getHours();
      if (h >= 4 && h < 11) actualMealTime = 'breakfast';
      else if (h >= 11 && h < 15) actualMealTime = 'lunch';
      else actualMealTime = 'dinner';
    }

    // 人数に応じた分量スケール計算 (1人あたり肉80g, 豆腐50g, 卵0.6個 等)
    const meatAmount = Math.max(80, Math.round(80 * sNum));
    const cabbageAmount = sNum <= 2 ? '1/8個 (約100g)' : sNum <= 4 ? '1/4個 (約220g)' : '1/2個 (約450g)';
    const tofuAmount = sNum <= 2 ? '1/3丁 (100g)' : sNum <= 4 ? '1/2丁 (150g)' : '1丁 (300g)';
    const eggAmount = sNum <= 2 ? '1個' : sNum <= 4 ? '2個' : '3個';
    const riceAmount = sNum <= 1 ? '1膳 (約0.5合)' : sNum <= 2 ? '2人分 (約1合)' : sNum <= 4 ? `${sNum}人分 (約2合)` : `${sNum}人分 (約3合)`;

    const adultArrangements = adultGoals.map(g => {
      if (g === 'athlete') return '【アスリート向け】主菜に温泉卵を添えてタンパク質+7g強化！副菜と汁物でミネラル補給。';
      if (g === 'diet') return '【ダイエット向け】主食の白米を小盛り(80g)に抑え、副菜と具だくさんスープから食べるベジファーストで満腹感UP。';
      if (g === 'health') return '【健康管理向け】汁物の塩分を控えめにし、出汁や生姜・黒胡椒の風味を利かせて満足度キープ。';
      return '【一般・バランス向け】主食・主菜・副菜・汁物をバランスよく食べ進めることで、自然と栄養満点に。';
    });

    const childSeparations = children.map(c => {
      const info = FamilyHelper.calculateChildInfo(c.birthDate);
      if (info.stageKey === 'milk') {
        return `【${c.name} (${info.ageText} / ${info.stageName})】まだ離乳食前のため取り分けは不要です。授乳・ミルクを優先してください。`;
      }
      return `【${c.name} (${info.ageText} / ${info.stageName})】主菜の柔らかい具材を細かく刻み、汁物の具材を出汁だけで薄味取り分け。`;
    });

    // 朝食向け時短プリセット (所要時間8分・軽食・卵や汁物メイン)
    if (actualMealTime === 'breakfast') {
      return this.filterProposalBySelectedCourses({
        mealTitle: `ふんわりかき玉とキャベツの和風朝スープ定食（${sNum}人分）`,
        genreName: '和風朝食',
        mealTime: '朝食',
        cookingTime: '8分',
        matchType: '忙しい朝の5〜8分時短朝ごはん',
        servings: sNum,
        courses: {
          staple: { type: '主食', name: 'ほかほか白ごはん または トースト', note: riceAmount },
          main: { type: '主菜', name: 'ふんわりキャベツと豚肉のレンジ蒸し', note: 'ポン酢でさっぱり・レンジ3分' },
          side: { type: '副菜', name: '豆腐とじゃこの和風小鉢', note: '火を使わず混ぜるだけ' },
          soup: { type: '汁物', name: '優しいお出汁のかき玉汁', note: '朝の胃腸を温める' }
        },
        ingredientsWithAmounts: [
          { name: 'キャベツ', amount: `${cabbageAmount}` },
          { name: '豚バラ肉', amount: `${Math.round(meatAmount * 0.7)}g` },
          { name: '卵', amount: `${eggAmount}` },
          { name: '木綿豆腐', amount: `${tofuAmount}` }
        ],
        seasonings: [
          { name: '和風だしの素・醤油', amount: '各小さじ1' },
          { name: 'ポン酢・ごま油', amount: '各大さじ1' }
        ],
        baseSteps: [
          '【共通・下ごしらえ】キャベツは手でちぎり、豚肉は一口大に切る。小鍋にお湯400mlと【調味料: 和風だしの素 小さじ1、醤油 小さじ1】を入れて中火で沸かす。',
          '【主菜 レンジ加熱】耐熱皿にキャベツと豚肉を広げ、【調味料: 酒 小さじ1、ごま油 小さじ1】を回しかけてラップをし、レンジ600Wで3分半加熱する。',
          '👶【子ども用取り分け＆味付け】レンジから柔らかく蒸し上がった豚肉とキャベツを取り出し、ハサミで細かく刻む。【子ども用味付け: 出汁 大さじ1】を和えて薄味おかずを完成。豆腐も小さじ2取り分けてスプーンでつぶす。',
          '【汁物・主菜 仕上げ・全員分完成】沸いた鍋に溶き卵を回し入れてかき玉汁を完成。レンジの大人用主菜には【調味料: ポン酢 大さじ1】をかけて完成！家族全員分が8分で出来上がり。'
        ],
        courseSteps: {
          main: [
            '耐熱皿にキャベツと豚肉を広げ、【調味料: 酒 小さじ1、ごま油 小さじ1】をかける。',
            'ラップをしてレンジ600Wで3分半加熱。',
            '👶【子ども用取り分け】お肉とキャベツを取り出して刻み、【子ども用味付け: 出汁 大さじ1】を和える。',
            '大人用にお好みでポン酢をかけて完成。'
          ],
          side: [
            '豆腐を器に盛り、じゃこと鰹節、醤油をひと垂らしして完成。'
          ],
          soup: [
            '小鍋にお湯と和風だし、醤油を煮立てる。',
            '溶き卵を流し入れ、ふんわり固まったら火を止める。'
          ],
          staple: [
            'ごはん または トーストを用意する。'
          ]
        },
        stepMode: stepMode,
        childSeparations: childSeparations,
        adultArrangements: adultArrangements,
        safetyAlert: '忙しい朝の熱湯・レンジ加熱後の蒸気にご注意ください。1歳未満へのハチミツは厳禁です。'
      }, selectedCourses, stapleVariant);
    }

    // 昼食向けワンプレート・時短ランチプリセット (所要時間12分)
    if (actualMealTime === 'lunch') {
      return this.filterProposalBySelectedCourses({
        mealTitle: `豚バラとキャベツの和風焼きうどん＆お吸い物ランチ（${sNum}人分）`,
        genreName: '和風ランチ',
        mealTime: '昼食',
        cookingTime: '12分',
        matchType: 'フライパン1つのワンプレート時短ランチ',
        servings: sNum,
        courses: {
          staple: { type: '主食', name: '和風焼きうどん（主食＋主菜合体）', note: `${sNum}玉` },
          main: { type: '主菜', name: '豚肉とキャベツの旨味炒め（うどん具材）', note: '甘辛醤油風味' },
          side: { type: '副菜', name: 'にんじんと玉ねぎの即席浅漬け', note: 'ポリ袋で揉むだけ' },
          soup: { type: '汁物', name: '豆腐とわかめの簡単お吸い物', note: 'マグカップでも作れる' }
        },
        ingredientsWithAmounts: [
          { name: 'うどん (茹で・冷凍)', amount: `${sNum}玉` },
          { name: '豚バラ肉', amount: `${meatAmount}g` },
          { name: 'キャベツ', amount: `${cabbageAmount}` },
          { name: '木綿豆腐', amount: `${tofuAmount}` }
        ],
        seasonings: [
          { name: '醤油・みりん', amount: sNum <= 2 ? '各大さじ1' : '各大さじ2' },
          { name: '和風だし', amount: '小さじ2' }
        ],
        baseSteps: [
          '【共通・下ごしらえ】キャベツはざく切り、豚肉は一口大に切る。',
          '【主菜・主食 同時炒め】フライパンにサラダ油小さじ1を熱し、豚肉とキャベツを中火で3分炒め、うどんとお湯大さじ2を入れてほぐしながら炒め合わせる。',
          '👶【子ども用取り分け＆味付け】大人の味付け前に、柔らかくなったうどんとお肉、キャベツを取り出しキッチンバサミで1〜2cmに刻む。【子ども用味付け: 出汁 大さじ1、醤油 2滴】を絡めて子ども用焼きうどんを完成。',
          '【大人用 仕上げ・全員分完成】フライパンに【調味料: 醤油 大さじ1.5、みりん 大さじ1、鰹節】を回し入れ、強火で香ばしく炒めて完成！'
        ],
        courseSteps: {
          main: [
            'フライパンで豚肉とキャベツを炒め、うどんを加えてほぐす。',
            '👶【子ども用取り分け】味付け前に取り出してハサミで刻み、薄味出汁で和える。',
            '大人用に醤油・みりん・鰹節を回し入れ、香ばしく炒め上げる。'
          ],
          side: [
            'にんじん・玉ねぎを薄切りにし、ポリ袋に塩少々と入れて揉む。'
          ],
          soup: [
            'お椀に豆腐とわかめ、白だしを入れ、熱湯を注いで完成。'
          ],
          staple: [
            '焼きうどんが主食を兼ねます。'
          ]
        },
        stepMode: stepMode,
        childSeparations: childSeparations,
        adultArrangements: adultArrangements,
        safetyAlert: 'うどんは子どもの月齢に合わせて短くカットし、喉詰めにご注意ください。'
      }, selectedCourses, stapleVariant);
    }

    // ジャンル別プリセット生成 (夕食向け)
    if (genre === 'chinese') {
      return this.filterProposalBySelectedCourses({
        mealTitle: `豚バラとキャベツの回鍋肉風＆中華玉子スープ定食（${sNum}人分）`,
        genreName: '中華',
        cookingTime: sNum >= 5 ? '25分' : '20分',
        matchType: '冷蔵庫の食材で1食分完成',
        servings: sNum,
        courses: {
          staple: { type: '主食', name: 'ほかほか白ごはん', note: riceAmount },
          main: { type: '主菜', name: '豚バラとキャベツの中華甘辛炒め（回鍋肉風）', note: '香ばしい味噌とオイスター風味' },
          side: { type: '副菜', name: 'にんじんと玉ねぎのピリ辛中華和え', note: 'レンジで1分！ごま油風味' },
          soup: { type: '汁物', name: '豆腐とかき玉の中華スープ', note: 'ふんわり卵と優しい鶏ガラ出汁' }
        },
        ingredientsWithAmounts: [
          { name: '豚バラ肉', amount: `${meatAmount}g (一口大)` },
          { name: 'キャベツ', amount: `${cabbageAmount}` },
          { name: '木綿豆腐', amount: `${tofuAmount}` },
          { name: '卵', amount: `${eggAmount}` },
          { name: 'にんじん・玉ねぎ', amount: sNum <= 2 ? '各1/4個 (千切り)' : '各1/2個 (千切り)' }
        ],
        seasonings: [
          { name: '味噌・オイスターソース', amount: sNum <= 2 ? '各小さじ2' : sNum <= 4 ? '各大さじ1' : '各大さじ2' },
          { name: '鶏ガラスープの素', amount: sNum <= 2 ? '小さじ1' : sNum <= 4 ? '小さじ2' : '大さじ1' },
          { name: 'ごま油・酒', amount: sNum <= 2 ? '各小さじ0.5' : '各小さじ1' }
        ],
        baseSteps: [
          '【共通・下ごしらえ】キャベツはざく切り、豚肉は一口大に切る。にんじんと玉ねぎは千切りにする。',
          '【主菜・汁物 同時加熱】フライパンに【調味料: ごま油 小さじ1】を熱し、豚肉とキャベツを中火で約4分、お肉の色が変わりキャベツがしんなりするまで炒める。小鍋に湯500mlと【調味料: 鶏ガラスープ 小さじ2】、豆腐を入れて弱中火で煮立てる。',
          '👶【子ども用取り分け＆味付け】中華だれ投入前に、フライパンから柔らかくなった豚肉とキャベツを取り出してキッチンバサミで1cmにカット。耐熱小皿に入れ【子ども用味付け: 和風出汁 大さじ1、すりごま 少々】を和えて薄味中華風おかずを完成させる。スープからも豆腐と汁を取り出し、白湯大さじ1で薄めて子ども用スープを完成。',
          '【副菜 レンジ調理】耐熱ボウルに千切りにんじん・玉ねぎを入れラップをし、レンジ600Wで1分半加熱。【調味料: ごま油 小さじ1、塩 ひとつまみ】を和えて副菜完成。',
          '【主菜・汁物 仕上げ・全員分完成】フライパンの大人用に【調味料: 味噌 大さじ1、オイスターソース 小さじ2、酒 大さじ1】を一気に回し入れ、強火で約1分香ばしく炒め合わせる。小鍋に溶き卵を回し入れ、ふわっと浮いたら火を止める。これで家族全員分が同時に完成！'
        ],
        courseSteps: {
          main: [
            'キャベツをざく切り、豚肉を一口大に切る。',
            'フライパンに【調味料: ごま油 小さじ1】を熱し、中火で約4分豚肉とキャベツを炒める。',
            '👶【子ども用取り分け＆味付け】味付け前に具材を取り分け、耐熱皿で【子ども用味付け: 出汁 大さじ1、すりごま 少々】を和えて薄味に仕上げる。',
            'フライパンの大人用に【調味料: 味噌 大さじ1、オイスターソース 小さじ2】を回し入れ、強火で約1分照りが出るまで炒め合わせる。'
          ],
          side: [
            'にんじんと玉ねぎを千切りにする。',
            '耐熱ボウルに入れラップをしてレンジ600Wで1分半加熱する。',
            '【調味料: ごま油 小さじ1、塩 ひとつまみ】をさっと和えて副菜完成。'
          ],
          soup: [
            '小鍋に水500mlと【調味料: 鶏ガラスープ 小さじ2】、さいの目切り豆腐を入れ煮立てる。',
            '👶【子ども用取り分け】お椀に取り分け、白湯大さじ1で薄めて子ども用にする。',
            '大人用の鍋に溶き卵を細く回し入れ、火を止めて完成。'
          ],
          staple: [
            '炊きたて白ごはんをよそう。子ども用は食べやすい一口おにぎりや小盛りにする。'
          ]
        },
        stepMode: stepMode,
        childSeparations: childSeparations,
        adultArrangements: adultArrangements,
        safetyAlert: '1歳未満へのハチミツ・黒糖は厳禁です。中華だれ投入前に必ず子ども用を取り分けてください。'
      }, selectedCourses, stapleVariant);
    }

    if (genre === 'italian') {
      return this.filterProposalBySelectedCourses({
        mealTitle: `豚肉とキャベツのトマト煮込み＆コンソメスープ定食（${sNum}人分）`,
        genreName: 'イタリアン',
        cookingTime: sNum >= 5 ? '25分' : '20分',
        matchType: '冷蔵庫の食材で1食分完成',
        servings: sNum,
        courses: {
          staple: { type: '主食', name: 'バゲット または ごはん', note: riceAmount },
          main: { type: '主菜', name: '豚バラとキャベツのガーリックオイル蒸し', note: 'オリーブオイル香るジューシー蒸し' },
          side: { type: '副菜', name: 'にんじんと玉ねぎのイタリアンマリネ', note: 'お酢とオリーブ油でさっぱり' },
          soup: { type: '汁物', name: '豆腐とキャベツのミネストローネ風スープ', note: 'トマトと野菜の優しい甘み' }
        },
        ingredientsWithAmounts: [
          { name: '豚バラ肉', amount: `${meatAmount}g` },
          { name: 'キャベツ', amount: `${cabbageAmount}` },
          { name: '木綿豆腐', amount: `${tofuAmount}` },
          { name: 'にんじん・玉ねぎ', amount: sNum <= 2 ? '各1/4個' : '各1/2個' }
        ],
        seasonings: [
          { name: 'オリーブオイル', amount: sNum <= 2 ? '大さじ1' : sNum <= 4 ? '大さじ1.5' : '大さじ2' },
          { name: '酒・塩', amount: '各小さじ1' },
          { name: 'コンソメ', amount: '1個' }
        ],
        baseSteps: [
          '【共通・下ごしらえ】キャベツと豚肉を食べやすい大きさに切る。にんじんと玉ねぎは薄切り、豆腐はさいの目に切る。',
          '【主菜・汁物 同時加熱】フライパンに【調味料: オリーブオイル 大さじ1】をひき、キャベツと豚肉を敷き詰めて【調味料: 酒 大さじ1、塩 少々】を振り、蓋をして中火で約6分蒸し焼きにする。小鍋に水400mlと【調味料: コンソメ 1個】、さいの目切り豆腐を入れて煮立てる。',
          '👶【子ども用取り分け＆味付け】フライパンから蒸し上がった豚肉とキャベツを取り出し、ハサミで小さくカット。【子ども用味付け: スープ出汁 大さじ1】をかけて薄味おかずを完成。スープからも豆腐と野菜を取り分けて冷ます。',
          '【副菜 レンジ調理】耐熱容器に薄切りにんじん・玉ねぎを入れラップをし、レンジ600Wで1分加熱。【調味料: 酢 小さじ2、オリーブオイル 小さじ1、塩 少々】を和えてマリネ完成。',
          '【主菜・汁物 仕上げ・全員分完成】大人用主菜に【調味料: 塩・粗挽き黒胡椒・お好みでハーブ 少々】を振って仕上げる。温かいバゲットまたはごはんと一緒に食卓へ並べて完成！'
        ],
        courseSteps: {
          main: [
            'キャベツと豚肉を食べやすい大きさに切る。',
            'フライパンに並べて【調味料: オリーブオイル 大さじ1、酒 大さじ1】を回しかけ、蓋をして中火で約6分蒸し焼きにする。',
            '👶【子ども用取り分け＆味付け】塩やスパイスを振る前に具材を取り分け、耐熱小皿で【子ども用味付け: スープ出汁 大さじ1】をかけてしっとり薄味に仕上げる。',
            '大人用に【調味料: 塩・粗挽き黒胡椒・ハーブ 少々】を振って仕上げる。'
          ],
          side: [
            'にんじんと玉ねぎを薄切りにし、レンジ600Wで1分加熱する。',
            '【調味料: 酢 小さじ2、オリーブオイル 小さじ1、塩 少々】を混ぜて和え、副菜完成。'
          ],
          soup: [
            '小鍋に水400mlと【調味料: コンソメ 1個】、さいの目切り豆腐、野菜を入れて中火で約5分煮立てる。',
            '👶【子ども用取り分け】豆腐と野菜を取り出し、白湯大さじ1で薄めて子ども用にする。',
            '大人用はお好みで黒胡椒を振って器に注ぐ。'
          ],
          staple: [
            'バゲットをトースターで軽く温める、またはごはんをよそう。'
          ]
        },
        stepMode: stepMode,
        childSeparations: childSeparations,
        adultArrangements: adultArrangements,
        safetyAlert: '1歳未満へのハチミツ厳禁。黒胡椒等のスパイスは大人用のみ最後に振ってください。'
      }, selectedCourses, stapleVariant);
    }

    // デフォルト（和食・おまかせ）
    return this.filterProposalBySelectedCourses({
      mealTitle: `豚バラと旬野菜の一汁二菜 ほっこり和定食（${sNum}人分）`,
      genreName: '和食',
      cookingTime: sNum >= 5 ? '25分' : '20分',
      matchType: '冷蔵庫の食材で1食分完成',
      servings: sNum,
      courses: {
        staple: { type: '主食', name: '炊きたてごはん（または麦ごはん）', note: riceAmount },
        main: { type: '主菜', name: '豚バラとキャベツの重ね蒸し（出汁仕立て）', note: 'フライパン1つで完成！素材の甘み' },
        side: { type: '副菜', name: 'にんじんと玉ねぎのレンジ和風ナムル', note: '余り野菜をレンジで1分！食物繊維補給' },
        soup: { type: '汁物', name: '木綿豆腐とキャベツ芯のお出汁味噌汁', note: 'キャベツの芯も無駄なく使ってフードロス削減' }
      },
      ingredientsWithAmounts: [
        { name: '豚バラ肉', amount: `${meatAmount}g (一口大)` },
        { name: 'キャベツ', amount: `${cabbageAmount}` },
        { name: '木綿豆腐', amount: `${tofuAmount}` },
        { name: '卵', amount: `${eggAmount}` },
        { name: 'にんじん・玉ねぎ', amount: sNum <= 2 ? '各1/4個 (スライス)' : '各1/2個 (スライス)' }
      ],
      seasonings: [
        { name: '和風だしの素', amount: sNum <= 2 ? '小さじ1' : sNum <= 4 ? '小さじ2' : '大さじ1' },
        { name: 'ポン酢 または 醤油', amount: sNum <= 2 ? '大さじ1.5' : sNum <= 4 ? '大さじ2.5' : '大さじ4' },
        { name: '味噌', amount: sNum <= 2 ? '大さじ1' : sNum <= 4 ? '大さじ2' : '大さじ3' },
        { name: '酒・ごま油', amount: sNum <= 2 ? '各小さじ1' : '各小さじ2' }
      ],
      baseSteps: [
        '【共通・下ごしらえ】キャベツはざく切り、芯は薄切りにして汁物用へ。豚肉は一口大、にんじんと玉ねぎは細切りにする。',
        '【主菜・同時加熱】フライパンにキャベツを敷き、豚肉を広げて並べる。【調味料: 酒 大さじ1、和風だし 小さじ1/2】を回しかけて蓋をし、中火で約6分蒸気が出るまでじっくり蒸し焼きにする。',
        '👶【子ども用取り分け＆味付け】大人の味付け前に、柔らかく蒸された豚肉とキャベツを取り出しキッチンバサミで1cm（月齢サイズ）にカット。耐熱小皿に入れ【子ども用味付け: だし汁 大さじ1、醤油 2滴】を和えてラップをしレンジ600Wで20秒加熱し、薄味の出汁蒸し煮に仕上げる。',
        '【汁物 調理】小鍋に水500mlとキャベツの芯、【調味料: 和風だし 小さじ1】、さいの目切り豆腐を入れ中火で煮立てる。子ども用をお椀に取り白湯大さじ1で薄めた後、鍋の火を止めて【調味料: 味噌 大さじ1.5】を溶き入れる。',
        '【副菜 レンジ和え】耐熱皿ににんじん・玉ねぎを入れレンジ600Wで1分半加熱。【調味料: ごま油 小さじ1、すりごま 大さじ1/2、醤油 小さじ1/2】を和えて副菜完成。',
        '【主菜・仕上げ・全員分完成】フライパンの大人用豚肉とキャベツに【調味料: ポン酢 大さじ2】を回しかける（または小皿のポン酢につけて食べる）。温かいごはん、お味噌汁、副菜を並べて家族全員分完成！'
      ],
      courseSteps: {
        main: [
          'キャベツをざく切り、豚肉を一口大に切る。',
          'フライパンにキャベツと豚肉を敷き詰め、【調味料: 酒 大さじ1、和風だし 小さじ1/2】を振り蓋をして中火で約6分蒸す。',
          '👶【子ども用取り分け＆味付け】大人のポン酢投入前に具材を取り分け、耐熱小皿で【子ども用味付け: 出汁 大さじ1、醤油 2滴】を加えレンジ20秒加熱して薄味出汁煮に仕上げる。',
          'フライパンの大人用に【調味料: ポン酢 大さじ2】を回しかけて仕上げる。'
        ],
        side: [
          'にんじんと玉ねぎを細切りにする。',
          '耐熱皿に入れラップをしてレンジ600Wで1分半加熱する。',
          '【調味料: ごま油 小さじ1、すりごま 大さじ1/2、醤油 小さじ1/2】を和えて副菜完成。'
        ],
        soup: [
          '小鍋に水500mlと【調味料: 和風だし 小さじ1】、キャベツの芯、さいの目切り豆腐を入れ煮立てる。',
          '👶【子ども用取り分け】お椀に取り出し、白湯大さじ1を加えて子ども用に薄める。',
          '大人用の鍋の火を止めて、【調味料: 味噌 大さじ1.5】を溶き入れて完成。'
        ],
        staple: [
          '炊きたてのごはんをよそう。子ども用は小盛りまたは軟飯に調整。'
        ]
      },
      stepMode: stepMode,
      childSeparations: childSeparations.length ? childSeparations : ['【子ども用】主菜のお肉と汁物の豆腐を調味前に小さくカットして取り分けます。'],
      adultArrangements: adultArrangements,
      safetyAlert: '1歳未満へのハチミツ・黒糖は厳禁です。喉詰まり防止のため、子ども用のお肉やにんじんは柔らかく加熱し一口サイズ以下にしてください。'
    }, selectedCourses, stapleVariant);
  },

  mockMealAnalysis() {
    return {
      dishName: '豚バラとキャベツの重ね蒸し ＆ ごはん',
      calories: 520,
      protein: 26,
      fat: 20,
      carbs: 58,
      vitamins: 45,
      feedback: 'タンパク質が26gしっかり摂れており優秀です！野菜の食物繊維も豊富で、脂質と炭水化物の比率も良好なバランスです。'
    };
  }
};


// ================= 3. Dashboard (5大栄養素レーダー & 日付別振り返り) =================
const NUTRITION_TARGETS = {
  general: { label: '一般・バランス', calories: 2000, protein: 65, fat: 55, carbs: 280, vitamins: 100 },
  athlete: { label: 'アスリート (高タンパク)', calories: 2500, protein: 120, fat: 60, carbs: 350, vitamins: 120 },
  diet: { label: 'ダイエット (低糖・低脂)', calories: 1600, protein: 75, fat: 35, carbs: 180, vitamins: 110 },
  health: { label: '健康管理 (減塩・血糖値)', calories: 1800, protein: 65, fat: 45, carbs: 240, vitamins: 130 }
};

const Dashboard = {
  selectedDate: new Date(),

  init() {
    this.bindEvents();
    this.render();
    window.addEventListener('app:settings-updated', () => this.render());
    window.addEventListener('app:logs-updated', () => this.render());
  },

  bindEvents() {
    const prevBtn = document.getElementById('dash-prev-day-btn');
    const nextBtn = document.getElementById('dash-next-day-btn');

    if (prevBtn) {
      prevBtn.onclick = () => {
        this.selectedDate.setDate(this.selectedDate.getDate() - 1);
        this.render();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        this.selectedDate.setDate(this.selectedDate.getDate() + 1);
        this.render();
      };
    }
  },

  render() {
    const settings = Store.getSettings();
    const primaryGoal = settings.adultGoals?.[0] || 'general';
    const target = NUTRITION_TARGETS[primaryGoal] || NUTRITION_TARGETS.general;

    // 日付ラベルの更新
    const dateStr = this.selectedDate.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const isToday = dateStr === todayStr;

    const dateLabel = document.getElementById('dash-current-date-label');
    if (dateLabel) {
      dateLabel.textContent = `${this.selectedDate.getFullYear()}/${(this.selectedDate.getMonth() + 1).toString().padStart(2, '0')}/${this.selectedDate.getDate().toString().padStart(2, '0')} ${isToday ? '(今日)' : ''}`;
    }

    // 選択された日付のログのみを集計
    const logs = Store.getMealLogs().filter(l => l.loggedAt && l.loggedAt.slice(0, 10) === dateStr);
    let curCal = 0, curP = 0, curF = 0, curC = 0, curV = 0;
    logs.forEach(log => {
      curCal += log.calories || 0;
      curP += log.protein || 0;
      curF += log.fat || 0;
      curC += log.carbs || 0;
      curV += log.vitamins || 30;
    });

    const percentages = [
      Math.min(120, Math.round((curCal / target.calories) * 100)),
      Math.min(120, Math.round((curP / target.protein) * 100)),
      Math.min(120, Math.round((curF / target.fat) * 100)),
      Math.min(120, Math.round((curC / target.carbs) * 100)),
      Math.min(120, Math.round((curV / target.vitamins) * 100))
    ];

    this.renderSvgRadar(percentages);

    const badge = document.getElementById('radar-mode-badge');
    if (badge) {
      const goalLabels = (settings.adultGoals || ['general']).map(g => NUTRITION_TARGETS[g]?.label?.split(' ')[0] || g).join(', ');
      badge.textContent = `🎯 目的: ${goalLabels}`;
    }

    // 日本語表記のエネルギー・PFCラベル
    const summaryLabel = document.getElementById('today-compact-summary');
    if (summaryLabel) {
      summaryLabel.innerHTML = `
        <span class="text-gray-700 font-bold text-[11px]">エネルギー:</span><span class="font-black text-orange-600 ml-0.5">${curCal}</span><span class="text-[9px] text-gray-400">kcal</span>
        <span class="mx-1 text-gray-300">|</span>
        <span class="text-blue-600 font-bold text-[11px]">たんぱく質:${curP}g</span>
        <span class="mx-1 text-gray-300">|</span>
        <span class="text-amber-600 font-bold text-[11px]">脂質:${curF}g</span>
        <span class="mx-1 text-gray-300">|</span>
        <span class="text-purple-600 font-bold text-[11px]">炭水化物:${curC}g</span>
      `;
    }
  },

  renderSvgRadar(percentages) {
    const container = document.getElementById('nutrition-radar-container');
    if (!container) return;

    const size = 210;
    const center = size / 2;
    const radius = 64;
    const labels = ['エネルギー', 'たんぱく質', '脂質', '炭水化物', 'ビタミン'];
    const angles = [-Math.PI/2, -Math.PI/2 + 2*Math.PI/5, -Math.PI/2 + 4*Math.PI/5, -Math.PI/2 + 6*Math.PI/5, -Math.PI/2 + 8*Math.PI/5];

    const targetPoints = angles.map(a => `${center + radius * Math.cos(a)},${center + radius * Math.sin(a)}`).join(' ');
    const halfPoints = angles.map(a => `${center + (radius*0.5) * Math.cos(a)},${center + (radius*0.5) * Math.sin(a)}`).join(' ');
    const curPoints = angles.map((a, i) => {
      const r = (Math.min(120, percentages[i]) / 100) * radius;
      return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
    }).join(' ');

    container.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="mx-auto select-none">
        <polygon points="${halfPoints}" fill="none" stroke="#e5e7eb" stroke-width="1"/>
        <polygon points="${targetPoints}" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4,4"/>
        <polygon points="${curPoints}" fill="rgba(249, 115, 22, 0.28)" stroke="#f97316" stroke-width="2.5"/>
        ${angles.map((a, i) => {
          const r = (Math.min(120, percentages[i]) / 100) * radius;
          return `<circle cx="${center + r * Math.cos(a)}" cy="${center + r * Math.sin(a)}" r="3" fill="#f97316"/>`;
        }).join('')}
        ${angles.map((a, i) => {
          const lx = center + (radius + 24) * Math.cos(a);
          const ly = center + (radius + 16) * Math.sin(a) + 3;
          return `
            <text x="${lx}" y="${ly}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="currentColor">
              ${labels[i]}
              <tspan x="${lx}" dy="9" font-size="7.5" fill="#f97316">${percentages[i]}%</tspan>
            </text>
          `;
        }).join('')}
      </svg>
    `;
  }
};


// ================= 4. Nutrition (食事記録 & Life Peak 連携) =================
const Nutrition = {
  currentAnalysis: null,
  volumeScale: 1.0,

  init() {
    this.bindEvents();
    this.renderLogs();
    window.addEventListener('app:logs-updated', () => this.renderLogs());
  },

  bindEvents() {
    const fileInput = document.getElementById('meal-photo-input');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const spinner = document.getElementById('global-loading');
        if (spinner) spinner.classList.remove('hidden');

        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result;
            const result = await ApiClient.analyzeMealImage(base64, file.type);
            this.currentAnalysis = result;
            this.volumeScale = 1.0;
            this.renderAnalysisModal(result, base64);
            if (spinner) spinner.classList.add('hidden');
          };
          reader.readAsDataURL(file);
        } catch (err) {
          alert('解析エラー: ' + err.message);
          if (spinner) spinner.classList.add('hidden');
        }
        fileInput.value = '';
      });
    }

    // Life Peak 連携ボタン
    const exportBtn = document.getElementById('btn-export-life-peak');
    if (exportBtn) {
      exportBtn.onclick = () => Store.exportLifePeakFormat();
    }
  },

  renderLogs() {
    const container = document.getElementById('nutrition-logs-container');
    if (!container) return;

    const logs = Store.getMealLogs();
    if (!logs || logs.length === 0) {
      container.innerHTML = `<p class="text-xs text-center text-gray-400 py-6">食事ログはまだありません。「写真を解析」から記録してください</p>`;
      return;
    }

    container.innerHTML = logs.map(log => `
      <div class="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs shadow-xs">
        <div>
          <div class="font-bold text-gray-800 text-sm">${log.dishName}</div>
          <div class="text-[10px] text-gray-400 mt-0.5">
            ${new Date(log.loggedAt).toLocaleDateString()} ${new Date(log.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ボリューム ${Math.round((log.scale || 1) * 100)}%
          </div>
          <div class="text-[10px] text-gray-500 mt-0.5">
            たんぱく質:${log.protein}g / 脂質:${log.fat}g / 炭水化物:${log.carbs}g
          </div>
        </div>
        <div class="text-right flex flex-col items-end space-y-1">
          <span class="font-black text-orange-600 text-sm">${log.calories} kcal</span>
          <button data-del-log="${log.id}" class="text-[11px] text-gray-400 hover:text-rose-500">削除</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-del-log]').forEach(btn => {
      btn.onclick = () => {
        if (confirm('この食事ログを削除しますか？')) {
          Store.deleteMealLog(btn.dataset.delLog);
        }
      };
    });
  },

  renderAnalysisModal(result, imageUrl) {
    const modal = document.getElementById('meal-analysis-modal');
    if (!modal) return;

    document.getElementById('analysis-dish-name').textContent = result.dishName;
    document.getElementById('analysis-image-preview').src = imageUrl;
    document.getElementById('analysis-feedback').textContent = result.feedback;

    const updateValues = () => {
      document.getElementById('val-cal').textContent = `${Math.round(result.calories * this.volumeScale)} kcal`;
      document.getElementById('val-p').textContent = `${Math.round(result.protein * this.volumeScale)}g`;
      document.getElementById('val-f').textContent = `${Math.round(result.fat * this.volumeScale)}g`;
      document.getElementById('val-c').textContent = `${Math.round(result.carbs * this.volumeScale)}g`;
    };
    updateValues();

    const slider = document.getElementById('volume-slider');
    if (slider) {
      slider.value = 1.0;
      slider.oninput = (e) => {
        this.volumeScale = parseFloat(e.target.value);
        document.getElementById('volume-scale-label').textContent = `${Math.round(this.volumeScale * 100)}%`;
        updateValues();
      };
    }

    document.getElementById('analysis-save-log-btn').onclick = () => {
      Store.addMealLog({
        dishName: result.dishName,
        calories: Math.round(result.calories * this.volumeScale),
        protein: Math.round(result.protein * this.volumeScale),
        fat: Math.round(result.fat * this.volumeScale),
        carbs: Math.round(result.carbs * this.volumeScale),
        vitamins: Math.round((result.vitamins || 30) * this.volumeScale),
        scale: this.volumeScale,
        loggedAt: new Date().toISOString()
      });
      modal.classList.add('hidden');
    };

    document.getElementById('analysis-cancel-btn').onclick = () => modal.classList.add('hidden');
    modal.classList.remove('hidden');
  }
};

// ================= 5. Recipe =================
const Recipe = {
  currentProposal: null,
  activeTab: 'suggest',
  hallFilter: 'all', // 'all' | 'set' | 'main' | 'side' | 'soup' | 'staple'
  selectedCourses: ['main', 'side', 'soup', 'staple'],
  stapleVariant: 'auto',

  init() {
    this.currentProposal = Store.getCurrentRecipe();
    this.bindEvents();
    this.initCourseToggles();
    this.render();
  },

  initCourseToggles() {
    const cards = document.querySelectorAll('[data-course-toggle]');
    const stapleBox = document.getElementById('staple-variant-box');
    const stapleSelect = document.getElementById('recipe-staple-variant-select');
    const allBtn = document.getElementById('btn-select-all-courses');
    const mainOnlyBtn = document.getElementById('btn-select-main-only');

    // トグルカードのクリックイベント
    cards.forEach(card => {
      card.onclick = () => {
        const course = card.dataset.courseToggle;
        const isSelected = this.selectedCourses.includes(course);

        // 最低1品選択ガード
        if (isSelected && this.selectedCourses.length <= 1) {
          if (window.showToast) {
            window.showToast('最低1つの品目を選択してください', '⚠️');
          } else {
            alert('最低1つの品目を選択してください');
          }
          return;
        }

        if (isSelected) {
          this.selectedCourses = this.selectedCourses.filter(c => c !== course);
        } else {
          this.selectedCourses.push(course);
        }

        this.syncCourseToggleUI();
      };
    });

    // 全選択ボタン
    if (allBtn) {
      allBtn.onclick = () => {
        this.selectedCourses = ['main', 'side', 'soup', 'staple'];
        this.syncCourseToggleUI();
      };
    }

    // 主菜のみボタン
    if (mainOnlyBtn) {
      mainOnlyBtn.onclick = () => {
        this.selectedCourses = ['main'];
        this.syncCourseToggleUI();
      };
    }

    // 主食タイプセレクト
    if (stapleSelect) {
      stapleSelect.onchange = (e) => {
        this.stapleVariant = e.target.value;
      };
    }

    this.syncCourseToggleUI();
  },

  syncCourseToggleUI() {
    const cards = document.querySelectorAll('[data-course-toggle]');
    const stapleBox = document.getElementById('staple-variant-box');

    cards.forEach(card => {
      const course = card.dataset.courseToggle;
      const isSelected = this.selectedCourses.includes(course);
      if (isSelected) {
        card.classList.add('is-selected', 'border-orange-500', 'bg-orange-50/70');
        card.classList.remove('border-gray-200', 'bg-white', 'opacity-60');
      } else {
        card.classList.remove('is-selected', 'border-orange-500', 'bg-orange-50/70');
        card.classList.add('border-gray-200', 'bg-white', 'opacity-60');
      }
    });

    // 主食がONのときだけ主食バリエーション設定を表示
    if (stapleBox) {
      if (this.selectedCourses.includes('staple')) {
        stapleBox.classList.remove('hidden');
      } else {
        stapleBox.classList.add('hidden');
      }
    }

    this.updateProposalButtonLabel();
  },

  updateProposalButtonLabel() {
    const labelEl = document.getElementById('btn-regenerate-recipe-label');
    if (!labelEl) return;

    const count = this.selectedCourses.length;
    const COURSE_NAMES = { main: '主菜', side: '副菜', soup: '汁物', staple: '主食' };

    if (count === 4) {
      labelEl.textContent = '✨ 1食分の献立（フルセット）を提案';
    } else if (count === 1) {
      const single = this.selectedCourses[0];
      const singleName = COURSE_NAMES[single] || '料理';
      if (single === 'main') labelEl.textContent = '🥩 主菜のみ（メインおかず）を提案';
      else if (single === 'side') labelEl.textContent = '🥗 副菜のみ（小鉢・常備菜）を提案';
      else if (single === 'soup') labelEl.textContent = '🥣 汁物のみ（スープ・味噌汁）を提案';
      else if (single === 'staple') labelEl.textContent = '🍚 主食のみ（ごはん・麺・パン）を提案';
      else labelEl.textContent = `✨ ${singleName}のみを提案`;
    } else {
      const selectedNames = ['main', 'side', 'soup', 'staple']
        .filter(c => this.selectedCourses.includes(c))
        .map(c => COURSE_NAMES[c])
        .join('＋');
      labelEl.textContent = `✨ ${count}品（${selectedNames}）の献立を提案`;
    }
  },

  formatStepText(text) {
    if (!text) return '';
    // 【】内のテキストを検出し、品目・役割・調味料に応じた専用カラーバッジに置換
    const formatted = text.replace(/【(.*?)】/g, (match, rawLabel) => {
      // ラベル内の既存絵文字重複を安全に除去
      const label = rawLabel.replace(/^[👶🧂🍚🥩🥗🥣👨‍🍳\s]+/, '').trim();
      if (rawLabel.startsWith('調味料') || rawLabel.includes('調味料:')) {
        return `<span class="seasoning-inline-badge">🧂 ${label}</span>`;
      }
      if (rawLabel.includes('子ども用味付け') || rawLabel.includes('子供用味付け')) {
        return `<span class="child-seasoning-badge">👶 ${label}</span>`;
      }
      if (rawLabel.includes('主食')) {
        return `<span class="step-badge step-badge-staple">🍚 ${label}</span>`;
      }
      if (rawLabel.includes('主菜')) {
        return `<span class="step-badge step-badge-main">🥩 ${label}</span>`;
      }
      if (rawLabel.includes('副菜')) {
        return `<span class="step-badge step-badge-side">🥗 ${label}</span>`;
      }
      if (rawLabel.includes('汁物')) {
        return `<span class="step-badge step-badge-soup">🥣 ${label}</span>`;
      }
      if (rawLabel.includes('子ども') || rawLabel.includes('取り分け')) {
        return `<span class="step-badge step-badge-child">👶 ${label}</span>`;
      }
      // 共通・下ごしらえ・全員分完成・加熱等
      return `<span class="step-badge step-badge-common">👨‍🍳 ${label}</span>`;
    });

    return `<span class="recipe-step-text leading-relaxed">${formatted}</span>`;
  },

  bindEvents() {
    const tabSuggest = document.getElementById('recipe-tab-suggest');
    const tabHall = document.getElementById('recipe-tab-hall');
    const condBox = document.getElementById('recipe-conditions-box');

    if (tabSuggest && tabHall) {
      tabSuggest.onclick = () => {
        this.activeTab = 'suggest';
        tabSuggest.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold theme-primary-bg text-white shadow-xs';
        tabHall.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:text-gray-900';
        if (condBox) condBox.classList.remove('hidden');
        this.render();
      };
      tabHall.onclick = () => {
        this.activeTab = 'hall-of-fame';
        tabHall.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold theme-primary-bg text-white shadow-xs';
        tabSuggest.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:text-gray-900';
        if (condBox) condBox.classList.add('hidden');
        this.render();
      };
    }

    // 献立画面での手順スタイル切り替え時に即時反映
    const stepModeSelect = document.getElementById('recipe-step-mode-select');
    if (stepModeSelect) {
      stepModeSelect.addEventListener('change', () => {
        if (this.currentProposal) {
          this.currentProposal.stepMode = stepModeSelect.value;
          Store.saveCurrentRecipe(this.currentProposal);
          this.render();
        }
      });
    }

    // 「🎲 別の献立を再提案してもらう」ボタン押下時のみ新規提案・AI検索を発火
    const regenBtn = document.getElementById('btn-regenerate-recipe');
    if (regenBtn) {
      regenBtn.onclick = () => this.generateNewRecipe();
    }

    window.addEventListener('app:delicious-updated', () => {
      if (this.activeTab === 'hall-of-fame') this.render();
    });
  },

  async generateNewRecipe() {
    const spinner = document.getElementById('global-loading');
    if (spinner) spinner.classList.remove('hidden');
    try {
      const mealTime = document.getElementById('recipe-meal-time-select')?.value || 'auto';
      const genre = document.getElementById('recipe-genre-select')?.value || 'auto';
      const stepMode = document.getElementById('recipe-step-mode-select')?.value || Store.getSettings().cookingStepMode || 'combined';
      const servings = document.getElementById('recipe-servings-select')?.value || Store.getSettings().defaultServings || 3;
      this.currentProposal = await ApiClient.generateMealProposal(
        Store.getInventory(),
        Store.getSettings(),
        genre,
        stepMode,
        servings,
        mealTime,
        this.selectedCourses,
        this.stapleVariant
      );
      Store.saveCurrentRecipe(this.currentProposal);
      this.render();
    } catch (err) {
      console.error('献立提案の生成に失敗しました:', err);
      try {
        const mealTime = document.getElementById('recipe-meal-time-select')?.value || 'auto';
        const genre = document.getElementById('recipe-genre-select')?.value || 'auto';
        const stepMode = document.getElementById('recipe-step-mode-select')?.value || Store.getSettings().cookingStepMode || 'combined';
        const servings = document.getElementById('recipe-servings-select')?.value || Store.getSettings().defaultServings || 3;
        this.currentProposal = ApiClient.mockMealProposal(
          Store.getInventory(),
          Store.getSettings(),
          genre,
          stepMode,
          servings,
          mealTime,
          this.selectedCourses,
          this.stapleVariant
        );
        Store.saveCurrentRecipe(this.currentProposal);
        this.render();
        if (window.showToast) window.showToast('オフライン提案を表示しました', '💡');
      } catch (fallbackErr) {
        console.error('フォールバック生成にも失敗しました:', fallbackErr);
      }
    } finally {
      if (spinner) spinner.classList.add('hidden');
    }
  },

  recallFavorite(item) {
    if (!item) return;
    if (item.itemType === 'course') {
      const key = item.courseKey || 'main';
      this.currentProposal = {
        mealTitle: item.mealTitle || `${item.title} (${item.courseType || '単品'})`,
        title: item.title,
        cookingTime: item.cookingTime || '15分',
        matchType: item.courseType ? `お気に入り${item.courseType}` : 'お気に入り料理',
        servings: item.servings || 3,
        description: item.description || (item.parentMealTitle ? `（元献立: ${item.parentMealTitle}）` : 'お気に入り保存レシピ'),
        courses: item.courses && Object.keys(item.courses).length > 0 ? item.courses : {
          [key]: { type: item.courseType || '主菜', name: item.title, note: item.note || '' }
        },
        ingredientsWithAmounts: item.ingredientsWithAmounts || [],
        seasonings: item.seasonings || [],
        adultArrangements: item.adultArrangements || [],
        childSeparations: item.childSeparations || [],
        stepMode: item.stepMode || 'combined',
        baseSteps: item.baseSteps || [],
        courseSteps: item.courseSteps || {}
      };
    } else {
      this.currentProposal = item;
    }
    Store.saveCurrentRecipe(this.currentProposal);
    // 献立タブに切り替えて詳細を表示
    document.getElementById('recipe-tab-suggest')?.click();
  },

  render() {
    const container = document.getElementById('recipe-content-container');
    const condBox = document.getElementById('recipe-conditions-box');
    if (!container) return;

    // ================= A. お気に入り・殿堂入り画面 =================
    if (this.activeTab === 'hall-of-fame') {
      if (condBox) condBox.classList.add('hidden');
      const allList = Store.getDeliciousRecipes();

      if (!allList || allList.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center bg-white rounded-2xl border border-dashed border-gray-200 animate-fade-in">
            <p class="text-3xl mb-1">⭐</p>
            <p class="font-bold text-xs text-gray-700">お気に入り料理・献立はまだありません</p>
            <p class="text-[10px] text-gray-400 mt-1">献立や各品目の「⭐」を押すか、3回以上作ると「👑 ⭐ 殿堂入り」になります</p>
            <button type="button" id="btn-back-to-suggest" class="mt-4 px-4 py-2 rounded-xl text-xs font-bold theme-primary-bg text-white shadow-xs">
              ✨ 献立を提案してもらう
            </button>
          </div>
        `;
        document.getElementById('btn-back-to-suggest')?.addEventListener('click', () => {
          document.getElementById('recipe-tab-suggest')?.click();
        });
        return;
      }

      // カテゴリフィルター適用
      let filteredList = allList;
      if (this.hallFilter === 'set') {
        filteredList = allList.filter(item => item.itemType !== 'course');
      } else if (this.hallFilter === 'main') {
        filteredList = allList.filter(item => item.itemType === 'course' && item.courseKey === 'main');
      } else if (this.hallFilter === 'side') {
        filteredList = allList.filter(item => item.itemType === 'course' && item.courseKey === 'side');
      } else if (this.hallFilter === 'soup') {
        filteredList = allList.filter(item => item.itemType === 'course' && item.courseKey === 'soup');
      } else if (this.hallFilter === 'staple') {
        filteredList = allList.filter(item => item.itemType === 'course' && item.courseKey === 'staple');
      }

      const filterTabs = [
        { id: 'all', label: 'すべて', count: allList.length },
        { id: 'set', label: '🍱 セット', count: allList.filter(i => i.itemType !== 'course').length },
        { id: 'main', label: '🥩 主菜', count: allList.filter(i => i.itemType === 'course' && i.courseKey === 'main').length },
        { id: 'side', label: '🥗 副菜', count: allList.filter(i => i.itemType === 'course' && i.courseKey === 'side').length },
        { id: 'soup', label: '🥣 汁物', count: allList.filter(i => i.itemType === 'course' && i.courseKey === 'soup').length }
      ];

      container.innerHTML = `
        <div class="space-y-3 animate-fade-in">
          <!-- フィルタータブ (5等分でスクロール不要・汁物まで1画面に収まる) -->
          <div class="grid grid-cols-5 gap-1 text-[11px]">
            ${filterTabs.map(t => {
              const active = this.hallFilter === t.id;
              return `
                <button type="button" data-hall-filter="${t.id}" class="py-1.5 px-0.5 rounded-xl font-bold transition-all text-center flex flex-col items-center justify-center ${
                  active
                    ? 'theme-primary-bg text-white shadow-2xs'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }">
                  <span class="truncate leading-none text-[11px]">${t.label}</span>
                  <span class="text-[9px] opacity-80 mt-0.5 font-medium">${t.count}</span>
                </button>
              `;
            }).join('')}
          </div>

          <div class="flex items-center justify-between px-1">
            <span class="text-[11px] font-bold text-gray-500">タップすると詳細・レシピを表示します</span>
            <span class="text-[10px] text-gray-400">3回調理で自動殿堂入り</span>
          </div>

          <!-- リスト表示 -->
          ${filteredList.length === 0 ? `
            <div class="p-6 text-center bg-white rounded-2xl border border-dashed border-gray-200 text-xs text-gray-400">
              このカテゴリのお気に入りはありません
            </div>
          ` : `
            <div class="space-y-2">
              ${filteredList.map(item => {
                const isCourse = item.itemType === 'course';
                const cookCount = item.cookCount || 1;
                const isHall = cookCount >= 3;
                const titleText = item.courseName || item.mealTitle || item.title || '料理';

                let badgeHtml = '';
                if (isHall) {
                  badgeHtml = `<span class="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 font-black px-1.5 py-0.5 rounded-full flex items-center space-x-1"><span>👑 ⭐ 殿堂入り</span><span>(${cookCount}回)</span></span>`;
                } else if (isCourse) {
                  const typeBgMap = {
                    '主菜': 'bg-rose-100 text-rose-800 border-rose-200',
                    '副菜': 'bg-emerald-100 text-emerald-800 border-emerald-200',
                    '汁物': 'bg-amber-100 text-amber-800 border-amber-200',
                    '主食': 'bg-orange-100 text-orange-800 border-orange-200'
                  };
                  const badgeClass = typeBgMap[item.courseType] || 'bg-gray-100 text-gray-700 border-gray-200';
                  badgeHtml = `<span class="text-[10px] ${badgeClass} border font-bold px-1.5 py-0.5 rounded-full">⭐ ${item.courseType || '単品'}</span>`;
                } else {
                  badgeHtml = `<span class="text-[10px] bg-orange-100 text-orange-800 border border-orange-200 font-bold px-1.5 py-0.5 rounded-full">🍱 献立セット</span>`;
                }

                return `
                  <div data-recall-id="${item.id}" class="bg-white p-3.5 rounded-2xl border ${
                    isHall ? 'border-amber-300 bg-gradient-to-br from-white to-amber-50/20' : 'border-gray-200'
                  } shadow-2xs hover:border-amber-400 hover:shadow-xs cursor-pointer active:scale-[0.99] transition-all group">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center space-x-1.5 flex-wrap">
                        ${badgeHtml}
                        <span class="text-[10px] text-gray-400">⏱️ ${item.cookingTime || '20分'}</span>
                      </div>
                      <button type="button" data-del-delicious-id="${item.id}" title="お気に入りから削除" class="p-1 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 active:scale-90 transition-all text-xs">
                        🗑️
                      </button>
                    </div>

                    <div class="mt-1.5">
                      <h4 class="font-black text-sm text-gray-900 group-hover:text-amber-600 transition-colors flex items-center justify-between">
                        <span>${titleText}</span>
                        <span class="text-xs text-gray-300 group-hover:text-amber-500 transition-colors font-normal">詳細 〉</span>
                      </h4>
                      ${isCourse && item.parentMealTitle ? `
                        <p class="text-[10px] text-gray-400 mt-0.5">献立: ${item.parentMealTitle}</p>
                      ` : ''}
                      ${item.note ? `
                        <p class="text-[11px] bg-amber-50/80 text-amber-900 px-2 py-1 rounded-lg font-medium border border-amber-100 mt-1.5">💬 ${item.note}</p>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      `;

      // カテゴリフィルターボタンのイベント
      container.querySelectorAll('[data-hall-filter]').forEach(btn => {
        btn.onclick = () => {
          this.hallFilter = btn.dataset.hallFilter;
          this.render();
        };
      });

      // カードタップで即座に再表示
      container.querySelectorAll('[data-recall-id]').forEach(card => {
        card.onclick = (e) => {
          // 削除ボタンクリック時は伝播防止
          if (e.target.closest('[data-del-delicious-id]')) return;
          const targetId = card.dataset.recallId;
          const item = allList.find(r => r.id === targetId);
          if (item) {
            this.recallFavorite(item);
          }
        };
      });

      // 削除ボタンのイベント
      container.querySelectorAll('[data-del-delicious-id]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const id = btn.dataset.delDeliciousId;
          const item = allList.find(r => r.id === id);
          const name = item ? (item.courseName || item.mealTitle || item.title) : 'この料理';
          if (confirm(`「${name}」をお気に入りから削除しますか？`)) {
            Store.removeDeliciousRecipe(id);
            window.showToast('お気に入りから削除しました', '🗑️');
            this.render();
          }
        };
      });

      return;
    }

    // ================= B. 献立提案・詳細画面 =================
    if (condBox) condBox.classList.remove('hidden');

    if (!this.currentProposal) {
      container.innerHTML = `
        <div class="p-6 text-center bg-white rounded-2xl border border-gray-100">
          <p class="text-3xl mb-2">🍳</p>
          <h4 class="font-bold text-sm text-gray-800">家族全員の取り分け献立</h4>
          <p class="text-xs text-gray-500 mt-1 max-w-xs mx-auto">大人それぞれの健康目的と子ども全員の月齢に合わせ、一度の調理で作るレシピを提案します</p>
          <button id="btn-generate-recipe" class="mt-4 px-6 py-2.5 rounded-xl text-white font-bold text-xs theme-primary-bg active:scale-95 shadow-xs">
            ✨ レシピを提案してもらう
          </button>
        </div>
      `;
      document.getElementById('btn-generate-recipe').onclick = () => this.generateNewRecipe();
      return;
    }

    const r = this.currentProposal;
    const title = r.mealTitle || r.title || '1食分のバランス献立';
    const courses = r.courses || {
      main: { type: '主菜', name: title, note: '手持ち食材メイン' }
    };

    // お気に入り登録状況の確認
    const isSetFav = Store.isDeliciousRecipe(title);
    const isStapleFav = courses.staple?.name ? Store.isCourseFavorite(courses.staple.name) : false;
    const isMainFav = courses.main?.name ? Store.isCourseFavorite(courses.main.name) : false;
    const isSideFav = courses.side?.name ? Store.isCourseFavorite(courses.side.name) : false;
    const isSoupFav = courses.soup?.name ? Store.isCourseFavorite(courses.soup.name) : false;

    container.innerHTML = `
      <div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-3">
        <div class="flex justify-between items-center">
          <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">⏱️ 所要時間: ${r.cookingTime || '20分'}</span>
          <span class="text-xs font-semibold text-emerald-600">✅ ${r.matchType || '1食分完成'}</span>
        </div>
        <div>
          <h3 class="recipe-meal-title font-black text-base text-gray-800 leading-snug">${title}</h3>
          <p class="text-xs text-gray-500 mt-0.5">${r.description || '主食・主菜・副菜・汁物の1食分バランス献立セット'}</p>
        </div>

        <!-- 献立構成カード (選択された品目のみ動的グリッド描画) -->
        <div class="grid ${Object.keys(courses).length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 pt-1">
          ${(() => {
            const COURSE_META = {
              staple: { icon: '🍚', label: '主食', bg: 'bg-orange-50/50 border-orange-100 text-orange-700', btnText: 'text-orange-600 border-orange-200' },
              main:   { icon: '🥩', label: '主菜', bg: 'bg-rose-50/50 border-rose-100 text-rose-700',     btnText: 'text-rose-600 border-rose-200' },
              side:   { icon: '🥗', label: '副菜', bg: 'bg-emerald-50/50 border-emerald-100 text-emerald-700', btnText: 'text-emerald-600 border-emerald-200' },
              soup:   { icon: '🥣', label: '汁物', bg: 'bg-amber-50/50 border-amber-100 text-amber-700',   btnText: 'text-amber-600 border-amber-200' }
            };
            const orderedKeys = ['main', 'side', 'soup', 'staple'].filter(k => courses[k]);
            return orderedKeys.map(k => {
              const c = courses[k];
              const meta = COURSE_META[k] || { icon: '🍽️', label: c.type || '料理', bg: 'bg-gray-50 border-gray-100 text-gray-700', btnText: 'text-gray-600 border-gray-200' };
              const isFav = c.name ? Store.isCourseFavorite(c.name) : false;
              return `
                <div class="p-2.5 rounded-xl ${meta.bg} border text-xs flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between font-black ${meta.bg.split(' ').pop()} mb-0.5">
                      <span>${meta.icon} ${meta.label}:</span>
                      <div class="flex items-center space-x-1">
                        <button type="button" data-fav-course="${k}" class="course-fav-btn p-0.5 text-xs ${isFav ? 'is-active text-amber-500' : 'text-gray-300 hover:text-amber-400'}" title="${meta.label}をお気に入り登録">⭐</button>
                        <button type="button" data-shuffle-course="${k}" class="text-[10px] font-bold ${meta.btnText} bg-white/90 hover:bg-white px-1.5 py-0.5 rounded border active:scale-95 transition-all shadow-2xs">🔄 変更</button>
                      </div>
                    </div>
                    <div class="font-bold text-gray-800 text-[11px] leading-snug">${c.name || title}</div>
                  </div>
                  <div class="text-[9px] text-gray-400 mt-1">${c.note || ''}</div>
                </div>
              `;
            }).join('');
          })()}
        </div>

        <!-- 材料 ＆ 調味料 -->
        <div class="space-y-2 pt-2 border-t border-gray-100">
          <div class="flex justify-between items-center">
            <h4 class="font-black text-xs text-gray-700 flex items-center space-x-1">
              <span>🛒</span>
              <span>使う食材 ＆ 調味料 (${r.servings || 3}人前)</span>
            </h4>
            <span class="text-[10px] text-gray-400">世帯人数に合わせて自動計算</span>
          </div>

          <div class="bg-gray-50/80 rounded-xl p-2.5 text-xs">
            <div class="font-bold text-gray-600 mb-1 flex items-center justify-between text-[11px]">
              <span>🥬 メイン食材リスト:</span>
              <span class="text-[10px] text-gray-400">冷蔵庫から自動選出</span>
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              ${(r.ingredientsWithAmounts || []).map(ing => `
                <div class="flex justify-between items-center bg-white px-2 py-1 rounded-lg border border-gray-100 text-[11px]">
                  <span class="font-medium text-gray-800">${ing.name}</span>
                  <span class="text-orange-600 font-bold ml-1">${ing.amount}</span>
                </div>
              `).join('')}
            </div>

            ${(r.seasonings && r.seasonings.length > 0) ? `
              <div class="font-bold text-gray-600 mt-2.5 mb-1 text-[11px]">🧂 基本の調味料:</div>
              <div class="flex flex-wrap gap-1">
                ${r.seasonings.map(s => `
                  <span class="bg-white px-2 py-0.5 rounded-md border border-gray-100 text-[10px] text-gray-600 font-medium">${s}</span>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 大人それぞれの健康アレンジ -->
        ${(r.adultArrangements && r.adultArrangements.length > 0) ? `
          <div class="p-2.5 rounded-xl bg-orange-50/40 border border-orange-100 text-xs space-y-1.5">
            <h4 class="font-bold text-orange-900 flex items-center space-x-1 text-[11px]">
              <span>💪</span>
              <span>大人それぞれの健康目的アレンジ</span>
            </h4>
            <div class="space-y-1">
              ${r.adultArrangements.map(a => `
                <div class="bg-white/80 p-2 rounded-lg text-[11px] border border-orange-50">
                  <div class="flex items-center space-x-1 font-bold text-orange-800 mb-0.5">
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-orange-100">${a.target || '健康管理'}</span>
                    <span>${a.title || ''}</span>
                  </div>
                  <p class="text-gray-600 leading-relaxed">${this.formatStepText(a.content || '')}</p>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 子ども全員の取り分けアドバイス -->
        ${(r.childSeparations && r.childSeparations.length > 0) ? `
          <div class="p-2.5 rounded-xl bg-rose-50/40 border border-rose-100 text-xs space-y-1.5">
            <h4 class="font-bold text-rose-900 flex items-center space-x-1 text-[11px]">
              <span>👶</span>
              <span>子ども全員の月齢別取り分けステップ</span>
            </h4>
            <div class="space-y-1">
              ${r.childSeparations.map(c => `
                <div class="bg-white/80 p-2 rounded-lg text-[11px] border border-rose-50">
                  <div class="flex items-center space-x-1 font-bold text-rose-800 mb-0.5">
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-rose-100">${c.childName || 'お子様'} (${c.stageName || ''})</span>
                    <span>${c.timing || '大人の味付け前に取り分け'}</span>
                  </div>
                  <p class="text-gray-600 leading-relaxed">${this.formatStepText(c.method || '')}</p>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 同時進行 or 品目別 調理手順 -->
        <div class="pt-2 border-t border-gray-100 space-y-2">
          <div class="flex justify-between items-center">
            <h4 class="font-black text-xs text-gray-700 flex items-center space-x-1">
              <span>🍳</span>
              <span>${r.stepMode === 'by_course' ? '品目ごとの調理手順' : 'まとめて同時進行・最速調理手順'}</span>
            </h4>
            <span class="text-[10px] text-gray-400">フライパン1つで同時進行</span>
          </div>

          ${r.stepMode === 'by_course' ? `
            <!-- 品目ごと表示 -->
            <div class="space-y-3">
              ${['main', 'side', 'soup'].map(cKey => {
                const cInfo = courses[cKey];
                const steps = (r.courseSteps && r.courseSteps[cKey]) || [];
                if (!cInfo && steps.length === 0) return '';
                const titleMap = { main: '🥩 主菜', side: '🥗 副菜', soup: '🥣 汁物' };
                const borderMap = { main: 'border-rose-200 bg-rose-50/20', side: 'border-emerald-200 bg-emerald-50/20', soup: 'border-amber-200 bg-amber-50/20' };
                return `
                  <div class="rounded-xl border ${borderMap[cKey] || 'border-gray-200'} p-2.5 text-xs space-y-1.5">
                    <div class="font-black text-gray-800 text-[11px] flex items-center justify-between border-b border-gray-100 pb-1">
                      <span>${titleMap[cKey] || 'おかず'}: ${cInfo?.name || ''}</span>
                      <span class="text-[9px] text-gray-400">${steps.length}工程</span>
                    </div>
                    <ol class="space-y-1.5 text-[11px]">
                      ${steps.map((st, i) => `
                        <li class="flex items-start space-x-1.5">
                          <span class="font-bold text-orange-500 shrink-0 text-[10px] mt-0.5">${i + 1}.</span>
                          <span class="text-gray-700 leading-relaxed flex-1">${this.formatStepText(st)}</span>
                        </li>
                      `).join('')}
                    </ol>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <!-- まとめて同時進行ステップ -->
            <ol class="space-y-2 text-xs">
              ${(r.baseSteps || []).map((step, idx) => {
                const isChildStep = step.includes('👶') || step.includes('子ども用取り分け') || step.includes('取り分け');
                if (isChildStep) {
                  return `
                    <li class="p-2.5 rounded-xl bg-pink-50/90 border border-pink-200 text-pink-950 font-medium space-y-1 shadow-xs">
                      <div class="flex items-center space-x-1 font-black text-pink-700 text-[11px]">
                        <span>👶</span>
                        <span>重要: 子ども用取り分けステップ</span>
                      </div>
                      <p class="leading-relaxed text-[11px]">${this.formatStepText(step.replace('👶', ''))}</p>
                    </li>
                  `;
                }
                return `
                  <li class="flex items-start space-x-2 bg-gray-50/60 p-2 rounded-xl border border-gray-100">
                    <span class="font-black text-orange-500 shrink-0 text-xs mt-0.5">${idx + 1}.</span>
                    <span class="leading-relaxed text-gray-700 text-[11px] flex-1">${this.formatStepText(step)}</span>
                  </li>
                `;
              }).join('')}
            </ol>
          `}
        </div>

        <!-- 献立アクションボタン (お気に入り保存 ＆ 在庫消費) -->
        <div class="pt-3 border-t border-gray-100 flex space-x-2">
          <button type="button" id="btn-save-delic" data-action="save-favorite" class="flex-1 py-2.5 rounded-xl font-bold text-xs ${
            isSetFav
              ? 'bg-amber-100 text-amber-900 border border-amber-400'
              : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
          } active:scale-95 transition-all flex items-center justify-center space-x-1 cursor-pointer">
            <span class="pointer-events-none">⭐</span>
            <span id="btn-save-delic-text" class="pointer-events-none">${isSetFav ? 'お気に入り保存済み' : 'お気に入りに保存'}</span>
          </button>
          <button type="button" id="btn-cook-recipe" class="flex-1 py-2.5 rounded-xl font-bold text-xs theme-primary-bg text-white hover:opacity-95 shadow-xs active:scale-95 transition-all flex items-center justify-center space-x-1 cursor-pointer">
            <span class="pointer-events-none">🍳</span>
            <span class="pointer-events-none">この献立を作った！(在庫消費)</span>
          </button>
        </div>
      </div>
    `;

    // 各品目の ⭐ お気に入りトグルボタン紐付け
    container.querySelectorAll('[data-fav-course]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const courseKey = btn.dataset.favCourse;
        const courseItem = courses[courseKey];
        if (!courseItem || !courseItem.name) return;
        const isNowFav = Store.toggleCourseFavorite(courseKey, courseItem, r);
        if (isNowFav) {
          btn.classList.add('is-active', 'text-amber-500');
          btn.classList.remove('text-gray-300');
          window.showToast(`「${courseItem.name}」をお気に入りに保存しました！`, '⭐');
        } else {
          btn.classList.remove('is-active', 'text-amber-500');
          btn.classList.add('text-gray-300');
          window.showToast(`「${courseItem.name}」をお気に入りから解除しました`, '⭐');
        }
      };
    });

    // 献立全体のお気に入り保存ボタン (画面遷移せずトースト通知のみで完了)
    const saveDelicBtn = document.getElementById('btn-save-delic');
    if (saveDelicBtn) {
      saveDelicBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          Store.saveDeliciousRecipe(r, 5, '');
          const saveText = document.getElementById('btn-save-delic-text');
          if (saveText) saveText.textContent = 'お気に入り保存済み';
          saveDelicBtn.classList.remove('bg-amber-50', 'text-amber-800');
          saveDelicBtn.classList.add('bg-amber-100', 'text-amber-900', 'border-amber-400');
          window.showToast('献立セットをお気に入りに保存しました！', '⭐');
        } catch (err) {
          console.error('お気に入り保存失敗:', err);
          alert('お気に入りの保存に失敗しました: ' + err.message);
        }
      };
    }

    // 在庫消費 ＆ 調理回数加算ボタン (数量を賢く減算し、残量があれば在庫に残す)
    const cookBtn = document.getElementById('btn-cook-recipe');
    if (cookBtn) {
      cookBtn.onclick = () => {
        if (confirm('この献立で使用した食材の分量を在庫から減算し、調理実績を記録しますか？')) {
          const used = r.ingredientsWithAmounts || [];
          const currentInv = Store.getInventory();
          const consumedDetails = [];

          // 分量と単位のスマートパーサー
          const parseQty = (str) => {
            if (!str) return { val: 1, unit: '個' };
            const s = String(str).trim();
            const fracMatch = s.match(/(\d+)\s*\/\s*(\d+)/);
            if (fracMatch) {
              const val = parseFloat(fracMatch[1]) / parseFloat(fracMatch[2]);
              const unit = s.replace(fracMatch[0], '').replace(/[約\s()（）一口大スライス千切り]/g, '').trim() || '個';
              return { val, unit };
            }
            const numMatch = s.match(/([0-9]+(?:\.[0-9]+)?)/);
            if (numMatch) {
              const val = parseFloat(numMatch[1]);
              const unit = s.replace(numMatch[0], '').replace(/[約\s()（）一口大スライス千切り]/g, '').trim() || '個';
              return { val, unit };
            }
            return { val: 1, unit: s };
          };

          const formatQty = (val, unit) => {
            if (Math.abs(val - 0.5) < 0.05) return `1/2${unit}`;
            if (Math.abs(val - 0.25) < 0.05) return `1/4${unit}`;
            if (Math.abs(val - 0.75) < 0.05) return `3/4${unit}`;
            if (Math.abs(val - 0.33) < 0.05) return `1/3${unit}`;
            if (Number.isInteger(val)) return `${val}${unit}`;
            return `${val.toFixed(1)}${unit}`;
          };

          used.forEach(u => {
            const matchIdx = currentInv.findIndex(inv => inv.name.includes(u.name) || u.name.includes(inv.name));
            if (matchIdx !== -1) {
              const invItem = currentInv[matchIdx];
              const invQ = parseQty(invItem.quantity);
              const usedQ = parseQty(u.amount);

              // 単位が同じまたはグラム系等の場合
              const remainingVal = invQ.val - usedQ.val;
              if (remainingVal > 0.05) {
                // まだ残量がある場合: 数量を更新して残す
                const newQtyStr = formatQty(remainingVal, invQ.unit);
                consumedDetails.push(`${invItem.name}: ${u.amount}使用 (残${newQtyStr})`);
                currentInv[matchIdx].quantity = newQtyStr;
              } else {
                // 使い切った場合: 在庫から削除
                consumedDetails.push(`${invItem.name}: ${invItem.quantity}完食`);
                currentInv.splice(matchIdx, 1);
              }
            }
          });

          Store.saveInventory(currentInv);

          // 調理回数を加算（3回以上で殿堂入り）
          const updatedRecord = Store.incrementCookCount(r);
          const times = updatedRecord?.cookCount || 1;
          const hallMsg = times >= 3 ? '\n\n🎉 3回以上調理されたため「👑 ⭐ 殿堂入り！リピート定番」に昇格しました！' : `\n（現在: ${times}回調理。3回で殿堂入り）`;

          const detailMsg = consumedDetails.length > 0 ? `\n\n【在庫の減算結果】\n・` + consumedDetails.join('\n・') : '';
          alert(`使った食材の分量を冷蔵庫の在庫から減算しました！${detailMsg}${hallMsg}`);
        }
      };
    }

    // 各品目の「🔄 変更 (部分シャッフル)」ボタンの紐付け
    container.querySelectorAll('[data-shuffle-course]').forEach(btn => {
      btn.onclick = () => {
        const courseKey = btn.dataset.shuffleCourse;
        this.shuffleCourse(courseKey);
      };
    });
  },

  // 品目別部分シャッフル
  shuffleCourse(courseKey) {
    if (!this.currentProposal) return;
    const p = this.currentProposal;
    if (!p.courses) p.courses = {};

    const genre = document.getElementById('recipe-genre-select')?.value || p.genre || 'auto';
    const isWestern = genre === 'italian' || genre === 'french';
    const isChinese = genre === 'chinese' || genre === 'ethnic';

    const CANDIDATES = {
      staple: [
        { name: 'ほかほか白ごはん', note: '炊きたて普通盛り' },
        { name: '麦ごはん または 雑穀米', note: '食物繊維たっぷり' },
        { name: 'わかめごはん', note: 'ミネラル豊富・子ども人気' },
        { name: '温かい素うどん・半玉', note: '消化に優しい主食' },
        { name: 'カリッと焼いたバゲット', note: '洋風にぴったり' }
      ],
      main: isWestern ? [
        { name: '豚肉とキャベツのガーリックオイル蒸し', note: 'オリーブオイル香るジューシー蒸し' },
        { name: 'チキンと玉ねぎのトマト煮込み', note: 'リコピンたっぷり・子どもも食べやすい' },
        { name: '豚バラと野菜のハーブソテー', note: '香ばしい焼き上がり' }
      ] : isChinese ? [
        { name: '豚肉とキャベツの甘味噌炒め (回鍋肉風)', note: '子ども用は味噌控えめ取り分け' },
        { name: '豚バラとふんわり卵の中華オイスター炒め', note: '高タンパク・スピード調理' },
        { name: '具だくさん麻婆豆腐 (辛味後入れ)', note: '優しい出汁ベース' }
      ] : [
        { name: '豚バラ肉とキャベツの重ね蒸し', note: '素材の甘みを最大限に生かす' },
        { name: '豚肉と玉ねぎの甘辛生姜焼き', note: '定番スタミナおかず' },
        { name: 'ふんわり豆腐ハンバーグ 照り焼きソース', note: 'ヘルシー＆高タンパク' },
        { name: '豚肉と野菜の具だくさん味噌炒め', note: 'ご飯が進むコクうま' }
      ],
      side: isWestern ? [
        { name: 'にんじんと玉ねぎのイタリアンマリネ', note: 'お酢とオリーブ油でさっぱり' },
        { name: 'キャベツとコーンのコールスロー', note: 'シャキシャキ食感' },
        { name: 'キャロットラペ レモン風味', note: '彩り鮮やか' }
      ] : [
        { name: 'にんじんと玉ねぎの胡麻和え', note: '香ばしいすりごま風味' },
        { name: 'キャベツと塩昆布の即席和え', note: '箸休めにぴったり' },
        { name: 'にんじんしりしり (卵とじ)', note: '甘みがあって子ども完食' },
        { name: '豆腐とわかめの和風チョレギサラダ', note: 'さっぱりミネラル補給' }
      ],
      soup: isWestern ? [
        { name: '豆腐とキャベツのミネストローネ風', note: 'トマトと野菜の優しい甘み' },
        { name: '玉ねぎと人参のコンソメスープ', note: '素材の旨味スープ' }
      ] : [
        { name: '豆腐とわかめのお味噌汁', note: '定番のほっとする味' },
        { name: '豚バラと根菜の具だくさん豚汁', note: 'これだけで栄養満点' },
        { name: 'ふわふわ卵と玉ねぎのかき玉汁', note: '子ども大人気のトロトロスープ' }
      ]
    };

    const list = CANDIDATES[courseKey] || CANDIDATES.side;
    const currentName = p.courses[courseKey]?.name;
    const nextCandidates = list.filter(item => item.name !== currentName);
    const selected = nextCandidates[Math.floor(Math.random() * nextCandidates.length)] || list[0];

    p.courses[courseKey] = {
      type: courseKey === 'staple' ? '主食' : courseKey === 'main' ? '主菜' : courseKey === 'side' ? '副菜' : '汁物',
      name: selected.name,
      note: selected.note
    };

    // 主菜が変わった場合は全体のタイトルも連動
    if (courseKey === 'main') {
      p.mealTitle = `${selected.name} 定食`;
      p.title = `${selected.name} 定食`;
    }

    Store.saveCurrentRecipe(p);
    this.render();
  }
};


// ================= 6. Inventory & OCR =================
const Inventory = {
  selectedIds: new Set(),

  render() {
    const container = document.getElementById('inventory-list-container');
    if (!container) return;

    const items = Store.getInventory();
    if (!items || items.length === 0) {
      this.selectedIds.clear();
      container.innerHTML = `<p class="text-xs text-center text-gray-400 py-6">食材がありません。「＋」から追加してください</p>`;
      return;
    }

    const selectedCount = this.selectedIds.size;
    const isAllSelected = selectedCount > 0 && selectedCount === items.length;

    container.innerHTML = `
      <div class="space-y-2.5">
        <!-- 一括操作 ＆ 選択バー (タップしやすいモダンボタン) -->
        <div class="flex items-center justify-between bg-gray-50 p-2 rounded-xl border border-gray-100 text-xs">
          <button type="button" id="btn-toggle-select-all" class="flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-white border border-gray-200 font-bold text-gray-700 active:scale-95 shadow-2xs">
            <span class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${isAllSelected ? 'bg-orange-500 text-white font-black' : 'border border-gray-300'}">
              ${isAllSelected ? '✓' : ''}
            </span>
            <span>すべて選択 (${selectedCount}/${items.length})</span>
          </button>

          ${selectedCount > 0 ? `
            <div class="flex items-center space-x-1">
              <button type="button" id="btn-open-bulk-edit" class="px-2.5 py-1.5 rounded-lg bg-orange-500 text-white font-bold text-xs active:scale-95 shadow-2xs flex items-center space-x-1">
                <span>✏️</span>
                <span>まとめて修正</span>
              </button>
              <button type="button" id="btn-bulk-consume" class="px-2 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-xs active:scale-95 shadow-2xs">
                🍳 使った
              </button>
              <button type="button" id="btn-bulk-delete" class="px-2 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-bold border border-rose-200 text-xs active:scale-95 shadow-2xs">
                🗑️ 削除
              </button>
            </div>
          ` : `
            <span class="text-[10px] text-gray-400">カードをタップで選択</span>
          `}
        </div>

        <!-- 食材一覧カード (トグル選択方式: カード全体タップでON/OFF) -->
        <div class="space-y-2">
          ${items.map(item => {
            const isSelected = this.selectedIds.has(item.id);
            return `
              <div data-inv-card="${item.id}" class="rounded-2xl p-3 border transition-all flex items-center justify-between text-xs cursor-pointer select-none ${
                isSelected
                  ? 'border-2 border-orange-500 bg-orange-50/60 shadow-sm'
                  : 'bg-white border-gray-100 hover:border-gray-200 shadow-2xs'
              }">
                <!-- 左側: トグル選択丸バッジ ＆ 食材情報 -->
                <div class="flex items-center space-x-3 flex-1 min-w-0">
                  <div class="w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    isSelected
                      ? 'bg-orange-500 text-white text-[11px] font-black'
                      : 'border-2 border-gray-300 bg-white'
                  }">
                    ${isSelected ? '✓' : ''}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-black text-gray-800 text-xs truncate flex items-center space-x-1.5">
                      <span class="truncate">${item.name}</span>
                      <span class="text-[10px] px-1.5 py-0.2 rounded-md font-bold shrink-0 ${
                        (item.expiryDays <= 1)
                          ? 'bg-rose-100 text-rose-700'
                          : (item.expiryDays <= 3)
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-100 text-gray-600'
                      }">(あと${item.expiryDays}日)</span>
                    </div>
                    <div class="text-gray-400 text-[10px] mt-0.5 truncate">${item.category || 'その他'} • 数量: ${item.quantity || '1個'}</div>
                  </div>
                </div>

                <!-- 右側: 独立アクションボタン (イベント伝播停止付き) -->
                <div class="flex items-center space-x-1 shrink-0 ml-2">
                  <button type="button" data-inv-edit-btn="${item.id}" class="p-1.5 px-2 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-xs border border-gray-200 active:scale-95 transition-all flex items-center space-x-1" title="食材を手修正">
                    <span>✏️</span>
                    <span class="text-[10px]">修正</span>
                  </button>
                  <button type="button" data-del-id="${item.id}" class="p-1.5 text-gray-400 hover:text-rose-500 text-sm active:scale-95" title="削除">🗑️</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // 全選択トグルボタン
    const selectAllBtn = document.getElementById('btn-toggle-select-all');
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        if (this.selectedIds.size === items.length) {
          this.selectedIds.clear();
        } else {
          this.selectedIds = new Set(items.map(i => i.id));
        }
        this.render();
      };
    }

    // カードタップによるトグル選択 (ON/OFF)
    container.querySelectorAll('[data-inv-card]').forEach(card => {
      card.onclick = () => {
        const id = card.dataset.invCard;
        if (this.selectedIds.has(id)) {
          this.selectedIds.delete(id);
        } else {
          this.selectedIds.add(id);
        }
        this.render();
      };
    });

    // ✏️ 修正ボタン押下で単品編集モーダルを起動 (イベント伝播を停止)
    container.querySelectorAll('[data-inv-edit-btn]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.invEditBtn;
        const targetItem = items.find(i => i.id === id);
        if (targetItem && window.App?.openItemEditModal) {
          window.App.openItemEditModal(targetItem);
        }
      };
    });

    // 単品削除ボタン (設定に応じて確認ダイアログ)
    container.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.delId;
        const targetItem = items.find(i => i.id === id);
        if (!targetItem) return;

        const needConfirm = Store.getSettings().confirmBeforeDelete !== false;
        if (needConfirm) {
          if (!confirm(`「${targetItem.name}」を冷蔵庫から削除しますか？`)) {
            return;
          }
        }
        Store.deleteInventoryItem(id);
        this.selectedIds.delete(id);
        if (window.showToast) window.showToast(`「${targetItem.name}」を削除しました`, '🗑️');
      };
    });

    // 一括使ったボタン
    const bulkConsumeBtn = document.getElementById('btn-bulk-consume');
    if (bulkConsumeBtn) {
      bulkConsumeBtn.onclick = () => {
        const count = this.selectedIds.size;
        if (count === 0) return;
        const selectedItems = items.filter(i => this.selectedIds.has(i.id));
        const itemNames = selectedItems.map(i => `・${i.name}`).join('\n');
        if (confirm(`選択した以下の${count}品を「使った」として消費しますか？\n\n${itemNames}`)) {
          this.selectedIds.forEach(id => Store.consumeInventoryItem(id));
          if (window.showToast) window.showToast(`${count}品の食材を消費しました`, '🍳');
          this.selectedIds.clear();
          this.render();
        }
      };
    }

    // 一括削除ボタン (設定に応じて対象リスト付きの確認ダイアログ)
    const bulkDelBtn = document.getElementById('btn-bulk-delete');
    if (bulkDelBtn) {
      bulkDelBtn.onclick = () => {
        const count = this.selectedIds.size;
        if (count === 0) return;
        const selectedItems = items.filter(i => this.selectedIds.has(i.id));
        const itemNames = selectedItems.map(i => `・${i.name}`).join('\n');

        const needConfirm = Store.getSettings().confirmBeforeDelete !== false;
        if (needConfirm) {
          if (!confirm(`選択した以下の${count}品を冷蔵庫から削除しますか？\n\n${itemNames}`)) {
            return;
          }
        }

        this.selectedIds.forEach(id => Store.deleteInventoryItem(id));
        if (window.showToast) window.showToast(`${count}品の食材を削除しました`, '🗑️');
        this.selectedIds.clear();
        this.render();
      };
    }

    // 一括修正モーダルのバインド
    const openBulkEditBtn = document.getElementById('btn-open-bulk-edit');
    const bulkModal = document.getElementById('bulk-edit-modal');
    const bulkCancelBtn = document.getElementById('bulk-edit-cancel-btn');
    const bulkTargetLabel = document.getElementById('bulk-edit-target-label');

    if (openBulkEditBtn && bulkModal) {
      openBulkEditBtn.onclick = () => {
        const count = this.selectedIds.size;
        if (count === 0) return;
        const selectedItems = items.filter(i => this.selectedIds.has(i.id));
        if (bulkTargetLabel) {
          bulkTargetLabel.textContent = `選択中: ${count}品 (${selectedItems.map(i => i.name).join('、')})`;
        }
        bulkModal.classList.remove('hidden');
      };
    }

    if (bulkCancelBtn && bulkModal) {
      bulkCancelBtn.onclick = () => bulkModal.classList.add('hidden');
    }

    // 一括延長ボタン群 (+1, +2, +3, +7日)
    document.querySelectorAll('[data-bulk-add-days]').forEach(btn => {
      btn.onclick = () => {
        const addDays = parseInt(btn.dataset.bulkAddDays, 10);
        const count = this.selectedIds.size;
        this.selectedIds.forEach(id => {
          const it = items.find(i => i.id === id);
          if (it) {
            Store.updateInventoryItem(id, { expiryDays: (it.expiryDays || 0) + addDays });
          }
        });
        if (window.showToast) window.showToast(`${count}品の期限を+${addDays}日延長しました`, '⏰');
        bulkModal?.classList.add('hidden');
        this.selectedIds.clear();
        this.render();
      };
    });

    // 日数統一設定ボタン
    const applyDaysBtn = document.getElementById('btn-bulk-apply-days');
    const setDaysInput = document.getElementById('bulk-set-days-input');
    if (applyDaysBtn && setDaysInput) {
      applyDaysBtn.onclick = () => {
        const days = parseInt(setDaysInput.value, 10);
        if (isNaN(days) || days < 0) {
          alert('有効な日数を入力してください');
          return;
        }
        const count = this.selectedIds.size;
        this.selectedIds.forEach(id => {
          Store.updateInventoryItem(id, { expiryDays: days });
        });
        if (window.showToast) window.showToast(`${count}品の期限を「あと${days}日」に統一しました`, '⏰');
        bulkModal?.classList.add('hidden');
        this.selectedIds.clear();
        this.render();
      };
    }

    // カテゴリ一括変更ボタン
    const applyCatBtn = document.getElementById('btn-bulk-apply-cat');
    const catSelect = document.getElementById('bulk-cat-select');
    if (applyCatBtn && catSelect) {
      applyCatBtn.onclick = () => {
        const cat = catSelect.value;
        if (!cat) {
          alert('変更先のカテゴリを選択してください');
          return;
        }
        const count = this.selectedIds.size;
        this.selectedIds.forEach(id => {
          Store.updateInventoryItem(id, { category: cat });
        });
        if (window.showToast) window.showToast(`${count}品のカテゴリを「${cat}」に変更しました`, '🏷️');
        bulkModal?.classList.add('hidden');
        this.selectedIds.clear();
        this.render();
      };
    }
  }
};

const Ocr = {
  init() {
    const fileInput = document.getElementById('receipt-file-input');
    if (!fileInput) return;

    fileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const spinner = document.getElementById('global-loading');
      if (spinner) spinner.classList.remove('hidden');

      const reader = new FileReader();
      reader.onload = async () => {
        const results = await ApiClient.extractGroceriesFromReceipt(reader.result, file.type);
        if (spinner) spinner.classList.add('hidden');
        this.showConfirmModal(results);
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    };
  },

  showConfirmModal(items) {
    const modal = document.getElementById('receipt-confirm-modal');
    const list = document.getElementById('receipt-items-list');
    if (!modal || !list) return;

    const categories = ['野菜', '肉類', '魚介', '卵・大豆', '乳製品', 'その他'];

    list.innerHTML = items.map((item, idx) => `
      <div class="p-3 bg-gray-50/90 rounded-2xl border border-gray-200 space-y-2 text-xs transition-all" id="ocr_item_row_${idx}">
        <div class="flex items-center space-x-2">
          <input type="checkbox" id="ocr_chk_${idx}" checked class="rounded text-orange-500 w-4 h-4 cursor-pointer">
          <input type="text" id="ocr_name_${idx}" value="${item.name || ''}" placeholder="食材名" class="flex-1 font-black text-gray-800 bg-white border border-gray-200 px-2 py-1 rounded-xl text-xs focus:outline-none focus:border-orange-500">
          <button type="button" onclick="document.getElementById('ocr_item_row_${idx}').remove()" class="text-gray-400 hover:text-rose-500 p-1 text-sm shrink-0" title="この品目を削除">🗑️</button>
        </div>
        <div class="grid grid-cols-3 gap-1.5 pt-0.5">
          <div>
            <label class="block text-[9px] font-bold text-gray-400 mb-0.5">数量・単位</label>
            <input type="text" id="ocr_qty_${idx}" value="${item.quantity || '1個'}" class="w-full bg-white border border-gray-200 px-2 py-1 rounded-lg text-xs font-bold text-gray-700">
          </div>
          <div>
            <label class="block text-[9px] font-bold text-gray-400 mb-0.5">期限 (あと何日)</label>
            <div class="flex items-center space-x-1">
              <input type="number" id="ocr_exp_${idx}" value="${item.expiryDays ?? 3}" min="0" max="60" class="w-full bg-white border border-gray-200 px-1.5 py-1 rounded-lg text-xs font-bold text-gray-700">
              <span class="text-[10px] text-gray-400 shrink-0">日</span>
            </div>
          </div>
          <div>
            <label class="block text-[9px] font-bold text-gray-400 mb-0.5">カテゴリ</label>
            <select id="ocr_cat_${idx}" class="w-full bg-white border border-gray-200 px-1 py-1 rounded-lg text-xs font-bold text-gray-700">
              ${categories.map(cat => `<option value="${cat}" ${item.category === cat ? 'selected' : ''}>${cat}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    `).join('');

    document.getElementById('receipt-confirm-save-btn').onclick = () => {
      let savedCount = 0;
      items.forEach((_, idx) => {
        const row = document.getElementById(`ocr_item_row_${idx}`);
        if (!row) return;
        const chk = document.getElementById(`ocr_chk_${idx}`);
        if (chk && chk.checked) {
          const nameInput = document.getElementById(`ocr_name_${idx}`);
          const qtyInput = document.getElementById(`ocr_qty_${idx}`);
          const expInput = document.getElementById(`ocr_exp_${idx}`);
          const catInput = document.getElementById(`ocr_cat_${idx}`);

          const finalName = nameInput?.value?.trim() || '食材';
          const finalQty = qtyInput?.value?.trim() || '1個';
          const finalExp = parseInt(expInput?.value || '3', 10);
          const finalCat = catInput?.value || 'その他';

          Store.addInventoryItem({
            name: finalName,
            category: finalCat,
            quantity: finalQty,
            expiryDays: isNaN(finalExp) ? 3 : finalExp
          });
          savedCount++;
        }
      });

      modal.classList.add('hidden');
      if (window.showToast) {
        window.showToast(`${savedCount}品の食材を冷蔵庫に登録しました！`, '🛒');
      } else {
        alert(`${savedCount}品の食材を登録しました！`);
      }
    };
    document.getElementById('receipt-confirm-cancel-btn').onclick = () => modal.classList.add('hidden');
    modal.classList.remove('hidden');
  }
};


// ================= 7. App Controller =================
const App = {
  activeTab: 'dashboard',

  init() {
    const settings = Store.getSettings();
    this.applySettings(settings);
    this.bindNavigation();
    this.bindDrawer();
    this.bindQuickHandToggle();
    this.bindSettingsForm();
    this.bindChildrenManager();
    this.bindManualAdd();

    Dashboard.init();
    Nutrition.init();
    Ocr.init();
    Recipe.init();
    Inventory.render();

    // リロード時は直前に開いていたタブを復元、初回アクセス時は設定の初期タブ（分析/ダッシュボード）を開く
    const hashTab = window.location.hash ? window.location.hash.replace('#', '') : null;
    let rememberedTab = null;
    try {
      rememberedTab = sessionStorage.getItem('active_tab');
    } catch (e) {
      console.warn('sessionStorage is not accessible', e);
    }

    const validTabs = ['dashboard', 'recipe', 'inventory', 'nutrition', 'settings'];
    let targetTab = settings.initialTab || 'dashboard';
    if (hashTab && validTabs.includes(hashTab)) {
      targetTab = hashTab;
    } else if (rememberedTab && validTabs.includes(rememberedTab)) {
      targetTab = rememberedTab;
    }

    this.switchTab(targetTab);

    window.addEventListener('app:inventory-updated', () => Inventory.render());
  },

  applySettings(settings) {
    document.documentElement.setAttribute('data-theme', settings.theme || 'orange');
    document.documentElement.setAttribute('data-font-size', settings.fontSize || 'large');
    const appWrapper = document.getElementById('app-wrapper');
    if (appWrapper) {
      appWrapper.className = `min-h-screen max-w-md mx-auto relative pb-20 shadow-xl flex flex-col justify-between ${settings.handMode === 'left' ? 'hand-mode-left' : 'hand-mode-right'}`;
    }

    const quickLabel = document.getElementById('quick-hand-label');
    const quickIcon = document.getElementById('quick-hand-icon');
    if (quickLabel && quickIcon) {
      if (settings.handMode === 'left') {
        quickLabel.textContent = '左手';
        quickIcon.textContent = '🤚';
      } else {
        quickLabel.textContent = '右手';
        quickIcon.textContent = '✋';
      }
    }

    const initSelect = document.getElementById('setting-initial-tab');
    const themeSelect = document.getElementById('setting-theme');
    const fontSelect = document.getElementById('setting-font-size');
    const handSelect = document.getElementById('setting-hand-mode');
    const expDaysSelect = document.getElementById('setting-default-expiry-days');
    const stepModeSelect = document.getElementById('setting-cooking-step-mode');
    const recipeStepSelect = document.getElementById('recipe-step-mode-select');
    const adultCountSelect = document.getElementById('setting-adult-count');
    const growthCountSelect = document.getElementById('setting-growth-count');
    const recipeServingsSelect = document.getElementById('recipe-servings-select');
    const syncCheckbox = document.getElementById('setting-enable-sync');

    if (initSelect) initSelect.value = settings.initialTab || 'dashboard';
    if (themeSelect) themeSelect.value = settings.theme || 'orange';
    if (fontSelect) fontSelect.value = settings.fontSize || 'large';
    if (handSelect) handSelect.value = settings.handMode || 'right';
    if (expDaysSelect) expDaysSelect.value = settings.defaultExpiryDays || 3;
    if (syncCheckbox) syncCheckbox.checked = !!settings.enableExternalSync;
    const confirmDeleteChk = document.getElementById('setting-confirm-delete');
    if (confirmDeleteChk) confirmDeleteChk.checked = settings.confirmBeforeDelete !== false;
    if (stepModeSelect) stepModeSelect.value = settings.cookingStepMode || 'combined';
    if (recipeStepSelect) recipeStepSelect.value = settings.cookingStepMode || 'combined';
    if (adultCountSelect) adultCountSelect.value = settings.adultCount ?? 2;
    if (growthCountSelect) growthCountSelect.value = settings.growthCount ?? 0;

    const autoServings = FamilyHelper.calculateHouseholdServings(settings);
    if (recipeServingsSelect && !recipeServingsSelect.dataset.userChanged) {
      recipeServingsSelect.value = autoServings.toFixed(1);
      if (!recipeServingsSelect.value) recipeServingsSelect.value = "2.5";
    }

    // 外部記録アプリ連携ボタンの表示・非表示制御
    const exportBtn = document.getElementById('btn-export-life-peak');
    if (exportBtn) {
      if (settings.enableExternalSync) exportBtn.classList.remove('hidden');
      else exportBtn.classList.add('hidden');
    }

    document.querySelectorAll('input[name="adult_goal_check"]').forEach(chk => {
      chk.checked = (settings.adultGoals || ['general']).includes(chk.value);
    });

    const apiKeyInput = document.getElementById('setting-api-key');
    if (apiKeyInput) {
      apiKeyInput.value = Store.getApiKey();
    }

    this.renderChildrenList(settings.children || []);
    this.updateHouseholdServingsBanner(settings);
  },

  updateHouseholdServingsBanner(settings) {
    const total = FamilyHelper.calculateHouseholdServings(settings);
    const bannerTotal = document.getElementById('household-servings-total');
    const bannerDetail = document.getElementById('household-servings-detail');
    if (bannerTotal) bannerTotal.textContent = `${total}人分`;

    if (bannerDetail) {
      const parts = [];
      const adults = settings.adultCount ?? 2;
      const growth = settings.growthCount ?? 0;
      if (adults > 0) parts.push(`大人${adults}人`);
      if (growth > 0) parts.push(`食べ盛り${growth}人`);
      if (settings.children && settings.children.length > 0) {
        const cLabels = settings.children.map(c => {
          const info = FamilyHelper.calculateChildInfo(c.birthDate);
          return `${c.name || '子'}(${info.ageText})`;
        });
        parts.push(cLabels.join('・'));
      }
      bannerDetail.textContent = parts.join(' + ') || '世帯人数未設定';
    }
  },

  bindQuickHandToggle() {
    const btn = document.getElementById('quick-hand-toggle-btn');
    if (btn) {
      btn.onclick = () => {
        const settings = Store.getSettings();
        settings.handMode = settings.handMode === 'left' ? 'right' : 'left';
        Store.saveSettings(settings);
        this.applySettings(settings);
      };
    }
  },

  renderChildrenList(children) {
    const container = document.getElementById('children-list-container');
    if (!container) return;

    if (!children || children.length === 0) {
      container.innerHTML = `<p class="text-[11px] text-gray-400 py-2 text-center">登録されているお子様はいません</p>`;
      return;
    }

    container.innerHTML = children.map((c, idx) => {
      const info = FamilyHelper.calculateChildInfo(c.birthDate);
      return `
        <div class="p-2.5 rounded-xl bg-gray-50 border border-gray-100 space-y-1.5 text-xs shadow-xs">
          <div class="flex items-center justify-between space-x-2">
            <input type="text" value="${c.name || ''}" placeholder="名前" data-child-idx="${idx}" data-field="name" class="w-24 font-bold bg-white border border-gray-200 px-2 py-1 rounded-lg text-xs">
            <div class="flex-1 flex items-center space-x-1">
              <span class="text-[10px] text-gray-500 font-semibold shrink-0">生年月:</span>
              <input type="month" value="${c.birthDate || '2024-03'}" data-child-idx="${idx}" data-field="birthDate" class="flex-1 bg-white border border-gray-200 px-1.5 py-1 rounded-lg text-xs font-bold">
            </div>
            <button type="button" data-del-child-idx="${idx}" class="text-gray-400 hover:text-rose-500 p-1 text-sm shrink-0">🗑️</button>
          </div>
          <!-- 自動計算バッジ表示エリア -->
          <div class="flex items-center justify-between pt-1 border-t border-gray-200/50 text-[10px]">
            <span class="px-2 py-0.5 rounded-md bg-pink-100 text-pink-800 font-bold border border-pink-200">
              👶 ${info.ageText} • ${info.stageName}
            </span>
            <span class="font-bold theme-primary-text">
              食事目安: 約${info.scale}人前
            </span>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-del-child-idx]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.delChildIdx, 10);
        const settings = Store.getSettings();
        settings.children.splice(idx, 1);
        Store.saveSettings(settings);
        this.renderChildrenList(settings.children);
        this.updateHouseholdServingsBanner(settings);
      };
    });

    container.querySelectorAll('input[data-child-idx]').forEach(el => {
      el.onchange = () => {
        const idx = parseInt(el.dataset.childIdx, 10);
        const field = el.dataset.field;
        const settings = Store.getSettings();
        if (settings.children[idx]) {
          settings.children[idx][field] = el.value;
          // 生年月変更時はステージキーも最新化
          if (field === 'birthDate') {
            const info = FamilyHelper.calculateChildInfo(el.value);
            settings.children[idx].stage = info.stageKey;
          }
          Store.saveSettings(settings);
          this.renderChildrenList(settings.children);
          this.updateHouseholdServingsBanner(settings);
        }
      };
    });
  },

  bindChildrenManager() {
    const addBtn = document.getElementById('btn-add-child');
    if (addBtn) {
      addBtn.onclick = () => {
        const settings = Store.getSettings();
        settings.children.push({
          id: 'child_' + Date.now(),
          name: `子ども${settings.children.length + 1}`,
          birthDate: '2024-03',
          stage: 'toddler',
          ngFoods: ''
        });
        Store.saveSettings(settings);
        this.renderChildrenList(settings.children);
        this.updateHouseholdServingsBanner(settings);
      };
    }

    // 大人・食べ盛り人数の変更時にリアルタイムで世帯ボリュームバナーを更新
    const adultSelect = document.getElementById('setting-adult-count');
    const growthSelect = document.getElementById('setting-growth-count');
    const onAdultChange = () => {
      const settings = Store.getSettings();
      settings.adultCount = parseInt(adultSelect?.value || '2', 10);
      settings.growthCount = parseInt(growthSelect?.value || '0', 10);
      this.updateHouseholdServingsBanner(settings);
    };
    if (adultSelect) adultSelect.onchange = onAdultChange;
    if (growthSelect) growthSelect.onchange = onAdultChange;
  },

  bindNavigation() {
    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      btn.onclick = () => this.switchTab(btn.dataset.tabTarget);
    });
  },

  bindDrawer() {
    const overlay = document.getElementById('drawer-overlay');
    const closeBtn = document.getElementById('drawer-close-btn');
    const openDrawer = () => overlay?.classList.remove('hidden');
    const closeDrawer = () => overlay?.classList.add('hidden');

    document.getElementById('drawer-toggle-btn-left')?.addEventListener('click', openDrawer);
    document.getElementById('drawer-toggle-btn-right')?.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.onclick = closeDrawer;
    if (overlay) {
      overlay.onclick = (e) => { if (e.target === overlay) closeDrawer(); };
    }

    document.querySelectorAll('[data-drawer-tab]').forEach(btn => {
      btn.onclick = () => {
        this.switchTab(btn.dataset.drawerTab);
        closeDrawer();
      };
    });
  },

  switchTab(tabId) {
    this.activeTab = tabId;

    try {
      sessionStorage.setItem('active_tab', tabId);
      if (window.location.hash !== `#${tabId}`) {
        history.replaceState(null, '', `#${tabId}`);
      }
    } catch (e) {
      // ignore
    }

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-panel-${tabId}`)?.classList.remove('hidden');

    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      const isCurrent = btn.dataset.tabTarget === tabId;
      btn.className = `flex-1 py-1 flex flex-col items-center justify-center space-y-0.5 text-xs transition-all ${isCurrent ? 'theme-primary-text font-black' : 'text-gray-400 font-medium'}`;
    });

    const fab = document.getElementById('inventory-fab');
    if (fab) {
      if (tabId === 'inventory') fab.classList.remove('hidden');
      else fab.classList.add('hidden');
    }

    if (tabId === 'dashboard') Dashboard.render();
    if (tabId === 'nutrition') Nutrition.renderLogs();
    if (tabId === 'recipe') Recipe.render();
    if (tabId === 'inventory') Inventory.render();
  },

  bindSettingsForm() {
    document.getElementById('settings-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const current = Store.getSettings();

      const selectedGoals = [];
      document.querySelectorAll('input[name="adult_goal_check"]:checked').forEach(chk => {
        selectedGoals.push(chk.value);
      });

      const adultCount = parseInt(document.getElementById('setting-adult-count')?.value || '2', 10);
      const growthCount = parseInt(document.getElementById('setting-growth-count')?.value || '0', 10);
      const autoServings = FamilyHelper.calculateHouseholdServings({
        ...current,
        adultCount,
        growthCount
      });

      const updated = {
        ...current,
        initialTab: document.getElementById('setting-initial-tab')?.value || 'dashboard',
        initialTabMigrated: true,
        theme: document.getElementById('setting-theme')?.value || 'orange',
        fontSize: document.getElementById('setting-font-size')?.value || 'large',
        handMode: document.getElementById('setting-hand-mode')?.value || 'right',
        cookingStepMode: document.getElementById('setting-cooking-step-mode')?.value || 'combined',
        defaultExpiryDays: parseInt(document.getElementById('setting-default-expiry-days')?.value || '3', 10),
        adultCount: adultCount,
        growthCount: growthCount,
        defaultServings: autoServings,
        enableExternalSync: document.getElementById('setting-enable-sync')?.checked || false,
        confirmBeforeDelete: document.getElementById('setting-confirm-delete')?.checked !== false,
        adultGoals: selectedGoals.length ? selectedGoals : ['general']
      };
      Store.saveSettings(updated);
      const inputApiKey = document.getElementById('setting-api-key')?.value?.trim();
      if (inputApiKey !== undefined) Store.saveApiKey(inputApiKey);
      this.applySettings(updated);
      alert(`家族設定を保存しました！\n（基本の作成人数は ${autoServings}人分 に更新されました）`);
    });

    // APIキー保存
    const saveKeyBtn = document.getElementById('save-api-key-btn');
    const statusMsg = document.getElementById('api-key-status-msg');

    const showApiKeyStatus = (text, isSuccess) => {
      if (!statusMsg) return;
      statusMsg.className = `text-xs font-bold py-2 px-3 rounded-xl block transition-all ${
        isSuccess ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
      }`;
      statusMsg.textContent = text;
    };

    if (saveKeyBtn) {
      saveKeyBtn.onclick = (e) => {
        e.preventDefault();
        const key = document.getElementById('setting-api-key')?.value?.trim() || '';
        Store.saveApiKey(key);

        // ボタンのフィードバック
        const origText = saveKeyBtn.textContent;
        saveKeyBtn.textContent = '✅ 保存完了！';
        saveKeyBtn.classList.remove('bg-gray-800');
        saveKeyBtn.classList.add('bg-emerald-600');

        showApiKeyStatus(key ? '✅ APIキーを端末に保存しました（次回も保持されます）' : 'ℹ️ APIキーを消去しました（モックモードで動作します）', true);

        setTimeout(() => {
          saveKeyBtn.textContent = origText;
          saveKeyBtn.classList.remove('bg-emerald-600');
          saveKeyBtn.classList.add('bg-gray-800');
        }, 2000);
      };
    }

    // API接続テスト
    const testKeyBtn = document.getElementById('test-api-key-btn');
    if (testKeyBtn) {
      testKeyBtn.onclick = async (e) => {
        e.preventDefault();
        const key = document.getElementById('setting-api-key')?.value?.trim() || '';
        const originalText = testKeyBtn.textContent;
        testKeyBtn.disabled = true;
        testKeyBtn.textContent = '⏳ 通信中...';
        showApiKeyStatus('Gemini APIと接続テストを実行中...', true);

        try {
          const res = await ApiClient.testConnection(key);
          showApiKeyStatus(res.message, res.success);
        } catch (err) {
          showApiKeyStatus(`エラーが発生しました: ${err.message}`, false);
        } finally {
          testKeyBtn.disabled = false;
          testKeyBtn.textContent = originalText;
        }
      };
    }

    // 文字サイズリアルタイム切替
    document.getElementById('setting-font-size')?.addEventListener('change', (e) => {
      document.documentElement.setAttribute('data-font-size', e.target.value);
    });

    document.getElementById('export-backup-btn')?.addEventListener('click', () => Store.exportBackup());
    document.getElementById('import-backup-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => Store.importBackup(event.target.result);
      reader.readAsText(file);
    });
  },

  openItemEditModal(item = null) {
    const modal = document.getElementById('manual-add-modal');
    if (!modal) return;

    const idInput = document.getElementById('manual-item-id');
    const nameInput = document.getElementById('manual-item-name');
    const catInput = document.getElementById('manual-item-cat');
    const qtyInput = document.getElementById('manual-item-qty');
    const expInput = document.getElementById('manual-item-exp');
    const titleEl = document.getElementById('manual-add-modal-title');
    const submitBtn = document.getElementById('manual-add-submit-btn');

    if (item) {
      if (idInput) idInput.value = item.id;
      if (nameInput) nameInput.value = item.name;
      if (catInput) catInput.value = item.category || '野菜';
      if (qtyInput) qtyInput.value = item.quantity || '1個';
      if (expInput) expInput.value = item.expiryDays ?? 3;
      if (titleEl) titleEl.textContent = '✏️ 食材を編集';
      if (submitBtn) submitBtn.textContent = '変更を保存する';
    } else {
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (catInput) catInput.value = '野菜';
      if (qtyInput) qtyInput.value = '1個';
      if (expInput) expInput.value = Store.getSettings().defaultExpiryDays || 3;
      if (titleEl) titleEl.textContent = '🥗 食材を手動で追加';
      if (submitBtn) submitBtn.textContent = '在庫に追加する';
    }

    modal.classList.remove('hidden');
  },

  bindManualAdd() {
    const modal = document.getElementById('manual-add-modal');
    const close = () => {
      modal?.classList.add('hidden');
      const form = document.getElementById('manual-add-form');
      if (form) form.reset();
      const idInput = document.getElementById('manual-item-id');
      if (idInput) idInput.value = '';
    };

    document.getElementById('open-manual-add-btn')?.addEventListener('click', () => this.openItemEditModal(null));
    document.getElementById('inventory-fab')?.addEventListener('click', () => this.openItemEditModal(null));
    document.getElementById('manual-add-cancel-btn')?.addEventListener('click', close);

    document.getElementById('manual-add-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const editId = document.getElementById('manual-item-id')?.value;
      const name = document.getElementById('manual-item-name')?.value?.trim() || '食材';
      const category = document.getElementById('manual-item-cat')?.value || 'その他';
      const quantity = document.getElementById('manual-item-qty')?.value?.trim() || '1個';
      const expiryDays = parseInt(document.getElementById('manual-item-exp')?.value || '3', 10);

      const itemData = { name, category, quantity, expiryDays: isNaN(expiryDays) ? 3 : expiryDays };

      if (editId) {
        Store.updateInventoryItem(editId, itemData);
        if (window.showToast) window.showToast(`「${name}」を更新しました！`, '✏️');
      } else {
        Store.addInventoryItem(itemData);
        if (window.showToast) window.showToast(`「${name}」を冷蔵庫に追加しました！`, '🥗');
      }

      close();
    });
  }
};

window.App = App;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
