/**
 * Visor Bíblico CAD / PWA - Lógica Principal
 * Soporte multiversión, IndexedDB, Parser XML robusto de Beblia y UI responsiva.
 */

const BEBLIA_BASE_URL = 'https://raw.githubusercontent.com/Beblia/Holy-Bible-XML-Format/master/';

const BOOK_NAMES_ES = [
  "Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio", "Josué", "Jueces", "Rut",
  "1 Samuel", "2 Samuel", "1 Reyes", "2 Reyes", "1 Crónicas", "2 Crónicas", "Esdras",
  "Nehemías", "Ester", "Job", "Salmos", "Proverbios", "Eclesiastés", "Cantares",
  "Isaías", "Jeremías", "Lamentaciones", "Ezequiel", "Daniel", "Oseas", "Joel",
  "Amós", "Abdías", "Jonás", "Miqueas", "Nahum", "Habacuc", "Sofonías",
  "Hageo", "Zacarías", "Malaquías",
  "Mateo", "Marcos", "Lucas", "Juan", "Hechos", "Romanos", "1 Corintios",
  "2 Corintios", "Gálatas", "Efesios", "Filipenses", "Colosenses", "1 Tesalonicenses",
  "2 Tesalonicenses", "1 Timoteo", "2 Timoteo", "Tito", "Filemón", "Hebreos",
  "Santiago", "1 Pedro", "2 Pedro", "1 Juan", "2 Juan", "3 Juan", "Judas", "Apocalipsis"
];

let state = {
  version: 'rvr1909',
  testament: 'ot', // 'ot'/'old' o 'nt'/'new'
  currentBook: null,
  currentChapter: 1,
  bibleData: null,
  fontSize: 100,
  lineHeight: 'relaxed',
  bookmarks: JSON.parse(localStorage.getItem('bible_bookmarks') || '[]'),
  highlights: JSON.parse(localStorage.getItem('bible_highlights') || '{}'),
  lastRead: JSON.parse(localStorage.getItem('bible_last_read') || 'null')
};

// IndexedDB Helper
const dbPromise = indexedDB.open('BibleDB', 1);
dbPromise.onupgradeneeded = (e) => {
  const db = e.target.result;
  if (!db.objectStoreNames.contains('versions')) {
    db.createObjectStore('versions');
  }
};

function saveVersionToIDB(versionKey, data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('BibleDB', 1);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('versions', 'readwrite');
      tx.objectStore('versions').put(data, versionKey);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
  });
}

