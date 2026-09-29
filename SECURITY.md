# Segurança

## Estado e escopo

O pacote X Cleaner está em beta público no npm; o repositório GitHub permanece
privado. A validação real foi limitada a uma conta e não garante compatibilidade
com outros Archives nem estabilidade dos seletores da interface do X. Não publique
issues com dados de conta até que estejam completamente sanitizados.

## Relato de vulnerabilidade

Para um possível problema de segurança, não abra uma issue pública com o
material. Use o canal privado de segurança do repositório privado ou contate o
proprietário por um canal previamente autorizado, descrevendo impacto,
versão/commit, passos mínimos reproduzíveis e uma correção sugerida quando
possível. Aguarde a confirmação antes de divulgar detalhes. Nunca envie senha,
cookie, token, Archive, perfil de navegador ou relatório bruto.
Não compartilhe artefatos reais em issues, pull requests, CI ou pedidos de ajuda.

## Fronteira de dados sensíveis

O Archive, `state.sqlite`, journals/WAL, `browser-profile/`, cookies, logs,
checkpoints, relatórios, screenshots, traces e vídeos são dados potencialmente
pessoais. Eles devem permanecer no diretório local do usuário e fora do Git,
issues, pull requests, CI, uploads e mensagens. O CLI não pede, lê, registra ou
persiste a senha do X.

Captura diagnóstica pode registrar conteúdo privado. Ela é desativada por padrão;
se for habilitada localmente para investigar uma falha, escolha um destino
privado, revise o material, apague screenshots/traces/vídeos e logs depois da
análise e confirme que não restaram cópias, caches ou arquivos temporários.

## Execução destrutiva

Toda execução deve passar por importação, dry-run, verificação explícita da
conta, confirmação exata `APAGAR` e limites graduais. Desafios, CAPTCHA, limites
de taxa e estados desconhecidos exigem pausa e ação manual legítima. Não use
proxy rotation, automação de desafio ou credenciais exportadas.
