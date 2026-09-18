# X Cleaner — Brief Técnico e Estratégia de Desenvolvimento

## 1. Visão Geral

O **X Cleaner** é uma ferramenta open source para permitir que uma pessoa limpe seu histórico de interações no X (antigo Twitter), mantendo sua conta ativa.

A ferramenta deve ser projetada para remover, de forma controlada e rastreável:

- posts;
- respostas;
- reposts;
- likes.

O objetivo principal é permitir que uma pessoa que utilizou o X durante muitos anos consiga “zerar” seu histórico de interações sem precisar excluir a conta, perder o `@username`, seguidores ou demais dados de identidade da conta.

A primeira versão deve funcionar **sem depender da API oficial paga do X**, utilizando automação do navegador.

Em uma fase futura, a arquitetura deve permitir adicionar um segundo motor baseado na **API oficial do X com OAuth**, sem necessidade de reescrever o restante da aplicação.

---

# 2. Objetivo do Produto

Criar uma ferramenta local, segura, gratuita e open source capaz de:

1. importar o arquivo oficial de dados exportado pelo X;
2. identificar o histórico de interações disponível nesse arquivo;
3. categorizar essas interações;
4. permitir que o usuário escolha o que deseja remover;
5. autenticar no X através do navegador, sem armazenar a senha;
6. executar as ações de remoção através da interface/web do X;
7. controlar progresso, falhas, pausas e retomadas;
8. gerar um relatório da limpeza executada;
9. futuramente suportar também a API oficial do X como motor alternativo.

---

# 3. Problema que a Ferramenta Resolve

O X não oferece uma função nativa para apagar todo o histórico de uma conta de uma única vez.

Ferramentas comerciais de terceiros normalmente:

- cobram assinatura;
- possuem limitações no plano gratuito;
- exigem autorização de acesso à conta;
- podem exigir upload do arquivo completo de dados do usuário;
- limitam a quantidade de interações que podem ser removidas;
- dependem das limitações da API oficial do X.

Além disso, APIs de timeline podem não fornecer todo o histórico de contas antigas.

O X Cleaner deve resolver esse problema utilizando o **arquivo oficial exportado pelo X como fonte de descoberta do histórico**, deixando o navegador apenas como executor das ações.

---

# 4. Princípio Arquitetural Central

A ferramenta deve separar completamente:

1. **descoberta dos dados**;
2. **planejamento da limpeza**;
3. **execução da limpeza**.

Fluxo conceitual:

```text
X Archive
    ↓
Parser
    ↓
Catálogo local de interações
    ↓
Plano de limpeza
    ↓
Engine de execução
    ↓
X
```

Na primeira versão:

```text
Engine
  └── Browser Automation
```

Futuramente:

```text
Engine
  ├── Browser Automation
  └── X Official API
```

O restante da aplicação não deve depender diretamente de Playwright, OAuth, endpoints HTTP específicos ou detalhes da interface do X.

---

# 5. Estratégia de Desenvolvimento

## Fase inicial

A primeira versão será baseada em:

- execução local;
- automação do navegador;
- importação do X Archive;
- CLI;
- armazenamento local de estado;
- nenhum serviço externo obrigatório;
- nenhuma API paga.

## Fase futura

Adicionar suporte à API oficial do X utilizando:

- OAuth 2.0 Authorization Code + PKCE;
- tokens de acesso;
- refresh token quando aplicável;
- endpoints oficiais para remoção de conteúdo;
- créditos Pay-Per-Use do X.

O usuário poderá então escolher qual motor utilizar.

Exemplo conceitual:

```text
Escolha o método de limpeza:

[1] Browser
    Gratuito
    Experimental

[2] X API
    Oficial
    Pode gerar custos
```

---

# 6. Escopo Funcional da Primeira Versão

A ferramenta deve permitir remover:

## 6.1 Posts

Posts publicados originalmente pelo próprio usuário.

---

## 6.2 Respostas

Posts do próprio usuário que sejam respostas a outros posts.

As respostas devem ser tratadas separadamente dos posts comuns para permitir que o usuário escolha:

