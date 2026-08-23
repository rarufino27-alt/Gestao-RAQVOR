# RAQVOR AI

Edge Function para o Assistente Financeiro. O navegador envia apenas o contexto necessário e a conversa; a chave da IA permanece no servidor.

Secrets necessários:
- `OPENAI_API_KEY`
- opcional: `RAQVOR_AI_MODEL` (padrão `gpt-5.6`)

A função usa a Responses API com Structured Outputs para devolver uma operação estruturada. Ela não grava diretamente no banco: o aplicativo deve mostrar o resumo e pedir confirmação antes de executar a operação.
