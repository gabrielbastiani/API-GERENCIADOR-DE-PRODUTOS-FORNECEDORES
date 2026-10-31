Pré-requisitos
Antes de iniciar, tenha instalado o Node.js e o npm, e disponha de um banco de dados PostgreSQL acessível.

Instalação e configuração
Na raiz do projeto — a pasta que contém o package.json — instale as dependências:

npm install
Crie um arquivo .env com base no .env.example e configure nele a string de conexão do PostgreSQL. Confira se o banco está acessível antes de continuar.

Aplique as migrations para criar ou atualizar a estrutura do banco e gere o cliente do Prisma:

npx prisma migrate dev
ou
npx prisma migrate deploy = para produção
npx prisma generate

## Prospecção de fornecedores com dados abertos do CNPJ

A implementação da pesquisa local por situação cadastral, município e CNAE está documentada em [`docs/PROSPECCAO-CNPJ.md`](docs/PROSPECCAO-CNPJ.md). Ela usa uma base independente do cadastro comercial `Supplier`; a importação de uma empresa para `Supplier` continua sendo uma ação explícita do usuário.
