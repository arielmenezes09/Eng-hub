let currentUser = null;
let projects = [];
let currentProject = null;
let files = [];
let lastSync = new Date().toISOString();
let syncTimer = null;

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
  return new Date(iso.includes('Z') ? iso : iso + 'Z').toLocaleString('pt-BR');
}

function fileExt(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'arq';
  return ext.length > 4 ? 'arq' : ext;
}

function escapeHtml(str) {
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
}

  // Fetch users for member selection
  let allUsers = [];
  async function loadUsers() {
    allUsers = await api('/api/users');
    const membersSelect = $('#project-members-select');
    if (membersSelect) {
      membersSelect.innerHTML = '';
      allUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.username;
        opt.textContent = u.username;
        membersSelect.appendChild(opt);
      });
    }
  }

async function loadProjects() {
  projects = await api('/api/projects');
  renderProjectList();
}

function renderProjectList() {
  const list = $('#project-list');
  if (!projects.length) {
    list.innerHTML = '<li style="padding:1rem;color:var(--text-muted);font-size:0.85rem">Nenhum projeto ainda</li>';
    return;
  }
  const filtered = getFilteredProjects();
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

  // Re-attach click handlers after rendering
  list.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => selectProject(Number(item.dataset.id)));
  });
}

async function selectProject(id) {
  currentProject = projects.find(p => p.id === id);
  if (!currentProject) return;

  $('#empty-state').classList.add('hidden');
  $('#project-view').classList.remove('hidden');
  $('#project-name').textContent = currentProject.name;
  $('#project-desc').textContent = currentProject.description || 'Sem descrição';

  // Fechar menu lateral no celular quando um projeto for selecionado
  const sidebar = $('.sidebar');
  const overlay = $('#sidebar-overlay');
  if (sidebar) sidebar.classList.remove('sidebar--open');
  if (overlay) overlay.classList.remove('active');

  renderProjectList();
  await loadFiles();
}

async function loadFiles() {
  if (!currentProject) return;
  files = await api(`/api/projects/${currentProject.id}/files`);
  renderFiles();
}

function renderFiles(filter = '') {
  const q = filter.toLowerCase();
  const filtered = q ? files.filter(f => f.originalName.toLowerCase().includes(q)) : files;

  $('#file-count').textContent = filtered.length;
  const list = $('#file-list');

  if (!filtered.length) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem">Nenhum arquivo neste projeto</p>';
    return;
  }

    // Render files with access check
    const canAccess = currentProject.members && currentProject.members.includes(currentUser.username);
    list.innerHTML = filtered.map(f => `
      <div class="file-item" data-id="${f.id}">
        <span class="file-item__icon">${escapeHtml(fileExt(f.originalName))}</span>
        <div class="file-item__info">
          <div class="file-item__name" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</div>
          <div class="file-item__meta">${formatSize(f.size)} · ${escapeHtml(f.uploadedBy)} · ${formatDate(f.uploadedAt)}</div>
        </div>
        <div class="file-item__actions">
          ${canAccess ? `<a href="/api/projects/${currentProject.id}/files/${f.id}/download" class="btn btn--outline btn--sm">Baixar</a>` : '<span class="text-muted">Sem acesso</span>'}
          ${canAccess ? `<button type="button" class="btn btn--danger btn--sm btn-delete-file" data-id="${f.id}">Excluir</button>` : ''}
        </div>
      </div>
    `).join('');


    // Ensure only members can delete files
    list.querySelectorAll('.btn-delete-file').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!currentProject.members || !currentProject.members.includes(currentUser.username)) {
          alert('Você não tem permissão para excluir este arquivo.');
          return;
        }
        deleteFile(Number(btn.dataset.id));
      });
    });
}

async function loadActivity() {
  const items = await api('/api/activity');
  renderActivity(items);
}