```text
[x] Posts
[ ] Respostas
```

ou:

```text
[ ] Posts
[x] Respostas
```

---

## 6.3 Reposts

Interações em que o usuário republicou conteúdo de terceiros.

A ferramenta deve identificar os IDs relevantes no arquivo exportado e desfazer esses reposts quando possível.

---

## 6.4 Likes

Posts de terceiros marcados como curtidos pelo usuário.

Likes podem representar a maior parte do histórico de algumas contas, portanto esse fluxo deve ser:

- incremental;
- resiliente;
- retomável;
- tolerante a falhas.

---

# 7. Fora do Escopo Inicial

Não fazem parte obrigatoriamente da primeira versão:

- exclusão de DMs;
- remoção de seguidores;
- deixar de seguir contas;
- limpeza de bookmarks;
- alteração de foto;
- alteração de nome;
- alteração de bio;
- exclusão da conta;
- limpeza de listas;
- limpeza de mídia enviada em DMs;
- gerenciamento de comunidades;
- gerenciamento de Spaces.

Esses recursos podem ser avaliados futuramente.

---

# 8. X Archive como Fonte de Dados

O arquivo oficial exportado pelo X deve ser considerado a principal fonte de descoberta do histórico.

O usuário deverá baixar seu próprio arquivo através das configurações do X.

A ferramenta deve aceitar:

- arquivo ZIP completo; ou
- diretório já extraído.

O parser deve localizar automaticamente os arquivos relevantes dentro da estrutura do archive.

Exemplos de dados esperados:

- posts;
- likes;
- demais registros disponíveis no arquivo.

A implementação não deve assumir que os nomes dos arquivos serão eternamente imutáveis.

O parser deve ser tolerante a pequenas mudanças de estrutura.

---

# 9. Responsabilidades do Parser

O módulo de importação deve:

1. validar se o arquivo parece ser um X Archive válido;
2. identificar os arquivos relevantes;
3. interpretar a estrutura dos dados;
4. extrair IDs;
5. extrair datas quando disponíveis;
6. identificar o tipo de interação;
7. normalizar os registros;
8. evitar duplicações;
9. armazenar o catálogo localmente.

Cada interação normalizada deve possuir, quando aplicável:

- identificador;
- tipo;
- data;
- texto ou descrição resumida;
- URL ou possibilidade de reconstruí-la;
- status local;
- origem.

---

# 10. Modelo Conceitual de Interação

Uma interação deve ser tratada como uma entidade independente da fonte e do motor de execução.

Exemplo conceitual:

```text
Interaction
- id
- type
- created_at
- content
- source
- status
```

Tipos iniciais:

```text
POST
REPLY
REPOST
LIKE
```

Status possíveis:

```text
PENDING
PROCESSING
COMPLETED
SKIPPED
FAILED
NOT_FOUND
ALREADY_REMOVED
```

A nomenclatura definitiva pode variar na implementação.

---

# 11. Engine de Execução

A aplicação deve possuir uma abstração de engine.

Conceitualmente:

```text
CleanerEngine
```

Esse contrato deve representar operações como:

```text
delete post
delete reply
remove repost
remove like
verify authentication
verify account
```

A aplicação não deve conhecer os detalhes de como essas ações são executadas.

---

# 12. Browser Engine

A primeira implementação será um motor baseado em automação do navegador.

Playwright é a tecnologia de referência inicial, mas a arquitetura geral deve continuar agnóstica à linguagem.

Responsabilidades:

- abrir o navegador;
- utilizar uma sessão autenticada;
- navegar até recursos específicos;
- executar ações;
- interpretar sucesso;
- interpretar conteúdo inexistente;
- interpretar falhas;
- detectar bloqueios temporários;
- retornar resultados normalizados para o restante da aplicação.

---

# 13. Autenticação

A ferramenta **não deve solicitar nem armazenar a senha do X**.

Fluxo esperado:

```text
Abrindo navegador...

Faça login no X normalmente.
```

O login acontece diretamente no site oficial.

Após login bem-sucedido, a ferramenta pode armazenar localmente o estado da sessão do navegador.

