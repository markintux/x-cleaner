# Contribuindo

O projeto é um beta público e aceita contribuições por issues e pull requests.
O idioma normal da documentação e do CLI é português; o
catálogo mantém chaves estáveis para futuras traduções.

## Dados e fixtures

Use apenas identificadores, texto, Archive, páginas e engines sintéticos. A
documentação em `tests/fixtures/x-archive/README.md` registra essa regra. Nunca
adicione Archive real, diretório extraído, SQLite, browser profile, cookies,
logs, reports, screenshots, traces, vídeos, tokens ou qualquer artefato de uma
conta a um commit, issue, PR, CI ou captura de tela. Não compartilhe esses
artefatos para pedir ajuda.

## Arquitetura e seletores

O Core não deve importar Playwright nem conhecer URLs, seletores, dialogs ou
detalhes da interface do X. Mudanças de seletor ficam em
`src/infrastructure/browser/x/` e devem preservar o contrato de resultados
normalizados do BrowserEngine. Um estado desconhecido deve pausar, nunca clicar
por tentativa. A evolução futura de um `XApiEngine` ou de novos catálogos i18n
não deve expandir o escopo V1.

## Verificação local

Instale Node.js 24 e dependências bloqueadas, depois rode o gate canônico:

```bash
npm ci
npm run check
```

O CI também roda o scanner de artefatos privados, cobertura e inspeção do pacote
em macOS, Linux e Windows. Execute `npm run check:private-artifacts` antes de
enviar mudanças que criem arquivos; o pacote é somente inspecionado e não é
publicado. Nenhum teste faz login no X ou exige segredo de CI.

## Pull requests

Descreva comportamento, risco de privacidade, testes executados e limitações.
Não inclua comandos de publicação, release, mudança de visibilidade ou
validação destrutiva de conta real. Uma execução real exige autorização do dono
em sessão separada e não pertence ao CI.
