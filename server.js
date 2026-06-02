const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Armazenador de sessões persistente no SQLite
const SqliteStore = (() => {
  const Store = session.Store;
  return class extends Store {
    constructor(database) {
      super();
      this.db = database;
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expired TEXT NOT NULL
        )
      `);
      // Limpa sessões expiradas na inicialização
      this.db.exec('DELETE FROM sessions WHERE datetime("now") > expired');
    }
    get(sid, cb) {
      try {
        const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND datetime("now") <= expired').get(sid);
        if (!row) return cb(null, null);
        cb(null, JSON.parse(row.sess));
      } catch (err) {
        cb(err);
      }
    }
    set(sid, sess, cb) {
      try {
        const expired = new Date(sess.cookie.expires || (Date.now() + 7 * 24 * 60 * 60 * 1000)).toISOString();
        const sessStr = JSON.stringify(sess);
        this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, sessStr, expired);
        cb(null);
      } catch (err) {
        cb(err);
      }
    }
    destroy(sid, cb) {
      try {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        cb(null);
      } catch (err) {
        cb(err);
      }
    }
  };
})();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SqliteStore(db),
  secret: process.env.SESSION_SECRET || 'eng-hub-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, String(req.params.projectId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  next();
}

function logActivity(userId, projectId, action, details = '') {
  db.prepare(
    'INSERT INTO activity (project_id, user_id, action, details) VALUES (?, ?, ?, ?)'
  ).run(projectId, userId, action, details);
}

function formatFile(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    uploadedBy: row.uploader_name,
    uploadedAt: row.uploaded_at
  };
}

function formatProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clientToken: row.client_token,
    createdBy: row.creator_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileCount: row.file_count || 0
  };
}

// --- Auth ---

app.get('/api/auth/check', (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  const user = db.prepare('SELECT id, username, email, phone FROM users WHERE id = ?')
    .get(req.session.userId);
  res.json({ authenticated: true, user });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, email, phone } = req.body;

  if (!username || !password || !email || !phone) {
    return res.status(400).json({ error: 'Preencha login, senha, e-mail e telefone' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }

  const existing = db.prepare(
    'SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ?'
  ).get(username.trim(), email.trim().toLowerCase());

  if (existing) {
    return res.status(409).json({ error: 'Login ou e-mail já cadastrado' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, email, phone) VALUES (?, ?, ?, ?)'
  ).run(username.trim(), hash, email.trim().toLowerCase(), phone.trim());

  req.session.userId = result.lastInsertRowid;
  logActivity(result.lastInsertRowid, null, 'register', `Usuário ${username} cadastrado`);

  res.status(201).json({
    message: 'Cadastro realizado com sucesso',
    user: { id: result.lastInsertRowid, username: username.trim(), email, phone }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Informe login e senha' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Login ou senha incorretos' });
  }

  req.session.userId = user.id;
  res.json({
    user: { id: user.id, username: user.username, email: user.email, phone: user.phone }
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logout realizado' });
  });
});

// --- Password Recovery ---

app.post('/api/auth/forgot-password', (req, res) => {
  const { identifier } = req.body;

  if (!identifier || !identifier.trim()) {
    return res.status(400).json({ error: 'Informe seu e-mail, telefone ou usuário' });
  }

  const cleanIdentifier = identifier.trim();
  const user = db.prepare(
    'SELECT id, username, email, phone FROM users WHERE email = ? OR phone = ? OR username = ? COLLATE NOCASE'
  ).get(cleanIdentifier, cleanIdentifier, cleanIdentifier);

  if (!user) {
    return res.status(404).json({ error: 'Nenhum usuário encontrado com os dados informados' });
  }

  // Gera um código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // Salva no banco com 15 minutos de validade
  db.prepare(
    "UPDATE users SET reset_code = ?, reset_expires = datetime('now', '+15 minutes') WHERE id = ?"
  ).run(code, user.id);

  // Simulação de envio (log no console do servidor e resposta de sucesso)
  console.log(`\n======================================================`);
  console.log(`[SIMULAÇÃO] Código de redefinição de senha para ${user.username}: ${code}`);
  console.log(`======================================================\n`);

  logActivity(user.id, null, 'forgot_password', `Código de recuperação gerado para ${user.username}`);

  res.json({
    message: `Código enviado com sucesso! (Simulado: ${code})`,
    code: code // Retornando o código para testes rápidos no frontend
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { identifier, code, newPassword } = req.body;

  if (!identifier || !code || !newPassword) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  const cleanIdentifier = identifier.trim();
  const cleanCode = code.trim();

  // Procura o usuário que tenha o código correspondente e ainda esteja dentro da validade
  const user = db.prepare(`
    SELECT * FROM users
    WHERE (email = ? OR phone = ? OR username = ?)
      AND reset_code = ?
      AND datetime('now') < reset_expires
  `).get(cleanIdentifier, cleanIdentifier, cleanIdentifier, cleanCode);

  if (!user) {
    return res.status(400).json({ error: 'Código de verificação inválido ou expirado' });
  }

  // Atualiza a senha e limpa o código
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(
    "UPDATE users SET password_hash = ?, reset_code = NULL, reset_expires = NULL WHERE id = ?"
  ).run(hash, user.id);

  logActivity(user.id, null, 'reset_password', `Senha redefinida para ${user.username}`);

  res.json({ message: 'Senha redefinida com sucesso!' });
});

// --- Projects ---

app.get('/api/projects', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.username AS creator_name,
      (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
    FROM projects p
    JOIN users u ON u.id = p.created_by
    ORDER BY p.updated_at DESC
  `).all();

  res.json(rows.map(formatProject));
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
  }

  const token = uuidv4();
  const result = db.prepare(
    'INSERT INTO projects (name, description, client_token, created_by) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), (description || '').trim(), token, req.session.userId);

  logActivity(req.session.userId, result.lastInsertRowid, 'project_create', name.trim());

  const row = db.prepare(`
    SELECT p.*, u.username AS creator_name, 0 AS file_count
    FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(formatProject(row));
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT p.*, u.username AS creator_name,
      (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
    FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Projeto não encontrado' });
  res.json(formatProject(row));
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { name, description } = req.body;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  db.prepare(`
    UPDATE projects SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    (name || project.name).trim(),
    description !== undefined ? description.trim() : project.description,
    req.params.id
  );

  logActivity(req.session.userId, project.id, 'project_update', name || project.name);

  const row = db.prepare(`
    SELECT p.*, u.username AS creator_name,
      (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
    FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = ?
  `).get(req.params.id);

  res.json(formatProject(row));
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const files = db.prepare('SELECT stored_name FROM files WHERE project_id = ?').all(req.params.id);
  const dir = path.join(UPLOAD_DIR, String(req.params.id));

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  logActivity(req.session.userId, null, 'project_delete', project.name);
  res.json({ message: 'Projeto excluído' });
});