Esse estado deve:

- permanecer apenas na máquina do usuário;
- nunca ser enviado a servidores externos;
- nunca ser commitado;
- ser ignorado pelo Git;
- poder ser apagado manualmente;
- ser invalidado caso a sessão expire.

---

# 14. Sessão Local

Exemplo conceitual:

```text
.x-cleaner/
├── session
├── state
├── logs
└── checkpoints
```

Essa pasta deve estar ignorada pelo versionamento.

Nunca deve conter credenciais em texto simples quando houver alternativa segura.

---

# 15. Identificação da Conta

Antes de iniciar qualquer limpeza, o sistema deve confirmar a conta autenticada.

Exemplo:

```text
Conta detectada:

@usuario

Confirma que deseja operar nesta conta?
```

Isso reduz o risco de o usuário estar autenticado acidentalmente em outra conta.

---

# 16. Fluxo Principal da CLI

Exemplo conceitual:

```text
X Cleaner
────────────────────────────

[1] Importar X Archive
[2] Analisar histórico
[3] Iniciar limpeza
[4] Continuar limpeza anterior
[5] Ver relatório
[0] Sair
```

Após análise:

```text
Histórico encontrado:

Posts:        1.842
Respostas:      723
Reposts:        416
Likes:        8.291

Total:       11.272
```

---

# 17. Seleção do que Remover

A ferramenta deve permitir seleção granular.

Exemplo:

```text
O que deseja remover?

[1] Posts
[2] Respostas
[3] Reposts
[4] Likes
[5] Tudo
```

A interface final pode utilizar checkboxes, menus ou flags.

---

# 18. Filtros

A arquitetura deve permitir filtros mesmo que alguns sejam implementados apenas em fases posteriores.

Filtros desejáveis:

- tudo;
- antes de determinada data;
- depois de determinada data;
- intervalo de datas;
- somente posts;
- somente respostas;
- somente reposts;
- somente likes.

Possíveis filtros futuros:

- preservar posts fixados;
- preservar posts com determinado número de likes;
- preservar conteúdo contendo determinadas palavras;
- preservar IDs específicos;
- preservar conteúdo de determinadas datas;
- blacklist;
- whitelist.

---

# 19. Dry Run

A ferramenta deve possuir modo de simulação.

Nesse modo:

- nenhuma alteração deve ser feita no X;
- o usuário deve receber um resumo exato ou estimado do que seria removido.

Exemplo:

```text
DRY RUN

Nenhuma alteração será realizada.

Posts:       1.842
Respostas:     723
Reposts:       416
Likes:       8.291

Total que seria removido:
11.272
```

O dry-run deve utilizar o mesmo mecanismo de seleção da execução real.

---

# 20. Confirmação Destrutiva

A ferramenta nunca deve iniciar uma exclusão em massa imediatamente após a seleção.

Antes de executar:

```text
Você está prestes a remover:

1.842 posts
723 respostas
416 reposts
8.291 likes

Total: 11.272 interações

Essa operação pode ser irreversível.

Digite DELETE para continuar:
```

A palavra ou mecanismo definitivo de confirmação pode variar.

O importante é exigir uma confirmação deliberada.

---

# 21. Checkpoints

Checkpoint é um requisito obrigatório.

A limpeza pode envolver milhares de operações e levar um tempo considerável.

A ferramenta deve registrar continuamente:

- itens concluídos;
- itens pendentes;
- itens ignorados;
- itens com erro;
- último ponto seguro de execução.

Se o processo for interrompido por:

- fechamento do terminal;
- `Ctrl+C`;
- crash;
- perda de internet;
- logout;
- erro do X;

a execução deve poder continuar posteriormente.

Exemplo:

```text
Uma execução anterior foi encontrada.

Posts:    1.250 / 2.417
Likes:    3.812 / 12.491

[1] Continuar
[2] Reiniciar
[3] Cancelar
```

---

# 22. Idempotência

Sempre que possível, operações devem ser idempotentes.

Exemplos:

