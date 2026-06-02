# Eng-Hub

Plataforma web para armazenar e compartilhar arquivos de projetos de engenharia.

## Funcionalidades

- **Login e cadastro** — usuário, senha, e-mail e telefone
- **Projetos compartilhados** — todos os usuários cadastrados veem e atualizam os mesmos projetos em tempo real
- **Upload de qualquer tipo de arquivo** — DWG, PDF, planilhas, imagens, vídeos (até 500 MB)
- **Link exclusivo para clientes** — visualização somente leitura, sem login
- **Sincronização automática** — atualizações a cada 5 segundos para todos os usuários conectados

## Como rodar

1. Instale o [Node.js](https://nodejs.org/) (versão 18 ou superior)
2. Abra o terminal na pasta `eng-hub`
3. Execute:

```bash
npm install
npm start
```

4. Acesse **http://localhost:3000** no navegador
5. Crie sua conta na aba **Cadastrar**

## Estrutura

```
eng-hub/
├── server.js          # Servidor e API
├── database.js        # Banco SQLite
├── public/            # Interface web
├── uploads/           # Arquivos enviados (criado automaticamente)
└── data/              # Banco de dados (criado automaticamente)
```

## Link do cliente

No painel, abra um projeto e clique em **Link do cliente**. O link gerado permite que o cliente veja e baixe os arquivos sem precisar de login.

Exemplo: `http://localhost:3000/client/abc123...`

## Produção

Para uso em produção, defina a variável de ambiente `SESSION_SECRET` com uma chave segura e hospede em um servidor com Node.js.
