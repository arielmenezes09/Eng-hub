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

// --- Login ---
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  showFeedback(form, '', 'success');

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
    showFeedback(form, err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- Cadastro (com Confirmação de Senha) ---
document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  
  const password = form.querySelector('#reg-pass').value;
  const passwordConfirm = form.querySelector('#reg-pass-confirm').value;

  if (password !== passwordConfirm) {
    showFeedback(form, 'As senhas digitadas não coincidem.', 'error');
    return;
  }

  btn.disabled = true;
  showFeedback(form, '', 'success');

  try {
    const fd = new FormData(form);
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: password,
        email: fd.get('email'),
        phone: fd.get('phone')
      })
    });
    window.location.href = '/dashboard';
  } catch (err) {
    showFeedback(form, err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- Lógica de Recuperação de Senha ---

const linkForgot = document.getElementById('link-forgot');
const formRecovery = document.getElementById('form-recovery');
const formLogin = document.getElementById('form-login');
const btnBackLogin = document.getElementById('btn-back-login');
const btnSendCode = document.getElementById('btn-send-code');
const step1 = document.getElementById('recovery-step-1');
const step2 = document.getElementById('recovery-step-2');

let recoveryIdentifier = ''; // Guarda o e-mail/celular para o passo 2

// Abrir tela de recuperação
linkForgot.addEventListener('click', (e) => {
  e.preventDefault();
  
  // Desativa tabs
  tabs.forEach(t => t.classList.remove('active'));
  
  // Esconde outros formulários
  forms.forEach(f => {
    f.classList.remove('active');
    f.hidden = true;
  });

  // Mostra formulário de recuperação
  formRecovery.classList.add('active');
  formRecovery.hidden = false;

  // Reseta estado do formulário de recuperação
  step1.classList.remove('hidden');
  step2.classList.add('hidden');
  document.getElementById('recovery-identifier').value = '';
  document.getElementById('recovery-code').value = '';
  document.getElementById('recovery-pass').value = '';
  document.getElementById('recovery-pass-confirm').value = '';
  showFeedback(formRecovery, '', 'success');
});

// Voltar para o Login
btnBackLogin.addEventListener('click', () => {
  // Esconde formulário de recuperação
  formRecovery.classList.remove('active');
  formRecovery.hidden = true;

  // Ativa aba e formulário de login
  const loginTab = document.querySelector('[data-tab="login"]');
  loginTab.classList.add('active');
  formLogin.classList.add('active');
  formLogin.hidden = false;
});

// Enviar código de recuperação (Passo 1)
btnSendCode.addEventListener('click', async () => {
  const input = document.getElementById('recovery-identifier');
  const identifier = input.value.trim();

  if (!identifier) {
    showFeedback(formRecovery, 'Por favor, informe seu usuário, e-mail ou telefone.', 'error');
    return;
  }

  btnSendCode.disabled = true;
  showFeedback(formRecovery, 'Enviando código...', 'success');

  try {
    const data = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ identifier })
    });

    recoveryIdentifier = identifier; // Armazena para o passo 2
    showFeedback(formRecovery, data.message, 'success');

    // Transiciona para o Passo 2
    setTimeout(() => {
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      showFeedback(formRecovery, '', 'success'); // Limpa a mensagem temporária para focar nos campos
    }, 2500);

  } catch (err) {
    showFeedback(formRecovery, err.message, 'error');
  } finally {
    btnSendCode.disabled = false;
  }
});

// Redefinir senha (Passo 2)
formRecovery.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const code = document.getElementById('recovery-code').value.trim();
  const newPassword = document.getElementById('recovery-pass').value;
  const newPasswordConfirm = document.getElementById('recovery-pass-confirm').value;
  const btnSubmit = formRecovery.querySelector('button[type=submit]');

  if (!code || !newPassword || !newPasswordConfirm) {
    showFeedback(formRecovery, 'Preencha todos os campos.', 'error');
    return;
  }

  if (newPassword !== newPasswordConfirm) {
    showFeedback(formRecovery, 'As novas senhas digitadas não coincidem.', 'error');
    return;
  }

  btnSubmit.disabled = true;
  showFeedback(formRecovery, 'Redefinindo senha...', 'success');

  try {
    await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        identifier: recoveryIdentifier,
        code,
        newPassword
      })
    });

    showFeedback(formRecovery, 'Senha redefinida com sucesso! Redirecionando para o login...', 'success');

    setTimeout(() => {
      btnBackLogin.click(); // Volta para a tela de login
    }, 2000);

  } catch (err) {
    showFeedback(formRecovery, err.message, 'error');
  } finally {
    btnSubmit.disabled = false;
  }
});

// Verificação de autenticação ao carregar
api('/api/auth/check').then(data => {
  if (data.authenticated) window.location.href = '/dashboard';
}).catch(() => {});
