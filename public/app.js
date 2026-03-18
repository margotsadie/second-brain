// ── IndexedDB Storage ──────────────────────────────────────────
const DB_NAME = 'second-brain';
const DB_VERSION = 1;
const STORE = 'resources';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllResources() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveResource(resource) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(resource);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteResource(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── State ──────────────────────────────────────────────────────
let resources = [];
let activeTag = null;
let searchQuery = '';
let currentView = 'list';

// ── DOM Elements ───────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const addBtn = $('#add-btn');
const modalOverlay = $('#modal-overlay');
const modalTitle = $('#modal-title');
const modalClose = $('#modal-close');
const form = $('#resource-form');
const deleteBtn = $('#delete-btn');
const detailOverlay = $('#detail-overlay');
const detailClose = $('#detail-close');
const detailContent = $('#detail-content');
const searchInput = $('#search-input');
const tagFilters = $('#tag-filters');
const entriesList = $('#entries-list');
const emptyState = $('#empty-state');
const mapEmptyState = $('#map-empty-state');
const listView = $('#list-view');
const mapView = $('#map-view');
const mapContainer = $('#map-container');
const urlInput = $('#input-url');
const urlStatus = $('#url-status');
const suggestedTagsEl = $('#suggested-tags');
const titleInput = $('#input-title');
const typeSelect = $('#input-type');
const tagsInput = $('#input-tags');

// ── Type icons ─────────────────────────────────────────────────
const typeIcons = {
  article: '📄',
  podcast: '🎙️',
  video: '🎬',
  book: '📚',
  paper: '📑',
  other: '📌'
};

// ── Tag colors ─────────────────────────────────────────────────
const tagColors = [
  '#a78bbd', '#8badc4', '#c49b8b', '#8bbda3', '#c4a68b',
  '#b08bbd', '#8bc4b8', '#bd8ba7', '#a3bd8b', '#8b9fc4',
  '#c48bab', '#8bc4a0', '#bda78b', '#8bbdc4', '#bd8b95'
];

function getTagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return tagColors[Math.abs(hash) % tagColors.length];
}

// ── URL Auto-Extract ───────────────────────────────────────────
const domainTypeMap = {
  'youtube.com': 'video', 'youtu.be': 'video', 'vimeo.com': 'video',
  'tiktok.com': 'video', 'twitch.tv': 'video',
  'spotify.com': 'podcast', 'podcasts.apple.com': 'podcast',
  'overcast.fm': 'podcast', 'pocketcasts.com': 'podcast',
  'anchor.fm': 'podcast', 'castbox.fm': 'podcast',
  'goodreads.com': 'book', 'amazon.com': 'book',
  'arxiv.org': 'paper', 'scholar.google.com': 'paper',
  'researchgate.net': 'paper', 'doi.org': 'paper',
  'jstor.org': 'paper', 'pubmed.ncbi.nlm.nih.gov': 'paper',
};

function detectTypeFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    // Check exact matches and partial matches
    for (const [domain, type] of Object.entries(domainTypeMap)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) return type;
    }
    // Check if Spotify podcast link specifically
    if (hostname.includes('spotify') && url.includes('/episode')) return 'podcast';
    if (hostname.includes('spotify') && url.includes('/show')) return 'podcast';
  } catch {}
  return 'article'; // default
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    // Get path segments, clean them up
    const path = u.pathname.replace(/\/$/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      // Clean up slug-style paths
      return last
        .replace(/[-_]/g, ' ')
        .replace(/\.\w+$/, '') // remove extensions
        .replace(/\b\w/g, c => c.toUpperCase()); // capitalize
    }
    return u.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

async function fetchPageTitle(url) {
  // Try multiple CORS proxy approaches
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  ];

  for (const proxyUrl of proxies) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;

      let html;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await res.json();
        html = json.contents || json.content || '';
      } else {
        html = await res.text();
      }

      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match) {
        const txt = document.createElement('textarea');
        txt.innerHTML = match[1];
        return txt.value.trim();
      }
    } catch {
      clearTimeout(timeout);
    }
  }
  return null;
}

