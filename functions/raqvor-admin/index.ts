import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const json=(body:any,status=200)=>Response.json(body,{status,headers:{...cors,'Content-Type':'application/json'}})

export default async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const auth=req.headers.get('Authorization')||''
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if(!service)return json({error:'SUPABASE_SERVICE_ROLE_KEY não configurada na Edge Function.'},503)
  const callerClient=createClient(url,anon,{global:{headers:{Authorization:auth}}})
  const {data:{user:caller},error:callerError}=await callerClient.auth.getUser()
  if(callerError||!caller)return json({error:'Não autenticado'},401)
  const adminClient=createClient(url,service)
  const admin=await adminClient.from('admin_users').select('role,active').eq('user_id',caller.id).maybeSingle()
  if(admin.error)return json({error:admin.error.message},500)
  if(!admin.data?.active)return json({error:'Sem permissão administrativa.'},403)
  const body=await req.json().catch(()=>({}))
  const action=String(body.action||'')
  const userId=String(body.user_id||'')

  if(action==='create_user'){
    const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'')
    if(!email||!password)return json({error:'E-mail e senha são obrigatórios.'},400)
    if(password.length<6)return json({error:'A senha deve ter pelo menos 6 caracteres.'},400)
    const created=await adminClient.auth.admin.createUser({email,password,email_confirm:true,phone:body.phone?String(body.phone):undefined,user_metadata:{full_name:String(body.full_name||''),phone:String(body.phone||'')}})
    if(created.error)return json({error:created.error.message},400)
    const id=created.data.user.id
    const profile=await adminClient.from('profiles').upsert({id,full_name:String(body.full_name||''),phone:String(body.phone||''),avatar_url:String(body.avatar_url||'')},{onConflict:'id'})
    if(profile.error)return json({error:profile.error.message},500)
    await adminClient.from('user_access_controls').upsert({user_id:id,status:'active',reason:null,changed_by:caller.id,changed_at:new Date().toISOString()},{onConflict:'user_id'})
    await adminClient.from('customer_accounts').upsert({user_id:id,plan_code:String(body.plan_code||'trial'),subscription_status:String(body.subscription_status||'trialing'),updated_at:new Date().toISOString()},{onConflict:'user_id'})
    const ws=await adminClient.from('finance_workspaces').insert({owner_user_id:id,name:'Gestão financeira RAQVOR'}).select('id').single()
    if(ws.error)return json({error:ws.error.message},500)
    await adminClient.from('admin_audit_log').insert({admin_user_id:caller.id,action:'user_created',target_user_id:id,metadata:{email}})
    return json({ok:true,user:created.data.user,workspace_id:ws.data.id})
  }

  if(!userId)return json({error:'user_id obrigatório.'},400)

  if(action==='update_auth'){
    const attrs:any={}
    if(body.email!==undefined)attrs.email=String(body.email).trim().toLowerCase()
    if(body.phone!==undefined)attrs.phone=String(body.phone).trim()
    if(body.password)attrs.password=String(body.password)
    if(body.email_confirm===true)attrs.email_confirm=true
    if(body.phone_confirm===true)attrs.phone_confirm=true
    if(body.full_name!==undefined||body.phone!==undefined)attrs.user_metadata={full_name:String(body.full_name??''),phone:String(body.phone??'')}
    const r=await adminClient.auth.admin.updateUserById(userId,attrs)
    if(r.error)return json({error:r.error.message},400)
    const profile=await adminClient.from('profiles').upsert({id:userId,full_name:body.full_name===undefined?undefined:String(body.full_name),phone:body.phone===undefined?undefined:String(body.phone),avatar_url:body.avatar_url===undefined?undefined:String(body.avatar_url)},{onConflict:'id'})
    if(profile.error)return json({error:profile.error.message},500)
    await adminClient.from('admin_audit_log').insert({admin_user_id:caller.id,action:'auth_user_updated',target_user_id:userId,metadata:{fields:Object.keys(attrs)}})
    return json({ok:true,user:r.data.user})
  }

  if(action==='ban_auth'){
    const r=await adminClient.auth.admin.updateUserById(userId,{ban_duration:body.banned===true?'876000h':'none'})
    if(r.error)return json({error:r.error.message},400)
    await adminClient.from('admin_audit_log').insert({admin_user_id:caller.id,action:body.banned===true?'auth_user_banned':'auth_user_unbanned',target_user_id:userId,metadata:{}})
    return json({ok:true})
  }
  return json({error:'Ação não suportada.'},400)
}
