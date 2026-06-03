let currentUser = null;
let projects = [];
let currentProject = null;
let files = [];
let lastSync = new Date().toISOString();
let syncTimer = null;
let selectedMembers = []; // { id, username }
let searchTimeout = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: isForm ? options.headers : { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Não autenticado');
  }
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso.includes('Z') ? iso : iso + 'Z').toLocaleString('pt-BR');
}

function fileExt(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'arq';
  return ext.length > 4 ? 'arq' : ext;
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function actionLabel(action, details) {
  const labels = {
    register: 'cadastrou-se',
    project_create: `criou o projeto "${details}"`,
    project_update: `atualizou "${details}"`,
    project_delete: `excluiu "${details}"`,
    file_upload: `enviou "${details}"`,
    file_delete: `removeu "${details}"`,
    link_regenerate: `gerou novo link para "${details}"`
  };
  return labels[action] || action;
}

async function init() {
  try {
    const auth = await api('/api/auth/check');
    if (!auth.authenticated) {
      window.location.href = '/';
      return;
    }
    currentUser = auth.user;
    $('#user-info').textContent = currentUser.username;

    await loadProjects();
    await loadActivity();
    startSync();
    bindEvents();
  } catch (err) {
    console.error('Erro ao inicializar:', err);
  }
}

async function loadProjects() {
  try {
    projects = await api('/api/projects');
    renderProjectList();
  } catch (err) {
    console.error('Erro ao carregar projetos:', err);
  }
}

function getFilteredProjects() {
  const filterStatus = $('#filter-status');
  const filterDeadline = $('#filter-deadline');
  const status = filterStatus ? filterStatus.value : '';
  const deadline = filterDeadline ? filterDeadline.value : '';
  return projects.filter(p => {
    const matchStatus = !status || (p.status === status);
    const matchDeadline = !deadline || (p.deadline && p.deadline.split('T')[0] <= deadline);
    return matchStatus && matchDeadline;
  });
}

function renderProjectList() {
  const list = $('#project-list');
  if (!list) return;
  const filtered = getFilteredProjects();
  if (!filtered.length) {
    list.innerHTML = '<li style="padding:1rem;color:var(--text-muted);font-size:0.85rem">Nenhum projeto ainda</li>';
    return;
  }
  list.innerHTML = filtered.map(p => `
    <li class="project-item ${currentProject?.id === p.id ? 'active' : ''}" data-id="${p.id}">
      <div class="project-item__name">${escapeHtml(p.name)}</div>
      <div class="project-item__meta">
        ${p.fileCount} arquivo(s) · ${formatDate(p.updatedAt)}
        ${p.status ? '· ' + escapeHtml(p.status) : ''}
        ${p.deadline ? '· Até ' + formatDate(p.deadline) : ''}
      </div>
    </li>
  `).join('');

  list.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => selectProject(Number(item.dataset.id)));
  });
}

async function selectProject(id) {
  currentProject = projects.find(p => p.id === id);
  if (!currentProject) return;

  const emptyState = $('#empty-state');
  const projectView = $('#project-view');
  if (emptyState) emptyState.classList.add('hidden');
  if (projectView) projectView.classList.remove('hidden');

  const nameEl = $('#project-name');
  const descEl = $('#project-desc');
  if (nameEl) nameEl.textContent = currentProject.name;
  if (descEl) descEl.textContent = currentProject.description || 'Sem descrição';

  renderProjectMembers(currentProject.members || []);

  const sidebar = $('.sidebar');
  const overlay = $('#sidebar-overlay');
  if (sidebar) sidebar.classList.remove('sidebar--open');
  if (overlay) overlay.classList.remove('active');

  renderProjectList();
  await loadFiles();
}

async function loadFiles() {
  if (!currentProject) return;
  try {
    files = await api(`/api/projects/${currentProject.id}/files`);
    renderFiles();
  } catch (err) {
    console.error('Erro ao carregar arquivos:', err);
  }
}

