// recipe.js - AIレシピ提案（大人アレンジ×子ども取り分け×安全第一）& おいしかった殿堂入りレシピ管理
import { ApiClient } from './api.js';
import { Store } from './store.js';

export const Recipe = {
  currentProposal: null,
  activeTab: 'suggest', // 'suggest' | 'hall-of-fame'

  init() {
    this.bindEvents();
    this.render();
  },

  bindEvents() {
    // タブ切替（おすすめ提案 vs 殿堂入りレシピ）
    const tabSuggest = document.getElementById('recipe-tab-suggest');
    const tabHall = document.getElementById('recipe-tab-hall');

    if (tabSuggest && tabHall) {
      tabSuggest.addEventListener('click', () => {
        this.activeTab = 'suggest';
        tabSuggest.classList.add('theme-primary-bg', 'text-white');
        tabSuggest.classList.remove('bg-gray-100', 'text-gray-600');
        tabHall.classList.remove('theme-primary-bg', 'text-white');
        tabHall.classList.add('bg-gray-100', 'text-gray-600');
        this.render();
      });

      tabHall.addEventListener('click', () => {
        this.activeTab = 'hall-of-fame';
        tabHall.classList.add('theme-primary-bg', 'text-white');
        tabHall.classList.remove('bg-gray-100', 'text-gray-600');
        tabSuggest.classList.remove('theme-primary-bg', 'text-white');
        tabSuggest.classList.add('bg-gray-100', 'text-gray-600');
        this.render();
      });
    }

    // AI提案生成ボタン
    const generateBtn = document.getElementById('generate-recipe-btn');
    if (generateBtn) {
      generateBtn.addEventListener('click', async () => {
        await this.generateNewRecipe();
      });
    }

    window.addEventListener('app:delicious-updated', () => {
      if (this.activeTab === 'hall-of-fame') this.render();
    });
  },

  async generateNewRecipe() {
    const inventory = Store.getInventory();
    const settings = Store.getSettings();

    if (!inventory || inventory.length === 0) {
      alert('在庫食材がありません。まずは食材を追加するかレシートを読み込んでください。');
      return;
    }

    const spinner = document.getElementById('global-loading');
    const loadingText = document.getElementById('global-loading-text');
    if (spinner) {
      if (loadingText) loadingText.textContent = 'AIが家族にぴったりの取り分けレシピを考案中...';
      spinner.classList.remove('hidden');
    }

    try {
      const proposal = await ApiClient.generateMealProposal(inventory, settings);
      this.currentProposal = proposal;
      this.render();
    } catch (err) {
      alert('レシピ生成に失敗しました: ' + err.message);
    } finally {
      if (spinner) spinner.classList.add('hidden');
    }
  },

  render() {
    const container = document.getElementById('recipe-content-container');
    if (!container) return;

    if (this.activeTab === 'hall-of-fame') {
      this.renderHallOfFame(container);
    } else {
      this.renderSuggest(container);
    }
  },

  renderSuggest(container) {
    if (!this.currentProposal) {
      container.innerHTML = `
        <div class="p-8 text-center bg-white rounded-2xl border border-gray-100">
          <p class="text-4xl mb-3">🍳</p>
          <h3 class="font-bold text-gray-800 text-lg">今ある食材で献立を自動提案</h3>
          <p class="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
            大人の健康目的と子どもの月齢に合わせた「一度の調理で作れる取り分けレシピ」をAIが考案します。
          </p>
          <button id="card-generate-btn" class="mt-4 px-6 py-3 rounded-xl text-white font-bold text-sm shadow-md theme-primary-bg active:scale-95 transition-all">
            ✨ レシピを提案してもらう
          </button>
        </div>
      `;
      const btn = document.getElementById('card-generate-btn');
      if (btn) btn.onclick = () => this.generateNewRecipe();
      return;
    }

    const recipe = this.currentProposal;
    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- レシピヘッダー -->
        <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">⏱️ 所要時間: ${recipe.cookingTime}</span>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">✅ ${recipe.matchType}</span>
          </div>
          <h2 class="text-xl font-black text-gray-800 mt-2">${recipe.title}</h2>
          <p class="text-xs text-gray-500 mt-1">${recipe.description}</p>

          <!-- 使用食材 -->
          <div class="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5">
            <span class="text-xs text-gray-400 font-semibold self-center">使う食材:</span>
            ${recipe.ingredientsUsed.map(ing => `<span class="text-xs px-2 py-0.5 rounded bg-gray-100 font-medium text-gray-700">${ing}</span>`).join('')}
          </div>

          <!-- 「おいしかった！」保存ボタン -->
          <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
            <button id="save-delicious-btn" class="flex-1 py-2.5 rounded-xl bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 font-bold text-xs flex items-center justify-center space-x-1 transition-all active:scale-95">
              <span>⭐ おいしかった！殿堂入りに保存</span>
            </button>
          </div>
        </div>

        <!-- 子ども用取り分けステップ (安全第一・最重要) -->
        <div class="bg-pink-50/70 p-4 rounded-2xl border border-pink-200">
          <div class="flex items-center space-x-2 text-pink-700 font-bold text-sm">
            <span>👶 子ども用取り分け指示（月齢配慮）</span>
          </div>
          <div class="mt-2 text-xs space-y-2 text-gray-700">
            <p><strong class="text-pink-600">取り分けタイミング:</strong> ${recipe.childSeparation.timing}</p>
            <p class="bg-white/80 p-2.5 rounded-xl border border-pink-100 leading-relaxed">${recipe.childSeparation.instructions}</p>
            ${recipe.childSeparation.safetyAlert ? `
              <div class="p-2 rounded-lg bg-rose-100/80 text-rose-800 text-xs font-semibold flex items-center space-x-1.5">
                <span>⚠️ 安全注意:</span>
                <span>${recipe.childSeparation.safetyAlert}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 大人向けアレンジ & 食べ方ガイド -->
        <div class="bg-blue-50/70 p-4 rounded-2xl border border-blue-200">
          <div class="flex items-center space-x-2 text-blue-700 font-bold text-sm">
            <span>🥗 大人向けアレンジ（${recipe.adultArrangement.goalName}モード）</span>
          </div>
          <div class="mt-2 text-xs space-y-2 text-gray-700">
            <p><strong class="text-blue-600">調味料・タレ:</strong> ${recipe.adultArrangement.sauceOrSeasoning}</p>
            <p class="bg-white/80 p-2.5 rounded-xl border border-blue-100 leading-relaxed text-blue-950 font-medium">💡 ${recipe.adultArrangement.eatingGuide}</p>
          </div>
        </div>

        <!-- 基本の共通調理手順 -->
        <div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
          <h4 class="font-bold text-gray-800 text-sm mb-2">👨‍🍳 共通基本調理ステップ</h4>
          <ol class="space-y-2 text-xs text-gray-600">
            ${recipe.baseSteps.map((step, idx) => `
              <li class="flex items-start space-x-2">
                <span class="w-5 h-5 rounded-full bg-gray-100 text-gray-700 font-bold flex items-center justify-center shrink-0">${idx + 1}</span>
                <span class="leading-relaxed mt-0.5">${step}</span>
              </li>
            `).join('')}
          </ol>
        </div>
      </div>
    `;

    // おいしかった保存アクション
    const saveBtn = document.getElementById('save-delicious-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const note = prompt('メモがあれば入力してください（例：子どもがパクパク完食！、ポン酢多めが美味しかった 等）', '');
        Store.saveDeliciousRecipe(recipe, 5, note || '');
        alert('「おいしかったレシピ（殿堂入り）」に保存しました！いつでも再呼び出しできます。');
      };
    }
  },

  renderHallOfFame(container) {
    const list = Store.getDeliciousRecipes();
    if (!list || list.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center bg-white rounded-2xl border border-dashed border-gray-200">
          <p class="text-3xl mb-2">⭐</p>
          <p class="font-bold text-gray-700">殿堂入りレシピはまだありません</p>
          <p class="text-xs text-gray-400 mt-1">提案されたレシピがおいしかったら「⭐ おいしかった！」ボタンを押して保存しましょう</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="space-y-3">
        <p class="text-xs font-bold text-gray-500">保存済みのおいしかったレシピ (${list.length}件)</p>
        ${list.map(item => `
          <div class="bg-white p-4 rounded-2xl border border-amber-200/70 shadow-sm transition-all hover:border-amber-400">
            <div class="flex items-center justify-between">
              <span class="text-amber-500 font-bold text-sm">⭐⭐⭐⭐⭐</span>
              <button data-action="remove-delic" data-id="${item.id}" class="text-xs text-gray-400 hover:text-rose-500">削除</button>
            </div>
            <h3 class="font-bold text-gray-800 text-base mt-1">${item.title}</h3>
            ${item.note ? `<p class="text-xs bg-amber-50 text-amber-900 px-2.5 py-1 rounded-lg mt-2 font-medium">💬 「${item.note}」</p>` : ''}
            <div class="mt-3 flex items-center justify-between">
              <span class="text-xs text-gray-400">⏱️ ${item.cookingTime}</span>
              <button data-action="recall-delic" data-id="${item.id}" class="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all">
                このレシピを再表示
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // 削除・再表示イベント
    container.querySelectorAll('[data-action="remove-delic"]').forEach(btn => {
      btn.onclick = (e) => {
        if (confirm('この殿堂入りレシピを一覧から削除しますか？')) {
          Store.removeDeliciousRecipe(e.currentTarget.dataset.id);
        }
      };
    });

    container.querySelectorAll('[data-action="recall-delic"]').forEach(btn => {
      btn.onclick = (e) => {
        const item = list.find(r => r.id === e.currentTarget.dataset.id);
        if (item) {
          this.currentProposal = item;
          // おすすめタブへ切り替えて詳細表示
          const tabSuggest = document.getElementById('recipe-tab-suggest');
          if (tabSuggest) tabSuggest.click();
        }
      };
    });
  }
};