function getVersionFromIDB(versionKey) {
  return new Promise((resolve) => {
    const req = indexedDB.open('BibleDB', 1);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('versions', 'readonly');
      const getReq = tx.objectStore('versions').get(versionKey);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initEventListeners();
  loadSavedPreferences();
  await loadBibleVersion(state.version);
  checkContinueReading();
});

// Normalizador de testamentos ('ot', 'nt', 'old', 'new', o índice numérico)
function normalizeTestament(t) {
  if (t === 'old' || t === 'ot') return 'ot';
  if (t === 'new' || t === 'nt') return 'nt';
  const num = parseInt(t);
  if (!isNaN(num)) {
    return num < 39 ? 'ot' : 'nt';
  }
  return 'ot';
}

// Cargar y Parsear Biblia
async function loadBibleVersion(versionKey) {
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.remove('hidden');
  document.getElementById('current-reference-badge').textContent = 'Cargando versión...';
  
  try {
    let cached = await getVersionFromIDB(versionKey);
    if (cached) {
      state.bibleData = processRawBibleData(cached);
      initApp();
      return;
    }

    if (versionKey === 'rvr1909') {
      try {
        const res = await fetch('data/rvr1909.json');
        const rawJson = await res.json();
        state.bibleData = processRawBibleData(rawJson);
        await saveVersionToIDB('rvr1909', state.bibleData);
        initApp();
      } catch (err) {
        console.error('Error cargando RVR 1909 local', err);
        state.bibleData = getMockBible();
        initApp();
      }
    } else {
      // Cargar XML desde Beblia con fallback automático
      const candidates = [
        versionKey,
        versionKey.replace('Bible', ''),
        'Spanish1960Bible',
        'SpanishReinaValera1960Bible'
      ];

      let xmlText = null;
      for (const cand of candidates) {
        try {
          const url = `${BEBLIA_BASE_URL}${cand}.xml`;
          const res = await fetch(url);
          if (res.ok) {
            xmlText = await res.text();
            break;
          }
        } catch (e) {}
      }

      if (xmlText) {
        state.bibleData = parseBebliaXML(xmlText);
        await saveVersionToIDB(versionKey, state.bibleData);
        initApp();
      } else {
        throw new Error('No se pudo descargar de Beblia');
      }
    }
    const sel = document.getElementById('select-version');
    if (sel && sel.selectedOptions[0]) {
      document.getElementById('footer-version').textContent = sel.selectedOptions[0].text;
    }
  } catch (err) {
    console.error('Error descargando versión', err);
    alert('No se pudo descargar esta versión o no hay conexión. Volviendo a RVR 1909.');
    state.version = 'rvr1909';
    document.getElementById('select-version').value = 'rvr1909';
    await loadBibleVersion('rvr1909');
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

function processRawBibleData(data) {
  let booksArr = [];
  if (Array.isArray(data)) {
    booksArr = data;
  } else if (data && Array.isArray(data.books)) {
    booksArr = data.books;
  } else {
    booksArr = getMockBible();
  }

  return booksArr.map((b, idx) => {
    const name = b.name || BOOK_NAMES_ES[idx] || `Libro ${idx + 1}`;
    const testament = normalizeTestament(b.testament !== undefined ? b.testament : idx);
    const chapters = Array.isArray(b.chapters) ? b.chapters : [];
    return { name, testament, chapters };
  });
}

function parseBebliaXML(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  const booksNode = xmlDoc.querySelectorAll('book, BIBLEBOOK');
  
  let books = [];
  booksNode.forEach((bNode, index) => {
    let bName = bNode.getAttribute('bname') || bNode.getAttribute('name');
    const numAttr = parseInt(bNode.getAttribute('number') || (index + 1));
    if (!bName) {
      bName = BOOK_NAMES_ES[numAttr - 1] || BOOK_NAMES_ES[index] || `Libro ${index + 1}`;
    }
    
    const testament = normalizeTestament(index < 39 ? 'ot' : 'nt');
    const chaptersNode = bNode.querySelectorAll('chapter, CHAPTER');
    
    let chapters = [];
    chaptersNode.forEach((cNode) => {
      const versesNode = cNode.querySelectorAll('verse, VERS');
      let verses = [];
      versesNode.forEach(vNode => {
        verses.push(vNode.textContent ? vNode.textContent.trim() : '');
      });
      chapters.push(verses);
    });
    books.push({ name: bName, testament, chapters });
  });
  return books.length ? books : getMockBible();
}

function getMockBible() {
  return [
    {
      name: 'Génesis',
      testament: 'ot',
      chapters: [
        ['En el principio creó Dios los cielos y la tierra.', 'Y la tierra estaba desordenada y vacía, y las tinieblas estaban sobre la faz del abismo.', 'Y dijo Dios: Sea la luz; y fue la luz.']
      ]
    },
    {
      name: 'Juan',
      testament: 'nt',
      chapters: [
        ['En el principio era el Verbo, y el Verbo era con Dios, y el Verbo era Dios.', 'Este era en el principio con Dios.', 'Todas las cosas por él fueron hechas, y sin él nada de lo que es hecho fue hecho.']
      ]
    }
  ];
}

function initApp() {
  renderBooks();
  if (state.currentBook !== null) {
    renderVerses(state.currentBook, state.currentChapter);
  }
}

function renderBooks() {
  const grid = document.getElementById('books-grid');
  grid.innerHTML = '';
  
  const targetTestament = normalizeTestament(state.testament);
  const filtered = state.bibleData.filter(b => normalizeTestament(b.testament) === targetTestament);
  
  filtered.forEach((book) => {
    const globalIndex = state.bibleData.indexOf(book);
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-[#0c1222]/80 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col justify-between hover:border-indigo-500/50 hover:shadow-lg transition-all cursor-pointer group';
    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-bold text-indigo-500 dark:text-indigo-400">${globalIndex + 1}</span>
        <span class="text-[10px] font-semibold text-slate-400 uppercase">${book.chapters.length} cap</span>
      </div>
      <h4 class="text-base font-bold text-slate-900 dark:text-white group-hover:text-indigo-500 dark:group-hover:text-indigo-300 transition-colors">${book.name}</h4>
    `;
    card.onclick = () => selectBook(globalIndex);
    grid.appendChild(card);
  });
}

function selectBook(bookIndex) {
  state.currentBook = bookIndex;
  state.currentChapter = 1;
  renderVerses(bookIndex, 1);
  document.getElementById('view-books').classList.add('hidden');
  document.getElementById('view-verses').classList.remove('hidden');
  document.getElementById('btn-back').classList.remove('hidden');
}

function renderVerses(bookIndex, chapterNum) {
  state.currentBook = bookIndex;
  state.currentChapter = chapterNum;
  
  const book = state.bibleData[bookIndex];
  const verses = book.chapters[chapterNum - 1] || [];
  
  document.getElementById('verses-chapter-title').textContent = `${book.name} ${chapterNum}`;
  document.getElementById('current-reference-badge').textContent = `${book.name} ${chapterNum}`;
  
  const container = document.getElementById('verses-container');
  container.innerHTML = '';
  
  verses.forEach((verseText, vIdx) => {
    const vNum = vIdx + 1;
    const p = document.createElement('p');
    p.className = 'verse-item relative py-1 px-2 rounded-xl transition-colors hover:bg-indigo-50/50 dark:hover:bg-white/[0.02] cursor-pointer';
    p.dataset.reference = `${book.name} ${chapterNum}:${vNum}`;
    p.dataset.text = verseText;
    p.innerHTML = `<sup class="text-xs font-bold text-indigo-500 mr-1.5 select-none">${vNum}</sup> ${verseText}`;
    
    p.onclick = (e) => {
      e.stopPropagation();
      showFloatingBar(p);
    };
    
    container.appendChild(p);
  });

  state.lastRead = { bookIndex, chapterNum, title: `${book.name} ${chapterNum}` };
  localStorage.setItem('bible_last_read', JSON.stringify(state.lastRead));
  checkContinueReading();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initEventListeners() {
  const handleTabClick = (testamentVal, activeBtnId, inactiveBtnId) => {
    state.testament = normalizeTestament(testamentVal);
    document.getElementById(activeBtnId).className = 'flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm transition-all';
    document.getElementById(inactiveBtnId).className = 'flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all';
    renderBooks();
  };

  document.getElementById('tab-ot').onclick = () => handleTabClick('ot', 'tab-ot', 'tab-nt');
  document.getElementById('tab-nt').onclick = () => handleTabClick('nt', 'tab-nt', 'tab-ot');

  document.getElementById('btn-back').onclick = () => {
    document.getElementById('view-verses').classList.add('hidden');
    document.getElementById('view-books').classList.remove('hidden');
    document.getElementById('btn-back').classList.add('hidden');
    document.getElementById('current-reference-badge').textContent = 'Selecciona un libro';
  };

  document.getElementById('select-version').onchange = (e) => {
    state.version = e.target.value;
    loadBibleVersion(state.version);
  };

  document.getElementById('btn-theme').onclick = () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  };

  const fontBtn = document.getElementById('btn-font-settings');
  const popover = document.getElementById('popover-font');
  fontBtn.onclick = (e) => {
    e.stopPropagation();
    popover.classList.toggle('hidden');
  };
  document.onclick = () => popover.classList.add('hidden');
  popover.onclick = (e) => e.stopPropagation();

  document.getElementById('font-increase').onclick = () => {
    if (state.fontSize < 160) {
      state.fontSize += 10;
      updateTypography();
    }
  };
  document.getElementById('font-decrease').onclick = () => {
    if (state.fontSize > 80) {
      state.fontSize -= 10;
      updateTypography();
    }
  };

  document.querySelectorAll('.line-btn').forEach(btn => {
    btn.onclick = () => {
      state.lineHeight = btn.dataset.line;
      updateTypography();
    };
  });

  document.getElementById('btn-prev-chapter').onclick = () => {
    if (state.currentChapter > 1) {
      renderVerses(state.currentBook, state.currentChapter - 1);
    }
  };
  document.getElementById('btn-next-chapter').onclick = () => {
    const book = state.bibleData[state.currentBook];
    if (state.currentChapter < book.chapters.length) {
      renderVerses(state.currentBook, state.currentChapter + 1);
    }
  };
  document.getElementById('btn-chapter-picker').onclick = () => {
    document.getElementById('view-verses').classList.add('hidden');
    document.getElementById('view-books').classList.remove('hidden');
    document.getElementById('btn-back').classList.add('hidden');
  };

  const searchModal = document.getElementById('modal-search');
  document.getElementById('btn-search-global').onclick = () => searchModal.classList.remove('hidden');
  document.getElementById('close-search').onclick = () => searchModal.classList.add('hidden');

  let searchTimeout;
  document.getElementById('search-input').oninput = (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 3) {
      document.getElementById('search-results').innerHTML = '<div class="text-center text-slate-400 py-12 text-sm">Escribe al menos 3 caracteres</div>';
      return;
    }
    searchTimeout = setTimeout(() => performGlobalSearch(query), 300);
  };

  window.onscroll = () => {
    const winScroll = document.documentElement.scrollTop || document.body.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (winScroll / height) * 100;
    document.getElementById('reading-progress').style.width = scrolled + '%';
  };
}

function updateTypography() {
  const container = document.getElementById('verses-container');
  container.style.fontSize = `${state.fontSize}%`;
  container.className = `space-y-4 text-lg font-sans ${state.lineHeight === 'loose' ? 'leading-loose' : 'leading-relaxed'}`;
  document.getElementById('font-size-display').textContent = `${state.fontSize}%`;
  localStorage.setItem('bible_fontsize', state.fontSize);
  localStorage.setItem('bible_lineheight', state.lineHeight);
}

function loadSavedPreferences() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') document.documentElement.classList.remove('dark');
  
  const fSize = localStorage.getItem('bible_fontsize');
  if (fSize) {
    state.fontSize = parseInt(fSize);
    updateTypography();
  }
}

function initTheme() {
  if (!localStorage.getItem('theme')) {
    document.documentElement.classList.add('dark');
  } else if (localStorage.getItem('theme') === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
}

function checkContinueReading() {
  if (state.lastRead && state.lastRead.bookIndex !== undefined) {
    const card = document.getElementById('continue-reading-card');
    card.classList.remove('hidden');
    document.getElementById('continue-title').textContent = state.lastRead.title;
    card.onclick = () => selectBook(state.lastRead.bookIndex);
  }
}

function showFloatingBar(verseEl) {
  const bar = document.getElementById('verse-floating-bar');
  bar.classList.remove('hidden');
  
  document.getElementById('action-copy').onclick = () => {
    navigator.clipboard.writeText(`${verseEl.dataset.reference} - ${verseEl.dataset.text}`);
    bar.classList.add('hidden');
    alert('Versículo copiado al portapapeles');
  };

  document.getElementById('action-share').onclick = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Biblia Pro',
        text: `${verseEl.dataset.reference} - ${verseEl.dataset.text}`
      });
    } else {
      navigator.clipboard.writeText(`${verseEl.dataset.reference} - ${verseEl.dataset.text}`);
      alert('Copiado para compartir');
    }
    bar.classList.add('hidden');
  };

  setTimeout(() => {
    const hideOnClick = (e) => {
      if (!bar.contains(e.target) && e.target !== verseEl) {
        bar.classList.add('hidden');
        document.removeEventListener('click', hideOnClick);
      }
    };
    document.addEventListener('click', hideOnClick);
  }, 100);
}

function performGlobalSearch(query) {
  const resultsContainer = document.getElementById('search-results');
  resultsContainer.innerHTML = '<div class="text-center text-slate-400 py-6">Buscando...</div>';
  
  setTimeout(() => {
    let results = [];
    const q = query.toLowerCase();
    
    state.bibleData.forEach((book, bIdx) => {
      book.chapters.forEach((chap, cIdx) => {
        chap.forEach((verse, vIdx) => {
          if (verse.toLowerCase().includes(q)) {
            results.push({
              reference: `${book.name} ${cIdx + 1}:${vIdx + 1}`,
              text: verse,
              bookIndex: bIdx,
              chapterNum: cIdx + 1
            });
          }
        });
      });
    });

    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="text-center text-slate-400 py-12">No se encontraron resultados.</div>';
      return;
    }

    resultsContainer.innerHTML = '';
    results.slice(0, 50).forEach(res => {
      const div = document.createElement('div');
      div.className = 'py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02] px-3 rounded-xl transition-colors';
      div.innerHTML = `
        <div class="text-xs font-bold text-indigo-500 mb-1">${res.reference}</div>
        <div class="text-sm text-slate-700 dark:text-slate-300">${res.text}</div>
      `;
      div.onclick = () => {
        document.getElementById('modal-search').classList.add('hidden');
        selectBook(res.bookIndex);
        renderVerses(res.bookIndex, res.chapterNum);
      };
      resultsContainer.appendChild(div);
    });
  }, 50);
}
