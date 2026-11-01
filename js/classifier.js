/*
 * タイトルから自動でタグ（ジャンル / 出版社 / 掲載誌 / 対象読者）を付与する分類器
 *
 * 1. 辞書（dictionary.js の TITLES）と照合 → 一致すれば正確なタグを付与
 * 2. 辞書にない場合はタイトル中のキーワードからジャンルを推測
 */
(function (global) {
  'use strict';

  const Dict = global.MangaDictionary || (typeof require !== 'undefined' ? require('./dictionary.js') : null);

  // 表記ゆれ吸収: 全角英数→半角、カタカナ→ひらがな、記号・空白除去、小文字化
  function normalize(str) {
    if (!str) return '';
    let s = String(str).normalize('NFKC').toLowerCase();
    s = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    s = s.replace(/×/g, 'x');
    s = s.replace(/[\s・☆★♪!！?？、。,.\-ー~〜'"「」『』【】()（）\[\]:：;；/／+＋△]/g, '');
    return s;
  }

  // 辞書を正規化済みの検索キーで展開しておく
  const INDEX = Dict.TITLES.map((entry) => ({
    entry,
    keys: [entry.t, ...(entry.a || [])].map(normalize).filter((k) => k.length > 0),
  }));

  function findInDictionary(title) {
    const q = normalize(title);
    if (!q) return null;

    // 完全一致
    for (const item of INDEX) {
      if (item.keys.includes(q)) return item.entry;
    }
    // 部分一致（「ONE PIECE 107」「鬼滅の刃 外伝」など）: 最も長く一致したキーを採用
    let best = null;
    let bestLen = 0;
    for (const item of INDEX) {
      for (const k of item.keys) {
        // ひらがなだけの短いキー（例: 「なな」）は誤爆しやすいので3文字以上のみ
        const minLen = /^[\u3040-\u309f]+$/.test(k) ? 3 : 2;
        if (k.length < minLen) continue;
        // 入力途中の短縮形（例: 「スパイファミ」）も拾う
        const prefixLike = q.length >= 4 && q.length / k.length >= 0.5 && k.includes(q);
        if ((q.includes(k) || prefixLike) && k.length > bestLen) {
          best = item.entry;
          bestLen = k.length;
        }
      }
    }
    return best;
  }

  function inferGenres(title) {
    const raw = String(title || '').normalize('NFKC');
    const lower = raw.toLowerCase();
    const scores = new Map();
    for (const rule of Dict.KEYWORD_RULES) {
      for (const kw of rule.k) {
        const k = kw.normalize('NFKC');
        // 英字キーワードは大文字小文字を無視
        const hit = /^[\x00-\x7f]+$/.test(k) ? lower.includes(k.toLowerCase()) : raw.includes(k);
        if (hit) scores.set(rule.g, (scores.get(rule.g) || 0) + 1);
      }
    }
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => g)
      .slice(0, 4);
  }

  function magazineTags(magazine) {
    const info = Dict.MAGAZINES[magazine];
    if (!info) return { publisher: [], magazine: magazine ? [magazine] : [], series: [], target: [] };
    return {
      publisher: [info.publisher],
      magazine: [magazine],
      series: [info.family],
      target: [info.target],
    };
  }

  /**
   * タイトルを分類する
   * @returns {{source: 'dictionary'|'keyword'|'none', matchedTitle?: string,
   *            tags: {genre: string[], publisher: string[], series: string[], magazine: string[], target: string[]}}}
   */
  function classify(title) {
    const entry = findInDictionary(title);
    if (entry) {
      const m = magazineTags(entry.m);
      return {
        source: 'dictionary',
        matchedTitle: entry.t,
        tags: { genre: [...entry.g], ...m },
      };
    }
    const genre = inferGenres(title);
    return {
      source: genre.length ? 'keyword' : 'none',
      tags: { genre, publisher: [], series: [], magazine: [], target: [] },
    };
  }

  // 掲載誌から出版社などを補完する（手動で掲載誌を選んだとき用）
  function tagsForMagazine(magazine) {
    return magazineTags(magazine);
  }

  const MangaClassifier = { normalize, classify, findInDictionary, inferGenres, tagsForMagazine };

  if (typeof module !== 'undefined' && module.exports) module.exports = MangaClassifier;
  global.MangaClassifier = MangaClassifier;
})(typeof window !== 'undefined' ? window : globalThis);
