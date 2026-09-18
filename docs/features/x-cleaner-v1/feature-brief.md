# Feature Brief — X Cleaner V1

Este documento consolida o brief de produto existente e as decisões confirmadas na entrevista inicial.

---

## O que é essa feature?

Quero criar a primeira versão estável do X Cleaner: uma ferramenta local, gratuita e inicialmente privada para eu limpar o histórico da minha própria conta no X. Depois de funcionar de forma segura e confiável em uma conta real, o projeto poderá ser publicado como open source.

A aplicação será uma CLI em português, preparada para receber inglês e espanhol futuramente. Ela importará o X Archive como fonte de descoberta das interações e usará automação de navegador com Playwright para apagar posts e respostas, desfazer reposts e remover likes sem depender da API oficial paga do X.

A stack confirmada para a V1 é TypeScript, Node.js, Playwright e SQLite. A aplicação deve funcionar em macOS, Linux e Windows, com o desenvolvimento e a primeira validação real feitos no macOS.

---

## Por que estamos construindo isso?

O X não oferece uma forma nativa de limpar todo o histórico de uma conta mantendo o nome de usuário, seguidores e identidade da conta. As alternativas comerciais podem cobrar assinatura, exigir acesso de terceiros ou upload de dados sensíveis e continuar limitadas pela API oficial.

Quero resolver primeiro o problema na minha própria conta, que possui anos de histórico, mantendo o archive, a sessão autenticada e todo o estado da limpeza somente na máquina local. Se a solução provar que funciona, ela será preparada para outras pessoas auditarem e utilizarem como software open source.

---

## O que DEVE entrar nessa feature?

- Importar um X Archive completo em ZIP ou um diretório já extraído.
- Validar o archive, localizar os arquivos relevantes e normalizar posts, respostas, reposts e likes sem depender rigidamente de um único nome de arquivo.
- Manter um catálogo local das interações em SQLite, com deduplicação, tipo, data, origem e estado de processamento.
- Separar descoberta dos dados, planejamento da limpeza e execução, mantendo o Core independente do Playwright.
- Oferecer uma CLI em português com estrutura preparada para futura tradução para inglês e espanhol.
- Permitir seleção por tipo de interação e filtros básicos por data.
- Fornecer dry-run usando a mesma seleção que seria usada na execução real.
- Exigir confirmação destrutiva deliberada antes de qualquer remoção.
- Abrir o navegador para login manual no site oficial do X, sem pedir nem armazenar a senha.
- Persistir a sessão autenticada somente na máquina local e confirmar qual conta está conectada antes de operar.
- Apagar posts e respostas, desfazer reposts e remover likes usando uma abstração de engine e uma implementação BrowserEngine com Playwright.
- Registrar progresso, checkpoints, tentativas, pausas, itens concluídos, ignorados e falhos.
- Permitir interrupção segura com Ctrl+C e retomada sem repetir desnecessariamente operações concluídas.
- Tratar conteúdo inexistente, indisponível ou já removido como resultado esperado quando aplicável.
- Aplicar ritmo conservador, retry limitado e backoff, pausando diante de bloqueios, CAPTCHA ou necessidade de interação manual.
- Gerar relatório local ao fim ou interrupção da execução, sem expor cookies, tokens ou conteúdo privado desnecessário.
- Ter testes do Core sem navegador real e testes controlados da BrowserEngine.
- Suportar macOS, Linux e Windows, validando primeiro no macOS.
- Realizar validação destrutiva gradual na conta do proprietário: dry-run, depois um único item e somente então lotes pequenos, sempre com autorização explícita para cada execução destrutiva.

---

## O que NÃO entra nessa feature (por hora)?

- Exclusão de mensagens diretas ou mídia enviada em mensagens.
- Remoção de seguidores ou deixar de seguir contas.
- Limpeza de bookmarks, listas, comunidades ou Spaces.
- Alteração de nome, foto, biografia ou exclusão da conta.
- Interface gráfica, aplicação web, SaaS ou backend remoto.
- Upload do X Archive, sessão ou histórico para servidores externos.
- API oficial do X, OAuth, estimativa de custos ou XApiEngine.
- Telemetria ou analytics por padrão.
- Automação de múltiplas contas em massa.
- Contorno de CAPTCHA, limites, autenticação ou outros mecanismos de segurança do X.