- tentar apagar algo que já foi apagado não deve interromper a execução;
- tentar remover um like já removido deve resultar em status equivalente a `ALREADY_REMOVED`;
- conteúdo inexistente deve ser registrado e ignorado;
- uma execução retomada não deve repetir desnecessariamente milhares de operações concluídas.

---

# 23. Retry

Erros transitórios devem possuir retry automático.

Exemplos:

- timeout;
- carregamento incompleto;
- falha temporária de rede;
- resposta inesperada;
- página não carregada;
- bloqueio temporário.

O retry deve possuir limites.

A aplicação nunca deve entrar em loop infinito.

---

# 24. Delays

A ferramenta não deve executar milhares de ações em velocidade artificialmente máxima.

Deve existir controle de ritmo.

Pode ser utilizado:

- pequeno delay entre operações;
- variação aleatória controlada;
- pausa maior após determinado número de ações;
- backoff progressivo após falhas.

O objetivo é:

- reduzir instabilidade;
- respeitar comportamento razoável;
- evitar sobrecarregar o site;
- diminuir bloqueios temporários.

---

# 25. Rate Limiting e Bloqueios

Mesmo utilizando o navegador, o X pode limitar ações.

A aplicação deve detectar sinais como:

- excesso de requisições;
- botões temporariamente indisponíveis;
- erros 429;
- mensagens de limite;
- falhas repetidas.

Quando isso ocorrer:

1. registrar a situação;
2. salvar checkpoint;
3. aplicar pausa/backoff;
4. tentar novamente quando apropriado;
5. nunca perder o progresso.

---

# 26. Progresso

A CLI deve mostrar progresso de forma clara.

Exemplo:

```text
Posts
████████████████████ 1842/1842

Respostas
████████████████████ 723/723

Reposts
██████████████░░░░░░ 301/416

Likes
██████░░░░░░░░░░░░░░ 2512/8291
```

Também deve ser possível visualizar:

- quantidade concluída;
- quantidade restante;
- quantidade ignorada;
- quantidade com falha.

---

# 27. Logs

A aplicação deve gerar logs locais.

Os logs devem registrar:

- início de execução;
- conta detectada;
- archive importado;
- opções escolhidas;
- operações executadas;
- erros;
- retries;
- pausas;
- status final.

Os logs não devem registrar:

- senha;
- cookies completos;
- tokens sensíveis;
- informações desnecessárias do conteúdo privado.

---

# 28. Relatório Final

Ao concluir, a ferramenta deve mostrar resumo.

Exemplo:

```text
Limpeza concluída.

Posts removidos:        1.842
Respostas removidas:      723
Reposts removidos:        416
Likes removidos:        8.247

Já removidos:               31
Não encontrados:            13
Falhas:                       0

Total processado:        11.272
```

O relatório pode também ser salvo localmente.

---

# 29. Segurança

A aplicação deve seguir os seguintes princípios:

## Dados locais

O processamento do archive deve ocorrer localmente.

Nenhum arquivo deve ser enviado automaticamente a terceiros.

---

## Senha

A ferramenta nunca deve pedir a senha do X.

---

## Sessão

O estado autenticado deve permanecer local.

---

## Open Source

O usuário deve poder auditar exatamente o que a ferramenta executa.

---

## Confirmações

Ações destrutivas devem exigir confirmação explícita.

---

# 30. Privacidade

O X Archive pode conter informações extremamente sensíveis.

Portanto:

- não enviar archive para servidor;
- não adicionar telemetria por padrão;
- não registrar conteúdo completo em logs sem necessidade;
- não enviar IDs ou histórico para analytics;
- não criar conta no X Cleaner;
- não exigir backend remoto.

A filosofia inicial do projeto deve ser:

> Local-first.

---

# 31. Seletores e Fragilidade da Interface

Automação de navegador possui fragilidade natural.

A implementação deve evitar dependência excessiva de:

- classes CSS geradas;
- estrutura profunda de DOM;
- índices fixos;
- seletores frágeis.

Priorizar, quando disponíveis:

- URLs previsíveis;
- `data-testid`;
- roles;
- atributos semânticos;
- elementos estáveis;
- padrões consistentes da própria interface.

