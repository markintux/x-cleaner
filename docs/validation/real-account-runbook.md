# Runbook de validação da conta real

**Estado atual: `PENDENTE` / `NOT-CODE`**

Este runbook é um procedimento manual, local e controlado pelo proprietário da
conta. O X Archive ainda não está disponível nesta fase. Nenhum passo abaixo é
executado por Ralph, CI, cron, script, workflow ou teste automatizado. A
conclusão de uma etapa não autoriza a etapa seguinte.

## Regras que não podem ser flexibilizadas

- Use somente a conta do proprietário, um perfil dedicado e o navegador visível
  criado pelo X Cleaner. Nunca use o perfil cotidiano do navegador.
- O Archive, o catálogo, o banco, a sessão, os logs, os checkpoints e os
  relatórios ficam somente na máquina local. Não copie nenhum deles para o
  repositório, issue, PR, CI, armazenamento remoto ou pedido de suporte.
- Nunca informe a senha ao X Cleaner. O login acontece manualmente na página
  oficial do X; CAPTCHA, desafio de segurança e limite de taxa não devem ser
  contornados.
- Não avance quando uma evidência estiver ausente. Registre `PENDENTE` ou
  `NÃO EXECUTADO`, sem estimar ou fabricar um resultado.
- Pare imediatamente diante de desafio de segurança, CAPTCHA, limite de taxa,
  sessão inesperada, URL ou estado de página não reconhecido, ou qualquer ação
  que o BrowserEngine não consiga provar com seletores e evidências suportados.
  Não tente novamente até a causa ser avaliada manualmente.

## 1. Preparar e adquirir o Archive localmente

- [ ] O proprietário solicitou e baixou o Archive oficial pelo fluxo do X.
- [ ] O ZIP original ou diretório extraído foi colocado em armazenamento local
      privado, fora do repositório e fora de qualquer diretório empacotado.
- [ ] O arquivo original foi preservado sem alteração; o X Cleaner deve apenas
      ler a fonte.
- [ ] Foi calculado e registrado o SHA-256 antes do import. Registre somente o
      digest hexadecimal de 64 caracteres, o tipo `ZIP` ou `DIRECTORY` e um
      rótulo seguro; não registre caminho absoluto, nome pessoal ou fragmento.
- [ ] A evidência recebeu um identificador sanitizado, por exemplo
      `ARCHIVE-001`, sem incluir o nome do arquivo ou da conta.

O caminho do Archive é um segredo operacional local. Ele não entra na
evidência. Não crie uma variável, seed, fixture ou configuração persistente no
repositório para apontar para o Archive real.

## 2. Importar offline antes de abrir o navegador

- [ ] Com a rede desnecessária desligada ou sem iniciar a sessão do navegador,
      execute o import local do Archive em um diretório de dados dedicado.
- [ ] Confirme que o import terminou com resultado normalizado e que a fonte
      permaneceu byte a byte inalterada.
- [ ] Faça a revisão dos totais locais de `POST`, `REPLY`, `REPOST` e `LIKE`,
      incluindo total geral, duplicados, inseridos, atualizados e falhas
      sanitizadas. Não copie texto de interação para a evidência.
- [ ] Registre o adapter, sua versão/identificador, o digest e os quatro
      contadores no [template de evidência](evidence-template.md).

### Decisão de compatibilidade do parser

- [ ] Compare a estrutura observada localmente com o contrato do adapter, sem
      enviar arquivos para fora da máquina.
- [ ] Registre uma decisão explícita: `COMPATÍVEL`, `INCOMPATÍVEL` ou
      `REVISÃO NECESSÁRIA`, com apenas códigos de issue sanitizados.
- [ ] Se a decisão não for `COMPATÍVEL`, pare antes de login, dry-run ou ação
      destrutiva. Uma fixture sintética nunca substitui essa decisão.

## 3. Confirmar a sessão e a conta

- [ ] Abra somente o perfil dedicado com `x-cleaner session login` e faça o
      login manual na página oficial do X.
- [ ] Não digite senha no terminal e não registre cookies, tokens, e-mail,
      screenshots, traces ou vídeo.
- [ ] Confirme visualmente o handle da conta conectada e compare-o com a
      identidade descoberta no Archive, sem gravar o handle completo na
      evidência.
- [ ] Registre apenas uma confirmação sanitizada, como fingerprint local ou
      `ACCOUNT-001`, a versão do navegador e o resultado `MATCH`/`MISMATCH`.
- [ ] Em `MISMATCH`, sessão expirada ou login incompleto, não crie plano de
      execução e não agende nenhuma ação.

## 4. Produzir e revisar o dry-run exato

- [ ] Execute o `dry-run` com os tipos e os limites de data que serão usados na
      execução. Os limites de data são inclusivos.
- [ ] Confirme a mensagem de que a operação é uma `SIMULAÇÃO` e não altera o
      X; nenhum método de mutação do BrowserEngine pode ser chamado.