---

## O que NÃO pode mudar de comportamento?

- O X Archive, o catálogo, os logs, os checkpoints e a sessão autenticada devem permanecer exclusivamente na máquina local.
- A ferramenta nunca deve pedir, capturar, registrar ou armazenar a senha do X.
- Nenhuma remoção pode acontecer durante dry-run ou antes de confirmação destrutiva explícita.
- Nenhuma execução destrutiva na conta real pode ser iniciada sem autorização explícita do proprietário para aquela etapa de validação.
- A conta autenticada deve ser identificada e confirmada antes de qualquer alteração.
- Interrupções, falhas transitórias, logout e conteúdo inexistente não podem apagar o progresso já persistido.
- O navegador não pode ser usado como crawler principal do histórico; o X Archive é a fonte primária de descoberta.
- O Core não pode depender diretamente de Playwright, seletores do X ou detalhes de uma futura API oficial.
- A ferramenta não pode tentar contornar CAPTCHA, bloqueios, rate limits ou mecanismos de segurança.
- O arquivo `x-cleaner-brief.md` da raiz permanece como referência integral da intenção original do produto.

---

## Regras de negócio que você já sabe?

- Os tipos iniciais são post, resposta, repost e like, selecionáveis separadamente.
- O mesmo mecanismo de filtros e seleção deve alimentar o dry-run e a execução real.
- O estado de cada interação deve permitir distinguir ao menos pendente, em processamento, concluída, ignorada, falha, não encontrada, indisponível e já removida.
- Operações retomadas devem ser idempotentes sempre que possível.
- Retries devem ter limite; a aplicação nunca pode entrar em loop infinito.
- Sinais de bloqueio ou limite devem salvar checkpoint e provocar pausa ou encerramento seguro, não tentativa de evasão.
- Seletores específicos da interface do X devem ficar isolados na BrowserEngine e priorizar roles, atributos semânticos, URLs previsíveis e identificadores estáveis.
- Logs não devem conter cookies completos, tokens, senha ou conteúdo privado desnecessário.
- Dados de teste versionados devem ser sintéticos e não podem conter informações da conta real.
- O projeto permanece privado durante o desenvolvimento e somente será tornado público depois da validação da V1.
- A licença atual é MIT.

---

## Quem usa essa feature?

- Proprietário da conta local: importa o próprio archive, escolhe o que remover, revisa o dry-run, confirma a conta e autoriza cada execução destrutiva.
- Futuro usuário open source: poderá executar a ferramenta localmente na própria conta após a validação e publicação do projeto.
- Contribuidor do projeto: desenvolve e audita código e testes, mas não recebe acesso ao archive, à sessão ou aos dados pessoais de outros usuários.

Não existem papéis administrativos, contas do X Cleaner ou operação remota na V1.

---

## Tem limite por plano / feature flag?

Não. A V1 não possui planos comerciais, contas no produto ou feature flags de cobrança. Durante o desenvolvimento, o próprio repositório privado e as confirmações de execução protegem o uso ainda não validado.

---

## Mexe em dado pessoal?

Sim. O X Archive, o nome da conta, IDs, datas, textos de interações, cookies e demais dados da sessão podem conter informações pessoais ou sensíveis.

Esses dados não devem sair da máquina local, não podem ser versionados e não serão enviados por telemetria, analytics, backend ou integração externa. Somente exemplos sintéticos e sanitizados podem fazer parte do repositório.

---

## Alguma referência ou observação extra?

- Brief técnico e estratégico original: `x-cleaner-brief.md`.
- Repositório: `https://github.com/markintux/x-cleaner`, mantido privado até a validação final.
- O X Archive real ainda precisa ser solicitado e baixado pelo proprietário. A implementação inicial pode usar fixtures sintéticas, mas a compatibilidade real do parser só poderá ser confirmada quando o archive estiver disponível.
- O nome X Cleaner permanece como nome de trabalho da V1.

## Perguntas em aberto

- Qual é a estrutura exata do X Archive atualmente fornecido para esta conta e quais variações reais o parser precisará aceitar? Essa resposta depende da obtenção e inspeção local do archive.
- Quais seletores e fluxos atuais da interface do X funcionam de forma estável para cada operação? Eles deverão ser confirmados de maneira controlada durante a implementação da BrowserEngine.