function renderFiles(filter = '') {
  const q = filter.toLowerCase();
  const filtered = q ? files.filter(f => f.originalName.toLowerCase().includes(q)) : files;

  const countEl = $('#file-count');
  if (countEl) countEl.textContent = filtered.length;
  const list = $('#file-list');
  if (!list) return;

  if (!filtered.length) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem">Nenhum arquivo neste projeto</p>';
    return;
  }

  list.innerHTML = filtered.map(f => `
    <div class="file-item" data-id="${f.id}">
      <span class="file-item__icon">${escapeHtml(fileExt(f.originalName))}</span>
      <div class="file-item__info">
        <div class="file-item__name" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</div>
        <div class="file-item__meta">${formatSize(f.size)} · ${escapeHtml(f.uploadedBy)} · ${formatDate(f.uploadedAt)}</div>
      </div>
      <div class="file-item__actions">
        <a href="/api/projects/${currentProject.id}/files/${f.id}/download" class="btn btn--outline btn--sm">Baixar</a>
        <button type="button" class="btn btn--danger btn--sm btn-delete-file" data-id="${f.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.btn-delete-file').forEach(btn => {
    btn.addEventListener('click', () => deleteFile(Number(btn.dataset.id)));
  });
}

async function loadActivity() {
  try {
    const items = await api('/api/activity');
    renderActivity(items);
  } catch (err) {
    console.error('Erro ao carregar atividade:', err);
  }
}

function renderActivity(items) {
  const feed = $('#activity-feed');
  if (!feed) return;
  if (!items.length) {
    feed.innerHTML = '<li>Nenhuma atividade</li>';
    return;
  }
  feed.innerHTML = items.slice(0, 10).map(a => `
    <li><strong>${escapeHtml(a.username)}</strong> ${actionLabel(a.action, a.details)}<br><small>${formatDate(a.created_at)}</small></li>
  `).join('');
}

function startSync() {
  syncTimer = setInterval(async () => {
    try {
      const data = await api(`/api/sync?since=${encodeURIComponent(lastSync)}`);
      lastSync = data.timestamp;

      if (data.projects.length) {
        const prevId = currentProject?.id;
        projects = await api('/api/projects');
        renderProjectList();
        if (prevId) {
          currentProject = projects.find(p => p.id === prevId);
          if (currentProject) await loadFiles();
        }
      }

      if (data.activity.length) {
        const all = await api('/api/activity');
        renderActivity(all);
      }
    } catch (_) { /* ignore sync errors */ }
  }, 5000);
}

// --- Members rendering & autocomplete ---

function renderProjectMembers(members) {
  const list = $('#project-members-list');
  const count = $('#members-count');
  if (!list) return;

  if (count) count.textContent = members.length;

  if (!members.length) {
    list.innerHTML = '<span class="project-members-list--empty">Nenhum responsável atribuído</span>';
    return;
  }

  list.innerHTML = members.map(m => `
    <span class="member-chip">
      <span class="member-chip__avatar">${escapeHtml(m.username.charAt(0).toUpperCase())}</span>
      ${escapeHtml(m.username)}
    </span>
  `).join('');
}

function renderSelectedMembers() {
  const container = $('#members-selected');
  if (!container) return;

  container.innerHTML = selectedMembers.map(m => `
    <span class="member-tag" data-id="${m.id}">
      ${escapeHtml(m.username)}
      <button type="button" data-remove-id="${m.id}" title="Remover">&times;</button>
    </span>
  `).join('');

  // Bind remove buttons
  container.querySelectorAll('button[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.removeId);
      selectedMembers = selectedMembers.filter(m => m.id !== id);
      renderSelectedMembers();
    });
  });

  // Update placeholder
  const input = $('#members-search-input');
  if (input) {
    input.placeholder = selectedMembers.length >= 8 ? 'Limite atingido (8)' : 'Buscar usuário cadastrado...';
    input.disabled = selectedMembers.length >= 8;
  }
}

async function searchUsers(query) {
  if (!query || query.length < 1) {
    hideMembersSuggestions();
    return;
  }

  try {
    const users = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
    // Filter out already selected members
    const filtered = users.filter(u => !selectedMembers.some(m => m.id === u.id));
    showMembersSuggestions(filtered);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
  }
}

function showMembersSuggestions(users) {
  const list = $('#members-suggestions');
  if (!list) return;

  if (!users.length) {
    list.innerHTML = '<li style="pointer-events:none;color:var(--text-muted)">Nenhum usuário encontrado</li>';
    list.classList.remove('hidden');
    return;
  }

  list.innerHTML = users.map(u => `
    <li data-user-id="${u.id}" data-username="${escapeHtml(u.username)}">
      <span class="suggestion-avatar">${escapeHtml(u.username.charAt(0).toUpperCase())}</span>
      ${escapeHtml(u.username)}
    </li>
  `).join('');

  list.classList.remove('hidden');

  // Bind click
  list.querySelectorAll('li[data-user-id]').forEach(item => {
    item.addEventListener('click', () => {
      const id = Number(item.dataset.userId);
      const username = item.dataset.username;
      if (selectedMembers.length < 8 && !selectedMembers.some(m => m.id === id)) {
        selectedMembers.push({ id, username });
        renderSelectedMembers();
      }
      const input = $('#members-search-input');
      if (input) input.value = '';
      hideMembersSuggestions();
    });
  });
}

function hideMembersSuggestions() {
  const list = $('#members-suggestions');
  if (list) {
    list.classList.add('hidden');
    list.innerHTML = '';
  }
}

function bindMembersInput() {
  const input = $('#members-search-input');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 1) {
      hideMembersSuggestions();
      return;
    }
    searchTimeout = setTimeout(() => searchUsers(q), 250);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && selectedMembers.length > 0) {
      selectedMembers.pop();
      renderSelectedMembers();
    }
    if (e.key === 'Escape') {
      hideMembersSuggestions();
    }
  });

  // Close suggestions on outside click
  document.addEventListener('click', (e) => {
    const wrapper = e.target.closest('.members-input-wrapper');
    if (!wrapper) hideMembersSuggestions();
  });

  // Focus input when clicking wrapper
  const wrapper = input.closest('.members-input-wrapper');
  if (wrapper) {
    wrapper.addEventListener('click', () => input.focus());
  }
}

// Abre o modal de projeto (criação ou edição)
function openProjectModal(edit = false) {
  const modal = $('#modal-project');
  if (!modal) return;

  const titleEl = $('#modal-project-title');
  const nameInput = $('#project-name-input');
  const descInput = $('#project-desc-input');
  const deadlineInput = $('#project-deadline-input');
  const statusSelect = $('#project-status-select');

  if (edit && currentProject) {
    if (titleEl) titleEl.textContent = 'Editar projeto';
    if (nameInput) nameInput.value = currentProject.name;
    if (descInput) descInput.value = currentProject.description || '';
    if (deadlineInput) deadlineInput.value = currentProject.deadline ? currentProject.deadline.split('T')[0] : '';
    if (statusSelect) statusSelect.value = currentProject.status || '';
    // Load existing members
    selectedMembers = (currentProject.members || []).map(m => ({ id: m.id, username: m.username }));
  } else {
    if (titleEl) titleEl.textContent = 'Novo projeto';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (deadlineInput) deadlineInput.value = '';
    if (statusSelect) statusSelect.value = '';
    selectedMembers = [];
  }

  renderSelectedMembers();
  hideMembersSuggestions();
  const membersInput = $('#members-search-input');
  if (membersInput) membersInput.value = '';

  modal.showModal();
}

async function saveProject(e) {
  e.preventDefault();

  const name = $('#project-name-input')?.value.trim();
  const description = $('#project-desc-input')?.value.trim() || '';
  const deadline = $('#project-deadline-input')?.value || null;
  const status = $('#project-status-select')?.value || null;
  const memberIds = selectedMembers.map(m => m.id);

  if (!name) {
    alert('Nome do projeto é obrigatório');
    return;
  }

  const payload = { name, description, deadline, status, memberIds };
  const isEditing = currentProject && $('#modal-project-title')?.textContent.includes('Editar');

  try {
    if (isEditing) {
      const updated = await api(`/api/projects/${currentProject.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      currentProject = updated;
      const nameEl = $('#project-name');
      const descEl = $('#project-desc');
      if (nameEl) nameEl.textContent = updated.name;
      if (descEl) descEl.textContent = updated.description || 'Sem descrição';
      renderProjectMembers(updated.members || []);
    } else {
      const project = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      projects.unshift(project);
      await selectProject(project.id);
    }

    await loadProjects();
    await loadActivity();
    $('#modal-project').close();
  } catch (err) {
    alert('Erro ao salvar projeto: ' + err.message);
  }
}

