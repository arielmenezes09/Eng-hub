const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool, initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const cors = require('cors');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));

app.set('trust proxy', 1);
app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'eng-hub-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
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

// --- Middlewares ---

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  next();
}

async function requireProjectAccess(req, res, next) {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) return res.status(400).json({ error: 'ID do projeto não informado' });

  try {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    const project = rows[0];
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const userId = req.session.userId;

    // Criador sempre tem acesso
    if (project.created_by === userId) {
      req.project = project;
      return next();
    }

    // Verifica se é membro do projeto
    const memberCheck = await pool.query(
      'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Você não tem acesso a este projeto' });
    }

    req.project = project;
    next();
  } catch (err) {
    console.error('Erro no requireProjectAccess:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

// --- Helpers ---

async function logActivity(userId, projectId, action, details = '') {
  await pool.query(
    'INSERT INTO activity (project_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
    [projectId, userId, action, details]
  );
}

async function getProjectMembers(projectId) {
  const { rows } = await pool.query(`
    SELECT u.id, u.username FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = $1
    ORDER BY pm.added_at ASC
  `, [projectId]);
  return rows;
}

async function setProjectMembers(projectId, memberIds) {
  // Remove existing members
  await pool.query('DELETE FROM project_members WHERE project_id = $1', [projectId]);

  // Insert new members (max 8)
  const validIds = memberIds.slice(0, 8);
  for (const userId of validIds) {
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (rows.length > 0) {
      await pool.query(
        'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [projectId, userId]
      );
    }
  }
}

function formatFile(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    uploadedBy: row.uploader_name,
    uploadedAt: row.uploaded_at
  };
}

async function formatProject(row) {
  const members = await getProjectMembers(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clientToken: row.client_token,
    createdBy: row.creator_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileCount: Number(row.file_count) || 0,
    members
  };
}

// --- Auth ---

app.get('/api/auth/check', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, phone FROM users WHERE id = $1', [req.session.userId]
    );
    res.json({ authenticated: true, user: rows[0] });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/register', async (req, res) => {
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

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [username.trim(), email.trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Login ou e-mail já cadastrado' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, email, phone) VALUES ($1, $2, $3, $4) RETURNING id',
      [username.trim(), hash, email.trim().toLowerCase(), phone.trim()]
    );

    const userId = result.rows[0].id;
    req.session.userId = userId;
    await logActivity(userId, null, 'register', `Usuário ${username} cadastrado`);

    res.status(201).json({
      message: 'Cadastro realizado com sucesso',
      user: { id: userId, username: username.trim(), email, phone }
    });
  } catch (err) {
    console.error('Erro no registro:', err);
    res.status(500).json({ error: 'Erro interno ao registrar' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Informe login e senha' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]
    );
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Login ou senha incorretos' });
    }

    req.session.userId = user.id;
    res.json({
      user: { id: user.id, username: user.username, email: user.email, phone: user.phone }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logout realizado' });
  });
});

// --- Password Recovery ---

