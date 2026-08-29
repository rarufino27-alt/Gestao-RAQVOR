RAQVOR DESKTOP V2.18.1 — CORREÇÃO DE BOOT + CALENDÁRIO

Correção crítica: a versão V2.18 não executava initSupabase() depois de carregar app.js.
Como o .app inicia com display:none, a aplicação ficava completamente branca.

Correções:
- inicialização automática no DOMContentLoaded;
- fallback para exibir a tela de login quando o Supabase não carregar;
- cache versionado para 2.18.1;
- referência do logo da sidebar corrigida para o mesmo asset usado na autenticação;
- calendário semanal permanece na estrutura V2.18.

Substituir no GitHub:
- app.js
- index.html
- styles.css
- sw.js

Depois: commit/push, aguardar GitHub Pages e usar Ctrl+Shift+R.
