(function () {
  'use strict';

  const Dict = window.MangaDictionary;
  const Classifier = window.MangaClassifier;
  const STORAGE_KEY = 'manga-shelf/v1';

  // タグの分類（切り口）
  const DIMENSIONS = [
    { key: 'status', label: '読書状況', derived: true },
    { key: 'genre', label: 'ジャンル', options: Dict.GENRES },
    { key: 'series', label: '雑誌系列（ジャンプ・マガジン等）', options: uniq(Object.values(Dict.MAGAZINES).map((m) => m.family)) },
    { key: 'publisher', label: '出版社', options: Dict.PUBLISHERS },
    { key: 'target', label: '対象読者', options: Dict.TARGETS },
    { key: 'custom', label: 'マイタグ', options: [] },
  ];
  const EDITABLE_DIMS = DIMENSIONS.filter((d) => !d.derived);
  const STATUS_ORDER = ['未読', '読書中', '最新巻まで既読', '読了'];

  // ---------- 状態 ----------
  let mangas = load();
  const filters = {}; // { dimKey: Set<tag> }
  let editingId = null;
  let editDraftTags = null;
  const openDetails = new Set(); // 巻ボタンを開いているカード

  // ---------- 要素 ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    stats: $('stats'), list: $('list'), filters: $('filters'), activeFilters: $('activeFilters'),
    search: $('search'), sort: $('sort'), clearFilters: $('clearFilters'),
    addForm: $('addForm'), addTitle: $('addTitle'), addTotal: $('addTotal'), addRead: $('addRead'),
    addCompleted: $('addCompleted'), addPreview: $('addPreview'),
    dialog: $('editDialog'), editForm: $('editForm'), editTitle: $('editTitle'), editTotal: $('editTotal'),
    editRead: $('editRead'), editCompleted: $('editCompleted'), editMagazine: $('editMagazine'),
    editTags: $('editTags'), editMemo: $('editMemo'), reclassifyBtn: $('reclassifyBtn'), cancelEdit: $('cancelEdit'),
    exportBtn: $('exportBtn'), importInput: $('importInput'),
  };

  // ---------- ユーティリティ ----------
  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function emptyTags() { return { genre: [], series: [], publisher: [], magazine: [], target: [], custom: [] }; }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.map(sanitize) : [];
    } catch (e) {
      return [];
    }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(mangas)); }

  function sanitize(m) {
    const tags = Object.assign(emptyTags(), m.tags || {});
    Object.keys(tags).forEach((k) => { tags[k] = uniq((tags[k] || []).map(String)); });
    const read = toInt(m.readVolumes);
    return {
      id: m.id || uid(),
      title: String(m.title || '').trim(),
      totalVolumes: Math.max(toInt(m.totalVolumes), read),
      readVolumes: read,
      completed: !!m.completed,
      tags,
      memo: String(m.memo || ''),
      createdAt: m.createdAt || Date.now(),
      updatedAt: m.updatedAt || Date.now(),
    };
  }

  function statusOf(m) {
    if (m.readVolumes <= 0) return '未読';
    if (m.totalVolumes > 0 && m.readVolumes >= m.totalVolumes) return m.completed ? '読了' : '最新巻まで既読';
    return '読書中';
  }
  function progressOf(m) {
    if (!m.totalVolumes) return m.readVolumes > 0 ? 1 : 0;
    return Math.min(1, m.readVolumes / m.totalVolumes);
  }
  function tagsOf(m, dimKey) {
    return dimKey === 'status' ? [statusOf(m)] : (m.tags[dimKey] || []);
  }

  function tagsFromClassification(title) {
    const r = Classifier.classify(title);
    return { result: r, tags: Object.assign(emptyTags(), r.tags) };
  }

  // ---------- 追加フォーム ----------
  function renderAddPreview() {
    const title = els.addTitle.value.trim();
    if (!title) { els.addPreview.innerHTML = ''; return; }
    const { result, tags } = tagsFromClassification(title);
    const label = result.source === 'dictionary'
      ? `辞書で「${esc(result.matchedTitle)}」と判定`
      : result.source === 'keyword' ? 'タイトルの単語からジャンルを推測' : '自動分類できませんでした（後から編集で追加できます）';
    const chips = EDITABLE_DIMS.flatMap((d) => (tags[d.key] || []).map((t) => chip(t, d.key))).join('');
    els.addPreview.innerHTML = `<div class="preview-label">自動タグ: ${label}</div><div class="chips">${chips}</div>`;
  }

  els.addTitle.addEventListener('input', renderAddPreview);
  els.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = els.addTitle.value.trim();
    if (!title) return;
    const { tags } = tagsFromClassification(title);
    const total = toInt(els.addTotal.value);
    const read = toInt(els.addRead.value);
    mangas.unshift(sanitize({
      id: uid(), title, totalVolumes: Math.max(total, read), readVolumes: read,
      completed: els.addCompleted.checked, tags,
    }));
    save();
    els.addForm.reset();
    els.addTotal.value = 1;
    els.addRead.value = 0;
    renderAddPreview();
    render();
  });

  // ---------- 絞り込み ----------
  function matchesFilters(m, skipDim) {
    for (const d of DIMENSIONS) {
      if (d.key === skipDim) continue;
      const sel = filters[d.key];
      if (!sel || sel.size === 0) continue;
      const tags = tagsOf(m, d.key);
      if (!tags.some((t) => sel.has(t))) return false;
    }
    return true;
  }
  function matchesSearch(m) {
    const q = Classifier.normalize(els.search.value);
    if (!q) return true;
    const hay = [m.title, m.memo, ...Object.values(m.tags).flat()].map(Classifier.normalize).join('|');
    return hay.includes(q);
  }

  function toggleFilter(dimKey, tag) {
    if (!filters[dimKey]) filters[dimKey] = new Set();
    const s = filters[dimKey];
    if (s.has(tag)) s.delete(tag); else s.add(tag);
    render();
  }

  function renderFilters() {
    const searched = mangas.filter(matchesSearch);
    els.filters.innerHTML = DIMENSIONS.map((d) => {
      // 他の分類の絞り込みを適用した上での件数を表示
      const pool = searched.filter((m) => matchesFilters(m, d.key));
      const counts = new Map();
      pool.forEach((m) => tagsOf(m, d.key).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      const allTags = d.key === 'status'
        ? STATUS_ORDER.filter((s) => mangas.some((m) => statusOf(m) === s))
        : sortTags(uniq(mangas.flatMap((m) => m.tags[d.key] || [])), d);
      if (!allTags.length) return '';
      const sel = filters[d.key] || new Set();
      const chips = allTags.map((t) => {
        const n = counts.get(t) || 0;
        const on = sel.has(t);
        return `<button type="button" class="chip filter dim-${d.key}${on ? ' on' : ''}${n === 0 && !on ? ' zero' : ''}"
          data-dim="${d.key}" data-tag="${esc(t)}">${esc(t)}<span class="count">${n}</span></button>`;
      }).join('');
      return `<div class="filter-group"><h3>${esc(d.label)}</h3><div class="chips">${chips}</div></div>`;
    }).join('') || '<p class="hint">漫画を追加するとタグが表示されます。</p>';
  }
  function sortTags(tags, dim) {
    const order = dim.options || [];
    return tags.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b, 'ja');
    });
  }

  function renderActiveFilters() {
    const items = [];
    DIMENSIONS.forEach((d) => (filters[d.key] || new Set()).forEach((t) => {
      items.push(`<button type="button" class="chip filter on dim-${d.key}" data-dim="${d.key}" data-tag="${esc(t)}">${esc(t)} ✕</button>`);
    }));
    els.activeFilters.innerHTML = items.length ? `<span class="hint">絞り込み中:</span>${items.join('')}` : '';
  }

  // ---------- 一覧 ----------
  function chip(tag, dimKey, clickable) {
    const attrs = clickable ? ` data-dim="${dimKey}" data-tag="${esc(tag)}" role="button" tabindex="0"` : '';
    return `<span class="chip dim-${dimKey}${clickable ? ' clickable' : ''}"${attrs}>${esc(tag)}</span>`;
  }

  function sorted(list) {
    const key = els.sort.value;
    const arr = list.slice();
    const cmp = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      title: (a, b) => a.title.localeCompare(b.title, 'ja'),
      progress: (a, b) => progressOf(b) - progressOf(a),
      progressAsc: (a, b) => progressOf(a) - progressOf(b),
      unread: (a, b) => (b.totalVolumes - b.readVolumes) - (a.totalVolumes - a.readVolumes),
    }[key];
    return arr.sort(cmp);
  }

  function renderList() {
    const visible = sorted(mangas.filter((m) => matchesSearch(m) && matchesFilters(m)));
    if (!mangas.length) {
      els.list.innerHTML = '<div class="empty">まだ漫画がありません。左のフォームからタイトルを入力して追加しましょう。<br>タイトルから自動でジャンル・出版社・掲載誌のタグが付きます。</div>';
      return;
    }
    if (!visible.length) {
      els.list.innerHTML = '<div class="empty">条件に一致する漫画がありません。</div>';
      return;
    }
    els.list.innerHTML = visible.map((m) => {
      const status = statusOf(m);
      const pct = Math.round(progressOf(m) * 100);
      const remaining = Math.max(0, m.totalVolumes - m.readVolumes);
      const tagChips = EDITABLE_DIMS.filter((d) => d.key !== 'magazine')
        .flatMap((d) => (m.tags[d.key] || []).map((t) => chip(t, d.key, true))).join('');
      const magazine = (m.tags.magazine || []).join(' / ');
      const volButtons = m.totalVolumes > 0 && m.totalVolumes <= 200
        ? `<div class="volumes">${Array.from({ length: m.totalVolumes }, (_, i) => {
            const v = i + 1;
            return `<button type="button" class="vol${v <= m.readVolumes ? ' read' : ''}" data-act="setvol" data-vol="${v}" title="${v}巻まで読んだ">${v}</button>`;
          }).join('')}</div>`
        : '';
      return `
        <article class="card status-${STATUS_ORDER.indexOf(status)}" data-id="${m.id}">
          <div class="card-head">
            <div>
              <h3 class="title">${esc(m.title)}</h3>
              <div class="sub">${magazine ? esc(magazine) + ' ・ ' : ''}${m.completed ? '完結' : '連載中/未設定'}</div>
            </div>
            <span class="status-badge">${status}</span>
          </div>
          <div class="progress-row">
            <button type="button" class="btn round" data-act="dec" aria-label="1巻戻す">−</button>
            <div class="progress-wrap">
              <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
              <div class="progress-text">
                <label><input type="number" class="read-input" data-act="read" min="0" value="${m.readVolumes}" /></label>
                / <label><input type="number" class="total-input" data-act="total" min="0" value="${m.totalVolumes}" /></label> 巻
                <span class="pct">${pct}%${remaining ? `・残り${remaining}巻` : ''}</span>
              </div>
            </div>
            <button type="button" class="btn round primary" data-act="inc" aria-label="1巻進める">＋</button>
          </div>
          <details class="vol-details"${openDetails.has(m.id) ? ' open' : ''}>
            <summary>巻を選んで進捗を設定</summary>
            ${volButtons || '<p class="hint">既刊数を入力すると巻ボタンが表示されます。</p>'}
          </details>
          <div class="chips">${tagChips || '<span class="hint">タグなし</span>'}</div>
          ${m.memo ? `<p class="memo">${esc(m.memo)}</p>` : ''}
          <div class="card-actions">
            <button type="button" class="link" data-act="edit">編集</button>
            <button type="button" class="link danger" data-act="delete">削除</button>
          </div>
        </article>`;
    }).join('');
  }

  function renderStats() {
    const total = mangas.length;
    const vols = mangas.reduce((s, m) => s + m.readVolumes, 0);
    const reading = mangas.filter((m) => statusOf(m) === '読書中').length;
    const done = mangas.filter((m) => statusOf(m) === '読了').length;
    els.stats.innerHTML = `
      <span><b>${total}</b>作品</span>
      <span>読書中 <b>${reading}</b></span>
      <span>読了 <b>${done}</b></span>
      <span>累計 <b>${vols}</b>巻</span>`;
  }

  function render() {
    renderStats();
    renderFilters();
    renderActiveFilters();
    renderList();
  }

  // ---------- 一覧の操作 ----------
  function update(id, fn) {
    const m = mangas.find((x) => x.id === id);
    if (!m) return;
    fn(m);
    if (m.totalVolumes < m.readVolumes) m.totalVolumes = m.readVolumes;
    m.updatedAt = Date.now();
    save();
    render();
  }

  els.list.addEventListener('click', (e) => {
    const tagEl = e.target.closest('.chip.clickable');
    if (tagEl) { toggleFilter(tagEl.dataset.dim, tagEl.dataset.tag); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const id = btn.closest('.card').dataset.id;
    const act = btn.dataset.act;
    if (act === 'inc') update(id, (m) => { m.readVolumes += 1; });
    else if (act === 'dec') update(id, (m) => { m.readVolumes = Math.max(0, m.readVolumes - 1); });
    else if (act === 'setvol') {
      const v = toInt(btn.dataset.vol);
      // 既に読んだ最終巻をもう一度押すと1巻戻す
      update(id, (m) => { m.readVolumes = m.readVolumes === v ? v - 1 : v; });
    } else if (act === 'edit') openEdit(id);
    else if (act === 'delete') {
      const m = mangas.find((x) => x.id === id);
      if (m && confirm(`「${m.title}」を削除しますか？`)) {
        mangas = mangas.filter((x) => x.id !== id);
        save();
        render();
      }
    }
  });
  els.list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.chip.clickable')) toggleFilter(e.target.dataset.dim, e.target.dataset.tag);
  });
  els.list.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-act]');
    if (!input) return;
    const id = input.closest('.card').dataset.id;
    const v = toInt(input.value);
    if (input.dataset.act === 'read') update(id, (m) => { m.readVolumes = v; });
    if (input.dataset.act === 'total') {
      update(id, (m) => { m.totalVolumes = v; if (m.readVolumes > v) m.readVolumes = v; });
    }
  });
  // 再描画しても巻ボタンの開閉状態を保つ（toggle はバブリングしないので capture で拾う）
  els.list.addEventListener('toggle', (e) => {
    if (!e.target.matches('.vol-details')) return;
    const id = e.target.closest('.card').dataset.id;
    if (e.target.open) openDetails.add(id); else openDetails.delete(id);
  }, true);

  // ---------- フィルター操作 ----------
  function onFilterClick(e) {
    const b = e.target.closest('.chip.filter');
    if (b) toggleFilter(b.dataset.dim, b.dataset.tag);
  }
  els.filters.addEventListener('click', onFilterClick);
  els.activeFilters.addEventListener('click', onFilterClick);
  els.clearFilters.addEventListener('click', () => {
    Object.keys(filters).forEach((k) => delete filters[k]);
    els.search.value = '';
    render();
  });
  els.search.addEventListener('input', render);
  els.sort.addEventListener('change', renderList);

  // ---------- 編集ダイアログ ----------
  const magazineNames = Object.keys(Dict.MAGAZINES);
  els.editMagazine.innerHTML = '<option value="">（未設定）</option>' +
    uniq(Object.values(Dict.MAGAZINES).map((m) => m.publisher)).map((pub) =>
      `<optgroup label="${esc(pub)}">${magazineNames.filter((n) => Dict.MAGAZINES[n].publisher === pub)
        .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`).join('');

  function openEdit(id) {
    const m = mangas.find((x) => x.id === id);
    if (!m) return;
    editingId = id;
    editDraftTags = JSON.parse(JSON.stringify(m.tags));
    els.editTitle.value = m.title;
    els.editTotal.value = m.totalVolumes;
    els.editRead.value = m.readVolumes;
    els.editCompleted.checked = m.completed;
    els.editMemo.value = m.memo;
    syncMagazineSelect();
    renderEditTags();
    els.dialog.showModal();
  }

  function syncMagazineSelect() {
    const mag = (editDraftTags.magazine || [])[0] || '';
    if (mag && !Dict.MAGAZINES[mag] && !els.editMagazine.querySelector(`option[value="${CSS.escape(mag)}"]`)) {
      els.editMagazine.insertAdjacentHTML('beforeend', `<option value="${esc(mag)}">${esc(mag)}</option>`);
    }
    els.editMagazine.value = mag;
  }

  function renderEditTags() {
    els.editTags.innerHTML = EDITABLE_DIMS.map((d) => {
      const tags = editDraftTags[d.key] || [];
      const suggestions = uniq([...(d.options || []), ...mangas.flatMap((m) => m.tags[d.key] || [])])
        .filter((o) => !tags.includes(o));
      const listId = `dl-${d.key}`;
      return `<div class="edit-dim">
        <div class="edit-dim-label">${esc(d.label)}</div>
        <div class="chips">
          ${tags.map((t) => `<span class="chip dim-${d.key}">${esc(t)}<button type="button" class="x" data-dim="${d.key}" data-tag="${esc(t)}" aria-label="削除">✕</button></span>`).join('')}
          <input type="text" class="tag-input" data-dim="${d.key}" list="${listId}" placeholder="＋追加" />
          <datalist id="${listId}">${suggestions.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
        </div>
      </div>`;
    }).join('');
  }

  function addDraftTag(dim, value) {
    const v = value.trim();
    if (!v) return;
    editDraftTags[dim] = uniq([...(editDraftTags[dim] || []), v]);
    renderEditTags();
    const next = els.editTags.querySelector(`.tag-input[data-dim="${dim}"]`);
    if (next) next.focus();
  }

  els.editTags.addEventListener('click', (e) => {
    const x = e.target.closest('.x');
    if (!x) return;
    editDraftTags[x.dataset.dim] = editDraftTags[x.dataset.dim].filter((t) => t !== x.dataset.tag);
    if (x.dataset.dim === 'magazine') syncMagazineSelect();
    renderEditTags();
  });
  els.editTags.addEventListener('keydown', (e) => {
    if (e.target.matches('.tag-input') && e.key === 'Enter') {
      e.preventDefault();
      addDraftTag(e.target.dataset.dim, e.target.value);
    }
  });
  els.editTags.addEventListener('change', (e) => {
    // datalist から候補を選んだときも追加
    if (e.target.matches('.tag-input') && e.target.value.trim()) addDraftTag(e.target.dataset.dim, e.target.value);
  });

  els.editMagazine.addEventListener('change', () => {
    const mag = els.editMagazine.value;
    if (!mag) {
      editDraftTags.magazine = [];
    } else {
      const t = Classifier.tagsForMagazine(mag);
      editDraftTags.magazine = t.magazine;
      editDraftTags.publisher = t.publisher.length ? t.publisher : editDraftTags.publisher;
      editDraftTags.series = t.series.length ? t.series : editDraftTags.series;
      editDraftTags.target = t.target.length ? t.target : editDraftTags.target;
    }
    renderEditTags();
  });

  els.reclassifyBtn.addEventListener('click', () => {
    const { result, tags } = tagsFromClassification(els.editTitle.value);
    if (result.source === 'none') { alert('このタイトルからは自動分類できませんでした。'); return; }
    // 自動分類の結果で置き換え（マイタグは残す）
    editDraftTags = Object.assign(tags, { custom: editDraftTags.custom || [] });
    syncMagazineSelect();
    renderEditTags();
  });

  els.cancelEdit.addEventListener('click', () => els.dialog.close());
  els.editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // 入力途中のタグも取り込む
    els.editTags.querySelectorAll('.tag-input').forEach((i) => {
      if (i.value.trim()) editDraftTags[i.dataset.dim] = uniq([...(editDraftTags[i.dataset.dim] || []), i.value.trim()]);
    });
    const title = els.editTitle.value.trim();
    if (!title) return;
    update(editingId, (m) => {
      m.title = title;
      m.readVolumes = toInt(els.editRead.value);
      m.totalVolumes = Math.max(toInt(els.editTotal.value), m.readVolumes);
      m.completed = els.editCompleted.checked;
      m.memo = els.editMemo.value.trim();
      m.tags = sanitize({ tags: editDraftTags }).tags;
    });
    els.dialog.close();
  });

  // ---------- エクスポート / インポート ----------
  els.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(mangas, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `manga-shelf-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  els.importInput.addEventListener('change', async () => {
    const file = els.importInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('形式が正しくありません');
      if (!confirm(`${data.length}件のデータを読み込みます。現在のデータは置き換えられます。よろしいですか？`)) return;
      mangas = data.map(sanitize).filter((m) => m.title);
      save();
      render();
    } catch (err) {
      alert('読み込みに失敗しました: ' + err.message);
    } finally {
      els.importInput.value = '';
    }
  });

  render();
})();
