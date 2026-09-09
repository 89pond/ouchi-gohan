// app.bundle.js - スタンドアロン統合スクリプト (ダッシュボード分離・過去日チャート・Life Peak連携対応)

// ================= 1. Store (データ管理 & Life Peak 連携) =================
const STORAGE_KEYS = {
  SETTINGS: 'meal_app_settings',
  INVENTORY: 'meal_app_inventory',
  DELICIOUS_RECIPES: 'meal_app_delicious_recipes',
  MEAL_LOGS: 'meal_app_logs',
  API_KEY: 'meal_app_gemini_api_key'
};

const DEFAULT_SETTINGS = {
  theme: 'orange',
  handMode: 'right',
  initialTab: 'dashboard', // システム初期表示はダッシュボード (5大栄養素)
  enableExternalSync: false, // 外部記録アプリ連携 (デフォルトOFF)
  cookingStepMode: 'combined', // 調理手順スタイル: combined (まとめて同時) | by_course (品目別ごと)
  defaultServings: 2.5, // 自動算出される世帯作成人数
  adultCount: 2, // 大人 (標準: 1.0人前)
  growthCount: 0, // 食べ盛り・アスリート (大盛り: 1.5人前)
  adultGoals: ['general'],
  children: [
    { id: 'child_1', name: '長男/長女', birthDate: '2024-03', stage: 'toddler', ngFoods: 'ハチミツ, ナッツ類' }
  ],
  dailyMoods: []
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
    if (existingIndex >= 0) list[existingIndex] = record;
    else list.unshift(record);
    localStorage.setItem(STORAGE_KEYS.DELICIOUS_RECIPES, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('app:delicious-updated', { detail: list }));
    return record;
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


// ================= 2. ApiClient =================
const ApiClient = {
  async extractGroceriesFromReceipt(base64Image, mimeType = 'image/jpeg') {
    return this.mockReceiptExtraction();
  },

  async generateMealProposal(inventory, settings, genre = 'auto', stepMode = 'combined', servings = 3) {
    return this.mockMealProposal(inventory, settings, genre, stepMode, servings);
  },

  async analyzeMealImage(base64Image, mimeType = 'image/jpeg') {
    return this.mockMealAnalysis();
  },

  mockReceiptExtraction() {
    return [
      { name: '豚バラ肉', category: '肉類', quantity: '1パック(250g)', expiryDays: 2 },
      { name: 'キャベツ', category: '野菜', quantity: '1/2個', expiryDays: 5 },
      { name: '木綿豆腐', category: '卵・大豆', quantity: '1丁(300g)', expiryDays: 3 },
      { name: '卵', category: '卵・大豆', quantity: '1パック(10個)', expiryDays: 10 }
    ];
  },

  mockMealProposal(inventory, settings, genre = 'auto', stepMode = 'combined', servings = 3) {
    const sNum = parseInt(servings, 10) || 3;
    const adultGoals = settings.adultGoals || ['general'];
    const children = settings.children || [];

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

    // ジャンル別プリセット生成
    if (genre === 'chinese') {
      return {
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
          '【主菜・汁物 同時加熱】フライパンにごま油少々で豚肉とキャベツを炒める。小鍋に湯500mlと鶏ガラスープ・豆腐を入れて火にかける。',
          '👶【子ども用取り分け】中華だれを入れる前に、火が通り柔らかくなった豚肉とキャベツを子どものお皿に取り出してキッチンバサミで月齢サイズにカット。スープからも豆腐と汁少々を取り出し、湯冷ましで薄める。',
          '【副菜 レンジ調理】耐熱ボウルに千切りにんじん・玉ねぎを入れ、ラップをしてレンジで1分半加熱。子ども用にはそのまますりごまを和え、大人用にはごま油と塩少々を和える。',
          '【主菜・汁物 仕上げ・全員分完成】フライパンに味噌・オイスターソースだれを一気に回し入れ強火で香ばしく炒める。小鍋に溶き卵を回し入れ火を止める。これで全員分同時に完成！'
        ],
        courseSteps: {
          main: [
            '【主菜】豚肉とキャベツを一口大に切る。',
            '【主菜】フライパンにごま油を熱し、豚肉とキャベツを強火で炒める。',
            '👶【子ども用取り分け】タレを絡める前に、柔らかくなったお肉とキャベツを取り出して月齢サイズにカット。',
            '【主菜】フライパンに味噌・オイスターソースだれを回し入れ、香ばしく炒め合わせて大人用完成。'
          ],
          side: [
            '【副菜】にんじんと玉ねぎを千切りにする。',
            '【副菜】耐熱ボウルに入れラップをしてレンジ(600W)で1分半加熱。',
            '👶【子ども用取り分け】味付け前に子ども分を取り出しすりごま少々で和える。',
            '【副菜】残りにごま油と塩少々を加えて和え、副菜完成。'
          ],
          soup: [
            '【汁物】小鍋に水500ml、鶏ガラスープの素、さいの目切り豆腐を入れて沸かす。',
            '👶【子ども用取り分け】溶き卵と塩胡椒の前に、豆腐とスープを取り出して湯冷ましで薄める。',
            '【汁物】溶き卵を回し入れ、ふんわり固まったら火を止めて汁物完成。'
          ],
          staple: [
            '【主食】炊きたてのごはんを茶碗によそう。子ども用は軟飯やおにぎりに。'
          ]
        },
        stepMode: stepMode,
        childSeparations: childSeparations,
        adultArrangements: adultArrangements,
        safetyAlert: '1歳未満へのハチミツ・黒糖は厳禁です。中華だれ投入前に必ず子ども用を取り分けてください。'
      };
    }

    if (genre === 'italian') {
      return {
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
          { name: 'コンソメキューブ', amount: sNum <= 2 ? '0.5個' : sNum <= 4 ? '1個' : '2個' },
          { name: '塩・黒胡椒・ハーブ', amount: '少々' }
        ],
        baseSteps: [
          '【共通・下ごしらえ】キャベツは一口大、豚肉も食べやすく切る。にんじん・玉ねぎはスライス。',
          '【主菜・汁物 同時蒸し・煮込み】フライパンにキャベツと豚肉を敷き、オリーブオイル小さじ1を回しかけて蓋をし蒸し焼き。小鍋に湯400ml、コンソメ、豆腐、野菜を入れて煮立てる。',
          '👶【子ども用取り分け】塩やハーブを振る前に、蒸し上がった柔らかい豚肉とキャベツを取り出し、子どもの月齢に合わせて細かく刻む。スープの豆腐と野菜も取り出して薄める。',
          '【主菜・汁物 仕上げ・全員分完成】フライパンの豚肉とキャベツに塩・黒胡椒・お好みのハーブを振って大人用を仕上げる。これで一度の調理で家族全員分が完成！'
        ],
        courseSteps: {
          main: [
            '【主菜】キャベツと豚肉を食べやすい大きさに切る。',
            '【主菜】フライパンに並べてオリーブオイル小さじ1を回しかけ、蓋をして中火で約7分蒸し焼きにする。',
            '👶【子ども用取り分け】調味料を振る前に、柔らかいお肉とキャベツを子どもの月齢に合わせてカット。',
            '【主菜】大人用に塩・黒胡椒・ハーブを振って仕上げる。'
          ],
          side: [
            '【副菜】にんじんと玉ねぎを薄切りにする。',
            '【副菜】オリーブオイルとお酢、塩少々を混ぜてマリネ液を作り、野菜を和えて副菜完成。'
          ],
          soup: [
            '【汁物】鍋に水400ml、コンソメ1個、さいの目切り豆腐、野菜を入れて煮立てる。',
            '👶【子ども用取り分け】煮込んだ豆腐と野菜を取り出し、白湯で薄めて子ども用にする。',
            '【汁物】大人用はお好みで黒胡椒を振って完成。'
          ],
          staple: [
            '【主食】バゲットを温める、またはごはんをよそう。'
          ]
        },
        stepMode: stepMode,
        childSeparations: childSeparations,
        adultArrangements: adultArrangements,
        safetyAlert: '1歳未満へのハチミツ厳禁。黒胡椒等のスパイスは大人用のみ最後に振ってください。'
      };
    }

    // デフォルト（和食・おまかせ）
    return {
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
        { name: '玉ねぎ', amount: sNum <= 2 ? '1/2個 (薄切り)' : '1個 (薄切り)' },
        { name: 'にんじん', amount: sNum <= 2 ? '1/3本 (千切り)' : '1/2本 (千切り)' }
      ],
      seasonings: [
        { name: '和風だしの素', amount: sNum <= 2 ? '小さじ1' : sNum <= 4 ? '小さじ2' : '大さじ1' },
        { name: '料理酒・みりん', amount: sNum <= 2 ? '各小さじ2' : '各大さじ1' },
        { name: '味噌', amount: sNum <= 2 ? '大さじ1' : sNum <= 4 ? '大さじ2' : '大さじ3' },
        { name: 'ポン酢・生姜 (大人用)', amount: '適宜' }
      ],
      baseSteps: [
        '【共通・下ごしらえ】キャベツはざく切り、豚肉は一口大に。にんじんと玉ねぎを千切りにする。',
        '【主菜・汁物 重ね蒸し＆煮込み】フライパンにキャベツと豚肉を重ね、酒大さじ1と出汁少々を回し入れ蓋をして弱中火で蒸す。同時に鍋に水600mlと出汁を沸かし、豆腐と野菜を煮る。',
        '👶【子ども用取り分け】味噌を溶く前、ポン酢をつける前に、フライパンから柔らかく蒸されたお肉とキャベツを取り出し、子どもの月齢に合わせて刻む。鍋の出汁で煮た豆腐も取り出し、薄味の離乳食・幼児食を確保。',
        '【副菜 レンジ調理】耐熱ボウルに千切りにんじん・玉ねぎ・ごま油少々を入れ、レンジで1分半加熱して塩昆布等で和える。',
        '【主菜・汁物 仕上げ・全員分完成】鍋に味噌を溶き入れて味噌汁完成。重ね蒸しはお皿に盛り、大人はポン酢や生姜を添える。一度の工程で家族全員分が完成！'
      ],
      courseSteps: {
        main: [
          '【主菜】キャベツをざく切り、豚肉を一口大に切る。',
          '【主菜】フライパンにキャベツと豚肉を交互に敷き、酒大さじ1と出汁少々を回し入れて蓋をし中火で蒸し焼き。',
          '👶【子ども用取り分け】タレやポン酢をつける前に、柔らかいお肉とキャベツを取り出し月齢サイズにカット。',
          '【主菜】お皿に盛り付け、大人用はお好みでポン酢・生姜を添えて主菜完成。'
        ],
        side: [
          '【副菜】にんじんと玉ねぎを千切りにする。',
          '【副菜】耐熱ボウルに入れてごま油少々を回しかけ、ラップをしてレンジで1分半加熱。',
          '👶【子ども用取り分け】塩昆布を和える前に子ども分を取り分ける。',
          '【副菜】残りに塩昆布やすりごまを和えて副菜完成。'
        ],
        soup: [
          '【汁物】小鍋に水600mlと和風出汁を沸かし、余ったキャベツとさいの目切り豆腐を煮る。',
          '👶【子ども用取り分け】味噌を溶く前に、出汁で柔らかくなった豆腐と野菜、出汁スープを取り出す。',
          '【汁物】鍋に味噌を溶き入れてひと煮立ちさせ、味噌汁完成。'
        ],
        staple: [
          '【主食】炊きたてのごはんをよそう。子ども用は食べやすい一口おにぎりや軟飯に。'
        ]
      },
      stepMode: stepMode,
      childSeparations: childSeparations.length ? childSeparations : ['【子ども用】主菜のお肉と汁物の豆腐を調味前に小さくカットして取り分けます。'],
      adultArrangements: adultArrangements,
      safetyAlert: '1歳未満へのハチミツ・黒糖は厳禁です。喉詰まり防止のため、子ども用のお肉やにんじんは柔らかく加熱し一口サイズ以下にしてください。'
    };
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

  init() {
    this.bindEvents();
    this.render();
  },

  formatStepText(text) {
    if (!text) return '';
    // 【】内のテキストを検出し、品目・役割に応じた専用カラーバッジに置換
    return text.replace(/【(.*?)】/g, (match, label) => {
      if (label.includes('主食')) {
        return `<span class="step-badge step-badge-staple">🍚 ${label}</span>`;
      }
      if (label.includes('主菜')) {
        return `<span class="step-badge step-badge-main">🥩 ${label}</span>`;
      }
      if (label.includes('副菜')) {
        return `<span class="step-badge step-badge-side">🥗 ${label}</span>`;
      }
      if (label.includes('汁物')) {
        return `<span class="step-badge step-badge-soup">🥣 ${label}</span>`;
      }
      if (label.includes('子ども') || label.includes('取り分け')) {
        return `<span class="step-badge step-badge-child">👶 ${label}</span>`;
      }
      // 共通・下ごしらえ・全員分完成・加熱等
      return `<span class="step-badge step-badge-common">👨‍🍳 ${label}</span>`;
    });
  },

  bindEvents() {
    const tabSuggest = document.getElementById('recipe-tab-suggest');
    const tabHall = document.getElementById('recipe-tab-hall');

    if (tabSuggest && tabHall) {
      tabSuggest.onclick = () => {
        this.activeTab = 'suggest';
        tabSuggest.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold theme-primary-bg text-white shadow-xs';
        tabHall.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:text-gray-900';
        this.render();
      };
      tabHall.onclick = () => {
        this.activeTab = 'hall-of-fame';
        tabHall.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold theme-primary-bg text-white shadow-xs';
        tabSuggest.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:text-gray-900';
        this.render();
      };
    }

    // 献立画面での手順スタイル切り替え時に即時反映
    const stepModeSelect = document.getElementById('recipe-step-mode-select');
    if (stepModeSelect) {
      stepModeSelect.addEventListener('change', () => {
        if (this.currentProposal) {
          this.currentProposal.stepMode = stepModeSelect.value;
          this.render();
        }
      });
    }

    // 献立画面での人数切り替え時に即時再提案/再計算
    const servingsSelect = document.getElementById('recipe-servings-select');
    if (servingsSelect) {
      servingsSelect.addEventListener('change', () => {
        if (this.currentProposal) {
          const s = parseInt(servingsSelect.value, 10) || 3;
          const genre = document.getElementById('recipe-genre-select')?.value || 'auto';
          const stepMode = document.getElementById('recipe-step-mode-select')?.value || 'combined';
          this.currentProposal = ApiClient.mockMealProposal(Store.getInventory(), Store.getSettings(), genre, stepMode, s);
          this.render();
        }
      });
    }

    window.addEventListener('app:delicious-updated', () => {
      if (this.activeTab === 'hall-of-fame') this.render();
    });
  },

  async generateNewRecipe() {
    const spinner = document.getElementById('global-loading');
    if (spinner) spinner.classList.remove('hidden');
    try {
      const genre = document.getElementById('recipe-genre-select')?.value || 'auto';
      const stepMode = document.getElementById('recipe-step-mode-select')?.value || Store.getSettings().cookingStepMode || 'combined';
      const servings = document.getElementById('recipe-servings-select')?.value || Store.getSettings().defaultServings || 3;
      this.currentProposal = await ApiClient.generateMealProposal(Store.getInventory(), Store.getSettings(), genre, stepMode, servings);
      this.render();
    } finally {
      if (spinner) spinner.classList.add('hidden');
    }
  },

  render() {
    const container = document.getElementById('recipe-content-container');
    if (!container) return;

    if (this.activeTab === 'hall-of-fame') {
      const list = Store.getDeliciousRecipes();
      if (!list || list.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center bg-white rounded-2xl border border-dashed border-gray-200">
            <p class="text-3xl mb-1">⭐</p>
            <p class="font-bold text-xs text-gray-700">殿堂入りレシピはまだありません</p>
          </div>
        `;
        return;
      }
      container.innerHTML = list.map(item => `
        <div class="bg-white p-4 rounded-2xl border border-amber-200/80 shadow-xs space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-amber-500 font-bold text-xs">⭐⭐⭐⭐⭐ 殿堂入り</span>
            <button data-recall-id="${item.id}" class="px-2.5 py-1 rounded bg-amber-500 text-white text-[11px] font-bold">再表示</button>
          </div>
          <h4 class="font-bold text-sm text-gray-800">${item.title}</h4>
          ${item.note ? `<p class="text-xs bg-amber-50 text-amber-900 p-2 rounded-lg font-medium">💬 ${item.note}</p>` : ''}
        </div>
      `).join('');

      container.querySelectorAll('[data-recall-id]').forEach(btn => {
        btn.onclick = () => {
          this.currentProposal = list.find(r => r.id === btn.dataset.recallId);
          document.getElementById('recipe-tab-suggest')?.click();
        };
      });
      return;
    }

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

        <!-- 1食分の献立構成 (主食・主菜・副菜・汁物) -->
        <div class="grid grid-cols-2 gap-2 pt-1">
          <div class="p-2.5 rounded-xl bg-orange-50/50 border border-orange-100 text-xs">
            <div class="flex items-center space-x-1 font-black text-orange-700 mb-0.5">
              <span>🍚 主食:</span>
            </div>
            <div class="font-bold text-gray-800 text-[11px]">${courses.staple?.name || 'ごはん'}</div>
            <div class="text-[9px] text-gray-400 mt-0.5">${courses.staple?.note || '適量'}</div>
          </div>

          <div class="p-2.5 rounded-xl bg-rose-50/50 border border-rose-100 text-xs">
            <div class="flex items-center space-x-1 font-black text-rose-700 mb-0.5">
              <span>🥩 主菜:</span>
            </div>
            <div class="font-bold text-gray-800 text-[11px]">${courses.main?.name || title}</div>
            <div class="text-[9px] text-gray-400 mt-0.5">${courses.main?.note || 'メインおかず'}</div>
          </div>

          <div class="p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-100 text-xs">
            <div class="flex items-center space-x-1 font-black text-emerald-700 mb-0.5">
              <span>🥗 副菜:</span>
            </div>
            <div class="font-bold text-gray-800 text-[11px]">${courses.side?.name || '野菜の小鉢'}</div>
            <div class="text-[9px] text-gray-400 mt-0.5">${courses.side?.note || '食物繊維補給'}</div>
          </div>

          <div class="p-2.5 rounded-xl bg-amber-50/50 border border-amber-100 text-xs">
            <div class="flex items-center space-x-1 font-black text-amber-700 mb-0.5">
              <span>🥣 汁物:</span>
            </div>
            <div class="font-bold text-gray-800 text-[11px]">${courses.soup?.name || '具だくさん味噌汁'}</div>
            <div class="text-[9px] text-gray-400 mt-0.5">${courses.soup?.note || '温活・水分補給'}</div>
          </div>
        </div>

        <!-- 具体的な材料・調味料の分量一覧 -->
        ${(r.ingredientsWithAmounts && r.ingredientsWithAmounts.length) ? `
          <div class="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-black text-gray-700">⚖️ 材料・調味料の分量目安</span>
              <span class="text-[10px] theme-primary-text font-bold px-2 py-0.5 rounded-full bg-orange-50 border border-orange-200">${r.servings || 3}人分目安</span>
            </div>
            
            <div class="space-y-1">
              <span class="text-[11px] font-bold text-gray-600 block">【食材】</span>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                ${r.ingredientsWithAmounts.map(ing => `
                  <div class="flex justify-between items-center bg-white px-2.5 py-1.5 rounded-lg border border-gray-100 text-[11px]">
                    <span class="text-gray-800 font-medium">${ing.name}</span>
                    <span class="text-orange-600 font-bold">${ing.amount}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            ${(r.seasonings && r.seasonings.length) ? `
              <div class="space-y-1 pt-1 border-t border-gray-200/60">
                <span class="text-[11px] font-bold text-gray-600 block">【調味料】</span>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  ${r.seasonings.map(s => `
                    <div class="flex justify-between items-center bg-white px-2.5 py-1.5 rounded-lg border border-gray-100 text-[11px]">
                      <span class="text-gray-800 font-medium">${s.name}</span>
                      <span class="text-emerald-600 font-bold">${s.amount}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- 保存ボタン -->
        <button id="btn-save-delic" class="w-full py-2.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 font-bold text-xs active:scale-95 transition-all">
          ⭐ この献立をおいしかった殿堂入りに保存
        </button>

        <!-- 子ども取り分け (複数人分表示) -->
        <div class="p-3 bg-pink-50 rounded-xl border border-pink-100 text-xs space-y-2">
          <p class="font-bold text-pink-700">👶 子ども別 取り分け指示</p>
          ${(r.childSeparations || []).map(cs => `
            <div class="p-2.5 rounded-lg border border-pink-200/50 leading-relaxed font-medium bg-white/70">
              ${cs}
            </div>
          `).join('')}
          ${r.safetyAlert ? `<p class="text-rose-600 font-bold mt-1">⚠️ ${r.safetyAlert}</p>` : ''}
        </div>

        <!-- 大人アレンジ (複数人分表示) -->
        <div class="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs space-y-2">
          <p class="font-bold text-blue-700">🥗 大人別 アレンジ・食べ方ガイド</p>
          ${(r.adultArrangements || []).map(aa => `
            <div class="p-2.5 rounded-lg border border-blue-200/50 leading-relaxed font-medium bg-white/70">
              💡 ${aa}
            </div>
          `).join('')}
        </div>

        <!-- 調理手順 (まとめて同時進行 or 品目別個別) -->
        <div class="pt-2 border-t border-gray-100">
          <div class="flex items-center justify-between mb-2">
            <p class="font-bold text-gray-800 text-xs">
              ${r.stepMode === 'by_course' ? '📑 品目別の調理ステップ' : '👨‍🍳 家族全員分が同時にできる時短調理ステップ'}
            </p>
            <span class="text-[10px] text-orange-600 font-semibold">
              ${r.stepMode === 'by_course' ? '各料理ごとに独立' : '上から順に進めるだけ'}
            </span>
          </div>

          ${r.stepMode === 'by_course' && r.courseSteps ? `
            <!-- 品目別個別ステップ -->
            <div class="space-y-3">
              <!-- 主菜 -->
              <div class="p-2.5 rounded-xl bg-rose-50/40 border border-rose-100 text-xs space-y-1.5">
                <span class="font-black text-rose-700 text-[11px] block">🥩 主菜のステップ (${courses.main?.name || 'メイン'})</span>
                <ol class="space-y-1 text-[11px]">
                  ${(r.courseSteps.main || []).map((step, idx) => `
                    <li class="flex items-start space-x-1.5 leading-relaxed text-gray-700">
                      <span class="font-bold text-rose-600 shrink-0">${idx + 1}.</span>
                      <span class="flex-1">${this.formatStepText(step)}</span>
                    </li>
                  `).join('')}
                </ol>
              </div>

              <!-- 副菜 -->
              <div class="p-2.5 rounded-xl bg-emerald-50/40 border border-emerald-100 text-xs space-y-1.5">
                <span class="font-black text-emerald-700 text-[11px] block">🥗 副菜のステップ (${courses.side?.name || 'サブ'})</span>
                <ol class="space-y-1 text-[11px]">
                  ${(r.courseSteps.side || []).map((step, idx) => `
                    <li class="flex items-start space-x-1.5 leading-relaxed text-gray-700">
                      <span class="font-bold text-emerald-600 shrink-0">${idx + 1}.</span>
                      <span class="flex-1">${this.formatStepText(step)}</span>
                    </li>
                  `).join('')}
                </ol>
              </div>

              <!-- 汁物 -->
              <div class="p-2.5 rounded-xl bg-amber-50/40 border border-amber-100 text-xs space-y-1.5">
                <span class="font-black text-amber-700 text-[11px] block">🥣 汁物のステップ (${courses.soup?.name || 'スープ'})</span>
                <ol class="space-y-1 text-[11px]">
                  ${(r.courseSteps.soup || []).map((step, idx) => `
                    <li class="flex items-start space-x-1.5 leading-relaxed text-gray-700">
                      <span class="font-bold text-amber-600 shrink-0">${idx + 1}.</span>
                      <span class="flex-1">${this.formatStepText(step)}</span>
                    </li>
                  `).join('')}
                </ol>
              </div>

              <!-- 主食 -->
              <div class="p-2.5 rounded-xl bg-orange-50/40 border border-orange-100 text-xs space-y-1.5">
                <span class="font-black text-orange-700 text-[11px] block">🍚 主食のステップ (${courses.staple?.name || 'ごはん'})</span>
                <ol class="space-y-1 text-[11px]">
                  ${(r.courseSteps.staple || []).map((step, idx) => `
                    <li class="flex items-start space-x-1.5 leading-relaxed text-gray-700">
                      <span class="font-bold text-orange-600 shrink-0">${idx + 1}.</span>
                      <span class="flex-1">${this.formatStepText(step)}</span>
                    </li>
                  `).join('')}
                </ol>
              </div>
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
              })}
            </ol>
          `}
        </div>
      </div>
    `;

    document.getElementById('btn-save-delic').onclick = () => {
      const note = prompt('メモがあれば入力してください（例：定食大好評！子ども完食 等）', '');
      Store.saveDeliciousRecipe(r, 5, note || '');
      alert('「おいしかった献立（殿堂入り）」に保存しました！');
    };
  }
};


// ================= 6. Inventory & OCR =================
const Inventory = {
  render() {
    const container = document.getElementById('inventory-list-container');
    if (!container) return;

    const items = Store.getInventory();
    if (!items || items.length === 0) {
      container.innerHTML = `<p class="text-xs text-center text-gray-400 py-6">食材がありません。「＋」から追加してください</p>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between text-xs">
        <div>
          <div class="font-bold text-gray-800">${item.name} <span class="text-[10px] text-orange-600 font-semibold">(あと${item.expiryDays}日)</span></div>
          <div class="text-gray-400 text-[10px] mt-0.5">${item.category} • ${item.quantity}</div>
        </div>
        <div class="flex space-x-1">
          <button data-consume-id="${item.id}" class="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 font-bold">使った</button>
          <button data-del-id="${item.id}" class="p-1 text-gray-400 hover:text-rose-500">🗑️</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-consume-id]').forEach(btn => {
      btn.onclick = () => Store.consumeInventoryItem(btn.dataset.consumeId);
    });
    container.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.onclick = () => Store.deleteInventoryItem(btn.dataset.delId);
    });
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

    list.innerHTML = items.map((item, idx) => `
      <div class="p-2.5 bg-gray-50 rounded-xl flex items-center justify-between text-xs">
        <label class="flex items-center space-x-2 font-bold text-gray-800 flex-1">
          <input type="checkbox" id="ocr_chk_${idx}" checked class="rounded text-orange-500">
          <span>${item.name} (${item.quantity})</span>
        </label>
      </div>
    `).join('');

    document.getElementById('receipt-confirm-save-btn').onclick = () => {
      items.forEach((item, idx) => {
        if (document.getElementById(`ocr_chk_${idx}`)?.checked) {
          Store.addInventoryItem(item);
        }
      });
      modal.classList.add('hidden');
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

    this.switchTab(settings.initialTab || 'dashboard');

    window.addEventListener('app:inventory-updated', () => Inventory.render());
  },

  applySettings(settings) {
    document.documentElement.setAttribute('data-theme', settings.theme || 'orange');
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
    const handSelect = document.getElementById('setting-hand-mode');
    const stepModeSelect = document.getElementById('setting-cooking-step-mode');
    const recipeStepSelect = document.getElementById('recipe-step-mode-select');
    const adultCountSelect = document.getElementById('setting-adult-count');
    const growthCountSelect = document.getElementById('setting-growth-count');
    const recipeServingsSelect = document.getElementById('recipe-servings-select');
    const syncCheckbox = document.getElementById('setting-enable-sync');

    if (initSelect) initSelect.value = settings.initialTab || 'dashboard';
    if (themeSelect) themeSelect.value = settings.theme || 'orange';
    if (handSelect) handSelect.value = settings.handMode || 'right';
    if (syncCheckbox) syncCheckbox.checked = !!settings.enableExternalSync;
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
        handMode: document.getElementById('setting-hand-mode')?.value || 'right',
        cookingStepMode: document.getElementById('setting-cooking-step-mode')?.value || 'combined',
        adultCount: adultCount,
        growthCount: growthCount,
        defaultServings: autoServings,
        enableExternalSync: document.getElementById('setting-enable-sync')?.checked || false,
        adultGoals: selectedGoals.length ? selectedGoals : ['general']
      };
      Store.saveSettings(updated);
      this.applySettings(updated);
      alert(`家族設定を保存しました！\n（基本の作成人数は ${autoServings}人分 に更新されました）`);
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

  bindManualAdd() {
    const modal = document.getElementById('manual-add-modal');
    const open = () => modal?.classList.remove('hidden');
    const close = () => modal?.classList.add('hidden');

    document.getElementById('open-manual-add-btn')?.addEventListener('click', open);
    document.getElementById('inventory-fab')?.addEventListener('click', open);
    document.getElementById('manual-add-cancel-btn')?.addEventListener('click', close);

    document.getElementById('manual-add-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      Store.addInventoryItem({
        name: document.getElementById('manual-item-name').value,
        category: document.getElementById('manual-item-cat').value,
        quantity: document.getElementById('manual-item-qty').value,
        expiryDays: parseInt(document.getElementById('manual-item-exp').value, 10) || 3
      });
      e.target.reset();
      close();
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