Todo detalhe específico da interface deve ficar isolado dentro do Browser Engine.

---

# 32. Estratégia contra Mudanças do X

Mudanças no frontend do X não devem exigir alterações em toda a aplicação.

Estrutura conceitual:

```text
Core
 ↓
CleanerEngine
 ↓
BrowserEngine
 ↓
X UI
```

Se um seletor mudar:

```text
alterar BrowserEngine
```

e não:

```text
alterar Parser
alterar CLI
alterar Checkpoint
alterar filtros
alterar relatório
```

---

# 33. Não Usar o Navegador como Crawler Principal

A aplicação não deve depender de rolar infinitamente a timeline para descobrir o histórico.

Abordagem desejada:

```text
X Archive
   ↓
IDs
   ↓
Browser
   ↓
ações específicas
```

Não:

```text
Browser
   ↓
rolar timeline
   ↓
descobrir posts
   ↓
rolar mais
   ↓
rolar mais
```

Essa decisão é central para tornar a ferramenta útil em contas antigas.

---

# 34. Conta com Muitos Anos de Histórico

A ferramenta deve ser projetada considerando contas com:

- milhares de posts;
- milhares de respostas;
- milhares de reposts;
- dezenas de milhares de likes.

Portanto, nenhum fluxo deve pressupor que a limpeza terminará em poucos minutos ou em uma única execução.

---

# 35. Estado Persistente

A ferramenta deve possuir armazenamento local suficiente para representar:

- archive importado;
- catálogo normalizado;
- plano de limpeza;
- status das interações;
- checkpoints;
- configuração;
- sessão.

A tecnologia concreta pode ser escolhida durante desenvolvimento.

Possibilidades:

- JSON;
- SQLite;
- banco embutido;
- outro armazenamento local apropriado.

Para volumes grandes, deve ser considerada a escalabilidade dessa escolha.

---

# 36. CLI Primeiro

A primeira interface deve ser CLI.

Motivos:

- menor complexidade;
- mais fácil de depurar;
- ideal para ferramenta open source;
- reduz escopo inicial;
- acelera validação.

Uma GUI pode ser criada no futuro.

---

# 37. Experiência Desejada

A ferramenta deve ser acessível mesmo para usuários não especialistas.

Exemplo:

```text
X Cleaner

✓ Archive carregado
✓ Conta conectada: @usuario

Encontramos:

2.417 posts
931 respostas
643 reposts
12.491 likes

O que deseja remover?
```

Mensagens de erro devem ser compreensíveis.

Evitar exigir conhecimento de:

- OAuth;
- cookies;
- API;
- DevTools;
- JavaScript;
- endpoints;
- headers.

---

# 38. Interrupção Manual

`Ctrl+C` deve ser tratado como interrupção válida.

Quando possível:

```text
Interrupção detectada.

Salvando checkpoint...

✓ Progresso salvo.

Execute novamente para continuar.
```

---

# 39. Falha de Autenticação

Se a sessão expirar:

```text
Sua sessão do X expirou.

O navegador será aberto novamente para autenticação.
```

Após autenticação:

```text
✓ Sessão restaurada.

Continuando da interação 4.218...
```

---

# 40. Conteúdo que Não Pode Mais Ser Acessado

Alguns registros do archive podem apontar para conteúdo:

- já removido;
- suspenso;
- indisponível;
- privado;
- inexistente.

Esses casos não devem ser tratados automaticamente como falha crítica.

Registrar como, por exemplo:

```text
NOT_FOUND
ALREADY_REMOVED
UNAVAILABLE
```

e continuar.

---

# 41. Testabilidade

O Core não deve depender diretamente de um navegador real.

Deve ser possível testar:

- parser;
- filtros;
- plano de limpeza;
- checkpoints;
- relatórios;
- transições de status;

sem acessar o X.

O engine deve poder ser substituído por implementação fake/mock durante testes.

---

# 42. Separação de Responsabilidades

Organização conceitual sugerida:

```text
Core
├── Models
├── Archive Parser
├── Cleaning Plan
├── Filters
├── Checkpoint
├── Reporting
└── Engine Contract

Infrastructure
├── Browser Engine
├── Local Storage
└── Logging

Interface
└── CLI
```

