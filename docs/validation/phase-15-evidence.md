# Evidência sanitizada da Fase 15

**Estado:** `PENDENTE` / `NOT-CODE`  
**Archive real:** `DISPONÍVEL LOCALMENTE`
**Ações destrutivas:** `LOTES PEQUENOS DOS QUATRO TIPOS CONCLUÍDOS E VERIFICADOS`
**Publicação:** `BLOQUEADA`

Este registro contém somente resultados mecânicos e sanitizados observados
localmente. Não é uma declaração de compatibilidade real nem substitui o
runbook, as autorizações ao vivo ou a aprovação do proprietário.

## Gates mecânicos registrados

| Verificação | Resultado | Escopo sanitizado |
|---|---|---|
| `npm run check` | `PASSOU` | 46 arquivos de teste, 209 testes; typecheck, lint, formatação e build passaram |
| `npm run test:coverage` | `PASSOU` | 46 arquivos de teste, 209 testes; statements 78.25%, branches 68.98%, functions 79.81%, lines 79.69% |
| `npm pack --dry-run` | `PASSOU` | 218 arquivos no pacote privado; sem publicação |
| `npm run check:private-artifacts` | `PASSOU` | Nenhuma violação encontrada; caminho local omitido |
| CI `f2a558a` | `PASSOU` | macOS, Linux e Windows: scanner, formatação, lint, typecheck, testes, cobertura, build e inspeção do pacote |

A tentativa preliminar de executar `npm run check` e `npm run test:coverage` em
paralelo não é usada como evidência final: houve um timeout de hook no
fechamento de uma suíte de navegador. Os dois comandos foram repetidos
serialmente e os resultados `PASSOU` acima são os únicos resultados usados como
gate desta fase.

## Auditoria da automação

**Resultado:** `PASSOU` para o escopo desta fase.

- O workflow CI executa apenas instalação, scanner, checks, testes sintéticos,
  cobertura, build e inspeção de pacote; não contém login real, Archive real,
  publicação ou mudança de visibilidade.
- Os scripts e `package.json` não contêm comando de publicação de pacote/release
  nem mudança de visibilidade.
- Os testes/fixtures usam páginas locais, engines e sessões injetadas. A frase
  `APAGAR` aparece somente como entrada de confirmação sintética; não há
  credencial, sessão X real ou caminho do Archive do proprietário.
- A verificação foi feita sem abrir o perfil normal, sem consultar Archive real
  e sem executar ação destrutiva.

## Gates manuais

- [x] Archive local adquirido e checksum registrado: `CONCLUÍDO`.
- [x] Import offline, contagens e decisão do adapter: `COMPATÍVEL`; 557 interações normalizadas.
- [x] Sessão dedicada e correspondência da conta: `MATCH`.
- [x] Dry-run e revisão do plano exato: `PASSOU`; plano somente de `POST`, 268 itens.
- [x] Exatamente um item com autorização nova e verificação no X: `COMPLETED`; página posteriormente confirmou item inexistente.
- [x] Lote pequeno com autorização nova e verificação no X: `COMPLETED`; limite 3, três outcomes `COMPLETED`, zero erros e três verificações independentes de item inexistente.
- [x] Interrupção `Ctrl+C`, checkpoint e resume: `PASSOU`. A primeira tentativa real saiu com run/lote `RUNNING` e lock órfão; dois itens foram concluídos e confirmados como ausentes no X. No primeiro reteste, o checkpoint e os estados `INTERRUPTED` persistiram, mas o handler SIGINT padrão do Playwright encerrou o processo com código 130 e deixou lock órfão; um item foi concluído e confirmado como ausente no X. Cada lock foi diagnosticado e removido pelo CLI, com confirmação destrutiva cancelada. Após desativar esse handler, o segundo reteste real passou: um único `Ctrl+C`, saída zero, run/lote `INTERRUPTED`, checkpoint `MANUAL_INTERRUPT`, nenhum item `PROCESSING`, nenhum lock e nenhum item novo agendado. O único item concluído foi confirmado como ausente no X. Uma retomada com autorização separada executou exatamente um item pendente, sem repetir os 12 concluídos, e o item novo foi confirmado como ausente no X.
- [x] Um `REPLY` autorizado: `COMPLETED`; o status foi confirmado como inexistente no X e o lote fechou sem lock.
- [x] Um `LIKE` autorizado: a primeira tentativa pausou antes do clique por evidência tardia; após correção e autorização nova, `COMPLETED`. A verificação independente encontrou o controle `Like` e nenhum `Unlike` no status exato.
- [x] Um `REPOST` autorizado: `COMPLETED` após provar o redirecionamento do ID do Archive ao status canônico, o alvo único, a marca do repost do proprietário e a confirmação semântica. A verificação independente encontrou o URL do repost inexistente e nenhum controle `unretweet` ativo. Outra tentativa anterior terminou `FAILED` com `UNSUPPORTED_INTERACTION_TYPE`, sem mutação no X. Antes do reteste descrito abaixo, uma inspeção somente de leitura confirmou que esse segundo repost continuava ativo; `resume` não selecionava esse item `FAILED`.
- [x] Uma nova simulação `REPOST` foi criada sem abrir navegador nem alterar o X; o primeiro item do plano foi comparado por identificador interno ao único `REPOST` histórico em `FAILED` e corresponde exatamente a ele. Com nova autorização específica, o X Cleaner executou somente esse item (`--limit 1`): lote `COMPLETED`, item `COMPLETED`, run `PAUSED`, zero itens em processamento. A verificação independente no X encontrou a página desse repost inexistente, nenhum controle `unretweet`, nenhuma tela de login ou desafio.
- [x] Cinco relatórios locais gerados e revisados. Os quatro anteriores registram `POST` 13 concluídos/255 pendentes; `REPLY` 1/120; `REPOST` 1/154, com 1 falha histórica; `LIKE` 1/11. O relatório do novo run `REPOST` registra 1 concluído/155 pendentes, zero falhas e estado `PAUSED`. Os cinco JSON contêm somente campos previstos e valores agregados; seus hashes conferem com o ledger. As contagens dos planos históricos são snapshots independentes e não devem ser somadas.
- [x] Nova execução local de `npm run check`: 46 arquivos, 209 testes, typecheck, lint, formatação e build passaram. A primeira tentativa teve timeout transitório na abertura do Chromium em seis suítes; uma suíte isolada e a repetição integral passaram. `npm run test:coverage`, `npm run check:private-artifacts`, `git diff --check`, `npm pack --dry-run` e `npm run inspect:package` também passaram; o pacote privado contém 218 arquivos.
- [x] Revisão local de privacidade: `PASSOU`. Os cinco relatórios foram auditados quanto a campos e valores; não há conteúdo, credenciais, URLs ou caminhos privados. O scanner do repositório e do pacote, a inspeção de distribuição e a revisão da evidência sanitizada passaram.
- [x] CI multiplataforma para código e evidência da validação: `PASSOU` no commit `f2a558a`, com os três jobs concluídos. No macOS, o primeiro fetch do checkout falhou transitoriamente; o retry obteve o commit correto e todos os gates passaram.
- [ ] Aprovação final do proprietário: `PENDENTE`.

Os testes destrutivos listados acima tiveram autorização individual e execução
limitada. A limpeza integral, a publicação e a declaração de validação final
continuam pendentes dos gates restantes e da aprovação do proprietário.