async function deleteProject() {
  if (!currentProject) return;
  if (!confirm(`Excluir o projeto "${currentProject.name}" e todos os arquivos?`)) return;

  try {
    await api(`/api/projects/${currentProject.id}`, { method: 'DELETE' });
    currentProject = null;
    const projectView = $('#project-view');
    const emptyState = $('#empty-state');
    if (projectView) projectView.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
    await loadProjects();
    await loadActivity();
  } catch (err) {
    alert('Erro ao excluir projeto: ' + err.message);
  }
}

function showShareModal() {
  if (!currentProject) return;
  const link = `${window.location.origin}/client/${currentProject.clientToken}`;
  const shareLinkEl = $('#share-link');
  if (shareLinkEl) shareLinkEl.value = link;
  const modal = $('#modal-share');
  if (modal) modal.showModal();
}

async function uploadFiles(fileList) {
  if (!currentProject || !fileList.length) return;

  const progress = $('#upload-progress');
  if (progress) {
    progress.classList.remove('hidden');
    progress.innerHTML = '';
  }

  for (const file of fileList) {
    const item = document.createElement('div');
    item.className = 'upload-progress__item';
    item.innerHTML = `
      <span>${escapeHtml(file.name)}</span>
      <div class="upload-progress__bar"><div class="upload-progress__fill" style="width:0%"></div></div>
    `;
    if (progress) progress.appendChild(item);
    const fill = item.querySelector('.upload-progress__fill');

    const fd = new FormData();
    fd.append('file', file);

    try {
      if (fill) fill.style.width = '50%';
      await api(`/api/projects/${currentProject.id}/files`, { method: 'POST', body: fd });
      if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--success)'; }
    } catch (err) {
      if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--danger)'; }
      const span = item.querySelector('span');
      if (span) span.textContent += ` — Erro: ${err.message}`;
    }
  }

  await loadFiles();
  await loadProjects();
  await loadActivity();
  lastSync = new Date().toISOString();

  setTimeout(() => { if (progress) progress.classList.add('hidden'); }, 2000);
}

