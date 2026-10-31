# Prospecção com a base aberta de CNPJ da Receita Federal

A tela `/prospeccao` consulta a base local importada do Dados Abertos do CNPJ. O cadastro comercial `Supplier` continua separado: uma empresa só vira fornecedor quando o usuário aciona **Cadastrar como fornecedor**.

## 1. Pré-requisitos

- PostgreSQL configurado em `DATABASE_URL`.
- Dependências do backend instaladas (`npm install`).
- Ferramenta `unzip` disponível no Linux. No Windows, instale 7-Zip e adicione `7z` ao `PATH` ou configure `CNPJ_ARCHIVE_BIN`.
- Uma pasta com os arquivos ZIP da mesma competência mensal da Receita Federal.
- Para geocodificação sob demanda, configure `PROSPECTING_USER_AGENT` com um identificador de aplicação e um contato válido (por exemplo, nome do sistema e e-mail de suporte). A geocodificação utiliza Nominatim, não a pesquisa de empresas.

## 2. Arquivos necessários

Coloque na mesma pasta os ZIPs oficiais:

- `Empresas*.zip`
- `Estabelecimentos*.zip`
- `Simples.zip`
- `Cnaes.zip`
- `Municipios.zip`

Não é necessário baixar/importar arquivos de sócios para este recurso. Os dados de empresas e estabelecimentos são lidos por streaming dentro dos ZIPs; o processo não extrai o conjunto completo para uma segunda cópia no disco.

Fonte oficial: https://www.gov.br/receitafederal/dados

Pasta de arquivos CNPJ no domínio da Receita: https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9. Se o compartilhamento mudar, comece pelo repositório oficial.

## 3. Executar a migration e gerar o Prisma Client

Na pasta do backend:

```bash
npx prisma migrate deploy
npx prisma generate
```

Em ambiente local de desenvolvimento que ainda não controla migrations, use o fluxo de migração que o projeto já adota. Em produção, prefira `migrate deploy`.

## 4. Executar a importação

O processo faz uma carga completa da competência selecionada para as UFs escolhidas. A base publicada atualmente continua disponível enquanto o novo lote é carregado; a troca ocorre somente após a carga terminar. Portanto, trata-se de substituição controlada de snapshot mensal, não de sincronização registro a registro.

Para executar diretamente do TypeScript, com `tsx` instalado:

Exemplo para importar somente o Rio Grande do Sul:

```bash
npm run cnpj:import -- --dir ./data/cnpj/2026-10 --ufs RS --competence 2026-10
```

Em servidor que executa somente os arquivos compilados, compile o backend e rode o script gerado:

```bash
npm run build
npm run cnpj:import:build -- --dir ./data/cnpj/2026-10 --ufs RS --competence 2026-10
```

Exemplo para RS e SC:

```bash
npm run cnpj:import -- --dir ./data/cnpj/2026-10 --ufs RS,SC --competence 2026-10
```

Os parâmetros também podem ser configurados por ambiente:

```env
CNPJ_DATA_DIR=./data/cnpj/2026-10
CNPJ_UFS=RS
CNPJ_ARCHIVE_BIN=unzip
PROSPECTING_USER_AGENT=CatalogManager/1.0 (suporte@seudominio.com.br)
```

A opção `--dir` prevalece sobre `CNPJ_DATA_DIR`; `--ufs` prevalece sobre `CNPJ_UFS`. Se a competência não for informada, o script tenta inferi-la pelo nome da pasta (`AAAA-MM`). A referência usada para interpretar as datas do MEI pode ser fixada com `--reference-date AAAAMMDD` ou `CNPJ_REFERENCE_DATE`; por padrão, é o último dia da competência. Use a data de referência da carga quando ela estiver documentada.

## 5. Regras de seleção da base

- Entram estabelecimentos com situação cadastral `02` (ativa) e UF solicitada.
- O relacionamento entre pessoa jurídica, estabelecimento e Simples/MEI é feito pelo CNPJ básico (raiz de oito caracteres).
- São excluídas as raízes cuja opção pelo MEI esteja marcada como `S`, com data de opção até o final da competência e sem data de exclusão até o final da competência.
- Empresas que foram MEI no passado, mas já estavam desenquadradas na competência importada, não são excluídas por esse motivo.
- A opção pelo Simples Nacional, isoladamente, não exclui uma empresa.
- A tabela `Supplier` não recebe carga em massa; apenas o cadastro manual/selecionado do usuário cria fornecedor.

A migration instala a extensão PostgreSQL `pg_trgm` e cria índices GIN trigram para busca parcial por nome de empresa. O usuário do banco precisa ter permissão para criar a extensão na primeira migration.

## 6. CNPJ alfanumérico

O campo CNPJ é armazenado como texto, sem pontuação, e aceita 14 posições: as 12 primeiras podem conter letras/números e as duas últimas são dígitos verificadores numéricos. A validação implementa a regra oficial de conversão ASCII menos 48 e módulo 11. Não use `replace(/\D/g, "")` em identificadores CNPJ: isso apagaria letras válidas.

Manual oficial: https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf

## 7. Publicação segura

A importação cria um lote `RUNNING`, carrega os dados ligados à nova competência e só marca o lote como `PUBLISHED` depois de concluir a carga. Se houver falha antes da publicação, a última base publicada permanece disponível. Depois da publicação, os registros de lotes anteriores são removidos para conter o tamanho do banco; os registros de controle dos lotes permanecem.

Execute uma importação por vez. O processo mantém na memória o conjunto de raízes de CNPJ dos estabelecimentos ativos da UF selecionada para fazer os relacionamentos com os arquivos nacionais. Comece por uma UF (RS), confira memória, tempo e espaço em disco e só então amplie para outras UFs.

## 8. API

- `GET /prospecting/companies` — busca paginada. Parâmetros: `uf`, `municipalities` (códigos separados por vírgula), `cnae` (códigos separados por vírgula), `search`, `onlyWithContact`, `page`, `limit`.
- `GET /prospecting/companies/:cnpj` — detalhes de estabelecimento.
- `POST /prospecting/companies/:cnpj/geocode` — geocodifica o endereço selecionado e guarda as coordenadas em cache.
- `POST /prospecting/companies/:cnpj/import` — cadastra a empresa selecionada como `Supplier`.
- `GET /prospecting/cnaes?q=` — busca CNAEs por código ou descrição.
- `GET /prospecting/municipalities?uf=RS&q=` — busca municípios existentes na competência publicada.
- `GET /prospecting/import-status` — situação da última importação e competência publicada.

Os endpoints antigos `/geocode`, `/places`, `/cnpj/:cnpj` e `/import` foram mantidos temporariamente para compatibilidade. A nova tela usa exclusivamente a base local para descobrir empresas. O mapa só mostra estabelecimentos já geocodificados, sem consultar Overpass.

## 9. Limitações e cuidados

- A base é um retrato cadastral mensal; não confirma estoque, disponibilidade comercial, atuação como atacadista nem interesse em vender para revenda.
- Telefone/e-mail podem estar vazios, desatualizados ou vinculados a prestadores de serviços contábeis/administrativos.
- A Receita não fornece latitude/longitude. A geocodificação é feita apenas sob demanda e sujeita à cobertura do serviço e seus limites de uso.
- O mapa exibe os resultados geocodificados da página atual. A lista paginada e os filtros de município/CNAE continuam sendo a ferramenta principal de descoberta.
- A tela apresenta apenas estabelecimentos ativos e a importação exclui optantes atuais pelo MEI conforme os campos do arquivo Simples da competência importada.
