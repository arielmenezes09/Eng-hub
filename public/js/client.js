const token = window.location.pathname.split('/client/')[1];

const els = {
  name: document.getElementById('client-project-name'),
  desc: document.getElementById('client-project-desc'),
  updated: document.getElementById('client-updated'),
  loading: document.getElementById('client-loading'),
  error: document.getElementById('client-error'),
  files: document.getElementById('client-files'),
  fileList: document.getElementById('client-file-list'),
  fileCount: document.getElementById('client-file-count')
};

function fileExt(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : 'arq';
  return ext.length > 4 ? 'arq' : ext;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso) {
  return new Date(iso + 'Z').toLocaleString('pt-BR');
}

function renderFiles(files) {
  els.fileCount.textContent = files.length;
  els.fileList.innerHTML = files.map(f => `
    <div class="file-item">
      <span class="file-item__icon">${escapeHtml(fileExt(f.original_name))}</span>
      <div class="file-item__info">
        <div class="file-item__name">${escapeHtml(f.original_name)}</div>
        <div class="file-item__meta">${formatSize(f.size)} · ${f.uploaded_by} · ${formatDate(f.uploaded_at)}</div>
      </div>
      <div class="file-item__actions">
        <a href="/api/client/${token}/files/${f.id}/download" class="btn btn--primary btn--sm">Baixar</a>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function load() {
  try {
    const res = await fetch(`/api/client/${token}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Erro ao carregar');

    els.name.textContent = data.project.name;
    els.desc.textContent = data.project.description || '';
    els.updated.textContent = `Última atualização: ${formatDate(data.project.updatedAt)}`;

    renderFiles(data.files);
    els.loading.classList.add('hidden');
    els.files.classList.remove('hidden');
  } catch (err) {
    els.loading.classList.add('hidden');
    els.error.textContent = err.message;
    els.error.classList.remove('hidden');
  }
}

load();
setInterval(load, 15000);
