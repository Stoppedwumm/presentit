// PresentIt Centralized i18n Translation System
let TRANSLATIONS = {};
let currentLang = localStorage.getItem('presentit_lang') || 'en';

// Load i18n.json dynamically
async function loadTranslations() {
  try {
    const res = await fetch('/i18n.json');
    TRANSLATIONS = await res.json();
    updatePageTranslations();
  } catch (err) {
    console.error('Failed to load i18n.json:', err);
  }
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('presentit_lang', lang);
  updatePageTranslations();
  
  // Dispatch custom event
  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

function getTranslation(key) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en || {};
  const fallback = TRANSLATIONS.en || {};
  return dict[key] || fallback[key] || key;
}

function updatePageTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = getTranslation(key);
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.placeholder = getTranslation(key);
    }
  });

  // Update active style highlight in language selector buttons
  document.querySelectorAll('.lang-select-btn').forEach(btn => {
    const isAct = btn.getAttribute('data-lang') === currentLang;
    btn.classList.toggle('active', isAct);
    btn.style.background = isAct ? 'rgba(255,255,255,0.25)' : 'transparent';
    btn.style.color = isAct ? '#ffffff' : 'var(--muted, #94a3b8)';
    btn.style.border = isAct ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent';
  });
}

function renderLangSelector(container) {
  if (typeof container === 'string') {
    container = document.getElementById(container);
  }
  if (!container) return;

  const languages = [
    { code: 'en', label: '🇬🇧 EN' },
    { code: 'de', label: '🇩🇪 DE' },
    { code: 'fr', label: '🇫🇷 FR' },
    { code: 'zh', label: '🇨🇳 中文' }
  ];

  container.innerHTML = `
    <div class="lang-selector-bar" style="display:inline-flex;gap:4px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:3px;border-radius:10px;">
      ${languages.map(l => {
        const isAct = l.code === currentLang;
        return `
          <button class="lang-select-btn ${isAct ? 'active' : ''}" data-lang="${l.code}" onclick="setLanguage('${l.code}')" style="background:${isAct ? 'rgba(255,255,255,0.25)' : 'transparent'};color:${isAct ? '#ffffff' : 'var(--muted, #94a3b8)'};border:${isAct ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent'};border-radius:7px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.2s;">
            ${l.label}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// Auto initialize on script load
loadTranslations();
