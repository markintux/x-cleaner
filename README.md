# X Cleaner

O X Cleaner é um CLI local-first para importar o X Archive oficial da própria
conta, revisar posts, replies, reposts e likes, e executar uma limpeza explícita
pela interface web oficial do X. O arquivo, a sessão do navegador, o catálogo,
os registros e os relatórios permanecem no computador local.

## Estado do projeto

O pacote no npm está em beta público; o repositório GitHub permanece privado.
Houve validação manual limitada com um Archive e uma conta reais, incluindo os
quatro tipos de interação e lotes pequenos. Isso não garante compatibilidade
com outros Archives nem estabilidade diante de mudanças na interface do X.
Os testes automatizados usam somente dados sintéticos e páginas locais; eles
não comprovam uma execução real.

## Instalação pelo npm

Você não precisa clonar o projeto nem compilar o código.

1. Instale o [Node.js 24 LTS](https://nodejs.org/en/download) e o
   [Google Chrome](https://www.google.com/chrome/). O instalador do Node inclui
   o npm. Se já tiver Node, confirme com `node --version`: a versão deve começar
   com `v24`.
2. Abra o terminal do seu sistema e execute:

   ```text
   npm install --global x-cleaner
   x-cleaner doctor
   ```

3. No X, solicite e baixe o Archive oficial da sua própria conta. Depois
   informe o caminho do ZIP ao programa:

   ```text
   x-cleaner "/caminho/para/x-archive.zip"
   ```

   Também é possível informar uma pasta já extraída. O X Cleaner lê a origem
   sem modificá-la ou enviá-la para um servidor. Para abrir o menu depois da
   importação, execute apenas `x-cleaner`.

### Terminal e caminho do arquivo em cada sistema

| Sistema | Abra                              | Exemplo de importação                                  |
| ------- | --------------------------------- | ------------------------------------------------------ |
| Windows | PowerShell ou Terminal do Windows | `x-cleaner "C:\Users\SeuNome\Downloads\x-archive.zip"` |
| macOS   | Terminal                          | `x-cleaner "$HOME/Downloads/x-archive.zip"`            |
| Linux   | Terminal                          | `x-cleaner "$HOME/Downloads/x-archive.zip"`            |

Troque `x-archive.zip` pelo nome real do arquivo baixado. Use aspas quando o
caminho contiver espaços. No Windows, você também pode arrastar o ZIP do
Explorador até o terminal após digitar `x-cleaner `; confira o caminho antes de
pressionar Enter. `--data-dir` escolhe onde guardar os **dados do programa**,
não onde encontrar o Archive.

`x-cleaner doctor` mostra o diretório local dos dados e verifica Node, Chrome e
o Chromium opcional do Playwright. Ele não abre o navegador, não acessa o X e
não lê o Archive. A presença dos programas não garante que o X aceitará o login
ou que a interface atual será reconhecida.

### Atualizar, desinstalar e resolver problemas

`npm install --global x-cleaner` também atualiza o
programa. `npm uninstall --global x-cleaner` o remove, mas preserva o Archive e
os dados locais descritos abaixo.

- `node` ou `npm` não é reconhecido: instale o Node 24, abra outro terminal e
  confirme com `node --version` e `npm --version`.
- `x-cleaner` não é reconhecido: abra outro terminal e repita a instalação. Se
  o npm mostrar erro de permissão, siga a
  [orientação oficial do npm](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/).
  Não execute o X Cleaner como administrador para contornar esse erro.
- O `doctor` não encontra Chrome: instale Google Chrome no local padrão do
  sistema e execute `x-cleaner doctor` novamente. No Linux, escolha o pacote
  do Chrome compatível com sua distribuição.
- O Archive não é encontrado: confira o caminho completo, as aspas e se o ZIP
  ainda está na pasta Downloads. Confira também as orientações desta página.

## Requisitos

- Node.js 24 LTS e npm.
- macOS, Linux ou Windows.
- Google Chrome instalado para o login manual. Se o Chromium do Playwright não
  estiver disponível, a execução pode usar o Chrome local com o perfil dedicado.
- Uma conta própria no X e o X Archive oficial baixado pelo fluxo de configurações
  da própria conta. O X Cleaner nunca solicita nem armazena a senha.

O fluxo de sessão abre o navegador visível e usa um perfil dedicado. Não use o
perfil cotidiano do Chrome, não compartilhe cookies e não tente contornar
CAPTCHA, desafios ou limites de taxa.

Durante `session login`, o Google Chrome comum abre primeiro com esse perfil
dedicado. Conclua o login e feche a janela; em seguida, o X Cleaner reutiliza o
mesmo perfil via Playwright somente para validar a sessão e identificar a conta.

Execuções reais aguardam pelo menos 5 segundos entre interações concluídas. O
intervalo cria uma fronteira visível para interrupção manual e não autoriza o
próximo lote automaticamente.

Durante a execução, cada item é impresso quando começa e quando sua fronteira é
persistida, e o intervalo entre itens também é anunciado. O primeiro `Ctrl+C`
para o agendamento e fecha o lote na última fronteira já persistida; o segundo
encerra o processo de imediato e, de propósito, não persiste nada. Depois de uma
parada não limpa, o `.executor.lock` sobrevive: consulte `x-cleaner status` e,
confirmando que nenhum executor está ativo, repita o comando com
`--release-stale-lock`.

## Instalação a partir do código-fonte (contribuidores)

Para contribuir em uma cópia autorizada do repositório, use Node 24 e Google
Chrome:

```bash
npm ci
npm run build
node dist/cli.js doctor
node dist/cli.js --help
```

Para instalar também o Chromium compatível com o Playwright fixado no projeto,
execute `npx playwright install chromium` **na pasta do projeto**. No Linux, o
navegador pode exigir bibliotecas do sistema; veja as
[instruções do Playwright](https://playwright.dev/docs/browsers).

Os artefatos de distribuição podem ser inspecionados localmente com
`npm pack --dry-run`; não há comando de publicação neste projeto.

### Menu interativo

Depois de importar o Archive, criar uma simulação, confirmar a conta e iniciar
uma execução, abra `x-cleaner` sem argumentos para ver os runs salvos e escolher
um lote. Na instalação a partir do código-fonte, use `node dist/cli.js menu`.
O menu mostra uma linha por tipo de interação, pede um limite de 1 a 25 itens e entrega a
execução ao mesmo CLI. Antes de qualquer alteração no X, o CLI mostra a conta e
os identificadores exatos do lote e exige `APAGAR` digitado pelo proprietário.
Ao selecionar uma execução pausada por erro, o menu mostra o motivo e o último
erro do item pendente. Depois de resolver a causa, escolha `T` para revisar uma
nova tentativa de **1 item** e confirme novamente com `APAGAR`. Voltar ou cancelar
preserva a pausa; evidência insuficiente pausa novamente. Itens já concluídos não
são repetidos. Sessão expirada, desafios e limites do X exigem resolver a situação
ou aguardar antes de tentar.

Se uma pausa por `UNKNOWN_UI` continuar mesmo após tentar novamente, escolha `P`
para deixar o item problemático de fora **somente desta execução**. O menu mostra
a conta, tipo, ID, data e erro do item e exige `PULAR` digitado exatamente. Isso
não altera o X: o item fica registrado como `SKIPPED`, separado dos removidos na
coluna **Pulados**, e o histórico do erro é preservado. Cancelar mantém a pausa.
Depois, escolha a execução no painel para preparar um novo lote, com nova revisão
e confirmação `APAGAR`. Esta opção vale para POST, REPLY, REPOST e LIKE; não está
disponível para contornar sessão expirada, desafios ou limites do X. Retweets
manuais antigos com texto `RT @` podem precisar desse tratamento, pois o Archive
pode classificá-los como reposts embora sejam publicações próprias.

Se houver mais de uma execução para o mesmo tipo, o painel continua mostrando
uma única linha. As contagens são da execução selecionada, sem somar planos com
os mesmos itens. Planos que repetem itens de uma execução anterior aparecem como
**Conferência de remoções anteriores**: os itens pendentes podem já ter sido
removidos. A coluna **Tratados** inclui resultados como não encontrado; não é uma
contagem de exclusões realizadas.

Selecione o tipo e escolha `R` para continuar a conferência, `C` para encerrá-la
ou `H` para consultar o histórico. `R` leva à escolha da quantidade e à revisão
exata do lote, que exige nova confirmação `APAGAR`. Pausas por erro continuam
exigindo o fluxo de recuperação descrito acima.

Para encerrar, digite `ENCERRAR` na confirmação. Isso apenas arquiva a conferência
localmente: não altera o X, não marca itens pendentes como removidos e preserva
os resultados, tentativas e erros. A conferência encerrada permanece no histórico
e não pode ser retomada pelo comando `resume`. A opção `H` do painel mostra o
histórico de todas as execuções. No histórico de um tipo, você pode selecionar
outra execução para ver seus detalhes e, se ainda estiver aberta, preparar um
lote com nova revisão e `APAGAR`. Nenhuma conferência é encerrada automaticamente.

Depois de cada lote, pressione Enter para voltar ao painel ou `0` para sair.
Confira os resultados no X antes de abrir o próximo lote. Voltar ao painel não
autoriza outra exclusão: cada lote exige nova revisão e `APAGAR`.
Os comandos individuais continuam
disponíveis para importação, simulação, sessão, diagnóstico e relatórios.

## Fluxo seguro

Os exemplos abaixo usam o comando da instalação por npm. Na instalação
a partir do código-fonte, substitua `x-cleaner` por `node dist/cli.js` e execute
os comandos na pasta do projeto. `--data-dir` é opcional; se você o usar, repita
o **mesmo diretório** em todos os comandos para trabalhar com o mesmo catálogo.

1. No X, solicite e baixe o Archive oficial da própria conta. Preserve o ZIP
   original e escolha um diretório local privado.
2. Importe sem alterar o arquivo de origem (ZIP ou diretório extraído):

   ```bash
   x-cleaner "/caminho/para/x-archive.zip"
   x-cleaner status
   ```

   `x-cleaner import <caminho>` continua disponível.

3. Crie e revise uma simulação. Os tipos podem ser repetidos e as datas são
   limites inclusivos:

   ```bash
   x-cleaner dry-run --type POST --type REPLY
   x-cleaner dry-run --type REPOST --from 2024-01-01
   ```

   `dry-run` não abre o navegador e não altera o X. O plano exibido é um
   snapshot imutável; revise o total e os tipos antes de continuar.

4. Faça login manual no navegador oficial e confirme a conta detectada:

   ```bash
   x-cleaner session login
   x-cleaner session status
   ```

   O Chrome abre com um perfil separado do seu navegador habitual. Entre no X
   diretamente nessa janela, feche-a quando o programa pedir e confirme no
   terminal **somente se** a conta detectada for a sua.

5. Para cada etapa destrutiva, revise a saída e use uma autorização nova. O
   terminal exige a palavra exata `APAGAR`; ela significa que a etapa aprovada
   pode alterar a conta. Comece com um item:

   ```bash
   x-cleaner run ID_DO_PLANO --limit 1
   ```

   Substitua `ID_DO_PLANO` pelo identificador mostrado na simulação. O programa
   mostrará conta e itens antes de pedir `APAGAR`. Se não tiver certeza, cancele.

   Depois, se o resultado foi conferido no X e o proprietário autorizou uma
   nova etapa, use um limite pequeno. Não existe autorização implícita para uma
   execução posterior.

6. Se a execução for pausada ou interrompida com `Ctrl+C`, resolva a causa e
   retome apenas após revisar o estado:

   ```bash
   x-cleaner resume ID_DA_EXECUCAO --limit 10
   x-cleaner report ID_DA_EXECUCAO
   ```

   Substitua `ID_DA_EXECUCAO` pelo identificador exibido pelo programa.

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
x-cleaner session clear
```

Na instalação a partir do código-fonte, use `node dist/cli.js session clear`.

Para apagar todo o diretório local, pare todos os processos e remova-o
manualmente depois de revisar os relatórios. Isso é separado da limpeza da
sessão e não altera nem apaga o Archive original.

## Limitações conhecidas

- V1 cobre somente posts, replies, reposts e likes descobertos no Archive.
- Mensagens diretas, bookmarks, listas, seguidores, seguindo, comunidades,
  Spaces, mudanças de perfil, exclusão da conta, API do X, OAuth, GUI e serviço
  remoto estão fora do escopo.
- Um Archive real foi validado em uma conta, mas outras variantes podem ser
  incompatíveis. Fixtures sintéticas não substituem testes com seus dados.
- A automação depende dos seletores e estados atuais do X. Um estado não
  reconhecido pausa por segurança até uma manutenção do BrowserEngine.
- A ação no X é irreversível no sentido de que o X Cleaner não promete restaurar
  o conteúdo removido. Revise o dry-run e mantenha o Archive original antes de
  qualquer confirmação.
- A automação autenticada é visível, sequencial e limitada de propósito. Não há
  execução paralela, descoberta por rolagem infinita, bypass de segurança ou
  operação autônoma recorrente.

## Roadmap e idiomas

O beta precisa de validação com outras variantes de Archive e manutenção dos
seletores quando a interface do X mudar. Uma release estável e a abertura do
repositório exigem decisões separadas. Inglês e espanhol são extensões futuras
do catálogo; o CLI entregue é português-first. Um futuro `XApiEngine` também
permanece fora do V1.

## Segurança, licença e marca

Leia os arquivos `SECURITY.md` e `LICENSE` incluídos no pacote antes de usar ou
contribuir. O projeto usa a licença MIT; o repositório de desenvolvimento segue
privado até uma decisão separada do proprietário.

X Cleaner é um projeto independente e não é afiliado, endossado ou patrocinado
por X Corp., Twitter ou qualquer entidade relacionada. “X” e outras marcas
pertencem aos seus respectivos titulares.