- [ ] Registre o `plan ID` sanitizado, o `run ID` quando existir, o snapshot do
      catálogo, os quatro contadores selecionados e o total.
- [ ] Revise o plano imutável item a item no terminal, usando somente o
      identificador necessário para a conferência local. Não copie conteúdo
      completo, URL privada, caminho absoluto ou texto da interação.
- [ ] Confirme que o plano contém exatamente os itens e tipos pretendidos e
      que nenhum import posterior o expande.

Se houver divergência entre Archive, catálogo, conta, contagem ou plano,
interrompa o procedimento e registre uma issue sanitizada. Não continue para a
confirmação destrutiva.

## 5. Autorizar e verificar exatamente um item

Esta é uma autorização nova e específica. A autorização para o dry-run não é
autorização para apagar, e a autorização de um item não é autorização para um
lote.

- [ ] O proprietário revisou o plano, o total `1` e o identificador do único
      item no live session.
- [ ] O proprietário deu autorização explícita, naquele momento, para **este
      único item**. Registre somente `OWNER-APPROVAL-001`, timestamp UTC, limite
      `1` e o run/batch ID sanitizado.
- [ ] O executor exibiu a advertência de irreversibilidade e o proprietário
      digitou manualmente a confirmação exata `APAGAR` no terminal visível.
- [ ] Aguarde o resultado normalizado do item e a persistência do checkpoint
      antes de qualquer próximo item.
- [ ] Verifique independentemente no X, pela interface visível, se o resultado
      corresponde ao item autorizado. Registre somente `COMPLETED`,
      `ALREADY_REMOVED`, `NOT_FOUND`, `UNAVAILABLE` ou outro outcome suportado,
      além do timestamp e de um issue ID sanitizado quando necessário.
- [ ] Se a verificação divergir, pare imediatamente e não faça resume nem
      outra execução.

## 6. Autorizar separadamente um lote pequeno

Somente após a verificação independente do item único o proprietário pode
decidir se deseja continuar. Esta decisão não é inferida pelo programa.

- [ ] O relatório do item único foi revisado e não deixou risco desconhecido.
- [ ] O proprietário deu uma nova autorização explícita para um limite pequeno,
      definido numericamente antes de iniciar o batch. Registre outro approval
      ID, outro timestamp UTC, outro batch ID e o limite exato.
- [ ] Revise novamente a conta, o plano e os itens elegíveis antes do batch.
- [ ] Confirme `APAGAR` manualmente somente para esse batch; nunca pré-preencha
      stdin e nunca use confirmação automática.
- [ ] Verifique cada resultado no X e registre apenas outcomes normalizados,
      contagens agregadas, duração, pausa e issue IDs sanitizados.
- [ ] Pare no primeiro desafio, limite de taxa, sessão expirada, estado
      desconhecido ou resultado inconsistente. Não faça bypass nem retry manual
      sem nova avaliação.

## 7. Exercitar interrupção e retomada

- [ ] Depois de uma fronteira persistida e dentro de uma execução autorizada,
      envie `Ctrl+C` manualmente para interromper o executor.
- [ ] Confirme que novos itens não foram agendados, o item em voo terminou ou
      ficou recuperável, e um checkpoint `MANUAL_INTERRUPT` foi persistido.
- [ ] Revise o progresso, os itens terminais e o próximo item antes de usar
      `resume`.
- [ ] Faça uma nova confirmação para o resume/batch; a confirmação anterior
      não é reutilizada.
- [ ] Confirme que itens concluídos, ignorados, indisponíveis, não encontrados
      ou já removidos não são executados novamente.
- [ ] Registre somente o motivo normalizado, sequências agregadas, IDs de run e
      batch sanitizados e o resultado da retomada.

Se a recuperação não puder provar a fronteira persistida, marque como
`NÃO EXECUTADO`, preserve o estado e não tente uma correção destrutiva.

## 8. Revisar o relatório final e encerrar

- [ ] O relatório final foi gerado localmente após conclusão ou pausa.
- [ ] O relatório contém somente contagens, tipos, timestamps, IDs, estados,
      motivos normalizados, versões e riscos residuais sanitizados.
- [ ] Foi feita revisão de privacidade: sem Archive, texto completo, cookies,
      tokens, senha, e-mail, screenshot, trace, vídeo ou caminho absoluto.
- [ ] O proprietário revisou o relatório, o estado da sessão e os riscos
      residuais e registrou aprovação explícita ou pendência.
- [ ] O repositório continua privado, nenhum pacote foi publicado e nenhuma
      release foi criada. Essas ações exigem uma aprovação futura separada.

## Critério de parada e resultado do runbook

O runbook só pode ser marcado como `CONCLUÍDO` quando todas as caixas
obrigatórias tiverem evidência sanitizada e cada ação destrutiva tiver sua
própria autorização do proprietário. Enquanto o Archive não estiver
disponível, ou enquanto qualquer gate acima estiver sem autorização, o estado
correto é `PENDENTE` / `NOT-CODE`; V1 não é declarada validada.

