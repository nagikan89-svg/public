// 実行: node test/classifier.test.js
const assert = require('assert');
const C = require('../js/classifier.js');

const cases = [
  ['ワンピース', 'ONE PIECE', '週刊少年ジャンプ'],
  ['ONE PIECE 107巻', 'ONE PIECE', '週刊少年ジャンプ'],
  ['ｽﾗﾑﾀﾞﾝｸ', 'SLAM DUNK', '週刊少年ジャンプ'],
  ['ブルーロック', 'ブルーロック', '週刊少年マガジン'],
  ['hunter x hunter', 'HUNTER×HUNTER', '週刊少年ジャンプ'],
  ['名探偵コナン', '名探偵コナン', '週刊少年サンデー'],
];
for (const [input, title, magazine] of cases) {
  const r = C.classify(input);
  assert.strictEqual(r.source, 'dictionary', input);
  assert.strictEqual(r.matchedTitle, title, input);
  assert.deepStrictEqual(r.tags.magazine, [magazine], input);
}
assert.deepStrictEqual(C.classify('ハイキュー!!').tags.series, ['ジャンプ']);
assert.deepStrictEqual(C.classify('ブルーロック').tags.publisher, ['講談社']);

// 辞書にない作品はキーワードから推測
assert.ok(C.classify('俺の野球部が甲子園を目指す件').tags.genre.includes('スポーツ'));
assert.ok(C.classify('異世界でスローライフ始めました').tags.genre.includes('異世界'));
assert.ok(C.classify('放課後の探偵事件簿').tags.genre.includes('ミステリー'));
// 短いひらがなキーで誤判定しない
assert.strictEqual(C.classify('ななみの日記').source, 'none');

console.log('all classifier tests passed');