app.post('/api/auth/forgot-password', async (req, res) => {
  const { identifier } = req.body;

  if (!identifier || !identifier.trim()) {
    return res.status(400).json({ error: 'Informe seu e-mail, telefone ou usuário' });
  }

  try {
    const cleanId = identifier.trim();
    const { rows } = await pool.query(
      'SELECT id, username, email, phone FROM users WHERE LOWER(email) = LOWER($1) OR phone = $2 OR LOWER(username) = LOWER($3)',
      [cleanId, cleanId, cleanId]
    );
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Nenhum usuário encontrado com os dados informados' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      "UPDATE users SET reset_code = $1, reset_expires = NOW() + INTERVAL '15 minutes' WHERE id = $2",
      [code, user.id]
    );

    console.log(`\n======================================================`);
    console.log(`[SIMULAÇÃO] Código de redefinição de senha para ${user.username}: ${code}`);
    console.log(`======================================================\n`);

    await logActivity(user.id, null, 'forgot_password', `Código de recuperação gerado para ${user.username}`);

    res.json({
      message: `Código enviado com sucesso! (Simulado: ${code})`,
      code: code
    });
  } catch (err) {
    console.error('Erro no forgot-password:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { identifier, code, newPassword } = req.body;

  if (!identifier || !code || !newPassword) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const cleanId = identifier.trim();
    const cleanCode = code.trim();

    const { rows } = await pool.query(`
      SELECT * FROM users
      WHERE (LOWER(email) = LOWER($1) OR phone = $2 OR LOWER(username) = LOWER($3))
        AND reset_code = $4
        AND NOW() < reset_expires
    `, [cleanId, cleanId, cleanId, cleanCode]);

    const user = rows[0];
    if (!user) {
      return res.status(400).json({ error: 'Código de verificação inválido ou expirado' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [hash, user.id]
    );

    await logActivity(user.id, null, 'reset_password', `Senha redefinida para ${user.username}`);
    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch (err) {
    console.error('Erro no reset-password:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- Users (search for adding members) ---

app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 1) return res.json([]);

  try {
    const { rows } = await pool.query(
      'SELECT id, username FROM users WHERE username ILIKE $1 ORDER BY username ASC LIMIT 10',
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

// --- Project Members ---

app.get('/api/projects/:id/members', requireAuth, requireProjectAccess, async (req, res) => {
  const members = await getProjectMembers(req.params.id);
  res.json(members);
});

app.put('/api/projects/:id/members', requireAuth, requireProjectAccess, async (req, res) => {
  const { memberIds } = req.body;
  const project = req.project;

  if (!Array.isArray(memberIds)) {
    return res.status(400).json({ error: 'memberIds deve ser um array' });
  }
  if (memberIds.length > 8) {
    return res.status(400).json({ error: 'Máximo de 8 responsáveis por projeto' });
  }

  try {
    await setProjectMembers(req.params.id, memberIds);
    await pool.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [req.params.id]);
    await logActivity(req.session.userId, project.id, 'members_update', project.name);

    const members = await getProjectMembers(req.params.id);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar membros' });
  }
});

// --- Projects ---

app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { rows } = await pool.query(`
      SELECT p.*, u.username AS creator_name,
        (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
      FROM projects p
      JOIN users u ON u.id = p.created_by
      WHERE p.created_by = $1
        OR p.id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = $2)
      ORDER BY p.updated_at DESC
    `, [userId, userId]);

    const projects = await Promise.all(rows.map(formatProject));
    res.json(projects);
  } catch (err) {
    console.error('Erro ao listar projetos:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  const { name, description, memberIds } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
  }

  try {
    const token = uuidv4();
    const result = await pool.query(
      'INSERT INTO projects (name, description, client_token, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [name.trim(), (description || '').trim(), token, req.session.userId]
    );
    const projectId = result.rows[0].id;

    // Sempre adiciona o criador como membro + os membros informados
    const allMemberIds = Array.isArray(memberIds) ? [...memberIds] : [];
    if (!allMemberIds.includes(req.session.userId)) {
      allMemberIds.unshift(req.session.userId);
    }
    await setProjectMembers(projectId, allMemberIds);

    await logActivity(req.session.userId, projectId, 'project_create', name.trim());

    const { rows } = await pool.query(`
      SELECT p.*, u.username AS creator_name, 0 AS file_count
      FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = $1
    `, [projectId]);

    res.status(201).json(await formatProject(rows[0]));
  } catch (err) {
    console.error('Erro ao criar projeto:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/projects/:id', requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.username AS creator_name,
        (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
      FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = $1
    `, [req.params.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Projeto não encontrado' });
    res.json(await formatProject(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.put('/api/projects/:id', requireAuth, requireProjectAccess, async (req, res) => {
  const { name, description, memberIds } = req.body;
  const project = req.project;

  try {
    await pool.query(
      'UPDATE projects SET name = $1, description = $2, updated_at = NOW() WHERE id = $3',
      [
        (name || project.name).trim(),
        description !== undefined ? description.trim() : project.description,
        req.params.id
      ]
    );

    if (Array.isArray(memberIds)) {
      await setProjectMembers(req.params.id, memberIds);
    }

    await logActivity(req.session.userId, project.id, 'project_update', name || project.name);

    const { rows } = await pool.query(`
      SELECT p.*, u.username AS creator_name,
        (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
      FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = $1
    `, [req.params.id]);

    res.json(await formatProject(rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar projeto:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.delete('/api/projects/:id', requireAuth, requireProjectAccess, async (req, res) => {
  const project = req.project;

  try {
    const dir = path.join(UPLOAD_DIR, String(req.params.id));
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    await logActivity(req.session.userId, null, 'project_delete', project.name);
    res.json({ message: 'Projeto excluído' });
  } catch (err) {
    console.error('Erro ao excluir projeto:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/projects/:id/regenerate-link', requireAuth, requireProjectAccess, async (req, res) => {
  const project = req.project;

  try {
    const token = uuidv4();
    await pool.query(
      'UPDATE projects SET client_token = $1, updated_at = NOW() WHERE id = $2',
      [token, req.params.id]
    );

    await logActivity(req.session.userId, project.id, 'link_regenerate', project.name);
    res.json({ clientToken: token });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- Files ---

app.get('/api/projects/:projectId/files', requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.*, u.username AS uploader_name
      FROM files f JOIN users u ON u.id = f.uploaded_by
      WHERE f.project_id = $1
      ORDER BY f.uploaded_at DESC
    `, [req.params.projectId]);

    res.json(rows.map(formatFile));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/projects/:projectId/files', requireAuth, requireProjectAccess, upload.single('file'), async (req, res) => {
  const project = req.project;
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  try {
    const result = await pool.query(`
      INSERT INTO files (project_id, original_name, stored_name, mime_type, size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [
      req.params.projectId,
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      req.session.userId
    ]);

    await pool.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [req.params.projectId]);
    await logActivity(req.session.userId, project.id, 'file_upload', req.file.originalname);

    const { rows } = await pool.query(`
      SELECT f.*, u.username AS uploader_name FROM files f
      JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1
    `, [result.rows[0].id]);

    res.status(201).json(formatFile(rows[0]));
  } catch (err) {
    console.error('Erro no upload:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/projects/:projectId/files/:fileId/download', requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND project_id = $2',
      [req.params.fileId, req.params.projectId]
    );
    const file = rows[0];
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const filePath = path.join(UPLOAD_DIR, String(req.params.projectId), file.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no disco' });

    res.download(filePath, file.original_name);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.delete('/api/projects/:projectId/files/:fileId', requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND project_id = $2',
      [req.params.fileId, req.params.projectId]
    );
    const file = rows[0];
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const filePath = path.join(UPLOAD_DIR, String(req.params.projectId), file.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await pool.query('DELETE FROM files WHERE id = $1', [req.params.fileId]);
    await pool.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [req.params.projectId]);
    await logActivity(req.session.userId, parseInt(req.params.projectId), 'file_delete', file.original_name);

    res.json({ message: 'Arquivo excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- Activity feed ---

app.get('/api/activity', requireAuth, async (req, res) => {
  try {
    const since = req.query.since || '1970-01-01';
    const { rows } = await pool.query(`
      SELECT a.*, u.username, p.name AS project_name
      FROM activity a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.created_at > $1
      ORDER BY a.created_at DESC
      LIMIT 50
    `, [since]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/sync', requireAuth, async (req, res) => {
  try {
    const since = req.query.since || '1970-01-01';
    const userId = req.session.userId;

    const projectsResult = await pool.query(`
      SELECT p.*, u.username AS creator_name,
        (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
      FROM projects p
      JOIN users u ON u.id = p.created_by
      WHERE p.updated_at > $1
        AND (p.created_by = $2 OR p.id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = $3))
      ORDER BY p.updated_at DESC
    `, [since, userId, userId]);

    const activityResult = await pool.query(`
      SELECT a.*, u.username, p.name AS project_name
      FROM activity a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.created_at > $1
      ORDER BY a.created_at DESC LIMIT 20
    `, [since]);

    const projects = await Promise.all(projectsResult.rows.map(formatProject));

    res.json({
      projects,
      activity: activityResult.rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- Client view (read-only, no auth) ---

app.get('/api/client/:token', async (req, res) => {
  try {
    const { rows: projectRows } = await pool.query(
      'SELECT id, name, description, updated_at FROM projects WHERE client_token = $1',
      [req.params.token]
    );
    const project = projectRows[0];
    if (!project) return res.status(404).json({ error: 'Link inválido ou expirado' });

    const { rows: fileRows } = await pool.query(`
      SELECT f.id, f.original_name, f.mime_type, f.size, f.uploaded_at, u.username AS uploaded_by
      FROM files f JOIN users u ON u.id = f.uploaded_by
      WHERE f.project_id = $1
      ORDER BY f.uploaded_at DESC
    `, [project.id]);

    res.json({
      project: {
        name: project.name,
        description: project.description,
        updatedAt: project.updated_at
      },
      files: fileRows
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/client/:token/files/:fileId/download', async (req, res) => {
  try {
    const { rows: projectRows } = await pool.query(
      'SELECT id FROM projects WHERE client_token = $1', [req.params.token]
    );
    if (!projectRows[0]) return res.status(404).json({ error: 'Link inválido' });

    const { rows: fileRows } = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND project_id = $2',
      [req.params.fileId, projectRows[0].id]
    );
    const file = fileRows[0];
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const filePath = path.join(UPLOAD_DIR, String(projectRows[0].id), file.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });

    res.download(filePath, file.original_name);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- SPA routes ---

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/client/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// --- Start server ---

async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Eng-Hub rodando em http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Erro ao iniciar o servidor:', err);
    process.exit(1);
  }
}

startServer();
