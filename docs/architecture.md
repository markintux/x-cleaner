# Arquitetura

## Limites

O fluxo é local e sequencial:

```text
CLI (Commander, mensagens pt-BR)
        |
Application/Core (seleção, planos, confirmação, estados, retry, resume)
        |
Ports (ArchiveSource, repositories, CleanerEngine, Prompt, Clock)
        |             |                 |
Archive adapters   SQLite             BrowserEngine
                    local              (Playwright + X UI)
```

O Core trabalha com IDs decimais, datas UTC e resultados normalizados. Ele não
importa Playwright, conhece seletores, acessa páginas X, percorre timelines ou
depende de SQLite. `src/infrastructure/browser/x/` concentra URL, locator,
dialog e evidência da interface. Repositórios e fontes de Archive adaptam I/O
local às portas; o CLI monta uma composição por diretório de dados sem
singleton mutável global.

## Segurança do fluxo

Importação é somente leitura. O dry-run cria um snapshot imutável do catálogo.
Antes da engine real, Core exige conta confirmada, plano revisado, lock e nova
confirmação `APAGAR`. Cada resultado é persistido antes do próximo item; pausa,
interrupção, retry limitado e retomada operam sobre esse checkpoint. O perfil de
navegador é dedicado e fica fora do repositório.

## Extensões futuras

`CleanerEngine` é o limite que permite um futuro `XApiEngine`, mas V1 não
implementa API do X, OAuth, estimativa de custo ou upload. Uma implementação
futura teria de manter os mesmos resultados, regras de segurança e ausência de
descoberta fora do Archive; não deve ser adicionada como atalho no Core.

O `MessageCatalog` usa chaves estáveis e o domínio compara estados neutros, não
textos traduzidos. Catálogos `en` e `es` podem ser adicionados depois sem
reescrever orquestração, persistência ou contratos de engine. O catálogo
entregue é `pt-BR`.

## Testabilidade e manutenção

Os testes de Core usam fake engine, relógio, prompt e páginas locais. Browser
Engine é exercitado por contratos de locator sem exigir uma conta. Uma mudança
de seletor deve incluir evidência sintética e parar com estado desconhecido se
o alvo não puder ser provado. A validação de Archive real e qualquer ação
destrutiva continuam gates manuais do proprietário, fora de testes e CI.