A nomenclatura concreta ficará a cargo da stack escolhida.

---

# 43. Futuro: API Oficial

A arquitetura deve prever um segundo engine.

Fluxo:

```text
CleanerEngine
├── BrowserEngine
└── XApiEngine
```

O XApiEngine deverá utilizar OAuth oficial.

Objetivos:

- maior estabilidade;
- menor dependência do frontend;
- uso de endpoints oficiais;
- possibilidade de uso profissional da ferramenta.

---

# 44. OAuth Futuro

A implementação futura deverá preferir:

```text
OAuth 2.0 Authorization Code + PKCE
```

O usuário será redirecionado para o X e autorizará a aplicação.

A ferramenta não deve capturar senha.

Scopes dependerão da API vigente no momento da implementação.

Exemplos esperados:

```text
tweet.read
tweet.write
users.read
like.read
like.write
offline.access
```

A lista exata deverá ser confirmada novamente na documentação oficial antes da implementação.

---

# 45. Custo da API Oficial

Atualmente a API do X utiliza modelo Pay-Per-Use.

Portanto, o engine oficial deverá:

1. informar que pode gerar custos;
2. calcular ou estimar custos antes da execução quando possível;
3. nunca iniciar milhares de operações sem confirmação.

Exemplo:

```text
Engine: X API

Operações previstas: 8.412

Custo estimado:
US$ XX.XX

Deseja continuar?
```

A tabela de preços deverá ser tratada como informação dinâmica.

Nunca hardcodar preços como regra permanente do produto.

---

# 46. Por que o Archive Continua Importante com a API

Mesmo após introduzir a API oficial, o X Archive deve continuar sendo suportado.

Motivo:

APIs de timeline podem possuir limites de histórico.

Estratégia futura:

```text
X Archive
   ↓
IDs conhecidos
   ↓
X API
   ↓
remoção
```

Isso reduz:

- dependência de leitura via API;
- custo;
- limitações de timeline;
- dificuldade para contas antigas.

---

# 47. Modo Híbrido Futuro

A versão madura pode permitir:

```text
Fonte de dados:

[1] X Archive
[2] X API
[3] Ambos
```

E:

```text
Engine de execução:

[1] Browser
[2] X API
```

Essas duas decisões devem continuar independentes.

---

# 48. Estratégia de Versionamento

Sugestão inicial:

## v0.1

- estrutura base;
- CLI;
- sessão no navegador;
- remoção de posts;
- checkpoint mínimo.

---

## v0.2

- respostas;
- reposts;
- melhoria de status e erros.

---

## v0.3

- likes;
- resiliência para grandes volumes.

---

## v0.4

- importação robusta do X Archive;
- catálogo local;
- checkpoints completos;
- retomada.

---

## v0.5

- dry-run;
- filtros;
- relatórios;
- melhorias de UX.

---

## v0.6

- testes mais amplos;
- proteção contra mudanças da interface;
- documentação open source;
- empacotamento.

---

## v1.0

Primeira versão considerada estável com:

- archive;
- posts;
- respostas;
- reposts;
- likes;
- browser engine;
- checkpoint;
- retomada;
- dry-run;
- filtros básicos;
- logs;
- relatório.

---

## v1.x

- XApiEngine;
- OAuth;
- estimativa de custo;
- seleção de engine.

---

# 49. Fases de Desenvolvimento Sugeridas para o Harness

O harness deve gerar fases pequenas e validáveis.

Sugestão:

### Fase 1 — Fundação

Definir:

- estrutura;
- modelos;
- estados;
- configuração;
- interfaces.

Sem automação real.

---

### Fase 2 — X Archive

Implementar:

- validação;
- leitura;
- parsing;
- normalização;
- contagem.

Critério principal:

```text
Dado um archive válido,
a ferramenta consegue apresentar
quantos posts, respostas, reposts e likes encontrou.
```

---

### Fase 3 — Persistência

Implementar:

- catálogo local;
- status;
- checkpoints;
- retomada.

