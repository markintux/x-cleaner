# Checklist de release após validação real

**Estado atual: `BLOQUEADO` / `NOT-CODE`**

Este checklist separa a validação da conta do proprietário de qualquer
publicação. O repositório continua privado, o pacote continua sem publicação e
nenhuma release estável é criada enquanto um gate obrigatório estiver ausente.
Fixtures sintéticas, uma suíte verde ou um pacote local inspecionado não
substituem a validação real.

## Gates obrigatórios antes de desbloquear qualquer publicação

Cada item deve apontar para uma evidência sanitizada aprovada pelo proprietário.
Marque `PENDENTE` quando não houver evidência; não use uma execução de CI como
autorização destrutiva.

- [ ] **Compatibilidade do Archive real:** import offline concluído, checksum
      registrado, adapter identificado e decisão explícita de compatibilidade.
- [ ] **Quatro tipos de interação:** `POST`, `REPLY`, `REPOST` e `LIKE` foram
      representados no Archive real e tiveram resultado observado ou foram
      classificados com motivo sanitizado.
- [ ] **Dry-run:** seleção, contagens, limites inclusivos e plano imutável foram
      revisados; nenhuma mutação do X ocorreu.
- [ ] **Correspondência da conta:** a sessão dedicada foi confirmada como a
      conta do Archive; nenhum mismatch ou sessão expirada ficou sem resolução.
- [ ] **Um item:** exatamente um item foi executado com autorização ao vivo,
      confirmação exata e verificação independente no X.
- [ ] **Lote pequeno:** um lote numericamente limitado foi executado com uma
      autorização nova e separada para esse batch, com cada resultado verificado.
- [ ] **Ctrl+C/resume:** a interrupção manual persistiu um checkpoint e a
      retomada não repetiu itens terminais; o resume teve confirmação própria.
- [ ] **Revisão de privacidade:** Archive, conteúdo, cookies, tokens, senha,
      e-mail, screenshot, trace, vídeo, log bruto e caminho absoluto não estão
      na evidência, repositório, pacote ou artefato de CI.
- [ ] **CI multiplataforma:** macOS, Linux e Windows passaram os gates
      sintéticos, cobertura, build, scanner e inspeção do pacote com Node 24.
- [ ] **Aprovação explícita do proprietário:** o relatório final, os riscos
      residuais e cada autorização independente foram revisados e aprovados.

## Bloqueios de publicação

As três ações abaixo permanecem bloqueadas até que **todos** os gates acima
estejam marcados e apontem para evidência aprovada:

| Ação | Estado | Pré-condição adicional |
|---|---|---|
| Tornar o repositório público | `BLOQUEADO` | Ação manual separada do proprietário; não pertence ao CI/Ralph |
| Publicar no npm | `BLOQUEADO` | Auditoria do pacote e aprovação de publicação em ação separada |
| Criar release estável | `BLOQUEADO` | Todos os gates, changelog/release review e aprovação final |

Não adicione comandos de `npm publish`, mudança de visibilidade, criação de
release ou token de publicação a workflow, script, teste, fixture ou seed para
"preparar" esse desbloqueio. A publicação, se aprovada futuramente, será uma
ação humana deliberada fora da validação automatizada.

## Limites da automação

- Ralph e CI podem executar somente dados sintéticos e páginas locais. Eles não
  podem fazer login no X, ler o caminho futuro do Archive do proprietário,
  digitar `APAGAR`, confirmar uma conta real, executar uma ação destrutiva ou
  publicar qualquer artefato.
- Os testes sintéticos podem mencionar a frase de confirmação como dado de
  teste injetado, mas não possuem sessão real, credencial, Archive real ou
  engine conectado ao X. Isso não é evidência de limpeza real.
- Um workflow verde nunca cria autorização do proprietário e nunca transforma
  `PENDENTE` em `VALIDADO`.

## Aprovação de desbloqueio

**Validation evidence ID:** `VALIDATION-001`  
**Release decision:** `BLOQUEADO` / `DESBLOQUEAR`  
**Owner approval ID:** `OWNER-APPROVAL-FINAL-001`  
**Timestamp UTC:** `AAAA-MM-DDTHH:MM:SSZ`  
**Responsável pela revisão:** `OWNER-001`

O valor `DESBLOQUEAR` só pode ser preenchido pelo proprietário depois de uma
revisão humana completa e separada. Até lá, a declaração correta é: **V1 não é
validada e o repositório permanece privado**.

