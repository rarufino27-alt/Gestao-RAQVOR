import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}

export default async (req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return Response.json({error:'Method not allowed'},{status:405,headers:cors})
  const auth=req.headers.get('Authorization')||''
  const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}})
  const {data:{user}}=await supabase.auth.getUser()
  if(!user) return Response.json({error:'Não autenticado'},{status:401,headers:cors})
  const body=await req.json().catch(()=>({}))
  const messages=Array.isArray(body.messages)?body.messages:[]
  const key=Deno.env.get('OPENAI_API_KEY')
  if(!key) return Response.json({error:'OPENAI_API_KEY não configurada.'},{status:503,headers:cors})
  const instructions=`Você é o Assistente de Suporte do RAQVOR. Faça triagem simples, humana e objetiva. Não invente soluções. Pergunte somente o necessário para entender o problema. Se o usuário demonstrar preferência por atendimento humano, diga que ele pode selecionar Especialista. Nunca peça senha, código de autenticação ou dados financeiros sensíveis. Responda em português brasileiro, com no máximo 3 parágrafos curtos.`
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:Deno.env.get('RAQVOR_AI_MODEL')||'gpt-5.6-luna',store:false,instructions,input:messages})})
  if(!response.ok)return Response.json({error:await response.text()},{status:502,headers:cors})
  const data=await response.json();return Response.json({assistant_text:data.output_text||'Entendi. Se preferir, selecione Especialista para falar com nossa equipe.'},{headers:{...cors,'Content-Type':'application/json'}})
}
