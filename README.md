# Eng-Hub

Plataforma web para armazenar e compartilhar arquivos de projetos de engenharia.

## Funcionalidades

- **Login e cadastro** — usuário, senha, e-mail e telefone
- **Controle de acesso** — apenas membros atribuídos podem ver cada projeto
- **Responsáveis por projeto** — até 8 integrantes (apenas usuários cadastrados)
- **Upload de qualquer tipo de arquivo** — DWG, PDF, planilhas, imagens, vídeos (até 500 MB)
- **Link exclusivo para clientes** — visualização somente leitura, sem login
- **Sincronização automática** — atualizações a cada 5 segundos
- **Banco PostgreSQL persistente** — dados nunca são perdidos entre deploys

## Requisitos

- [Node.js](https://nodejs.org/) versão 18 ou superior
- [PostgreSQL](https://www.postgresql.org/) (local ou remoto)

## Como rodar localmente

1. Instale o PostgreSQL e crie um banco de dados:

```bash
createdb enghub
```

2. Configure a variável de ambiente:

```bash
export DATABASE_URL="postgresql://usuario:senha@localhost:5432/enghub"
```

Ou crie um arquivo `.env` na raiz:

```
DATABASE_URL=postgresql://usuario:senha@localhost:5432/enghub
SESSION_SECRET=uma-chave-secreta-qualquer
```

3. Instale as dependências e inicie:

```bash
npm install
npm start
```

4. Acesse **http://localhost:3001** no navegador

## Deploy no Render (gratuito)

1. Faça push do código no GitHub
2. No [Render Dashboard](https://dashboard.render.com/):
   - Crie um **PostgreSQL** (plano Free)
   - Crie um **Web Service** apontando para o repositório
   - Na aba Environment, adicione:
     - `DATABASE_URL` → copie a **Internal Database URL** do PostgreSQL criado
     - `SESSION_SECRET` → gere uma chave aleatória
     - `NODE_ENV` → `production`
3. Deploy automático a cada push!

Ou use o botão **Blueprint** com o `render.yaml` incluso no projeto.

## Estrutura

```
eng-hub/
├── server.js          # Servidor Express + API
├── database.js        # Conexão PostgreSQL + criação de tabelas
├── package.json       # Dependências
├── render.yaml        # Blueprint para deploy no Render
├── public/            # Interface web (HTML/CSS/JS)
│   ├── index.html     # Tela de login/cadastro
│   ├── dashboard.html # Painel de projetos
│   ├── client.html    # Visualização do cliente
│   ├── css/style.css  # Estilos (responsivo)
│   └── js/            # JavaScript do frontend
└── uploads/           # Arquivos enviados (criado automaticamente)
```

## Banco de Dados

O sistema usa **PostgreSQL** com as seguintes tabelas:

- `users` — Usuários cadastrados
- `projects` — Projetos de engenharia
- `project_members` — Integrantes de cada projeto (controle de acesso)
- `files` — Arquivos enviados
- `activity` — Log de atividades
- `sessions` — Sessões de login

As tabelas são criadas automaticamente na primeira execução.

## Link do cliente

No painel, abra um projeto e clique em **Link do cliente**. O link gerado permite que o cliente veja e baixe os arquivos sem precisar de login.
