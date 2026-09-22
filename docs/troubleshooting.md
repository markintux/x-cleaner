# Solução de problemas

## Sessão expirada

Uma sessão expirada pausa a execução e preserva o checkpoint. Não apague o
`state.sqlite` nem recrie o plano. Abra o fluxo visível novamente, conclua o
login diretamente no X, confirme que a conta detectada é a conta vinculada e
retome com `x-cleaner resume <run-id>`. Se a conta não corresponder, pare e
investigue o diretório de dados antes de qualquer nova confirmação.

## Limite de taxa ou desafio

CAPTCHA, revisão de login, limite de taxa e outros desafios são sinais para
parar. Resolva somente a etapa manual legítima indicada pelo X e aguarde quando
necessário. O X Cleaner não tenta burlar o desafio, trocar proxy, acelerar
ações ou continuar automaticamente. Depois, revise o relatório e autorize um
novo `resume` com limite pequeno.

## Estado desconhecido da interface

Se o BrowserEngine não comprovar o alvo e a ação pelos seletores semânticos e
evidências esperados, ele retorna uma pausa de estado desconhecido. Nenhuma
ação destrutiva deve ser inferida. Guarde apenas diagnóstico local opt-in,
revise a versão/commit e abra uma manutenção de seletor com fixture ou página
local reproduzível; não anexe o perfil ou a página real.

## Executor bloqueado

O arquivo `.executor.lock` fica no diretório de dados e contém somente PID,
hostname e instante de aquisição. Primeiro confirme se outro processo ainda
está executando e aguarde sua conclusão. Use `status` para observar o diretório;
não remova o lock ativo nem execute duas limpezas no mesmo diretório. Uma
diagnose `STALE` é evidência para investigação manual, não autorização para
assumir o lock. Lock inválido ou de outro host deve ser tratado como
`UNKNOWN` e preservado até uma decisão segura.

`run` e `resume` diagnosticam o lock antes de recuperar o estado e antes de
pedir a confirmação destrutiva, então uma execução bloqueada nunca chega a pedir
`APAGAR`. O comando `status` imprime o mesmo diagnóstico sem escrever nada.

Um lock deixado por uma parada não limpa — por exemplo um segundo `Ctrl+C`, que
encerra o processo de propósito sem persistir nada — aparece como `STALE`. Nesse
caso, e somente depois de confirmar que nenhum executor está ativo, repita o
comando com `--release-stale-lock`. A remoção rediagnostica o lock no mesmo
instante e recusa qualquer estado que não seja `STALE`, de modo que um executor
ativo nunca é despejado. A remoção não autoriza nada: a confirmação `APAGAR`
continua obrigatória para o lote seguinte.

A retomada seguinte reconcilia a parada não limpa: os itens em voo sem tentativa
comprometida voltam para `PENDING`, os lotes que ficaram `RUNNING` são fechados
como `INTERRUPTED`, o run vira `INTERRUPTED` e um checkpoint `MANUAL_INTERRUPT`
é registrado. Esse checkpoint é reconstruído na recuperação, não observado no
instante do sinal, porque o encerramento imediato não persiste nada.

## Archive incompatível

Fixtures sintéticas validam o contrato do parser, não o formato de todo Archive
real. Se a importação falhar, preserve o arquivo original, registre somente a
versão e o código de erro, e não edite o ZIP para “fazer caber”. A compatibilidade
real precisa ser inspecionada localmente pelo proprietário antes de qualquer
ação. Não existe suporte para formatos fora de posts, replies, reposts e likes.

## Diagnóstico seguro

Use `--diagnostics` somente localmente e por tempo limitado. Antes de enviar
qualquer saída, remova caminhos privados, IDs pessoais, conteúdo, cookies,
tokens, screenshots, traces e vídeos. Veja [PRIVACY.md](../PRIVACY.md) para
limpeza do perfil e dos artefatos.
