// nutrition.js - 食事写真解析、5大栄養素レーダーチャート、ボリュームスライダー、食事ログ管理
import { ApiClient } from './api.js';
import { Store } from './store.js';

// モード別 1日の目標基準値 (5大栄養素)
const NUTRITION_TARGETS = {
  general: {
    label: '一般・バランス',
    calories: 2000,
    protein: 65,  // g
    fat: 55,      // g
    carbs: 280,   // g
    vitamins: 100 // %基準
  },
  athlete: {
    label: 'アスリート (高タンパク・筋力)',
    calories: 2500,
    protein: 120, // 筋力増強のため約2倍
    fat: 60,
    carbs: 350,
    vitamins: 120
  },
  diet: {
    label: 'ダイエット (低糖質・低脂質)',
    calories: 1600,
    protein: 75,  // 筋肉を落とさないようタンパク質は確保
    fat: 35,      // 脂質カット
    carbs: 180,   // 糖質オフ
    vitamins: 110
  },
  health: {
    label: '健康管理 (減塩・血糖値対策)',
    calories: 1800,
    protein: 65,
    fat: 45,
    carbs: 240,
    vitamins: 130 // 野菜・微量栄養素重視
  }
};

export const Nutrition = {
  currentAnalysis: null,
  volumeScale: 1.0,
  radarChart: null,

  init() {
    this.bindEvents();
    this.renderLogs();
    this.initRadarChart();

    // 設定変更（大人目的モード変更等）でレーダーチャート更新
    window.addEventListener('app:settings-updated', () => {
      this.updateRadarChart();
    });
  },

  bindEvents() {
    const fileInput = document.getElementById('meal-photo-input');
    if (!fileInput) return;

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const spinner = document.getElementById('global-loading');
      const loadingText = document.getElementById('global-loading-text');
      if (spinner) {
        if (loadingText) loadingText.textContent = '料理写真から5大栄養素・カロリーを推計中...';
        spinner.classList.remove('hidden');
      }

      try {
        const base64 = await this.fileToBase64(file);
        const result = await ApiClient.analyzeMealImage(base64, file.type);
        // ビタミン・ミネラル充足度（未定義時はタンパク・野菜バランスから推計）
        if (!result.vitamins) result.vitamins = Math.round((result.protein * 1.2 + (result.carbs > 40 ? 20 : 10)));

        this.currentAnalysis = result;
        this.volumeScale = 1.0;
        this.renderAnalysisModal(result, base64);
      } catch (err) {
        alert('食事解析に失敗しました: ' + err.message);
      } finally {
        if (spinner) spinner.classList.add('hidden');
        fileInput.value = '';
      }
    });

    window.addEventListener('app:logs-updated', () => {
      this.renderLogs();
      this.updateRadarChart();
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

  // レーダーチャート初期化
  async initRadarChart() {
    const canvas = document.getElementById('nutrition-radar-chart');
    if (!canvas) return;

    // Chart.js のロード待ち（最大2秒）
    let attempts = 0;
    while (typeof Chart === 'undefined' && attempts < 20) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    const settings = Store.getSettings();
    const mode = settings.adultGoal || 'general';
    const target = NUTRITION_TARGETS[mode] || NUTRITION_TARGETS.general;
    const percentages = this.calculateAchievementPercentages(target);

    if (typeof Chart !== 'undefined') {
      const ctx = canvas.getContext('2d');
      if (this.radarChart) {
        this.radarChart.destroy();
      }
      this.radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: [
            'エネルギー',
            'タンパク質',
            '脂質',
            '炭水化物',
            'ビタミン・ミネラル'
          ],
          datasets: [
            {
              label: '現在の摂取量 (%)',
              data: percentages,
              backgroundColor: 'rgba(249, 115, 22, 0.3)',
              borderColor: 'rgba(249, 115, 22, 1)',
              borderWidth: 2,
              pointBackgroundColor: 'rgba(249, 115, 22, 1)',
              pointRadius: 4
            },
            {
              label: '目標ライン (100%)',
              data: [100, 100, 100, 100, 100],
              backgroundColor: 'transparent',
              borderColor: 'rgba(156, 163, 175, 0.7)',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 400 },
          scales: {
            r: {
              min: 0,
              max: 120,
              ticks: { stepSize: 30, display: false },
              pointLabels: {
                font: { size: 11, weight: 'bold' },
                color: '#374151'
              },
              grid: { color: 'rgba(209, 213, 219, 0.8)' },
              angleLines: { color: 'rgba(209, 213, 219, 0.8)' }
            }
          },
          plugins: { legend: { display: false } }
        }
      });
    } else {
      // 万が一CDNがオフライン時のSVGネイティブ描画
      this.renderNativeSvgRadar(percentages);
    }

    const badge = document.getElementById('radar-mode-badge');
    if (badge) badge.textContent = `🎯 目標基準: ${target.label}`;
  },

  renderNativeSvgRadar(percentages) {
    const container = document.getElementById('nutrition-radar-chart')?.parentElement;
    if (!container) return;
    const center = 110, radius = 75;
    const labels = ['エネルギー', 'タンパク質', '脂質', '炭水化物', 'ビタミン'];
    const angles = [ -Math.PI/2, -Math.PI/2 + 2*Math.PI/5, -Math.PI/2 + 4*Math.PI/5, -Math.PI/2 + 6*Math.PI/5, -Math.PI/2 + 8*Math.PI/5 ];

    const targetPoints = angles.map(a => `${center + radius * Math.cos(a)},${center + radius * Math.sin(a)}`).join(' ');
    const currentPoints = angles.map((a, i) => {
      const r = (Math.min(120, percentages[i]) / 100) * radius;
      return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
    }).join(' ');

    container.innerHTML = `
      <svg width="220" height="220" viewBox="0 0 220 220" class="mx-auto">
        <!-- 目標点線 -->
        <polygon points="${targetPoints}" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4,4"/>
        <!-- 現在の摂取 -->
        <polygon points="${currentPoints}" fill="rgba(249, 115, 22, 0.3)" stroke="#f97316" stroke-width="2"/>
        ${angles.map((a, i) => `
          <text x="${center + (radius + 20) * Math.cos(a)}" y="${center + (radius + 15) * Math.sin(a) + 4}" text-anchor="middle" font-size="9" font-weight="bold" fill="#4b5563">
            ${labels[i]} (${percentages[i]}%)
          </text>
        `).join('')}
      </svg>
    `;
  },

  // 達成度%の計算
  calculateAchievementPercentages(target) {
    const logs = Store.getMealLogs();
    let curCal = 0, curP = 0, curF = 0, curC = 0, curV = 0;

    logs.forEach(log => {
      curCal += log.calories || 0;
      curP += log.protein || 0;
      curF += log.fat || 0;
      curC += log.carbs || 0;
      curV += log.vitamins || 25; // 1食あたり約25%目安
    });

    return [
      Math.min(120, Math.round((curCal / target.calories) * 100)),
      Math.min(120, Math.round((curP / target.protein) * 100)),
      Math.min(120, Math.round((curF / target.fat) * 100)),
      Math.min(120, Math.round((curC / target.carbs) * 100)),
      Math.min(120, Math.round((curV / target.vitamins) * 100))
    ];
  },

  // レーダーチャートの更新
  updateRadarChart() {
    if (!this.radarChart) {
      this.initRadarChart();
      return;
    }

    const settings = Store.getSettings();
    const mode = settings.adultGoal || 'general';
    const target = NUTRITION_TARGETS[mode] || NUTRITION_TARGETS.general;

    const percentages = this.calculateAchievementPercentages(target);
    this.radarChart.data.datasets[0].data = percentages;
    this.radarChart.update();

    const badge = document.getElementById('radar-mode-badge');
    if (badge) badge.textContent = `🎯 目標基準: ${target.label}`;
  },

  renderAnalysisModal(result, imageUrl) {
    const modal = document.getElementById('meal-analysis-modal');
    if (!modal) return;

    const dishTitle = document.getElementById('analysis-dish-name');
    const imgEl = document.getElementById('analysis-image-preview');
    const feedbackEl = document.getElementById('analysis-feedback');

    if (dishTitle) dishTitle.textContent = result.dishName;
    if (imgEl && imageUrl) imgEl.src = imageUrl;
    if (feedbackEl) feedbackEl.textContent = result.feedback;

    this.updateScaledNutrition();

    // スライダー
    const slider = document.getElementById('volume-slider');
    const scaleLabel = document.getElementById('volume-scale-label');
    if (slider) {
      slider.value = 1.0;
      slider.oninput = (e) => {
        this.volumeScale = parseFloat(e.target.value);
        if (scaleLabel) {
          scaleLabel.textContent = `${Math.round(this.volumeScale * 100)}% (${this.volumeScale < 1 ? '小盛り' : this.volumeScale > 1 ? '大盛り' : '普通'})`;
        }
        this.updateScaledNutrition();
      };
    }

    // 保存ボタン
    const saveBtn = document.getElementById('analysis-save-log-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        Store.addMealLog({
          dishName: result.dishName,
          calories: Math.round(result.calories * this.volumeScale),
          protein: Math.round(result.protein * this.volumeScale),
          fat: Math.round(result.fat * this.volumeScale),
          carbs: Math.round(result.carbs * this.volumeScale),
          vitamins: Math.round((result.vitamins || 25) * this.volumeScale),
          scale: this.volumeScale
        });
        modal.classList.add('hidden');
        alert('食事ログを記録しました！レーダーチャートが更新されました。');
      };
    }

    const cancelBtn = document.getElementById('analysis-cancel-btn');
    if (cancelBtn) {
      cancelBtn.onclick = () => modal.classList.add('hidden');
    }

    modal.classList.remove('hidden');
  },

  updateScaledNutrition() {
    if (!this.currentAnalysis) return;
    const scaledCal = Math.round(this.currentAnalysis.calories * this.volumeScale);
    const scaledP = Math.round(this.currentAnalysis.protein * this.volumeScale);
    const scaledF = Math.round(this.currentAnalysis.fat * this.volumeScale);
    const scaledC = Math.round(this.currentAnalysis.carbs * this.volumeScale);

    const calEl = document.getElementById('val-cal');
    const pEl = document.getElementById('val-p');
    const fEl = document.getElementById('val-f');
    const cEl = document.getElementById('val-c');

    if (calEl) calEl.textContent = `${scaledCal} kcal`;
    if (pEl) pEl.textContent = `${scaledP}g`;
    if (fEl) fEl.textContent = `${scaledF}g`;
    if (cEl) cEl.textContent = `${scaledC}g`;
  },

  renderLogs() {
    const container = document.getElementById('nutrition-logs-container');
    const summaryCal = document.getElementById('today-total-calories');
    const summaryP = document.getElementById('today-total-protein');
    const summaryF = document.getElementById('today-total-fat');
    const summaryC = document.getElementById('today-total-carbs');

    if (!container) return;

    const logs = Store.getMealLogs();
    if (!logs || logs.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
          <p class="text-3xl mb-1">📸</p>
          <p class="font-medium text-sm text-gray-600">まだ食事ログがありません</p>
          <p class="text-xs text-gray-400 mt-1">「写真を解析」から撮影・登録してみましょう</p>
        </div>
      `;
      if (summaryCal) summaryCal.textContent = '0';
      if (summaryP) summaryP.textContent = '0g';
      if (summaryF) summaryF.textContent = '0g';
      if (summaryC) summaryC.textContent = '0g';
      return;
    }

    // 本日の合計算出
    let totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
    logs.forEach(log => {
      totalCal += log.calories || 0;
      totalP += log.protein || 0;
      totalF += log.fat || 0;
      totalC += log.carbs || 0;
    });

    if (summaryCal) summaryCal.textContent = totalCal;
    if (summaryP) summaryP.textContent = `${totalP}g`;
    if (summaryF) summaryF.textContent = `${totalF}g`;
    if (summaryC) summaryC.textContent = `${totalC}g`;

    container.innerHTML = `
      <div class="space-y-2.5">
        ${logs.map(log => `
          <div class="bg-white p-3.5 rounded-xl border border-gray-100 flex items-center justify-between shadow-xs">
            <div>
              <div class="font-bold text-gray-800 text-sm">${log.dishName}</div>
              <div class="text-xs text-gray-400 mt-0.5">${new Date(log.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ボリューム ${Math.round((log.scale || 1) * 100)}%</div>
            </div>
            <div class="text-right">
              <div class="font-bold text-orange-600 text-sm">${log.calories} <span class="text-xs font-normal">kcal</span></div>
              <div class="text-xs text-gray-500 mt-0.5">P:${log.protein}g / F:${log.fat}g / C:${log.carbs}g</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
};