let urlDebounceTimer = null;

urlInput.addEventListener('input', () => {
  clearTimeout(urlDebounceTimer);
  const url = urlInput.value.trim();
  if (!url || !url.startsWith('http')) {
    urlStatus.classList.add('hidden');
    return;
  }
  urlDebounceTimer = setTimeout(() => handleUrlPaste(url), 400);
});

// Also handle paste event for instant response
urlInput.addEventListener('paste', (e) => {
  // Use setTimeout to get the pasted value after it's applied
  setTimeout(() => {
    const url = urlInput.value.trim();
    if (url && url.startsWith('http')) {
      clearTimeout(urlDebounceTimer);
      handleUrlPaste(url);
    }
  }, 50);
});

async function handleUrlPaste(url) {
  // Auto-detect type
  const detectedType = detectTypeFromUrl(url);
  typeSelect.value = detectedType;

  // Show loading state
  urlStatus.className = 'loading';
  urlStatus.textContent = 'Fetching title...';
  urlStatus.classList.remove('hidden');

  // Set a fallback title from URL immediately (always overwrite on new paste)
  const fallbackTitle = titleFromUrl(url);
  titleInput.value = fallbackTitle;
  renderSuggestedTags();

  // Try to fetch the real title
  const fetchedTitle = await fetchPageTitle(url);
  if (fetchedTitle) {
    titleInput.value = fetchedTitle;
    renderSuggestedTags();
    urlStatus.className = 'success';
    urlStatus.textContent = 'Title extracted!';
  } else {
    urlStatus.className = 'error';
    urlStatus.textContent = 'Could not fetch title — you can edit it above.';
  }

  // Hide status after a moment
  setTimeout(() => urlStatus.classList.add('hidden'), 3000);
}

// ── Suggested Tags ─────────────────────────────────────────────
let selectedSuggestedTags = new Set();

// Keyword-to-tag mapping for smart suggestions based on content
const keywordTagMap = {
  // Tech
  'ai': 'ai', 'artificial intelligence': 'ai', 'machine learning': 'machine learning',
  'ml': 'machine learning', 'deep learning': 'deep learning', 'neural': 'ai',
  'gpt': 'ai', 'llm': 'ai', 'chatgpt': 'ai', 'claude': 'ai', 'openai': 'ai',
  'anthropic': 'ai', 'generative': 'ai',
  'programming': 'programming', 'coding': 'programming', 'software': 'software',
  'developer': 'programming', 'code': 'programming', 'engineering': 'engineering',
  'python': 'python', 'javascript': 'javascript', 'typescript': 'javascript',
  'react': 'react', 'web': 'web', 'app': 'tech', 'api': 'tech',
  'data': 'data', 'database': 'data', 'algorithm': 'programming',
  'crypto': 'crypto', 'blockchain': 'crypto', 'bitcoin': 'crypto',
  'cybersecurity': 'security', 'security': 'security', 'privacy': 'privacy',
  'cloud': 'cloud', 'aws': 'cloud', 'devops': 'devops',
  // Design
  'design': 'design', 'ux': 'design', 'ui': 'design', 'figma': 'design',
  'typography': 'design', 'branding': 'design', 'creative': 'creativity',
  'creativity': 'creativity', 'aesthetic': 'design', 'visual': 'design',
  // Business
  'startup': 'startups', 'entrepreneur': 'startups', 'founder': 'startups',
  'business': 'business', 'strategy': 'strategy', 'marketing': 'marketing',
  'growth': 'growth', 'product': 'product', 'leadership': 'leadership',
  'management': 'management', 'finance': 'finance', 'investing': 'investing',
  'economy': 'economics', 'economic': 'economics', 'market': 'economics',
  'venture': 'startups', 'vc': 'startups',
  // Science
  'science': 'science', 'research': 'research', 'study': 'research',
  'biology': 'science', 'physics': 'science', 'chemistry': 'science',
  'climate': 'climate', 'environment': 'climate', 'sustainability': 'sustainability',
  'space': 'space', 'nasa': 'space', 'quantum': 'science',
  'neuroscience': 'neuroscience', 'brain': 'neuroscience', 'cognitive': 'psychology',
  // Culture
  'culture': 'culture', 'society': 'society', 'politics': 'politics',
  'policy': 'politics', 'history': 'history', 'philosophy': 'philosophy',
  'art': 'art', 'music': 'music', 'film': 'film', 'book': 'books',
  'writing': 'writing', 'author': 'writing', 'journalism': 'media',
  'media': 'media', 'news': 'media', 'podcast': 'podcasts',
  // Health & Wellness
  'health': 'health', 'mental health': 'mental health', 'wellness': 'wellness',
  'fitness': 'fitness', 'nutrition': 'health', 'meditation': 'wellness',
  'psychology': 'psychology', 'therapy': 'psychology',
  // Education
  'education': 'education', 'learning': 'learning', 'teaching': 'education',
  'university': 'education', 'academic': 'education',
  // Domains from URL
  'nytimes.com': 'news', 'bbc.com': 'news', 'theguardian.com': 'news',
  'ft.com': 'finance', 'wsj.com': 'finance', 'bloomberg.com': 'finance',
  'techcrunch.com': 'tech', 'theverge.com': 'tech', 'wired.com': 'tech',
  'arstechnica.com': 'tech', 'hbr.org': 'business',
  'medium.com': 'blogs', 'substack.com': 'newsletters',
  'github.com': 'programming', 'stackoverflow.com': 'programming',
  'nature.com': 'science', 'sciencemag.org': 'science',
};

