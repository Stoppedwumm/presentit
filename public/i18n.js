// PresentIt Centralized i18n Translation System
const registeredContainers = new Set();
let currentLang = localStorage.getItem('presentit_lang') || 'en';

let TRANSLATIONS = {};

// Shorthand alias
function t(key) {
  return getTranslation(key);
}

// Load full i18n.json dynamically
async function loadTranslations() {
  try {
    const res = await fetch('/i18n.json');
    if (res.ok) {
      TRANSLATIONS = await res.json();
      updatePageTranslations();
    }
  } catch (err) {
    console.error('i18n.json load fallback:', err);
  }
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('presentit_lang', lang);
  updatePageTranslations();
  
  // Re-render all registered language selectors instantly
  registeredContainers.forEach(containerEl => {
    if (containerEl && document.body.contains(containerEl)) {
      renderLangSelector(containerEl);
    }
  });

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
      const translation = getTranslation(key);
      if (translation) el.textContent = translation;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const translation = getTranslation(key);
      if (translation) el.placeholder = translation;
    }
  });

  // Highlight active selector buttons
  document.querySelectorAll('.lang-select-btn').forEach(btn => {
    const isAct = btn.getAttribute('data-lang') === currentLang;
    btn.classList.toggle('active', isAct);
    btn.style.background = isAct ? 'rgba(255,255,255,0.25)' : 'transparent';
    btn.style.color = isAct ? '#ffffff' : 'var(--muted, #94a3b8)';
    btn.style.border = isAct ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent';
  });
}

function renderLangSelector(container) {
  let targetEl = container;
  if (typeof container === 'string') {
    targetEl = document.getElementById(container);
  }
  if (!targetEl) return;

  registeredContainers.add(targetEl);

  const languages = [
    { code: 'en', label: '🇬🇧 EN' },
    { code: 'de', label: '🇩🇪 DE' },
    { code: 'fr', label: '🇫🇷 FR' },
    { code: 'zh', label: '🇨🇳 中文' }
  ];

  targetEl.innerHTML = `
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

// Sync across tabs / windows
window.addEventListener('storage', (e) => {
  if (e.key === 'presentit_lang' && e.newValue && e.newValue !== currentLang) {
    currentLang = e.newValue;
    updatePageTranslations();
    registeredContainers.forEach(containerEl => {
      if (containerEl && document.body.contains(containerEl)) {
        renderLangSelector(containerEl);
      }
    });
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: currentLang } }));
  }
});

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  updatePageTranslations();
});

// Load JSON
loadTranslations();

