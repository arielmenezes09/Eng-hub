const tabs = document.querySelectorAll('.auth-tab');
const forms = document.querySelectorAll('.auth-form');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => {
      f.classList.remove('active');
      f.hidden = true;
    });
    tab.classList.add('active');
    const form = document.getElementById(`form-${tab.dataset.tab}`);
    form.classList.add('active');
    form.hidden = false;
  });
});

function showFeedback(form, message, type = 'error') {
  const el = form.querySelector('.form-feedback');
  el.textContent = message;
  el.className = `form-feedback ${type}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'same-origin',
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    const fd = new FormData(form);
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password')
      })
    });
    window.location.href = '/dashboard';
  } catch (err) {
    showFeedback(form, err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    const fd = new FormData(form);
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
        email: fd.get('email'),
        phone: fd.get('phone')
      })
    });
    window.location.href = '/dashboard';
  } catch (err) {
    showFeedback(form, err.message);
  } finally {
    btn.disabled = false;
  }
});

api('/api/auth/check').then(data => {
  if (data.authenticated) window.location.href = '/dashboard';
}).catch(() => {});