function getSmartTagSuggestions() {
  const title = titleInput.value.toLowerCase();
  const url = urlInput.value.toLowerCase();
  const combined = title + ' ' + url;

  const suggested = new Set();

  // Check keywords against title and URL
  for (const [keyword, tag] of Object.entries(keywordTagMap)) {
    if (combined.includes(keyword)) {
      suggested.add(tag);
    }
  }

  // Also add existing tags from the library (so you can reuse them)
  const existingTags = getAllTags();
  existingTags.forEach(({ tag }) => suggested.add(tag));

  return [...suggested];
}

function renderSuggestedTags() {
  const smartTags = getSmartTagSuggestions();

  if (smartTags.length === 0) {
    suggestedTagsEl.innerHTML = '';
    return;
  }

  // Get currently typed tags
  const currentTags = tagsInput.value
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  // Filter out already-selected tags, limit to 12
  const suggestions = smartTags
    .filter(tag => !currentTags.includes(tag))
    .slice(0, 12);

  if (suggestions.length === 0) {
    suggestedTagsEl.innerHTML = '';
    return;
  }

  suggestedTagsEl.innerHTML = suggestions.map(tag =>
    `<button type="button" class="suggested-tag ${selectedSuggestedTags.has(tag) ? 'selected' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join('');
}

suggestedTagsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.suggested-tag');
  if (!btn) return;
  const tag = btn.dataset.tag;

  if (selectedSuggestedTags.has(tag)) {
    // Deselect: remove from input and set
    selectedSuggestedTags.delete(tag);
    const tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t.toLowerCase() !== tag);
    tagsInput.value = tags.join(', ');
  } else {
    // Select: add to input
    selectedSuggestedTags.add(tag);
    const current = tagsInput.value.trim();
    tagsInput.value = current ? `${current}, ${tag}` : tag;
  }

  renderSuggestedTags();
});

// Re-render suggestions when tags input changes
tagsInput.addEventListener('input', () => {
  // Sync selectedSuggestedTags with what's in the input
  const currentTags = tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  for (const tag of selectedSuggestedTags) {
    if (!currentTags.includes(tag)) selectedSuggestedTags.delete(tag);
  }
  renderSuggestedTags();
});

// Re-render suggestions when title changes (smart suggestions depend on title)
titleInput.addEventListener('input', () => renderSuggestedTags());

// ── Rendering ──────────────────────────────────────────────────
function getFilteredResources() {
  let filtered = [...resources];
  if (activeTag) {
    filtered = filtered.filter(r => r.tags.includes(activeTag));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q) ||
      r.tags.some(t => t.toLowerCase().includes(q))
    );
  }
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

function getAllTags() {
  const counts = {};
  resources.forEach(r => {
    r.tags.forEach(t => {
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
}

function renderTagFilters() {
  const tags = getAllTags();
  tagFilters.innerHTML = tags.map(({ tag, count }) =>
    `<button class="tag-chip ${activeTag === tag ? 'active' : ''}" data-tag="${tag}">${tag} (${count})</button>`
  ).join('');
}

function renderList() {
  const filtered = getFilteredResources();
  emptyState.classList.toggle('hidden', filtered.length > 0 || resources.length === 0);

  if (resources.length === 0) {
    emptyState.classList.remove('hidden');
    entriesList.innerHTML = '';
    return;
  }

  if (filtered.length === 0 && resources.length > 0) {
    entriesList.innerHTML = '<p style="text-align:center;color:var(--text2);padding:40px 0;">No results found.</p>';
    emptyState.classList.add('hidden');
    return;
  }

  entriesList.innerHTML = filtered.map(r => `
    <div class="entry-card" data-id="${r.id}">
      <span class="entry-type">${typeIcons[r.type] || '📌'} ${r.type}</span>
      <div class="entry-title">${escapeHtml(r.title)}</div>
      ${r.notes ? `<div class="entry-notes">${escapeHtml(r.notes)}</div>` : ''}
      <div class="entry-tags">
        ${r.tags.map(t => `<span class="entry-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="entry-date">${formatDate(r.createdAt)}</div>
    </div>
  `).join('');
}

function render() {
  renderTagFilters();
  renderList();
  if (currentView === 'map') renderMap();
}

// ── Detail View ────────────────────────────────────────────────
function showDetail(id) {
  const r = resources.find(r => r.id === id);
  if (!r) return;

  detailContent.innerHTML = `
    <div class="detail-type">${typeIcons[r.type] || '📌'} ${r.type}</div>
    <h2>${escapeHtml(r.title)}</h2>
    ${r.url ? `<a class="detail-url" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>` : ''}
    ${r.notes ? `<div class="detail-notes">${escapeHtml(r.notes)}</div>` : ''}
    <div class="detail-tags">
      ${r.tags.map(t => `<span class="detail-tag">${escapeHtml(t)}</span>`).join('')}
    </div>
    <div class="detail-date">Saved ${formatDate(r.createdAt)}</div>
    <div class="detail-actions">
      <button class="btn-secondary" onclick="openEdit('${r.id}')">Edit</button>
      ${r.url ? `<a class="btn-secondary" href="${escapeHtml(r.url)}" target="_blank" rel="noopener" style="text-decoration:none;text-align:center;">Open Link</a>` : ''}
    </div>
  `;
  detailOverlay.classList.remove('hidden');
}

// ── Modal (Add/Edit) ───────────────────────────────────────────
function openAdd() {
  form.reset();
  $('#input-id').value = '';
  modalTitle.textContent = 'Add Resource';
  deleteBtn.classList.add('hidden');
  urlStatus.classList.add('hidden');
  selectedSuggestedTags.clear();
  renderSuggestedTags();
  $('#date-added-display').textContent = formatDate(Date.now());
  modalOverlay.classList.remove('hidden');
  urlInput.focus();
}

function openEdit(id) {
  detailOverlay.classList.add('hidden');
  const r = resources.find(r => r.id === id);
  if (!r) return;

  $('#input-id').value = r.id;
  $('#input-title').value = r.title;
  $('#input-url').value = r.url || '';
  $('#input-type').value = r.type;
  $('#input-tags').value = r.tags.join(', ');
  $('#input-notes').value = r.notes || '';
  modalTitle.textContent = 'Edit Resource';
  deleteBtn.classList.remove('hidden');
  urlStatus.classList.add('hidden');
  selectedSuggestedTags.clear();
  r.tags.forEach(t => selectedSuggestedTags.add(t));
  renderSuggestedTags();
  $('#date-added-display').textContent = formatDate(r.createdAt);
  modalOverlay.classList.remove('hidden');
}
window.openEdit = openEdit;

function closeModal() {
  modalOverlay.classList.add('hidden');
}

// ── Form Submit ────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#input-id').value || crypto.randomUUID();
  const existing = resources.find(r => r.id === id);

  const resource = {
    id,
    title: $('#input-title').value.trim(),
    url: $('#input-url').value.trim(),
    type: $('#input-type').value,
    tags: $('#input-tags').value
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean),
    notes: $('#input-notes').value.trim(),
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now()
  };

  await saveResource(resource);
  resources = await getAllResources();
  closeModal();
  render();
  syncBackup();
});

