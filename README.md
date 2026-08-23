# RAQVOR Desktop

Cliente Desktop/PWA completo do RAQVOR.

## Publicação GitHub Pages

Repositório sugerido: `RAQVOR-DESKTOP`

URL esperada:
`https://rarufino27-alt.github.io/RAQVOR-DESKTOP/`

## Integração

Este cliente usa o mesmo projeto Supabase do RAQVOR Mobile e Admin. Não crie outro banco.

O Desktop é a aplicação financeira completa: Dashboard, Livro Caixa, Dívidas e Despesas, Cartões, Calendário, Relatórios, Suporte, Configurações e Perfil.

## Correções incluídas nesta separação

- correção do `user is not defined` no canal de controle de acesso;
- `table()` aceita arrays ou HTML já montado, eliminando `rows.join is not a function`;
- datas aceitam `Date` ou string em `monthKey()`/`yearKey()`;
- renderização de módulo protegida por `try/catch` para uma tela não derrubar o aplicativo inteiro.
