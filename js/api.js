// api.js - Gemini API通信 & ハイブリッドBYOK / モックモジュール
import { Store } from './store.js';

// Gemini API Direct Endpoint (BYOK)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_NAME = 'gemini-1.5-flash';

export const ApiClient = {
  // API接続テスト
  async testConnection(apiKey) {
    const key = apiKey || Store.getApiKey();
    if (!key) {
      return { success: false, message: 'APIキーが入力されていません。' };
    }
    try {
      const res = await fetch(`${GEMINI_API_BASE}/${MODEL_NAME}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello! Please respond with "OK"' }] }]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, message: `接続失敗 (${res.status}): ${err.error?.message || res.statusText}` };
      }
      return { success: true, message: 'Gemini APIとの接続に成功しました！' };
    } catch (e) {
      return { success: false, message: `通信エラー: ${e.message}` };
    }
  },

  // 1. レシートOCR（画像から食材抽出・正規化）
  async extractGroceriesFromReceipt(base64Image, mimeType = 'image/jpeg') {
    const key = Store.getApiKey();
    if (!key) {
      console.log('Using Mock OCR Simulation');
      return this.mockReceiptExtraction();
    }

    const prompt = `あなたは食料品の買い出しレシートから食材在庫を自動抽出・正規化するプロのエージェントです。
画像内のレシートから「食品・食材」のみを抽出してください。
【必須ルール】
- 調味料、日用品（洗剤、ティッシュ等）、レジ袋、割引券等の非食品は完全に除外すること。
- 商品の略称（例：「国産豚ﾊﾞﾗうす切」「有機ｷｬﾍﾞﾂ1/2」等）は、一般的な名詞（例：「豚バラ肉」「キャベツ」）へ正規化すること。
- 各食材の一般的な消費期限の目安日数（1〜14日程度）と数量、カテゴリ（肉類/魚介/野菜/卵・大豆/乳製品/その他）を推計すること。

以下の純粋なJSON配列形式のみで出力してください（Markdownのバッククォート等の余計な装飾は含めないでください）:
[
  {"name": "豚バラ肉", "category": "肉類", "quantity": "1パック", "expiryDays": 2},
  {"name": "キャベツ", "category": "野菜", "quantity": "1/2個", "expiryDays": 5}
]`;

    try {
      const res = await fetch(`${GEMINI_API_BASE}/${MODEL_NAME}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Image.split(',')[1] || base64Image } }
            ]
          }]
        })
      });

      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.warn('Real API failed, fallback to mock:', err);
      return this.mockReceiptExtraction();
    }
  },

  // 2. AIレシピ提案（大人アレンジ×子ども取り分け×安全第一ガードレール）
  async generateMealProposal(inventory, settings) {
    const key = Store.getApiKey();
    if (!key) {
      console.log('Using Mock Meal Proposal');
      return this.mockMealProposal(inventory, settings);
    }

    const stageDescriptions = {
      early: '離乳食初期 (5〜6ヶ月: トロトロのペースト・すりつぶし)',
      mid: '離乳食中期 (7〜8ヶ月: 舌でつぶせる豆腐くらいの固さ・細かく刻む)',
      late: '離乳食後期 (9〜11ヶ月: 歯ぐきでつぶせるバナナの固さ・手づかみ食べ)',
      complete: '離乳食完了期 (12〜18ヶ月: 肉団子の固さ・薄味)',
      toddler: '幼児食 (1歳半〜5歳: 大人より薄味、喉詰まり防止)'
    };

    const adultGoalDescriptions = {
      general: '一般・バランス重視（野菜と主菜の調和）',
      athlete: 'アスリート（高タンパク質重視、筋力維持・増量）',
      diet: 'ダイエット（低糖質・低脂質、食物繊維豊富）',
      health: '健康管理（減塩・血糖値上昇を抑えるベジファースト）'
    };

    const prompt = `あなたは「一度の調理で家族全員分を作る」時短と安全を極めたプロの管理栄養士・AIシェフです。
手持ちの食材在庫をベースに、大人の健康目的と子どもの月齢に合わせた「取り分けレシピ」を1品提案してください。

【現在の冷蔵庫の食材】
${inventory.map(i => `- ${i.name} (${i.quantity}, 賞味期限目安あと${i.expiryDays}日)`).join('\n')}

【大人の健康目的】
${adultGoalDescriptions[settings.adultGoal] || adultGoalDescriptions.general}

【子どもの状態 & 安全ガードレール（絶対遵守）】
- 月齢段階: ${stageDescriptions[settings.childStage] || '幼児食'}
- アレルギー/NG食材: ${settings.childNgFoods?.join('、') || '特になし'}
- 【最重要安全ルール】:
  1. 1歳未満の場合、ハチミツや黒糖は絶対に含めないこと。
  2. 幼児食・離乳食では、ミニトマト丸ごとやナッツ類等の誤飲・窒息リスク食材は四分割カットや加熱すりつぶしを明記すること。
  3. 味付け（塩分・強い香辛料）をする前に、子ども用を取り分けるステップを必ず設けること。

以下の純粋なJSONフォーマットのみを出力してください:
{
  "title": "レシピ名（例：豚バラとキャベツの重ね蒸し）",
  "description": "料理の簡単な魅力・特徴",
  "cookingTime": "15分",
  "matchType": "100%手持ちで作れる",
  "ingredientsUsed": ["豚バラ肉", "キャベツ"],
  "missingIngredients": [],
  "baseSteps": [
    "キャベツをざく切り、豚バラ肉を食べやすい大きさに切る。",
    "フライパンにキャベツと豚肉を交互に敷き詰め、少量の酒を振って蓋をして中火で蒸す。"
  ],
  "childSeparation": {
    "timing": "調味料を加える前、全体に火が通った直後",
    "instructions": "子どもの月齢に合わせて、豚肉をキッチンバサミで細かく刻み、キャベツの柔らかい葉先を取り分ける。味付けは素材の甘みのみ、または出汁を数滴。",
    "safetyAlert": "お肉が噛み切りにくい場合はさらに細かくほぐしてください。"
  },
  "adultArrangement": {
    "goalName": "${settings.adultGoal}",
    "sauceOrSeasoning": "ポン酢＋大根おろし、または黒胡椒とポン酢",
    "eatingGuide": "食物繊維が豊富なキャベツから先に食べる（ベジファースト）ことで血糖値の上昇を抑えます。"
  }
}`;

    try {
      const res = await fetch(`${GEMINI_API_BASE}/${MODEL_NAME}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.warn('Real API failed, fallback to mock proposal:', err);
      return this.mockMealProposal(inventory, settings);
    }
  },

  // 3. 食事画像解析（写真からカロリー・PFC推定）
  async analyzeMealImage(base64Image, mimeType = 'image/jpeg') {
    const key = Store.getApiKey();
    if (!key) {
      console.log('Using Mock Meal Nutrition Analysis');
      return this.mockMealAnalysis();
    }

    const prompt = `この食事写真から料理名を特定し、1人前あたりの推定カロリーとPFC（タンパク質・脂質・炭水化物）、栄養バランスのアドバイスを算出してください。
以下の純粋なJSONフォーマットのみを出力してください:
{
  "dishName": "推定された料理名",
  "calories": 580,
  "protein": 24,
  "fat": 18,
  "carbs": 75,
  "feedback": "タンパク質と野菜がバランス良く摂れています。夜食の場合は主食（炭水化物）を少し控えめにするとさらに理想的です。"
}`;

    try {
      const res = await fetch(`${GEMINI_API_BASE}/${MODEL_NAME}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Image.split(',')[1] || base64Image } }
            ]
          }]
        })
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.warn('Real API failed, fallback to mock analysis:', err);
      return this.mockMealAnalysis();
    }
  },

  // --- モックデータ (Simulation) ---
  mockReceiptExtraction() {
    return [
      { name: '豚バラ肉', category: '肉類', quantity: '1パック(250g)', expiryDays: 2 },
      { name: 'キャベツ', category: '野菜', quantity: '1/2個', expiryDays: 5 },
      { name: '木綿豆腐', category: '卵・大豆', quantity: '1丁(300g)', expiryDays: 3 },
      { name: '卵', category: '卵・大豆', quantity: '1パック(10個)', expiryDays: 10 },
      { name: '玉ねぎ', category: '野菜', quantity: '1袋(3個)', expiryDays: 8 }
    ];
  },

  mockMealProposal(inventory, settings) {
    return {
      title: '豚バラとキャベツの重ね蒸し（出汁仕立て）',
      description: 'フライパン1つで完了！素材の甘みを最大限に引き出し、味付け前の取り分けで離乳食・幼児食にも最適な定番おかず。',
      cookingTime: '15分',
      matchType: '冷蔵庫の食材だけで100%作れる',
      ingredientsUsed: ['豚バラ肉', 'キャベツ', '玉ねぎ'],
      missingIngredients: [],
      baseSteps: [
        'キャベツを大きめのざく切り、玉ねぎを薄切り、豚バラ肉を食べやすい大きさにカットします。',
        'フライパンにキャベツと玉ねぎを敷き、その上に豚肉を広げて並べます。水大さじ2と和風出汁少々を回し入れます。',
        '蓋をして中火にかけ、蒸気が出たら弱火で約7〜8分じっくり蒸し焼きにします。全体にしっかり火が通ったら基本調理完了です。'
      ],
      childSeparation: {
        timing: '大人の味付け（タレ・塩分投入）を行う直前',
        instructions: '【' + (settings.childStage === 'toddler' ? '幼児食向け' : '離乳食向け') + '】柔らかく蒸されたキャベツの葉先と玉ねぎを取り出し、豚肉はキッチンバサミで1cm未満（月齢に応じて細かく）刻みます。素材の出汁と甘みだけで美味しく召し上がれます。',
        safetyAlert: '豚肉の脂身が気になる場合は赤身部分を取り分け、喉詰まり防止のため必ず小さく刻んでください。'
      },
      adultArrangement: {
        goalName: settings.adultGoal,
        sauceOrSeasoning: settings.adultGoal === 'athlete'
          ? '高タンパク質を意識し、ポン酢にすりごま・七味唐辛子をプラス。温泉卵を添えてタンパク質をさらに強化！'
          : 'ポン酢と生姜、または減塩しょうゆでさっぱりとお召し上がりください。',
        eatingGuide: '血糖値の上昇を緩やかにするため、蒸しキャベツと玉ねぎから先に食べる（ベジファースト）がおすすめです。'
      }
    };
  },

  mockMealAnalysis() {
    return {
      dishName: '豚バラとキャベツの重ね蒸し ＆ ごはん',
      calories: 520,
      protein: 26,
      fat: 20,
      carbs: 58,
      feedback: 'タンパク質がしっかり26g摂取できており優秀です！野菜の食物繊維も豊富で、脂質と炭水化物の比率も良好なバランスです。'
    };
  }
};
