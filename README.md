# X Cleaner

O X Cleaner é um CLI local-first para importar o X Archive oficial da própria
conta, revisar posts, replies, reposts e likes, e executar uma limpeza explícita
pela interface web oficial do X. O arquivo, a sessão do navegador, o catálogo,
os registros e os relatórios permanecem no computador local.

## Estado do projeto

Este repositório está em beta privado. A compatibilidade com um arquivo real e a
estabilidade da automação diante da interface real do X ainda dependem de
validação manual controlada pelo proprietário. Os testes automatizados usam
somente dados sintéticos e páginas locais; eles não comprovam uma execução real.
O repositório não deve ser tornado público, e o pacote não deve ser publicado,
sem uma autorização separada depois dos gates de validação.

## Requisitos

- Node.js 24 LTS e npm compatível com o `package-lock.json`.
- macOS, Linux ou Windows.
- Chromium do Playwright instalado para comandos que abrem a sessão visível:
  `npx playwright install chromium`.
- Uma conta própria no X e o X Archive oficial baixado pelo fluxo de configurações
  da própria conta. O X Cleaner nunca solicita nem armazena a senha.

O fluxo de sessão abre o navegador visível e usa um perfil dedicado. Não use o
perfil cotidiano do Chrome, não compartilhe cookies e não tente contornar
CAPTCHA, desafios ou limites de taxa.

## Instalação a partir do código-fonte

O projeto ainda não é instalado do npm. Em uma cópia autorizada do repositório:

```bash
npm ci
npx playwright install chromium
npm run build
node dist/cli.js --help
```

Os artefatos de distribuição podem ser inspecionados localmente com
`npm pack --dry-run`; não há comando de publicação neste projeto.

## Fluxo seguro

1. No X, solicite e baixe o Archive oficial da própria conta. Preserve o ZIP
   original e escolha um diretório local privado.
2. Importe sem alterar o arquivo de origem:

   ```bash
   node dist/cli.js import /caminho/para/x-archive.zip --data-dir ./x-cleaner-data
   node dist/cli.js status --data-dir ./x-cleaner-data
   ```

3. Crie e revise uma simulação. Os tipos podem ser repetidos e as datas são
   limites inclusivos:

   ```bash
   node dist/cli.js dry-run --data-dir ./x-cleaner-data --type POST --type REPLY
   node dist/cli.js dry-run --data-dir ./x-cleaner-data --type REPOST --from 2024-01-01
   ```

   `dry-run` não abre o navegador e não altera o X. O plano exibido é um
   snapshot imutável; revise o total e os tipos antes de continuar.

4. Faça login manual no navegador oficial e confirme a conta detectada:

   ```bash
   node dist/cli.js session login --data-dir ./x-cleaner-data
   node dist/cli.js session status --data-dir ./x-cleaner-data
   ```

5. Para cada etapa destrutiva, revise a saída e use uma autorização nova. O
   terminal exige a palavra exata `APAGAR`; ela significa que a etapa aprovada
   pode alterar a conta. Comece com um item:

   ```bash
   node dist/cli.js run <plan-id> --limit 1 --data-dir ./x-cleaner-data
   ```

   Depois, se o resultado foi conferido no X e o proprietário autorizou uma
   nova etapa, use um limite pequeno. Não existe autorização implícita para uma
   execução posterior.

6. Se a execução for pausada ou interrompida com `Ctrl+C`, resolva a causa e
   retome apenas após revisar o estado:

   ```bash
   node dist/cli.js resume <run-id> --limit 10 --data-dir ./x-cleaner-data
   node dist/cli.js report <run-id> --data-dir ./x-cleaner-data
   ```

   Itens já concluídos ou com resultado terminal não fatal não são repetidos.
   Sessão expirada, limite de taxa, desafio de segurança e estado desconhecido
   da interface pausam a execução; o programa não tenta adivinhar nem burlar a
   proteção.

## Dados locais e limpeza da sessão

Sem `--data-dir`, o diretório de dados é resolvido assim:

- macOS: `~/Library/Application Support/x-cleaner`;
- Linux: `$XDG_DATA_HOME/x-cleaner` ou `~/.local/share/x-cleaner`;
- Windows: `%LOCALAPPDATA%/x-cleaner` (com fallback para `%APPDATA%`).

Um diretório fornecido explicitamente continua sendo resolvido de forma segura
em relação ao diretório atual. Dentro dele ficam o `state.sqlite`, o perfil
`browser-profile/`, `logs/audit.ndjson`, checkpoints e `reports/`. Esses arquivos
podem conter dados pessoais e não devem entrar em commits, tickets, uploads ou
diagnósticos sem sanitização.

Para remover somente o perfil dedicado, preservando catálogo, banco, logs e
relatórios, confirme a pergunta do comando:

```bash
node dist/cli.js session clear --data-dir ./x-cleaner-data
```

Para apagar todo o diretório local, pare todos os processos e remova-o
manualmente depois de revisar os relatórios. Isso é separado da limpeza da
sessão e não altera nem apaga o Archive original.

## Limitações conhecidas

- V1 cobre somente posts, replies, reposts e likes descobertos no Archive.
- Mensagens diretas, bookmarks, listas, seguidores, seguindo, comunidades,
  Spaces, mudanças de perfil, exclusão da conta, API do X, OAuth, GUI e serviço
  remoto estão fora do escopo.
- A compatibilidade do formato do Archive real ainda não foi declarada como
  validada; fixtures sintéticas não substituem a inspeção do Archive do dono.
- A automação depende dos seletores e estados atuais do X. Um estado não
  reconhecido pausa por segurança até uma manutenção do BrowserEngine.
- A ação no X é irreversível no sentido de que o X Cleaner não promete restaurar
  o conteúdo removido. Revise o dry-run e mantenha o Archive original antes de
  qualquer confirmação.
- A automação autenticada é visível, sequencial e limitada de propósito. Não há
  execução paralela, descoberta por rolagem infinita, bypass de segurança ou
  operação autônoma recorrente.

## Roadmap e idiomas

O próximo gate é a validação manual do Archive e da conta do proprietário, em
etapas de dry-run, um item e pequenos lotes com conferência e retomada. Depois
disso podem ser avaliados um lançamento público aprovado e manutenção de
seletores. Inglês e espanhol são extensões futuras do catálogo; o CLI entregue
é português-first. Um futuro `XApiEngine` também permanece fora do V1.

## Segurança, licença e marca

Leia [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md),
[CONTRIBUTING.md](CONTRIBUTING.md),
[docs/troubleshooting.md](docs/troubleshooting.md) e
[docs/architecture.md](docs/architecture.md) antes de contribuir. A licença é
[MIT](LICENSE).

X Cleaner é um projeto independente e não é afiliado, endossado ou patrocinado
por X Corp., Twitter ou qualquer entidade relacionada. “X” e outras marcas
pertencem aos seus respectivos titulares.
