# Template de evidência de validação

Preencha este documento apenas com fatos observados na máquina local. Campos
sem execução devem permanecer `PENDENTE` ou `NÃO EXECUTADO`; não substitua uma
lacuna por uma suposição. Use IDs sanitizados e timestamps UTC.

**Estado da validação:** `PENDENTE`  
**Data da última atualização:** `AAAA-MM-DDTHH:MM:SSZ`  
**Responsável:** `OWNER-001`  
**Escopo:** conta própria, uma sessão dedicada, Archive local e validação
manual controlada

## Limites de privacidade

Esta evidência pode conter contagens, versões, digests SHA-256, IDs
sanitizados, timestamps e outcomes normalizados. Ela **não pode conter**:

- dados pessoais, handle completo, e-mail, nome, texto de post/reply, conteúdo
  de Archive ou fragmentos de arquivo;
- senha, cookie, token, header de autorização, estado de sessão ou segredo;
- caminho absoluto, nome pessoal de arquivo, perfil normal do navegador ou
  qualquer localização privada;
- URL privada, screenshot, trace, vídeo, HTML bruto ou log bruto;
- dados que permitam reconstruir uma conta, um Archive ou uma interação.

## 1. Aplicação e ambiente

| Campo | Valor sanitizado |
|---|---|
| Application commit | `COMMIT-<short-sha>` |
| Versão do aplicativo | `0.1.0` |
| Node.js | `v<major.minor.patch>` |
| npm | `v<major.minor.patch>` |
| Playwright | `<versão>` |
| Browser engine | `<Chromium/Firefox/WebKit> <versão>` |
| Sistema operacional | `<nome e versão, sem hostname/username>` |
| Arquitetura | `<arm64/x64/etc.>` |
| Data/hora UTC | `AAAA-MM-DDTHH:MM:SSZ` |

## 2. Suíte sintética e gates mecânicos

Registre somente status, contagens e versões. A suíte sintética não comprova
compatibilidade do Archive real nem estabilidade da automação no X.

| Verificação | Comando | Resultado sanitizado | Observação |
|---|---|---|---|
| Gate canônico | `npm run check` | `PASSOU` / `FALHOU` / `NÃO EXECUTADO` | `<contagem ou issue ID>` |
| Cobertura | `npm run test:coverage` | `PASSOU` / `FALHOU` / `NÃO EXECUTADO` | `<percentuais, sem dados privados>` |
| Pacote | `npm pack --dry-run` | `PASSOU` / `FALHOU` / `NÃO EXECUTADO` | `<quantidade de arquivos>` |
| Scanner privado | `npm run check:private-artifacts` | `PASSOU` / `FALHOU` / `NÃO EXECUTADO` | `<sem caminho absoluto>` |
| CI macOS | `<run sanitizado>` | `PASSOU` / `FALHOU` / `PENDENTE` | `<issue ID>` |
| CI Linux | `<run sanitizado>` | `PASSOU` / `FALHOU` / `PENDENTE` | `<issue ID>` |
| CI Windows | `<run sanitizado>` | `PASSOU` / `FALHOU` / `PENDENTE` | `<issue ID>` |

## 3. Archive e adapter

| Campo | Valor sanitizado |
|---|---|
| Archive evidence ID | `ARCHIVE-001` |
| Tipo de fonte | `ZIP` / `DIRECTORY` |
| Rótulo seguro | `<sem nome pessoal ou caminho>` |
| SHA-256 | `<64 hexadecimais>` |
| Adapter key | `<identificador estável>` |
| Adapter version | `<versão ou commit>` |
| Import ID | `IMPORT-001` |
| Resultado do import | `COMPLETED` / `FAILED` / `PENDENTE` |
| Decisão de compatibilidade | `COMPATÍVEL` / `INCOMPATÍVEL` / `REVISÃO NECESSÁRIA` |
| Issue sanitizada | `ISSUE-<id>` ou `NENHUMA` |

### Contagens do import

| Tipo | Encontrados | Inseridos | Reutilizados | Atualizados |
|---|---:|---:|---:|---:|
| `POST` | `0` | `0` | `0` | `0` |
| `REPLY` | `0` | `0` | `0` | `0` |
| `REPOST` | `0` | `0` | `0` | `0` |
| `LIKE` | `0` | `0` | `0` | `0` |
| **Total** | `0` | `0` | `0` | `0` |