// ── Delete ─────────────────────────────────────────────────────
deleteBtn.addEventListener('click', async () => {
  const id = $('#input-id').value;
  if (!id) return;
  if (!confirm('Delete this resource?')) return;
  await deleteResource(id);
  resources = await getAllResources();
  closeModal();
  render();
  syncBackup();
});

// ── Events ─────────────────────────────────────────────────────
addBtn.addEventListener('click', openAdd);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

detailClose.addEventListener('click', () => detailOverlay.classList.add('hidden'));
detailOverlay.addEventListener('click', (e) => {
  if (e.target === detailOverlay) detailOverlay.classList.add('hidden');
});

entriesList.addEventListener('click', (e) => {
  const card = e.target.closest('.entry-card');
  if (card) showDetail(card.dataset.id);
});

tagFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('.tag-chip');
  if (!chip) return;
  const tag = chip.dataset.tag;
  activeTag = activeTag === tag ? null : tag;
  render();
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  render();
});

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    listView.classList.toggle('active', currentView === 'list');
    mapView.classList.toggle('active', currentView === 'map');
    if (currentView === 'map') renderMap();
  });
});

// ── D3 Cluster Map ─────────────────────────────────────────────
function renderMap() {
  mapContainer.innerHTML = '';

  if (resources.length < 1) {
    mapEmptyState.classList.remove('hidden');
    return;
  }
  mapEmptyState.classList.add('hidden');

  const width = mapContainer.clientWidth;
  const height = mapContainer.clientHeight || 500;

  const svg = d3.select(mapContainer)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const g = svg.append('g');

  // Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.3, 4])
    .on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoom);

  // Build nodes and links
  const tags = getAllTags();
  const tagSet = new Set(tags.map(t => t.tag));

  // Tag nodes (larger, anchor points)
  const tagNodes = tags.map(({ tag, count }) => ({
    id: `tag:${tag}`,
    label: tag,
    isTag: true,
    count,
    radius: Math.max(20, Math.min(45, 12 + count * 6)),
    color: getTagColor(tag)
  }));

  // Resource nodes
  const resourceNodes = resources.map(r => ({
    id: r.id,
    label: r.title.length > 30 ? r.title.slice(0, 28) + '...' : r.title,
    fullTitle: r.title,
    isTag: false,
    type: r.type,
    tags: r.tags,
    radius: 8,
    color: r.tags.length > 0 ? getTagColor(r.tags[0]) : '#666'
  }));

  const nodes = [...tagNodes, ...resourceNodes];

  // Links: connect resources to their tags
  const links = [];
  resources.forEach(r => {
    r.tags.forEach(tag => {
      if (tagSet.has(tag)) {
        links.push({ source: r.id, target: `tag:${tag}` });
      }
    });
  });

  // Simulation
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(80).strength(0.7))
    .force('charge', d3.forceManyBody().strength(d => d.isTag ? -300 : -60))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.radius + 4));

  // Draw links
  const link = g.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'map-link');

  // Draw nodes
  const node = g.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'map-node')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // Tag nodes: larger circles with labels
  node.filter(d => d.isTag)
    .append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => d.color + '33')
    .attr('stroke', d => d.color);

  node.filter(d => d.isTag)
    .append('text')
    .attr('class', 'map-tag-label')
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('fill', d => d.color)
    .text(d => d.label);

  // Resource nodes: small circles with labels
  node.filter(d => !d.isTag)
    .append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => d.color + '88');

  node.filter(d => !d.isTag)
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', -14)
    .attr('font-size', '10px')
    .text(d => d.label);

  // Click handler on resource nodes
  node.filter(d => !d.isTag)
    .on('click', (e, d) => {
      showDetail(d.id);
    });

  // Tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

