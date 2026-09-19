import type { MessageCatalog } from "./catalog.js";

export const ptBR: MessageCatalog = {
  "cli.description": "Organiza localmente o histórico da sua própria conta no X.",
  "cli.dataDirectoryOption": "diretório local isolado para os dados da aplicação",
  "cli.statusDescription": "mostra o diretório local controlado pelo X Cleaner",
  "cli.importDescription": "importa um arquivo ZIP ou diretório de X Archive",
  "cli.dryRunDescription": "cria uma simulação imutável sem alterar o X",
  "cli.typeOption": "tipo de interação a selecionar (pode ser repetido)",
  "cli.fromOption": "limite inicial inclusivo",
  "cli.toOption": "limite final inclusivo",
  "cli.limitOption": "quantidade máxima desta confirmação",
  "cli.runDescription": "executa um plano revisado com nova confirmação",
  "cli.resumeDescription": "retoma uma execução com nova confirmação",
  "run.planId": "Plano revisado: {planId}",
  "run.runId": "Execução: {runId}",
  "run.typeCounts":
    "Tipos selecionados: POST={posts}; REPLY={replies}; REPOST={reposts}; LIKE={likes}",
  "run.total": "Total: {count}",
  "run.account": "Conta vinculada: @{handle}",
  "run.warning": "AVISO: esta ação é irreversível e altera sua conta no X.",
  "run.confirmInstruction": "Digite exatamente APAGAR para continuar.",
  "run.confirmQuestion": "Confirmação:",
  "run.canceled": "Execução cancelada; nenhuma interação foi enviada à engine.",
  "run.completed": "Run {runId} concluído nesta etapa: {count} item(ns).",
  "run.paused":
    "Execução pausada por {reason}; o estado foi salvo. Resolva a situação manualmente e use `x-cleaner resume {runId}`.",
  "run.interrupted":
    "Execução interrompida com segurança. O estado confirmado foi preservado; use `x-cleaner resume {runId}`.",
  "status.dataDirectory": "Diretório local de dados: {dataDirectory}",
  "status.localOnlyNotice":
    "Seus arquivos, sessão, registros, pontos de controle e relatórios permanecem somente neste computador. Nenhuma conexão com o X foi realizada.",
  "status.account": "Conta local: @{handle}",
  "status.accountMissing": "Conta local: ainda não identificada",
  "status.imports": "Importações: {total}",
  "status.importLifecycle":
    "Ciclo de importações — concluídas: {completed}; em andamento: {processing}; falhas: {failed}",
  "status.catalog": "Catálogo: {total} interações",
  "status.typeCount": "{type}: {count}",
  "status.emptyCatalog": "O catálogo está vazio.",
  "import.completed": "Importação concluída.",
  "import.adapter": "Adaptador: {adapter}",
  "import.inserted": "Inseridos: {count}",
  "import.reused": "Reutilizados: {count}",
  "import.updated": "Atualizados: {count}",
  "import.typeCount": "{type}: {count}",
  "import.total": "Total: {count}",
  "import.empty": "Nenhuma interação compatível foi encontrada; o catálogo ficou vazio.",
  "import.validationFailure": "Importação não concluída. Validação: {errorCode}",
  "dryRun.notice": "================ SIMULAÇÃO ================",
  "dryRun.noMutation": "Nenhuma alteração será feita no X e nenhum navegador será acionado.",
  "dryRun.planId": "Plano imutável: {planId}",
  "dryRun.types": "Tipos selecionados: {types}",
  "dryRun.from": "Limite inicial inclusivo: {from}",
  "dryRun.to": "Limite final inclusivo: {to}",
  "dryRun.typeCount": "{type}: {count}",
  "dryRun.total": "Total selecionado: {count}",
  "dryRun.empty": "Nenhuma interação corresponde aos filtros; nenhum plano foi salvo.",
  "selection.error": "Seleção inválida: {errorCode}",
  "cli.sessionDescription": "gerencia a sessão local autenticada do X",
  "cli.sessionLoginDescription": "abre o fluxo oficial visível para login manual",
  "cli.sessionStatusDescription": "mostra a conta confirmada e o estado local da sessão",
  "cli.sessionClearDescription": "remove somente o perfil de navegador dedicado",
  "session.localGuidance":
    "A sessão fica somente neste computador. O navegador visível abrirá o site oficial do X; faça o login diretamente nele e não digite sua senha no terminal.",
  "session.loginStarted": "Aguardando autenticação manual no navegador visível.",
  "session.profile": "Perfil dedicado da sessão: {profileDirectory}",
  "session.detectedAccount": "Conta detectada: @{handle}",
  "session.confirmQuestion": "Confirmar esta conta para este diretório? [s/N]",
  "session.confirmed": "Conta @{handle} confirmada para este diretório de dados.",
  "session.rejected": "Conta não confirmada; nenhuma alteração destrutiva foi autorizada.",
  "session.loginRequired":
    "Nenhuma autenticação foi detectada; conclua o login manual e tente novamente.",
  "session.sessionExpired":
    "A sessão expirou; use `x-cleaner session login` para autenticar novamente.",
  "session.challenge":
    "O X apresentou um desafio de segurança. Resolva-o manualmente; o X Cleaner não tenta contorná-lo.",
  "session.unknown":
    "O estado da página do X não pôde ser comprovado com segurança; nenhuma ação foi realizada.",
  "session.identityMismatch":
    "A conta detectada não corresponde à identidade já vinculada ao diretório; nenhuma alteração foi realizada.",
  "session.statusHeader": "Estado da sessão local:",
  "session.confirmedAccount": "Conta confirmada: @{handle}",
  "session.notConfirmed": "Nenhuma conta autenticada foi confirmada neste diretório.",
  "session.clearGuidance":
    "Esta ação remove somente os dados da sessão do perfil dedicado. Catálogo, arquivo, banco, logs, checkpoints e relatórios serão preservados.",
  "session.clearQuestion": "Remover o perfil dedicado da sessão? [s/N]",
  "session.clearCanceled": "Limpeza da sessão cancelada; nenhum arquivo foi removido.",
  "session.cleared": "Dados da sessão removidos com segurança.",
  "session.clearProfile": "Perfil removido: {profileDirectory}",
  "cli.reportDescription": "gera ou atualiza o relatório local de uma execução",
  "progress.header": "Progresso da execução ({state}):",
  "progress.type":
    "{type}: concluídos {completed}; restantes {remaining}; ignorados {skipped}; terminais sem erro {terminal}; falhos {failed}; tentativas {retry}",
  "progress.total":
    "Total {total}: concluídos {completed}; restantes {remaining}; ignorados {skipped}; terminais sem erro {terminal}; falhos {failed}; pausados {paused}; tentativas {retry}",
  "progress.pause": "Pausa registrada: {reason}.",
  "report.generated": "Relatório local gerado para a execução {runId}.",
  "report.path": "Caminho local relativo: {path}",
  "report.state": "Estado: {state}",
  "report.total":
    "Total: {total}; concluídos: {completed}; restantes: {remaining}; ignorados: {skipped}; terminais sem erro: {terminal}; falhos: {failed}; pausados: {paused}; tentativas: {retry}",
  "report.type":
    "{type}: total {total}; concluídos {completed}; restantes {remaining}; ignorados {skipped}; terminais sem erro {terminal}; falhos {failed}; tentativas {retry}",
  "report.failure": "Falha sanitizada: {failure}"
};