Não registre amostras, conteúdo, IDs de interação, caminhos de origem ou
fragmentos do Archive nesta tabela.

## 4. Conta, plano e execução autorizada

| Campo | Valor sanitizado |
|---|---|
| Account evidence ID | `ACCOUNT-001` |
| Resultado da confirmação | `MATCH` / `MISMATCH` / `PENDENTE` |
| Session evidence ID | `SESSION-001` |
| Plan ID | `PLAN-001` |
| Catalog cutoff | `<inteiro local>` |
| Dry-run | `PASSOU` / `FALHOU` / `PENDENTE` |
| Run ID | `RUN-001` |
| Batch ID(s) | `BATCH-001`, `BATCH-002` |
| Interruption checkpoint | `CHECKPOINT-001` / `NÃO EXECUTADO` |
| Final report ID | `REPORT-001` / `PENDENTE` |

### Autorizações independentes

| Etapa | Approval ID | Limite autorizado | Timestamp UTC | Verificação independente |
|---|---|---:|---|---|
| Um item | `OWNER-APPROVAL-001` | `1` | `AAAA-MM-DDTHH:MM:SSZ` | `PASSOU` / `FALHOU` / `PENDENTE` |
| Lote pequeno | `OWNER-APPROVAL-002` | `<inteiro pequeno>` | `AAAA-MM-DDTHH:MM:SSZ` | `PASSOU` / `FALHOU` / `PENDENTE` |
| Resume/interrupção | `OWNER-APPROVAL-003` | `<limite>` | `AAAA-MM-DDTHH:MM:SSZ` | `PASSOU` / `FALHOU` / `PENDENTE` |

Uma autorização anterior nunca é reutilizada. Se a linha não foi autorizada
ao vivo pelo proprietário, use `NÃO EXECUTADO` e não execute a etapa.

### Outcomes normalizados

| Run/batch | Tipo | Outcome | Quantidade | Motivo normalizado | Issue sanitizada |
|---|---|---|---:|---|---|
| `BATCH-001` | `POST`/`REPLY`/`REPOST`/`LIKE` | `COMPLETED` | `0` | `NONE` | `NENHUMA` |
| `BATCH-001` | `<tipo>` | `ALREADY_REMOVED` / `NOT_FOUND` / `UNAVAILABLE` | `0` | `<categoria>` | `<ISSUE-id>` |
| `BATCH-001` | `<tipo>` | `FAILED` / `PAUSED` / `INTERRUPTED` | `0` | `<categoria>` | `<ISSUE-id>` |

Use somente outcomes e motivos definidos pelo domínio. Não copie mensagens
brutas da página, texto de erro, URL, seletor ou conteúdo privado.

## 5. Riscos residuais e aprovação do proprietário

### Riscos residuais

- Compatibilidade do Archive: `PENDENTE` / `ACEITA COM RISCO` / `SEM RISCO CONHECIDO`.
- Mudança da interface do X: `PENDENTE` / `<código de risco sanitizado>`.
- Desafio, CAPTCHA ou limite de taxa: `NÃO OBSERVADO` / `OBSERVADO — PARADO`.
- Privacidade do relatório: `REVISADA` / `PENDENTE`.
- Outros: `<somente categoria e ISSUE-id, sem dados pessoais>`.

### Aprovação

- [ ] O proprietário revisou o Archive/adapter, as contagens e a decisão de
      compatibilidade.
- [ ] O proprietário revisou o dry-run e o plano exato.
- [ ] O proprietário aprovou cada ação destrutiva em autorização separada.
- [ ] O proprietário revisou a verificação independente, a interrupção/resume,
      o relatório final e os riscos residuais.
- [ ] O proprietário aprovou a declaração de validação: `SIM` / `NÃO`.

**Owner approval ID:** `OWNER-APPROVAL-FINAL-001`  
**Timestamp UTC:** `AAAA-MM-DDTHH:MM:SSZ`  
**Assinatura ou confirmação local:** `<somente referência sanitizada>`

Até que todas as aprovações acima existam, o projeto permanece beta privado,
V1 não é validada e nenhuma publicação é permitida.