async function deleteFile(fileId) {
  if (!confirm('Excluir este arquivo?')) return;
  try {
    await api(`/api/projects/${currentProject.id}/files/${fileId}`, { method: 'DELETE' });
    await loadFiles();
    await loadProjects();
    await loadActivity();
  } catch (err) {
    alert('Erro ao excluir arquivo: ' + err.message);
  }
}

function bindEvents() {
  // Members autocomplete
  bindMembersInput();

  // Logout
  const btnLogout = $('#btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  // Botão "+" da sidebar
  const btnNewProject = $('#btn-new-project');
  if (btnNewProject) btnNewProject.addEventListener('click', () => openProjectModal(false));

  // Botão "Criar primeiro projeto" na tela inicial
  const btnNewProjectEmpty = $('#btn-new-project-empty');
  if (btnNewProjectEmpty) btnNewProjectEmpty.addEventListener('click', () => openProjectModal(false));

  // Botão Editar projeto
  const btnEditProject = $('#btn-edit-project');
  if (btnEditProject) btnEditProject.addEventListener('click', () => openProjectModal(true));

  // Botão Excluir projeto
  const btnDeleteProject = $('#btn-delete-project');
  if (btnDeleteProject) btnDeleteProject.addEventListener('click', deleteProject);

  // Botão Link do cliente
  const btnShare = $('#btn-share');
  if (btnShare) btnShare.addEventListener('click', showShareModal);

  // Formulário do modal de projeto
  const formProject = $('#form-project');
  if (formProject) formProject.addEventListener('submit', saveProject);

  // Fechar modais
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  // Copiar link
  const btnCopyLink = $('#btn-copy-link');
  if (btnCopyLink) btnCopyLink.addEventListener('click', () => {
    const shareLinkEl = $('#share-link');
    if (shareLinkEl) navigator.clipboard.writeText(shareLinkEl.value);
    btnCopyLink.textContent = 'Copiado!';
    setTimeout(() => { btnCopyLink.textContent = 'Copiar'; }, 2000);
  });

  // Gerar novo link
  const btnRegenerateLink = $('#btn-regenerate-link');
  if (btnRegenerateLink) btnRegenerateLink.addEventListener('click', async () => {
    if (!confirm('Gerar novo link? O link anterior deixará de funcionar.')) return;
    try {
      const data = await api(`/api/projects/${currentProject.id}/regenerate-link`, { method: 'POST' });
      currentProject.clientToken = data.clientToken;
      const shareLinkEl = $('#share-link');
      if (shareLinkEl) shareLinkEl.value = `${window.location.origin}/client/${data.clientToken}`;
      await loadActivity();
    } catch (err) {
      alert('Erro ao gerar link: ' + err.message);
    }
  });

  // Upload de arquivos
  const btnBrowse = $('#btn-browse');
  if (btnBrowse) btnBrowse.addEventListener('click', () => $('#file-input').click());

  const fileInput = $('#file-input');
  if (fileInput) fileInput.addEventListener('change', (e) => {
    uploadFiles([...e.target.files]);
    e.target.value = '';
  });

  const zone = $('#upload-zone');
  if (zone) {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      uploadFiles([...e.dataTransfer.files]);
    });
    // Touch/click on entire upload zone opens file picker
    zone.addEventListener('click', (e) => {
      if (e.target.id !== 'btn-browse' && !e.target.closest('#btn-browse')) {
        $('#file-input').click();
      }
    });
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('#file-input').click();
      }
    });
  }

  // Busca de arquivos
  const fileSearch = $('#file-search');
  if (fileSearch) fileSearch.addEventListener('input', (e) => renderFiles(e.target.value));

  // Filtros
  const filterStatus = $('#filter-status');
  const filterDeadline = $('#filter-deadline');
  if (filterStatus) filterStatus.addEventListener('change', renderProjectList);
  if (filterDeadline) filterDeadline.addEventListener('change', renderProjectList);

  // Tema
  const btnTheme = $('#btn-theme');
  if (btnTheme) btnTheme.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light');
  });

  // Menu mobile
  const btnMenu = $('#btn-menu');
  const sidebar = $('.sidebar');
  const overlay = $('#sidebar-overlay');
  if (btnMenu && sidebar) {
    btnMenu.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar--open');
      if (overlay) overlay.classList.toggle('active');
    });
  }
  if (overlay && sidebar) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('sidebar--open');
      overlay.classList.remove('active');
    });
  }
}

init();
