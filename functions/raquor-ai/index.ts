const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const nullable=(type:string)=>({anyOf:[{type},{type:'null'}]})
const operation={
  type:'object',additionalProperties:false,
  properties:{
    kind:nullable('string'),intent:nullable('string'),amount:nullable('number'),creditor:nullable('string'),card_id:nullable('string'),description:nullable('string'),date:nullable('string'),first_due_date:nullable('string'),installments:nullable('integer'),installment_value:nullable('number'),interest:nullable('number'),total_payable:nullable('number'),payment_type:nullable('string'),source:nullable('string'),repayment_needed:nullable('boolean'),linked_payments:{type:'array',items:{type:'object',additionalProperties:true}}
  },required:['kind','intent','amount','creditor','card_id','description','date','first_due_date','installments','installment_value','interest','total_payable','payment_type','source','repayment_needed','linked_payments']
}
const schema={type:'object',additionalProperties:false,properties:{assistant_text:{type:'string'},choices:{type:'array',items:{type:'string'}},ready:{type:'boolean'},missing_fields:{type:'array',items:{type:'string'}},operation:{anyOf:[operation,{type:'null'}]}},required:['assistant_text','choices','ready','missing_fields','operation']}
const json=(b:any,s=200)=>Response.json(b,{status:s,headers:{...cors,'Content-Type':'application/json'}})
export default async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const auth=req.headers.get('Authorization')||''
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase=(await import('https://esm.sh/@supabase/supabase-js@2')).createClient(url,anon,{global:{headers:{Authorization:auth}}})
  const {data:{user}}=await supabase.auth.getUser();if(!user)return json({error:'Não autenticado'},401)
  const body=await req.json().catch(()=>({}));const context=body.context??{};const messages=Array.isArray(body.messages)?body.messages:[];const key=Deno.env.get('OPENAI_API_KEY');if(!key)return json({error:'OPENAI_API_KEY não configurada.'},503)
  const instructions=`Você é o Assistente Financeiro do RAQVOR. Organize sem executar silenciosamente.
Faça perguntas curtas e use choices quando possível. Nunca invente dados. Diferencie pagamento único, mensal parcelado e recorrente. Em cartão, use o cartão exato. Em empréstimo, considere entrada, dívida e pagamentos vinculados. Só ready=true quando houver dados suficientes para um resumo seguro. O usuário sempre confirma antes de gravar. Responda em português brasileiro simples.
Hoje: ${new Date().toISOString().slice(0,10)}
Configuração: ${JSON.stringify(context.profile||{})}
Credores: ${JSON.stringify(context.creditors||[])}
Cartões: ${JSON.stringify(context.cards||[])}
Ciclo: ${JSON.stringify(context.cycle||{})}`
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:Deno.env.get('RAQVOR_AI_MODEL')||'gpt-5.6-luna',store:false,instructions,input:messages,text:{format:{type:'json_schema',name:'raqvor_operation',strict:true,schema}}})})
  if(!response.ok)return json({error:await response.text()},502)
  const data=await response.json();const raw=data.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==='output_text')?.text;if(!raw)return json({error:'Resposta estruturada não retornada.'},502)
  try{return json(JSON.parse(raw))}catch{return json({error:'Resposta da IA inválida.'},502)}
}