function renderActivity(items) {
  const feed = $('#activity-feed');
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

async function openProjectModal(edit = false) {
  const modal = $('#modal-project');
  // Ensure members list is loaded
  await loadUsers();
  // Populate fields when editing
  if (edit && currentProject) {
    $('#project-deadline-input').value = currentProject.deadline ? currentProject.deadline.split('T')[0] : '';
    $('#project-status-select').value = currentProject.status || '';
    // Set selected members
    const membersSelect = $('#project-members-select');
    if (membersSelect) {
      Array.from(membersSelect.options).forEach(opt => {
        opt.selected = currentProject.members && currentProject.members.includes(opt.value);
      });
    }
  } else {
    $('#project-deadline-input').value = '';
    $('#project-status-select').value = '';
    const membersSelect = $('#project-members-select');
    if (membersSelect) membersSelect.value = '';
  }
  $('#modal-project-title').textContent = edit ? 'Editar projeto' : 'Novo projeto';
  $('#project-name-input').value = edit ? currentProject.name : '';
  $('#project-desc-input').value = edit ? (currentProject.description || '') : '';
  modal.showModal();
}



async function saveProject(e) {
  e.preventDefault();
  const name = $('#project-name-input').value.trim();
  const description = $('#project-desc-input').value.trim();
  const deadline = $('#project-deadline-input').value; // ISO date string (yyyy-mm-dd)
  const status = $('#project-status-select').value;

    const selectedMembers = Array.from($('#project-members-select').selectedOptions).map(o => o.value);
    if (selectedMembers.length > 10) {
      alert('Selecione no máximo 10 membros.');
      return;
    }
    const payload = { name, description, deadline: deadline || null, status: status || null, members: selectedMembers };

  if (currentProject && $('#modal-project-title').textContent.includes('Editar')) {
    // Update existing project
    currentProject = await api(`/api/projects/${currentProject.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    $('#project-name').textContent = currentProject.name;
    $('#project-desc').textContent = currentProject.description || 'Sem descrição';
  } else {
  
    // Create new project
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
}



async function deleteProject() {
  if (!currentProject) return;
  if (!confirm(`Excluir o projeto "${currentProject.name}" e todos os arquivos?`)) return;

  await api(`/api/projects/${currentProject.id}`, { method: 'DELETE' });
  currentProject = null;
  $('#project-view').classList.add('hidden');
  $('#empty-state').classList.remove('hidden');
  await loadProjects();
  await loadActivity();
}

function showShareModal() {
  if (!currentProject) return;
  const link = `${window.location.origin}/client/${currentProject.clientToken}`;
  $('#share-link').value = link;
  $('#modal-share').showModal();
}

async function uploadFiles(fileList) {
  if (!currentProject || !fileList.length) return;

  const progress = $('#upload-progress');
  progress.classList.remove('hidden');
  progress.innerHTML = '';

  for (const file of fileList) {
    const item = document.createElement('div');
    item.className = 'upload-progress__item';
    item.innerHTML = `
      <span>${escapeHtml(file.name)}</span>
      <div class="upload-progress__bar"><div class="upload-progress__fill" style="width:0%"></div></div>
    `;
    progress.appendChild(item);
    const fill = item.querySelector('.upload-progress__fill');

    const fd = new FormData();
    fd.append('file', file);

    try {
      fill.style.width = '50%';
      await api(`/api/projects/${currentProject.id}/files`, { method: 'POST', body: fd });
      fill.style.width = '100%';
      fill.style.background = 'var(--success)';
    } catch (err) {
      fill.style.width = '100%';
      fill.style.background = 'var(--danger)';
      item.querySelector('span').textContent += ` — Erro: ${err.message}`;
    }
  }

  await loadFiles();
  await loadProjects();
  await loadActivity();
  lastSync = new Date().toISOString();

  setTimeout(() => progress.classList.add('hidden'), 2000);
}

async function deleteFile(fileId) {
  if (!confirm('Excluir este arquivo?')) return;
  await api(`/api/projects/${currentProject.id}/files/${fileId}`, { method: 'DELETE' });
  await loadFiles();
  await loadProjects();
  await loadActivity();
}

function bindEvents() {
  $('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  // Filter UI events
  const filterStatus = $('#filter-status');
  const filterDeadline = $('#filter-deadline');
  if (filterStatus) filterStatus.addEventListener('change', renderProjectList);
  if (filterDeadline) filterDeadline.addEventListener('change', renderProjectList);

  // Helper to filter projects based on UI selections
  window.getFilteredProjects = function () {
    const status = filterStatus ? filterStatus.value : '';
    const deadline = filterDeadline ? filterDeadline.value : '';
    return projects.filter(p => {
      const matchStatus = !status || (p.status === status);
      const matchDeadline = !deadline || (p.deadline && p.deadline.split('T')[0] <= deadline);
      return matchStatus && matchDeadline;
    });
  };

  $('#btn-new-project').addEventListener('click', () => openProjectModal(false));



  $('#btn-delete-project').addEventListener('click', deleteProject);
  $('#btn-share').addEventListener('click', showShareModal);

  $('#form-project').addEventListener('submit', saveProject);

  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  $('#btn-copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText($('#share-link').value);
    $('#btn-copy-link').textContent = 'Copiado!';
    setTimeout(() => { $('#btn-copy-link').textContent = 'Copiar'; }, 2000);
  });

  $('#btn-regenerate-link').addEventListener('click', async () => {
    if (!confirm('Gerar novo link? O link anterior deixará de funcionar.')) return;
    const data = await api(`/api/projects/${currentProject.id}/regenerate-link`, { method: 'POST' });
    currentProject.clientToken = data.clientToken;
    $('#share-link').value = `${window.location.origin}/client/${data.clientToken}`;
    await loadActivity();
  });

  $('#btn-browse').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    uploadFiles([...e.target.files]);
    e.target.value = '';
  });

  const zone = $('#upload-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    uploadFiles([...e.dataTransfer.files]);
  });

  $('#file-search').addEventListener('input', (e) => renderFiles(e.target.value));
}

init();
