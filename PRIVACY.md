# Privacidade local

O X Cleaner não tem backend, telemetria ou upload. O Archive e os resultados
ficam no computador do usuário. O diretório padrão é o indicado no README e
`--data-dir` permite escolher outro diretório local controlado pelo usuário.

O `state.sqlite` guarda catálogo, planos, checkpoints e resultados; o perfil
dedicado guarda a sessão do navegador; `logs/audit.ndjson` e `reports/` guardam
observabilidade local sanitizada. Ainda assim, IDs, datas e mensagens de erro
podem ser pessoais. O relatório padrão não inclui senha, cookie completo, token
ou texto privado completo.

Não compartilhe Archive, diretórios extraídos, SQLite, journals/WAL, perfil de
navegador, cookies, logs, checkpoints, reports, screenshots, traces ou vídeos.
Para suporte, reproduza com um fixture sintético e retenha somente códigos de
erro, versões e contagens agregadas. Apague o perfil com `session clear`; para
remover o restante, pare o CLI, revise o relatório e apague manualmente o
diretório local apropriado.

Capturas diagnósticas podem conter páginas e dados pessoais. Mantenha-as
desativadas por padrão, guarde-as apenas localmente durante a investigação e
apague-as imediatamente depois. A automação e o CI usam fixtures sintéticos;
dados de uma conta real nunca são necessários para testes.
