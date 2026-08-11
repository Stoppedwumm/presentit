// PresentIt Centralized i18n Translation System
const registeredContainers = new Set();
let currentLang = localStorage.getItem('presentit_lang') || 'en';

// Inline synchronous fallback dictionary to prevent blank keys before fetch completes
let TRANSLATIONS = {
  en: {
    app_title: "PresentIt",
    tagline: "Where presentations get wild",
    host_game: "Host a Game",
    join_game: "Join a Game",
    room_code: "Room Code",
    enter_code: "Enter 4-letter code",
    enter_name: "Enter your name",
    join_button: "Join Game",
    admin_title: "Admin (Template Builder)",
    select_presenter: "👑 Make Presenter",
    start_game: "Start Game",
    play_again: "🔄 Play Again (Same Room & Players)",
    change_presentation: "📑 Change Presentation",
    back: "Back",
    create_template: "+ Create Template"
  },
  de: {
    app_title: "PresentIt",
    tagline: "Wo Präsentationen verrückt werden",
    host_game: "Spiel Hosten",
    join_game: "Spiel Beitreten",
    room_code: "Raumcode",
    enter_code: "4-stelligen Code eingeben",
    enter_name: "Gib deinen Namen ein",
    join_button: "Spiel Beitreten",
    admin_title: "Admin (Vorlagen-Editor)",
    select_presenter: "👑 Als Präsentator wählen",
    start_game: "Spiel Starten",
    play_again: "🔄 Noch einmal spielen (Gleicher Raum)",
    change_presentation: "📑 Präsentation wechseln",
    back: "Zurück",
    create_template: "+ Vorlage erstellen"
  },
  fr: {
    app_title: "PresentIt",
    tagline: "Quand les présentations deviennent folles",
    host_game: "Héberger une partie",
    join_game: "Rejoindre une partie",
    room_code: "Code de salle",
    enter_code: "Entrez le code à 4 lettres",
    enter_name: "Entrez votre nom",
    join_button: "Rejoindre le jeu",
    admin_title: "Admin (Créateur de modèles)",
    select_presenter: "👑 Désigner présentateur",
    start_game: "Commencer le jeu",
    play_again: "🔄 Rejouer (Même salle)",
    change_presentation: "📑 Changer de présentation",
    back: "Retour",
    create_template: "+ Créer un modèle"
  },
  zh: {
    app_title: "PresentIt",
    tagline: "让演示变得狂野搞笑",
    host_game: "主持游戏",
    join_game: "加入游戏",
    room_code: "房间代码",
    enter_code: "输入4位房间代码",
    enter_name: "输入你的名字",
    join_button: "加入游戏",
    admin_title: "管理员（模板生成器）",
    select_presenter: "👑 设为演示者",
    start_game: "开始游戏",
    play_again: "🔄 再玩一次（相同房间）",
    change_presentation: "📑 更换演示模板",
    back: "返回",
    create_template: "+ 创建模板"
  }
};

// Load full i18n.json dynamically
async function loadTranslations() {
  try {
    const res = await fetch('/i18n.json');
    if (res.ok) {
      const data = await res.json();
      TRANSLATIONS = data;
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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  updatePageTranslations();
});

// Load JSON
loadTranslations();