app.post('/api/projects/:id/regenerate-link', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const token = uuidv4();
  db.prepare('UPDATE projects SET client_token = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(token, req.params.id);

  logActivity(req.session.userId, project.id, 'link_regenerate', project.name);
  res.json({ clientToken: token });
});

// --- Files ---

app.get('/api/projects/:projectId/files', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.username AS uploader_name
    FROM files f JOIN users u ON u.id = f.uploaded_by
    WHERE f.project_id = ?
    ORDER BY f.uploaded_at DESC
  `).all(req.params.projectId);

  res.json(rows.map(formatFile));
});

app.post('/api/projects/:projectId/files', requireAuth, upload.single('file'), (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const result = db.prepare(`
    INSERT INTO files (project_id, original_name, stored_name, mime_type, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.params.projectId,
    req.file.originalname,
    req.file.filename,
    req.file.mimetype,
    req.file.size,
    req.session.userId
  );

  db.prepare('UPDATE projects SET updated_at = datetime(\'now\') WHERE id = ?')
    .run(req.params.projectId);

  logActivity(req.session.userId, project.id, 'file_upload', req.file.originalname);

  const row = db.prepare(`
    SELECT f.*, u.username AS uploader_name FROM files f
    JOIN users u ON u.id = f.uploaded_by WHERE f.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(formatFile(row));
});

app.get('/api/projects/:projectId/files/:fileId/download', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?')
    .get(req.params.fileId, req.params.projectId);

  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

  const filePath = path.join(UPLOAD_DIR, String(req.params.projectId), file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no disco' });

  res.download(filePath, file.original_name);
});

app.delete('/api/projects/:projectId/files/:fileId', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?')
    .get(req.params.fileId, req.params.projectId);

  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

  const filePath = path.join(UPLOAD_DIR, String(req.params.projectId), file.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);
  db.prepare('UPDATE projects SET updated_at = datetime(\'now\') WHERE id = ?')
    .run(req.params.projectId);

  logActivity(req.session.userId, req.params.projectId, 'file_delete', file.original_name);
  res.json({ message: 'Arquivo excluído' });
});

// --- Activity feed (for real-time sync) ---

app.get('/api/activity', requireAuth, (req, res) => {
  const since = req.query.since || '1970-01-01';
  const rows = db.prepare(`
    SELECT a.*, u.username, p.name AS project_name
    FROM activity a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.created_at > ?
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all(since);

  res.json(rows);
});

app.get('/api/sync', requireAuth, (req, res) => {
  const since = req.query.since || '1970-01-01';

  const projects = db.prepare(`
    SELECT p.*, u.username AS creator_name,
      (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
    FROM projects p
    JOIN users u ON u.id = p.created_by
    WHERE p.updated_at > ?
    ORDER BY p.updated_at DESC
  `).all(since);

  const activity = db.prepare(`
    SELECT a.*, u.username, p.name AS project_name
    FROM activity a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.created_at > ?
    ORDER BY a.created_at DESC LIMIT 20
  `).all(since);

  res.json({
    projects: projects.map(formatProject),
    activity,
    timestamp: new Date().toISOString()
  });
});

// --- Client view (read-only, no auth) ---

app.get('/api/client/:token', (req, res) => {
  const project = db.prepare(`
    SELECT p.id, p.name, p.description, p.updated_at
    FROM projects p WHERE p.client_token = ?
  `).get(req.params.token);

  if (!project) return res.status(404).json({ error: 'Link inválido ou expirado' });

  const files = db.prepare(`
    SELECT f.id, f.original_name, f.mime_type, f.size, f.uploaded_at, u.username AS uploaded_by
    FROM files f JOIN users u ON u.id = f.uploaded_by
    WHERE f.project_id = ?
    ORDER BY f.uploaded_at DESC
  `).all(project.id);

  res.json({
    project: {
      name: project.name,
      description: project.description,
      updatedAt: project.updated_at
    },
    files
  });
});

app.get('/api/client/:token/files/:fileId/download', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE client_token = ?')
    .get(req.params.token);
  if (!project) return res.status(404).json({ error: 'Link inválido' });

  const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?')
    .get(req.params.fileId, project.id);
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

  const filePath = path.join(UPLOAD_DIR, String(project.id), file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });

  res.download(filePath, file.original_name);
});

// --- SPA routes ---

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/client/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

app.listen(PORT, () => {
  console.log(`Eng-Hub rodando em http://localhost:${PORT}`);
});
