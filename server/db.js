const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'presentit.db');
const db = new Database(dbPath);

// Enable WAL mode & FK constraints
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize Schema
function initDb() {
  // Reset if old legacy schema with INTEGER id is present
  try {
    const sInfo = db.prepare("PRAGMA table_info(slides)").all().find(c => c.name === 'id');
    if (sInfo && sInfo.type.toUpperCase().includes('INT')) {
      db.exec(`DROP TABLE IF EXISTS slides; DROP TABLE IF EXISTS templates;`);
    }
  } catch (err) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slides (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      slide_type TEXT NOT NULL,
      question TEXT,
      options_json TEXT,
      order_num INTEGER NOT NULL,
      content_text TEXT,
      image_url TEXT,
      FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
    );
  `);

  // Migration checks for templates
  const tCols = db.prepare("PRAGMA table_info(templates)").all().map(c => c.name);
  if (!tCols.includes('description')) {
    db.exec(`ALTER TABLE templates ADD COLUMN description TEXT;`);
  }

  // Migration checks for slides
  const sCols = db.prepare("PRAGMA table_info(slides)").all().map(c => c.name);
  if (!sCols.includes('slide_type')) {
    db.exec(`ALTER TABLE slides ADD COLUMN slide_type TEXT NOT NULL DEFAULT 'text_options';`);
  }
  if (!sCols.includes('question')) {
    db.exec(`ALTER TABLE slides ADD COLUMN question TEXT;`);
  }
  if (!sCols.includes('order_num')) {
    db.exec(`ALTER TABLE slides ADD COLUMN order_num INTEGER DEFAULT 0;`);
  }
  if (!sCols.includes('content_text')) {
    db.exec(`ALTER TABLE slides ADD COLUMN content_text TEXT;`);
  }
  if (!sCols.includes('image_url')) {
    db.exec(`ALTER TABLE slides ADD COLUMN image_url TEXT;`);
  }
  if (!sCols.includes('options_json')) {
    db.exec(`ALTER TABLE slides ADD COLUMN options_json TEXT;`);
  }

  // Seed default template if empty
  const count = db.prepare('SELECT COUNT(*) as count FROM templates').get();
  if (count.count === 0) {
    seedDefaultTemplates();
  }
}

function seedDefaultTemplates() {
  const templateId = uuidv4();
  db.prepare(`
    INSERT INTO templates (id, name, description)
    VALUES (?, ?, ?)
  `).run(templateId, 'Default Wild Presentation', 'A fun default deck filled with absurd questions and prompts!');

  const slides = [
    {
      slide_type: 'predefined',
      question: 'Introduction',
      content_text: 'Welcome to my life-changing presentation! Prepare to be amazed and confused.',
      order_num: 0
    },
    {
      slide_type: 'text_options',
      question: 'What is the secret ingredient to my success?',
      options_json: JSON.stringify(['3 hours of sleep', 'Pure chaos', 'Aggressive nodding', 'Cold iced coffee']),
      order_num: 1
    },
    {
      slide_type: 'photo_options',
      question: 'What best describes my current mental state?',
      options_json: JSON.stringify([
        { id: '1', caption: 'A screaming seagull', image_url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?w=600&auto=format&fit=crop&q=80' },
        { id: '2', caption: 'A chill cat', image_url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=600&auto=format&fit=crop&q=80' },
        { id: '3', caption: 'A confused dog', image_url: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=600&auto=format&fit=crop&q=80' }
      ]),
      order_num: 2
    },
    {
      slide_type: 'photo_and_text',
      question: 'The topic of my presentation is:',
      options_json: JSON.stringify([
        { id: '1', caption: 'Why coffee is actually a complete breakfast', text: 'Why coffee is actually a complete breakfast', image_url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=600&auto=format&fit=crop&q=80' },
        { id: '2', caption: 'How aliens built the pyramids with laser pointers', text: 'How aliens built the pyramids with laser pointers', image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80' }
      ]),
      order_num: 3
    },
    {
      slide_type: 'predefined',
      question: 'Conclusion',
      content_text: 'Thank you for coming to my TED talk. Any questions will be ignored.',
      order_num: 4
    }
  ];

  const insertSlide = db.prepare(`
    INSERT INTO slides (id, template_id, slide_type, question, options_json, order_num, content_text, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  slides.forEach(s => {
    insertSlide.run(
      uuidv4(),
      templateId,
      s.slide_type,
      s.question || '',
      s.options_json || null,
      s.order_num,
      s.content_text || null,
      s.image_url || null
    );
  });
}

// DAO Functions
function getTemplates() {
  const templates = db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
  return templates.map(t => {
    const slides = db.prepare('SELECT * FROM slides WHERE template_id = ? ORDER BY order_num ASC').all(t.id);
    return {
      ...t,
      slides: slides.map(parseSlide)
    };
  });
}

function getTemplate(id) {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!t) return null;
  const slides = db.prepare('SELECT * FROM slides WHERE template_id = ? ORDER BY order_num ASC').all(t.id);
  return {
    ...t,
    slides: slides.map(parseSlide)
  };
}

function parseSlide(s) {
  return {
    id: s.id,
    template_id: s.template_id,
    slide_type: s.slide_type,
    question: s.question,
    options: s.options_json ? JSON.parse(s.options_json) : [],
    order_num: s.order_num,
    content_text: s.content_text,
    image_url: s.image_url
  };
}

function createTemplate(name, description, slides = []) {
  const id = uuidv4();
  const insertT = db.prepare('INSERT INTO templates (id, name, description) VALUES (?, ?, ?)');
  const insertS = db.prepare(`
    INSERT INTO slides (id, template_id, slide_type, question, options_json, order_num, content_text, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertT.run(id, name, description || '');
    slides.forEach((s, idx) => {
      insertS.run(
        uuidv4(),
        id,
        s.slide_type || 'text_options',
        s.question || '',
        s.options ? JSON.stringify(s.options) : null,
        idx,
        s.content_text || null,
        s.image_url || null
      );
    });
  })();

  return getTemplate(id);
}

function updateTemplate(id, name, description, slides = []) {
  const updateT = db.prepare('UPDATE templates SET name = ?, description = ? WHERE id = ?');
  const deleteSlides = db.prepare('DELETE FROM slides WHERE template_id = ?');
  const insertS = db.prepare(`
    INSERT INTO slides (id, template_id, slide_type, question, options_json, order_num, content_text, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    updateT.run(name, description || '', id);
    deleteSlides.run(id);
    slides.forEach((s, idx) => {
      insertS.run(
        uuidv4(),
        id,
        s.slide_type || 'text_options',
        s.question || '',
        s.options ? JSON.stringify(s.options) : null,
        idx,
        s.content_text || null,
        s.image_url || null
      );
    });
  })();

  return getTemplate(id);
}

function deleteTemplate(id) {
  const del = db.prepare('DELETE FROM templates WHERE id = ?');
  const result = del.run(id);
  return result.changes > 0;
}

initDb();

module.exports = {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate
};