// ── Local Folder Backup ────────────────────────────────────────
const backupBtn = $('#backup-btn');
const backupStatus = $('#backup-status');
let backupDirHandle = null;
const supportsFileSystem = 'showDirectoryPicker' in window;

function sanitizeFilename(str) {
  return str.replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '-').slice(0, 60).toLowerCase();
}

function resourceToMarkdown(r) {
  let md = `# ${r.title}\n\n`;
  md += `- **Type:** ${r.type}\n`;
  if (r.url) md += `- **URL:** ${r.url}\n`;
  md += `- **Tags:** ${r.tags.join(', ')}\n`;
  md += `- **Date Added:** ${formatDate(r.createdAt)}\n`;
  if (r.updatedAt) md += `- **Last Updated:** ${formatDate(r.updatedAt)}\n`;
  if (r.notes) md += `\n## Notes\n\n${r.notes}\n`;
  return md;
}

async function syncBackup() {
  if (!backupDirHandle) return;

  try {
    // Write individual .md files for each resource
    const existingFiles = new Set();
    for await (const [name] of backupDirHandle) {
      existingFiles.add(name);
    }

    const currentFiles = new Set();
    for (const r of resources) {
      const filename = `${sanitizeFilename(r.title)}-${r.id.slice(0, 8)}.md`;
      currentFiles.add(filename);
      const fileHandle = await backupDirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(resourceToMarkdown(r));
      await writable.close();
    }

    // Write master JSON
    const jsonHandle = await backupDirHandle.getFileHandle('second-brain-backup.json', { create: true });
    const jsonWritable = await jsonHandle.createWritable();
    await jsonWritable.write(JSON.stringify(resources, null, 2));
    await jsonWritable.close();
    currentFiles.add('second-brain-backup.json');

    // Remove .md files for deleted resources
    for (const name of existingFiles) {
      if (name.endsWith('.md') && !currentFiles.has(name)) {
        try { await backupDirHandle.removeEntry(name); } catch {}
      }
    }

    backupStatus.textContent = `Synced ${resources.length} items`;
    backupStatus.className = 'synced';
  } catch (err) {
    backupStatus.textContent = 'Backup failed';
    backupStatus.className = '';
    console.error('Backup error:', err);
  }
}

async function pickBackupFolder() {
  if (supportsFileSystem) {
    try {
      backupDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      backupBtn.textContent = 'Change folder';
      backupStatus.textContent = 'Syncing...';
      await syncBackup();
    } catch (err) {
      if (err.name !== 'AbortError') {
        backupStatus.textContent = 'Could not access folder';
      }
    }
  } else {
    // Fallback: download JSON file
    downloadBackupJson();
  }
}

function downloadBackupJson() {
  const data = JSON.stringify(resources, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `second-brain-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  backupStatus.textContent = 'Downloaded!';
  setTimeout(() => { backupStatus.textContent = ''; }, 3000);
}

// Set button text based on browser support
if (!supportsFileSystem) {
  backupBtn.textContent = 'Download backup';
}

backupBtn.addEventListener('click', pickBackupFolder);

// ── Service Worker ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Init ───────────────────────────────────────────────────────
(async () => {
  resources = await getAllResources();
  render();
})();