Sem excluir nada ainda.

---

### Fase 4 — Browser Session

Implementar:

- abertura do navegador;
- login manual;
- persistência segura da sessão;
- detecção da conta autenticada.

---

### Fase 5 — Posts

Implementar somente:

- exclusão de posts;
- resultado;
- retry;
- checkpoint;
- retomada.

Validar em pequena quantidade antes de continuar.

---

### Fase 6 — Respostas

Adicionar tratamento específico para respostas.

---

### Fase 7 — Reposts

Adicionar desfazer reposts.

---

### Fase 8 — Likes

Adicionar remoção de likes.

Dar atenção especial a:

- volume;
- ritmo;
- retry;
- retomada.

---

### Fase 9 — Dry Run e Filtros

Adicionar:

- simulação;
- filtros por tipo;
- filtros por data;
- preview.

---

### Fase 10 — UX da CLI

Melhorar:

- menus;
- progresso;
- mensagens;
- confirmações;
- relatório.

---

### Fase 11 — Robustez

Testar:

- milhares de registros;
- interrupções;
- logout;
- perda de internet;
- conteúdo inexistente;
- mudança parcial do DOM;
- erro repetido.

---

### Fase 12 — Open Source Release

Preparar:

- README;
- licença;
- instalação;
- exemplos;
- segurança;
- troubleshooting;
- contribuição;
- release inicial.

---

# 50. Critérios de Aceite da Primeira Versão Estável

A v1.0 somente deve ser considerada pronta quando:

1. o usuário consegue importar seu X Archive;
2. o sistema identifica as categorias suportadas;
3. o usuário consegue escolher o que remover;
4. existe dry-run;
5. existe confirmação destrutiva;
6. login é realizado diretamente no X;
7. senha nunca é armazenada;
8. a conta autenticada é confirmada;
9. posts podem ser removidos;
10. respostas podem ser removidas;
11. reposts podem ser desfeitos;
12. likes podem ser removidos;
13. operações concluídas são registradas;
14. falhas não interrompem necessariamente toda a execução;
15. o processo pode ser interrompido;
16. o processo pode ser retomado;
17. conteúdo inexistente é tratado;
18. existe relatório final;
19. archive e sessão permanecem locais;
20. nenhuma API paga é obrigatória.

---

# 51. Riscos Técnicos

## Mudanças no X

O frontend pode mudar e quebrar seletores.

Mitigação:

- BrowserEngine isolado;
- seletores estáveis;
- testes;
- versionamento.

---

## Rate Limits

O X pode limitar operações repetidas.

Mitigação:

- delays;
- backoff;
- checkpoints;
- retomada.

---

## Conta Bloqueada Temporariamente

Automação intensiva pode acionar proteções.

Mitigação:

- ritmo conservador;
- pausa;
- não tentar burlar proteções;
- permitir retomada posterior.

---

## Archive Incompleto

O formato pode mudar.

Mitigação:

- parser modular;
- validação;
- mensagens claras;
- testes com múltiplos archives.

---

## Conteúdo Antigo Inexistente

Parte do histórico pode não existir mais.

Mitigação:

- tratar como estado esperado;
- não considerar fatal.

---

# 52. Princípios de Segurança Operacional

A ferramenta não deve tentar:

- contornar CAPTCHA;
- burlar autenticação;
- derrotar mecanismos de segurança;
- mascarar comportamento malicioso;
- utilizar proxies para escapar de limites;
- manipular múltiplas contas de forma abusiva.

Quando o X exigir interação manual legítima, a ferramenta deve pausar e pedir que o usuário conclua a ação no navegador.

---

# 53. Open Source

O projeto deverá preferencialmente:

- possuir licença open source;
- explicar claramente limitações;
- explicar que não é afiliado ao X;
- informar que automação de browser pode quebrar;
- recomendar backup do archive;
- deixar claro que exclusões podem ser irreversíveis.

---

# 54. README Futuro

O README deverá conter:

