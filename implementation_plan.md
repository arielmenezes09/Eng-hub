# Persistência de Dados Durante Atualizações

## Objetivo
Garantir que o front‑end não perca o estado de autenticação nem os dados temporários (lista de projetos) quando a página for recarregada ou o código for atualizado.

## Estratégia Proposta
1. **Armazenar token de autenticação em `localStorage`**
   - Após login bem‑sucedido, salvar `token` em `localStorage.setItem('authToken', token)`.
   - No `init()` ler o token e incluir no header `Authorization` de todas as chamadas `api()`.
2. **Modificar a helper `api`**
   - Anexar automaticamente `Authorization: Bearer <token>` se o token existir.
   - Caso `/api/auth/check` retorne `authenticated: false`, remover o token e redirecionar ao login.
3. **Cache opcional via Service Worker** (poderá ser habilitado depois)
   - Registrar `service-worker.js` que faz cache‑first dos recursos estáticos (`/js/*`, `/css/*`, `/images/*`).
   - Opcionalmente cachear respostas de APIs críticas (lista de projetos) usando a Cache API.
4. **Limpeza de token ao logout**
   - No fluxo de logout excluir `localStorage.removeItem('authToken')`.
5. **Sincronização no início**
   - Se houver token, chamar `api('/api/auth/check')` → se válido, prosseguir com `loadProjects()` e `loadActivity()` como já acontece.

## Alterações de Código
- **public/js/dashboard.js**
  - Atualizar `init()` para ler `localStorage.getItem('authToken')`.
  - Ajustar `api()` para inserir o header `Authorization`.
  - Adicionar lógica de remoção de token caso a verificação falhe.
- **public/service-worker.js** (novo arquivo)
  - Implementar estratégia `cache-first` para assets estáticos.
  - Registrar o SW em `dashboard.html` via `<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/service-worker.js');}</script>`.

## Verificação
- Testar login → fechar aba → reabrir → permanecer autenticado.
- Simular recarregamento da página (ou atualização de código) e confirmar que a lista de projetos ainda carrega.
- Verificar redirecionamento ao login caso o token expire.

## Perguntas ao Usuário
- Deseja que o Service Worker seja incluído agora ou prefere adicioná‑lo em um passo futuro?
- Há algum limite de tempo para o token (ex.: 1 h) que devemos respeitar?

## Próximos Passos
1. Implementar as mudanças acima.
2. Testar manualmente.
3. Atualizar `walkthrough.md` ao final.