- objetivo;
- screenshots ou exemplos;
- instalação;
- requisitos;
- como baixar o X Archive;
- como executar;
- dry-run;
- como continuar uma limpeza;
- segurança;
- privacidade;
- limitações;
- troubleshooting;
- roadmap;
- contribuição;
- licença.

---

# 55. Nome do Projeto

Nome provisório:

```text
X Cleaner
```

Alternativas:

```text
x-cleaner
x-wipe
x-history-cleaner
```

O nome final não é requisito para iniciar o desenvolvimento.

---

# 56. Diretriz de Produto

A primeira prioridade não é criar um SaaS ou produto comercial.

A prioridade é:

> resolver corretamente a limpeza de uma conta real.

Depois de validado:

1. estabilizar;
2. documentar;
3. abrir o código;
4. adicionar engine oficial;
5. avaliar outras interfaces.

---

# 57. Diretriz para o Harness

Este documento deve ser utilizado como **brief de produto e arquitetura**.

O harness deve transformar esse brief em fases incrementais.

Cada fase deve:

1. possuir objetivo claro;
2. evitar escopo excessivo;
3. possuir critérios de aceite;
4. ser testável isoladamente;
5. não implementar funcionalidades de fases futuras sem necessidade;
6. respeitar as abstrações definidas;
7. manter o Core independente do método de automação;
8. priorizar segurança, retomada e previsibilidade.

Nenhuma fase deve presumir linguagem específica.

A linguagem e stack podem ser definidas posteriormente.

---

# 58. Decisões Já Tomadas

As seguintes decisões fazem parte do brief e não precisam ser rediscutidas inicialmente:

- ferramenta open source;
- execução local;
- primeira versão gratuita;
- primeira engine baseada em browser automation;
- Playwright como referência inicial;
- X Archive como principal fonte de descoberta do histórico;
- CLI como primeira interface;
- senha nunca será armazenada;
- sessão fica apenas localmente;
- checkpoint é obrigatório;
- retomada é obrigatória;
- dry-run é obrigatório para a versão estável;
- confirmação destrutiva é obrigatória;
- Core deve ser independente do browser;
- arquitetura deve permitir XApiEngine no futuro;
- API oficial será adicionada apenas posteriormente;
- API oficial pode ser paga;
- archive continuará útil mesmo após a API;
- posts, respostas, reposts e likes são o escopo inicial;
- DMs e demais interações ficam fora do MVP.

---

# 59. Definição de Sucesso

O projeto será considerado bem-sucedido quando uma pessoa com anos de histórico no X puder:

```text
baixar seu archive
       ↓
executar X Cleaner
       ↓
entrar no X pelo navegador
       ↓
visualizar seu histórico
       ↓
selecionar o que deseja remover
       ↓
simular a operação
       ↓
confirmar
       ↓
deixar a ferramenta trabalhar
       ↓
interromper se necessário
       ↓
continuar posteriormente
       ↓
terminar com sua conta limpa
```

sem:

- entregar sua senha a terceiros;
- pagar por uma ferramenta SaaS;
- enviar seu archive para um servidor;
- perder o progresso em caso de interrupção;
- depender de rolagem manual da timeline.

---

# 60. Resumo Estratégico

A estratégia do X Cleaner é:

```text
LOCAL-FIRST
+
X ARCHIVE
+
BROWSER AUTOMATION
+
CHECKPOINT
+
DRY RUN
+
ENGINE ABSTRACTION
```

Primeiro:

```text
X Archive
    +
Browser Engine
```

Depois:

```text
X Archive
    +
X API Engine
```

A automação via browser resolve o problema imediato sem exigir pagamento pelo uso da API oficial.

A abstração de engine evita que essa primeira implementação transforme o projeto em um script descartável.

O X Archive resolve a principal dificuldade de contas antigas: localizar interações que não estão necessariamente acessíveis através de timelines convencionais.

Checkpoint, idempotência, retry e retomada devem ser tratados como funcionalidades centrais, e não como melhorias posteriores, porque uma limpeza real pode envolver milhares ou dezenas de milhares de interações.

A ferramenta deve permanecer simples para o usuário, conservadora em ações destrutivas, local por padrão e preparada para evoluir sem reescrever seu núcleo.
