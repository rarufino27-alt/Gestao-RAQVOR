let KEY='finance_nexora_v1';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $=s=>document.querySelector(s);
function money(n){const c=(db?.settings?.currency||'BRL');return new Intl.NumberFormat('pt-BR',{style:'currency',currency:c==='USD'?'USD':c==='EUR'?'EUR':'BRL'}).format(Number(n)||0)}
const num=n=>Number(n)||0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=(d)=>{if(d instanceof Date)return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);if(!d)return new Date(NaN);const s=String(d).slice(0,10);return new Date(`${s}T12:00:00`)};
function defaultDB(){return{balance:0,transactions:[],debts:[],cards:[],loans:[],recurring:[],cashbooks:[],creditors:[],categories:{receita:['Salário','Trabalho','Freelance','Investimentos','Outros'],despesa:['Moradia','Alimentação','Transporte','Saúde','Educação','Lazer','Assinaturas','Cartões','Empréstimos','Impostos','Outros']},settings:{theme:'light',project:'RAQVOR',weekMode:'seg-sex',currency:'BRL',cycleStart:1,cycleLength:30,daysOff:[]}}}
let db=(()=>{try{return JSON.parse(localStorage.getItem(KEY))||defaultDB()}catch{return defaultDB()}})();
const SUPABASE_URL='https://zowmlsusgnzqskuplxcu.supabase.co';
const SUPABASE_KEY='sb_publishable_vkoEbQBCeSDsoFRZxJ4VoA_gVWhQf5M';
let supabaseClient=null;
let supabaseWorkspaceId=null;
let currentUser=null;
let currentProfile=null;
let syncTimer=null;
let syncInProgress=false;
let syncReady=false;
let syncDirty=false;
let realtimeChannel=null;
let lastRemoteUpdatedAt=localStorage.getItem(KEY+'_remote_updated_at')||'';
function setSyncStatus(text,ok=false){const el=document.querySelector('#sync-status');if(el){el.textContent=text;el.classList.toggle('sync-ok',ok)}}
function saveLocal(){localStorage.setItem(KEY,JSON.stringify(db))}
function normalizeRemoteState(state){
  const base=defaultDB();
  const r=state&&typeof state==='object'?state:{};
  const out={...base,...r,settings:{...base.settings,...(r.settings||{})},categories:{...base.categories,...(r.categories||{})}};
  out.transactions=Array.isArray(out.transactions)?out.transactions:[];
  out.debts=Array.isArray(out.debts)?out.debts:[];
  out.cards=Array.isArray(out.cards)?out.cards:[];
  out.loans=Array.isArray(out.loans)?out.loans:[];
  out.recurring=Array.isArray(out.recurring)?out.recurring:[];
  out.cashbooks=Array.isArray(out.cashbooks)?out.cashbooks:[];
  out.creditors=Array.isArray(out.creditors)?out.creditors:[];
  out.cashbooks.forEach(c=>{c.entries=Array.isArray(c.entries)?c.entries:[]});
  out.settings.daysOff=Array.isArray(out.settings.daysOff)?out.settings.daysOff:[];
  return out;
}
function applyRemoteState(state,updatedAt){
  db=normalizeRemoteState(state);
  saveLocal();
  if(updatedAt){lastRemoteUpdatedAt=updatedAt;localStorage.setItem(KEY+'_remote_updated_at',updatedAt)}
}
async function pullRemoteState({force=false}={}){
  if(!supabaseClient||!supabaseWorkspaceId||syncDirty&&!force)return false;
  const res=await supabaseClient.from('app_state').select('state,updated_at').eq('workspace_id',supabaseWorkspaceId).maybeSingle();
  if(res.error)throw res.error;
  if(!res.data)return false;
  const remoteTime=res.data.updated_at||'';
  if(force || !lastRemoteUpdatedAt || remoteTime>lastRemoteUpdatedAt){
    applyRemoteState(res.data.state,remoteTime);
    render(view);
    return true;
  }
  return false;
}
function subscribeRealtime(){
  if(!supabaseClient||!supabaseWorkspaceId)return;
  if(realtimeChannel){try{supabaseClient.removeChannel(realtimeChannel)}catch{}}
  realtimeChannel=supabaseClient.channel('raquor-app-state-'+supabaseWorkspaceId)
    .on('postgres_changes',{event:'*',schema:'public',table:'app_state',filter:`workspace_id=eq.${supabaseWorkspaceId}`},payload=>{
      const row=payload.new||null;
      if(!row||!row.state)return;
      const remoteTime=row.updated_at||'';
      if(syncDirty && remoteTime!==lastRemoteUpdatedAt)return;
      if(!lastRemoteUpdatedAt || remoteTime>=lastRemoteUpdatedAt){
        applyRemoteState(row.state,remoteTime);
        syncDirty=false;
        setSyncStatus('RAQVOR • Supabase sincronizado',true);
        render(view);
      }
    })
    .subscribe(status=>{
      if(status==='SUBSCRIBED')setSyncStatus('RAQVOR • Supabase conectado',true);
    });
}
function normalizePhone(raw){
  let d=String(raw||'').replace(/\D/g,'');
  if(d.startsWith('55') && d.length>=12)d=d.slice(2);
  if(d.length===10||d.length===11)return '+55'+d;
  return String(raw||'').trim();
}
function normalizeEmail(raw){return String(raw||'').trim().toLowerCase()}
function authErrorMessage(err){
  const m=String(err?.message||err||'');
  if(/invalid login credentials/i.test(m))return 'E-mail ou senha incorretos.';
  if(/user already registered|already registered/i.test(m))return 'Este e-mail já está cadastrado.';
  if(/password.*(6|characters|length)/i.test(m))return 'A senha deve ter pelo menos 6 caracteres.';
  if(/email.*disabled|provider_disabled/i.test(m))return 'O cadastro por e-mail ainda não está habilitado no Supabase.';
  return m||'Não foi possível concluir a operação.';
}
function showAuth(mode='login',message=''){
  const app=document.querySelector('.app'); if(app)app.style.display='none';
  let box=document.querySelector('#auth-screen');
  if(!box){box=document.createElement('section');box.id='auth-screen';document.body.prepend(box)}
  const isReg=mode==='register';
  box.innerHTML=`<div class="auth-shell"><div class="auth-brand"><img src="./assets/raquor-logo.png" alt="RAQVOR"><span>RAQVOR</span></div><div class="auth-card"><div class="auth-kicker">${isReg?'COMECE SEU CONTROLE':'BEM-VINDO DE VOLTA'}</div><h1>${isReg?'Criar sua conta':'Entrar no RAQVOR'}</h1><p class="auth-sub">${isReg?'Cadastre seu e-mail, telefone e crie sua senha. O telefone ficará vinculado ao seu perfil.':'Acesse suas finanças em qualquer dispositivo.'}</p>${message?`<div class="auth-alert">${esc(message)}</div>`:''}<form id="auth-form" class="auth-form">${isReg?`<label>Nome completo<input id="auth-name" autocomplete="name" required placeholder="Seu nome"></label>`:''}<label>E-mail<input id="auth-email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></label>${isReg?`<label>Número de celular<input id="auth-phone" inputmode="tel" autocomplete="tel" required placeholder="(81) 99999-9999"></label>`:''}<label>Senha<input id="auth-password" type="password" minlength="6" autocomplete="${isReg?'new-password':'current-password'}" required placeholder="Mínimo de 6 caracteres"></label>${isReg?`<label>Confirmar senha<input id="auth-password2" type="password" minlength="6" autocomplete="new-password" required placeholder="Repita sua senha"></label>`:''}<button class="btn primary auth-submit" type="submit">${isReg?'Criar conta':'Entrar'}</button></form><div class="auth-switch">${isReg?'Já possui uma conta?':'Ainda não possui uma conta?'} <button type="button" id="auth-switch">${isReg?'Entrar':'Criar conta'}</button></div></div><div class="auth-foot">Seus dados financeiros ficam vinculados à sua conta no Supabase.</div></div>`;
  box.style.display='grid';
  document.querySelector('#auth-switch').onclick=()=>showAuth(isReg?'login':'register');
  document.querySelector('#auth-form').onsubmit=async e=>{
    e.preventDefault(); const btn=e.currentTarget.querySelector('.auth-submit'); btn.disabled=true; btn.textContent='Aguarde...';
    try{
      if(isReg){
        const p1=document.querySelector('#auth-password').value,p2=document.querySelector('#auth-password2').value;
        if(p1!==p2)throw new Error('As senhas não conferem.');
        const email=normalizeEmail(document.querySelector('#auth-email').value);
        const phone=normalizePhone(document.querySelector('#auth-phone').value);
        const name=document.querySelector('#auth-name').value.trim();
        const {data,error}=await supabaseClient.auth.signUp({email,password:p1,options:{data:{full_name:name,phone}}});
        if(error)throw error;
        if(!data.session){showAuth('login','Conta criada. Se a confirmação de e-mail estiver ativada no Supabase, confirme o e-mail antes de entrar.');return;}
        await startAuthenticatedApp(data.session.user);
      }else{
        const email=normalizeEmail(document.querySelector('#auth-email').value),password=document.querySelector('#auth-password').value;
        const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
        if(error)throw error; await startAuthenticatedApp(data.user);
      }
    }catch(err){console.error('[RAQVOR][AUTH]',err);showAuth(isReg?'register':'login',authErrorMessage(err));}
    finally{const b=document.querySelector('.auth-submit');if(b){b.disabled=false;b.textContent=isReg?'Criar conta':'Entrar'}}
  };
}
function showUserMenu(user){
  const side=document.querySelector('#sidebar'); if(!side)return;
  let el=document.querySelector('#user-panel');
  if(!el){el=document.createElement('div');el.id='user-panel';side.insertBefore(el,side.querySelector('.side-foot'));}
  const name=esc(currentProfile?.full_name||user?.user_metadata?.full_name||'Usuário RAQVOR');
  const phone=esc(currentProfile?.phone||user?.user_metadata?.phone||user?.phone||'');
  const avatar=currentProfile?.avatar_url?`<img class="user-avatar-img" src="${esc(currentProfile.avatar_url)}" alt="Foto de perfil">`:`<div class="user-avatar">${name.charAt(0).toUpperCase()}</div>`;
  el.innerHTML=`${avatar}<div class="user-meta"><b>${name}</b><small>${phone}</small></div><button id="profile-btn" title="Meu perfil">⚙</button><button id="logout-btn" title="Sair">↪</button>`;
  document.querySelector('#profile-btn').onclick=()=>openProfile();
  document.querySelector('#logout-btn').onclick=async()=>{await supabaseClient.auth.signOut();location.reload()};
}
async function refreshProfile(){
  if(!currentUser)return;
  const r=await supabaseClient.from('profiles').select('*').eq('id',currentUser.id).maybeSingle();
  if(r.data){currentProfile=r.data;showUserMenu(currentUser)}
}
async function uploadProfileAvatar(file){
  if(!currentUser||!file)return;
  if(file.size>10*1024*1024)throw new Error('A foto deve ter no máximo 10 MB.');
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`${currentUser.id}/${Date.now()}-${safe}`;
  const up=await supabaseClient.storage.from('profile-avatars').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(up.error)throw up.error;
  const pub=supabaseClient.storage.from('profile-avatars').getPublicUrl(path).data.publicUrl;
  const r=await supabaseClient.from('profiles').update({avatar_url:pub}).eq('id',currentUser.id);
  if(r.error)throw r.error;
  currentProfile={...(currentProfile||{}),avatar_url:pub};
  return pub;
}
function openProfile(){
  const p=currentProfile||{}; const el=document.createElement('div'); el.className='modal open';
  el.innerHTML=`<div class="modal-card profile-modal"><div class="profile-head"><div><span class="eyebrow">MINHA CONTA</span><h2>Meu perfil</h2><p>Seus dados de contato são usados para identificar e atender sua conta.</p></div><button class="close" id="profile-close">×</button></div><form id="profile-form" class="form"><div class="profile-photo"><div id="profile-photo-preview" class="profile-photo-preview">${p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="Foto">`:`<span>${esc((p.full_name||currentUser?.email||'R').charAt(0).toUpperCase())}</span>`}</div><div><label class="btn secondary file-btn">Carregar foto<input id="profile-photo" type="file" accept="image/*,.heic,.heif,.avif,.webp"></label><small>JPG, PNG, WEBP, GIF, AVIF, HEIC/HEIF quando suportado. Até 10 MB.</small></div></div><div class="field"><label>Nome completo</label><input id="profile-name" required value="${esc(p.full_name||currentUser?.user_metadata?.full_name||'')}"></div><div class="field"><label>Número de celular</label><input id="profile-phone" inputmode="tel" value="${esc(p.phone||currentUser?.phone||'')}"></div><div class="field"><label>E-mail</label><input value="${esc(currentUser?.email||'')}" disabled></div><div class="actions"><button class="btn primary">Salvar perfil</button><button type="button" class="btn secondary" id="profile-cancel">Cancelar</button></div></form></div>`;
  document.body.appendChild(el); el.querySelector('#profile-close').onclick=()=>el.remove(); el.querySelector('#profile-cancel').onclick=()=>el.remove(); el.onclick=e=>{if(e.target===el)el.remove()};
  el.querySelector('#profile-photo').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const url=await uploadProfileAvatar(f);el.querySelector('#profile-photo-preview').innerHTML=`<img src="${esc(url)}" alt="Foto">`;toast('Foto atualizada.')}catch(err){toast('Não foi possível carregar a foto: '+err.message)}};
  el.querySelector('#profile-form').onsubmit=async e=>{e.preventDefault();try{const full_name=el.querySelector('#profile-name').value.trim(),phone=el.querySelector('#profile-phone').value.trim();const r=await supabaseClient.from('profiles').update({full_name,phone}).eq('id',currentUser.id);if(r.error)throw r.error;await supabaseClient.auth.updateUser({data:{full_name,phone}});currentProfile={...(currentProfile||{}),full_name,phone};showUserMenu(currentUser);el.remove();toast('Perfil atualizado.')}catch(err){toast('Não foi possível salvar: '+err.message)}};
}

async function ensureWorkspace(){
  const {data,error}=await supabaseClient.rpc('get_or_create_my_workspace');
  if(error)throw error;
  if(!data)throw new Error('Não foi possível obter o espaço financeiro da conta.');
  supabaseWorkspaceId=typeof data==='string'?data:data.id;
  return supabaseWorkspaceId;
}
async function startAuthenticatedApp(user){
  currentUser=user;
  const pr=await supabaseClient.from('profiles').select('*').eq('id',user.id).maybeSingle();
  currentProfile=pr.data||{id:user.id,full_name:user.user_metadata?.full_name||'',phone:user.user_metadata?.phone||user.phone||'',avatar_url:''};
  const auth=document.querySelector('#auth-screen');if(auth)auth.style.display='none';
  const app=document.querySelector('.app');if(app)app.style.display='grid';
  showUserMenu(user); try{const ar=await supabaseClient.from('user_access_controls').select('status,reason').eq('user_id',user.id).maybeSingle();if(ar.data&&ar.data.status!=='active'){await supabaseClient.auth.signOut();throw new Error('Seu acesso está bloqueado. '+(ar.data.reason||''));}}catch(e){if(e.message?.includes('bloqueado'))throw e;}
  const baseKey='finance_nexora_v1_'+user.id;
  if(!localStorage.getItem(baseKey)){
    const old=localStorage.getItem('finance_nexora_v1'); if(old)localStorage.setItem(baseKey,old);
  }
  KEY=baseKey;
  try{db=JSON.parse(localStorage.getItem(KEY))||defaultDB()}catch{db=defaultDB()}
  db=normalizeRemoteState(db);
  lastRemoteUpdatedAt=localStorage.getItem(KEY+'_remote_updated_at')||'';
  Object.assign(db,defaultDB(),db,{settings:{...defaultDB().settings,...(db.settings||{})},categories:{...defaultDB().categories,...(db.categories||{})}});
  db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];db.creditors=Array.isArray(db.creditors)?db.creditors:[];db.settings.currency=db.settings.currency||'BRL';db.settings.cycleStart=Number(db.settings.cycleStart||1);db.settings.cycleLength=Number(db.settings.cycleLength||30);
  const theme=document.querySelector('#theme'),open=document.querySelector('#open-menu'),close=document.querySelector('#close-menu'),side=document.querySelector('#sidebar');
  if(open)open.onclick=()=>side.classList.add('open'); if(close)close.onclick=()=>side.classList.remove('open');
  if(theme){theme.textContent=db.settings.theme==='dark'?'☀':'☾';theme.onclick=()=>{db.settings.theme=db.settings.theme==='dark'?'light':'dark';save();document.body.classList.toggle('dark',db.settings.theme==='dark');theme.textContent=db.settings.theme==='dark'?'☀':'☾'}}
  document.body.classList.toggle('dark',db.settings.theme==='dark');
  normalizeOverdue(); render();
  await connectUserWorkspace(currentUser);
}
async function connectUserWorkspace(authUser=currentUser){
  try{
    const user=authUser||currentUser;
    if(!user?.id)throw new Error('Usuário autenticado não encontrado para iniciar o workspace.');
    setSyncStatus('RAQVOR • Supabase: conectando...');
    await ensureWorkspace();
    const stateRes=await supabaseClient.from('app_state').select('state,updated_at').eq('workspace_id',supabaseWorkspaceId).maybeSingle();
    if(stateRes.error)throw stateRes.error;
    const remoteState=stateRes.data?.state||null;
    if(remoteState){applyRemoteState(remoteState,stateRes.data.updated_at);syncDirty=false;render(view)}
    else {await syncNow()}
    syncReady=true;subscribeRealtime();supabaseClient.channel('raquor-access-'+currentUser.id).on('postgres_changes',{event:'*',schema:'public',table:'user_access_controls',filter:`user_id=eq.${currentUser.id}`},async p=>{if(p.new?.status&&p.new.status!=='active'){toast('Seu acesso foi bloqueado.');await supabaseClient.auth.signOut();location.reload()}}).subscribe();await pullRemoteState({force:false});setSyncStatus('RAQVOR • Supabase conectado',true);
  }catch(err){console.error('[RAQVOR][SUPABASE]',err);setSyncStatus('RAQVOR • Supabase indisponível');toast(authErrorMessage(err))}
}
async function initSupabase(){
  if(!window.supabase||!window.supabase.createClient)throw new Error('Biblioteca Supabase não carregada');
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{headers:{'x-raquor-client':'raqvor-v2.11'}}});
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user){await startAuthenticatedApp(session.user);return true}
  showAuth('login');return false;
}

async function syncNow(){
  if(!supabaseClient||!supabaseWorkspaceId||syncInProgress)return;
  syncInProgress=true;
  try{
    const state=JSON.parse(JSON.stringify(db));
    const stamp=new Date().toISOString();
    const res=await supabaseClient.from('app_state').upsert({workspace_id:supabaseWorkspaceId,state,updated_at:stamp},{onConflict:'workspace_id'});
    if(res.error)throw res.error;
    lastRemoteUpdatedAt=stamp;
    localStorage.setItem(KEY+'_remote_updated_at',stamp);
    localStorage.setItem(KEY+'_remote_initialized','1');
    syncDirty=false;
    setSyncStatus('RAQVOR • Supabase sincronizado',true);
  }catch(err){
    console.error('[RAQVOR][SYNC]',err);
    setSyncStatus('RAQVOR • erro de sincronização');
  }finally{syncInProgress=false}
}
function queueSync(){
  if(!syncReady)return;
  syncDirty=true;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(syncNow,250);
}
window.addEventListener('online',()=>{if(syncReady){syncDirty=true;syncNow().catch(()=>{})}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&syncReady&&!syncDirty)pullRemoteState().catch(err=>console.error('[RAQVOR][PULL]',err))});
window.addEventListener('focus',()=>{if(syncReady&&!syncDirty)pullRemoteState().catch(err=>console.error('[RAQVOR][PULL]',err))});
window.addEventListener('pagehide',()=>{if(syncDirty)syncNow().catch(()=>{})});

db.cashbooks=db.cashbooks||[]; db.cashbooks.forEach(c=>{c.entries=Array.isArray(c.entries)?c.entries:[]});
db.cashbooks=db.cashbooks||[]; db.cashbooks.forEach(c=>{c.entries=Array.isArray(c.entries)?c.entries:[]}); db.transactions.forEach(x=>{if(x.paymentSource===undefined)x.paymentSource='';if(x.type==='receita'&&x.repayable===undefined)x.repayable=false}); db.debts.forEach(x=>{if(x.paymentSource===undefined)x.paymentSource=''}); db.loans.forEach(x=>{if(x.paymentSource===undefined)x.paymentSource=''}); Object.assign(db,defaultDB(),db,{settings:{...defaultDB().settings,...(db.settings||{})},categories:{...defaultDB().categories,...(db.categories||{})}}); db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];db.creditors=Array.isArray(db.creditors)?db.creditors:[];db.settings.currency=db.settings.currency||'BRL';db.settings.cycleStart=Number(db.settings.cycleStart||1);db.settings.cycleLength=Number(db.settings.cycleLength||30);
let view='dashboard'; let editingId=null;
function save(){saveLocal();queueSync()}
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(window._toast);window._toast=setTimeout(()=>t.style.display='none',2200)}
function fmtDate(d){if(!d)return'—';return new Intl.DateTimeFormat('pt-BR').format(iso(d))}
function monthKey(d){if(d instanceof Date){const x=ymd(d);return x?x.slice(0,7):''}return String(d??'').slice(0,7)}
function currentMonth(){return monthKey(today())}
function weekOf(d){const x=iso(d);if(Number.isNaN(x.getTime()))return null;const first=new Date(x.getFullYear(),x.getMonth(),1,12);const offset=(first.getDay()+6)%7;const monday=new Date(first);monday.setDate(first.getDate()-offset);return Math.floor((x-monday)/86400000/7)+1}
function weekLabel(d){const w=weekOf(d);return w?`Semana ${w}`:'Fora da semana operacional'}
function assignedWeekLabel(x){return x.weekAssigned?`Semana ${x.weekAssigned}`:weekLabel(x.date)}
function txAmount(x){return x.type==='receita'?num(x.value):-num(x.value)}
function paidTransactions(){return db.transactions.filter(x=>x.status==='pago')}
function ensureRecurring(){const base=new Date();for(const r of db.recurring.filter(x=>x.active)){for(let i=0;i<12;i++){const lastDay=new Date(base.getFullYear(),base.getMonth()+i+1,0).getDate();const dt=new Date(base.getFullYear(),base.getMonth()+i,Math.min(r.day,lastDay),12);const date=dt.toISOString().slice(0,10);const exists=db.transactions.some(x=>x.recurringId===r.id&&x.date===date);if(!exists)db.transactions.push({id:uid(),date,value:num(r.value),category:r.category||'Recorrente',person:r.person||'',status:'previsto',weekAssigned:weekOf(date),note:`Lançamento recorrente — ${r.description}`,type:r.type,recurringId:r.id})}}save()}
function totals(m=currentMonth()){const arr=db.transactions.filter(x=>monthKey(x.date)===m);return{r:arr.filter(x=>x.type==='receita'&&x.status==='pago').reduce((a,x)=>a+num(x.value),0),d:arr.filter(x=>x.type==='despesa'&&x.status==='pago').reduce((a,x)=>a+num(x.value),0),rp:arr.filter(x=>x.type==='receita'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0),dp:arr.filter(x=>x.type==='despesa'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0)}}
function currentBalance(){return num(db.balance)+paidTransactions().reduce((a,x)=>a+txAmount(x),0)}
function cashStatus(){const bal=currentBalance();const received=paidTransactions().filter(x=>x.type==='receita').reduce((a,x)=>a+num(x.value),0);const paid=paidTransactions().filter(x=>x.type==='despesa').reduce((a,x)=>a+num(x.value),0);return{balance:bal,received,paid,deficit:received===0&&paid>0&&bal<0}}
function projectedBalance(){return currentBalance()+db.transactions.filter(x=>x.status!=='pago').reduce((a,x)=>a+txAmount(x),0)}
function debtOutstanding(){return db.debts.reduce((a,d)=>{const paid=db.transactions.filter(x=>x.debtId===d.id&&x.status==='pago').reduce((s,x)=>s+num(x.value),0);return a+Math.max(0,num(d.value)-paid)},0)}
function debtRemaining(id){const d=db.debts.find(x=>x.id===id);if(!d)return 0;const paid=db.transactions.filter(x=>x.debtId===id&&x.status==='pago').reduce((s,x)=>s+num(x.value),0);return Math.max(0,num(d.value)-paid)}
function table(rows,heads){const safeRows=Array.isArray(rows)?rows:(rows==null?[]:[String(rows)]);const body=safeRows.join('');return body?`<div class="table-wrap"><table class="table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`:`<div class="empty">Nenhum registro encontrado.</div>`}
function layout(title,body){$('#page-title').textContent=title;$('#content').innerHTML=body;bindGlobal()}
function overdueInfo(date){const d=iso(date), t=iso(today());if(Number.isNaN(d.getTime())||d>=t)return{days:0,label:''};const days=Math.max(1,Math.floor((t-d)/86400000));const priority=days>=8?'Crítica':days>=3?'Alta':'Média';return{days,priority,label:`Atrasado • ${priority}`}}
function normalizeOverdue(){let changed=false;for(const x of db.transactions){if(x.type!=='despesa'||x.status==='pago'||!x.date)continue;const info=overdueInfo(x.date);if(info.days>0){if(x.status!=='atrasado'||x.priority!==info.priority){x.status='atrasado';x.priority=info.priority;changed=true}}else if(x.status==='atrasado'){x.status='pendente';delete x.priority;changed=true}}if(changed)save()}
function statusPill(s,priority=''){const label=s==='pago'?'Pago':s==='atrasado'?`Atrasado${priority?` • ${priority}`:''}`:s==='pendente'?'Pendente':'Previsto';const cls=s==='pago'?'paid':s==='atrasado'?'overdue':s==='pendente'?'pending':'planned';return `<span class="pill ${cls}">${label}</span>`}
function dashboard(){const t=totals(), bal=currentBalance(), proj=projectedBalance();const due=db.transactions.filter(x=>x.status!=='pago').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8);layout('Dashboard',`<div class="hero"><div><small>SALDO ATUAL</small><h2>${money(bal)}</h2><small>Saldo inicial + movimentações pagas</small></div><div class="side"><small>SALDO PROJETADO</small><br><b>${money(proj)}</b><br><small>Considerando compromissos previstos</small></div></div><div class="grid"><div class="card"><div class="label">Receitas pagas</div><div class="value positive">${money(t.r)}</div></div><div class="card"><div class="label">Despesas pagas</div><div class="value negative">${money(t.d)}</div></div><div class="card"><div class="label">Dívidas pendentes</div><div class="value">${money(debtOutstanding())}</div></div><div class="card"><div class="label">Resultado do mês</div><div class="value ${t.r-t.d>=0?'positive':'negative'}">${money(t.r-t.d)}</div></div></div><div class="card"><div class="section-head"><div><h3>Próximos compromissos</h3><p>Vencimentos ainda não pagos</p></div><button class="btn primary" data-view="calendario">Ver calendário</button></div>${table(due.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(assignedWeekLabel(x))}</td><td>${esc(x.category||'—')}</td><td>${esc(x.person||'—')}</td><td class="${x.type==='receita'?'positive':'negative'}">${x.type==='receita'?'+':'-'} ${money(x.value)}</td><td>${statusPill(x.status,x.priority)}</td></tr>`),['Data','Semana','Categoria','Credor/Origem','Valor','Status'])}</div>`)}
function categories(type){return (db.categories[type]||[]).map(x=>`<option>${esc(x)}</option>`).join('')}
function transactionForm(type,id=null){const x=id?db.transactions.find(z=>z.id===id):null;const title=x?'Editar lançamento':type==='receita'?'Nova Receita':'Nova Despesa';const sourceLabel=type==='receita'?'Origem da receita / de onde veio':'Fonte do pagamento / de onde sairá o dinheiro';layout(title,`<div class="card"><form id="entry-form" class="form"><div class="field"><label>Data de vencimento</label><input id="date" type="date" value="${x?.date||today()}" required></div><div class="field"><label>Valor (R$)</label><input id="value" type="number" step="0.01" min="0" value="${x?.value??''}" required></div><div class="field"><label>Categoria</label><select id="category"><option value="">Selecione</option>${categories(type)}</select></div><div class="field"><label>${type==='receita'?'Quem pagou / origem':'Credor / beneficiário'}</label><input id="person" value="${esc(x?.person||'')}" placeholder="Pessoa, empresa, instituição..."></div><div class="field"><label>${sourceLabel}</label><input id="paymentSource" value="${esc(x?.paymentSource||'')}" placeholder="Conta, carteira, caixa, banco, cartão..."></div><div class="field"><label>Status</label><select id="status"><option value="previsto">Previsto</option><option value="pendente">Pendente</option><option value="atrasado">Atrasado</option><option value="pago">Pago / Recebido</option></select></div><div class="field"><label>${type==='receita'?'Precisa devolver?':'Semana financeira'}</label>${type==='receita'?`<select id="repayable"><option value="nao">Não</option><option value="sim">Sim</option></select>`:`<select id="week"><option value="auto">Automática — ${weekLabel(x?.date||today())}</option>${[1,2,3,4,5].map(n=>`<option value="${n}">Semana ${n}</option>`).join('')}</select>`}</div>${type==='receita'?`<div class="field"><label>Data limite para devolver (opcional)</label><input id="repayDate" type="date" value="${x?.repayDate||''}"></div>`:''}<div class="field full"><label>Observação</label><textarea id="note" placeholder="Detalhes, referência, parcela ou comentário...">${esc(x?.note||'')}</textarea></div><div class="actions full"><button type="submit" class="btn primary">${x?'Salvar alterações':'Salvar lançamento'}</button><button type="button" class="btn secondary" data-view="movimentos">Cancelar</button></div></form></div>`);if(x){$('#category').value=x.category||'';$('#status').value=x.status||'previsto';if(type==='receita'){$('#repayable').value=x.repayable?'sim':'nao'}else $('#week').value=x.weekAssigned||'auto'}$('#entry-form').onsubmit=e=>{e.preventDefault();const data={date:$('#date').value,value:num($('#value').value),category:$('#category').value,person:$('#person').value,paymentSource:$('#paymentSource').value,status:$('#status').value,weekAssigned:type==='receita'?weekOf($('#date').value):($('#week').value==='auto'?weekOf($('#date').value):Number($('#week').value)),note:$('#note').value,type};if(type==='receita'){data.repayable=$('#repayable').value==='sim';data.repayDate=$('#repayDate').value||''}if(editingId){Object.assign(db.transactions.find(z=>z.id===editingId),data);editingId=null;toast('Lançamento atualizado')}else{db.transactions.push({id:uid(),...data});toast('Lançamento salvo')}save();render(type==='receita'?'receitas':'movimentos')}
}
function listTransactions(type,title){
  if(type==='receita') return receitasPage();
  const rows=db.transactions.filter(x=>!type||x.type===type).sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(assignedWeekLabel(x))}</td><td>${x.type==='receita'?'Receita':'Despesa'}</td><td>${esc(x.category||'—')}</td><td>${esc(x.person||'—')}</td><td>${money(x.value)}</td><td>${esc(x.paymentSource||'—')}</td><td>${statusPill(x.status,x.priority)}</td><td><button class="btn secondary" data-edit="${x.id}">Editar</button> <button class="btn danger" data-del="${x.id}">Excluir</button></td></tr>`);
  layout(title,`<div class="actions"><button class="btn primary" data-new="receita">+ Receita</button><button class="btn primary" data-new="despesa">+ Despesa</button></div><div class="section">${table(rows,['Vencimento','Semana','Tipo','Categoria','Credor/Origem','Valor','Status','Ações'])}</div>`)
}
function receitaPrevistaRows(){return db.transactions.filter(x=>x.type==='receita'&&x.status!=='pago').sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.person||'—')}</td><td>${esc(x.category||'—')}</td><td>${money(x.value)}</td><td>${statusPill(x.status,x.priority)}</td><td><button class="btn primary" data-receive="${x.id}">Receber</button> <button class="btn secondary" data-edit="${x.id}">Editar</button></td></tr>`)}
function receitaRecebidaRows(){return db.transactions.filter(x=>x.type==='receita'&&x.status==='pago').sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.person||'—')}</td><td>${esc(x.category||'—')}</td><td class="positive">${money(x.value)}</td><td><button class="btn secondary" data-edit="${x.id}">Editar</button></td></tr>`)}
function cashbookOpen(){
  db.cashbooks=db.cashbooks||[];
  let c=db.cashbooks.find(x=>x.date===today());
  if(!c){c={id:uid(),date:today(),openedAt:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),closedAt:null,entries:[],closingTransactionId:null};db.cashbooks.push(c)}
  else if(!Array.isArray(c.entries))c.entries=[];
  save();toast('Livro caixa aberto');cashbook();
}
function cashEntryForm(type,id=null){
  const c=db.cashbooks?.find(x=>x.date===today());
  if(!c||c.closedAt){toast('Abra o Livro Caixa antes de registrar movimentações');return}
  const x=id?c.entries.find(z=>z.id===id):null;
  layout(x?'Editar movimento do caixa':type==='entrada'?'Registrar entrada':'Registrar saída',`<div class="card"><form id="cash-entry-form" class="form"><div class="field"><label>Tipo</label><select id="ce-type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></div><div class="field"><label>Valor (R$)</label><input id="ce-value" type="number" step="0.01" min="0" value="${x?.value??''}" required></div><div class="field"><label>Descrição</label><input id="ce-desc" value="${esc(x?.description||'')}" placeholder="Ex.: corrida, combustível, compra, pagamento..." required></div><div class="field"><label>Origem / destino</label><input id="ce-source" value="${esc(x?.source||'')}" placeholder="Pessoa, empresa, conta, carteira..."></div><div class="field"><label>Categoria</label><input id="ce-cat" value="${esc(x?.category||'')}" placeholder="Categoria opcional"></div><div class="field full"><label>Observação</label><textarea id="ce-note" placeholder="Detalhes relevantes">${esc(x?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">${x?'Salvar alteração':'Registrar movimento'}</button><button type="button" class="btn secondary" data-view="caixa">Cancelar</button></div></form></div>`);
  $('#ce-type').value=x?.type||type;
  $('#cash-entry-form').onsubmit=e=>{e.preventDefault();const data={type:$('#ce-type').value,value:num($('#ce-value').value),description:$('#ce-desc').value,source:$('#ce-source').value,category:$('#ce-cat').value,note:$('#ce-note').value,time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})};if(x)Object.assign(x,data);else c.entries.push({id:uid(),...data});save();toast('Movimento do caixa registrado');cashbook()}
}
function cashbookClose(){
  const c=db.cashbooks?.find(x=>x.date===today());
  if(!c||c.closedAt){toast('O Livro Caixa já está fechado ou não foi aberto');return}
  const net=(c.entries||[]).reduce((a,e)=>a+(e.type==='entrada'?num(e.value):-num(e.value)),0);
  const old=db.transactions.find(x=>x.id===c.closingTransactionId);
  const closing={date:today(),value:net,category:'Livro Caixa',person:'Fechamento do caixa',paymentSource:'Caixa do dia',status:'pago',weekAssigned:weekOf(today()),note:`Fechamento do Livro Caixa de ${fmtDate(today())}. ${net>=0?'Saldo positivo':'Saldo negativo'} do movimento diário.`,type:'receita',cashbookId:c.id,cashbookClosing:true};
  if(old)Object.assign(old,closing);else{const tx={id:uid(),...closing};db.transactions.push(tx);c.closingTransactionId=tx.id}
  c.closedAt=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});c.net=net;save();toast(`Caixa fechado: ${money(net)}`);cashbook();
}
function cashbook(){
  const day=today();db.cashbooks=db.cashbooks||[];const c=db.cashbooks.find(x=>x.date===day);const entries=c?.entries||[];const ins=entries.filter(x=>x.type==='entrada').reduce((a,x)=>a+num(x.value),0), outs=entries.filter(x=>x.type==='saida').reduce((a,x)=>a+num(x.value),0), net=ins-outs;
  layout('Livro Caixa',`<div class="hero cash-hero"><div><small>LIVRO CAIXA DIÁRIO</small><h2>${fmtDate(day)}</h2><small>${c?.openedAt?'Aberto às '+c.openedAt:'Caixa ainda não aberto'}</small></div><div class="side"><small>SALDO DO DIA</small><br><b class="${net>=0?'positive':'negative'}">${money(net)}</b><br><small>${c?.closedAt?'Fechado às '+c.closedAt:'Em aberto'}</small></div></div>
  <div class="grid"><div class="card"><div class="label">Total de entradas</div><div class="value positive">${money(ins)}</div></div><div class="card"><div class="label">Total de saídas</div><div class="value negative">${money(outs)}</div></div><div class="card"><div class="label">Resultado do caixa</div><div class="value ${net>=0?'positive':'negative'}">${money(net)}</div></div><div class="card"><div class="label">Status</div><div class="value">${c?.closedAt?'Fechado':'Em aberto'}</div></div></div>
  <div class="actions">${!c?'<button class="btn primary" data-open-cash>Abrir caixa do dia</button>':c.closedAt?'<span class="pill paid">Caixa fechado</span>':`<button class="btn primary" data-new-cash-entry="entrada">+ Registrar entrada</button><button class="btn secondary" data-new-cash-entry="saida">− Registrar saída</button><button class="btn danger" data-close-cash>Fechar caixa e lançar resultado na receita</button>`}</div>
  <div class="card section"><div class="section-head"><div><h3>Movimentações do dia</h3><p>Registre tudo o que entrou e saiu. Ao fechar o caixa, o saldo líquido do dia será lançado automaticamente em Receitas.</p></div></div>${table(entries.map(x=>`<tr><td>${esc(x.time||'—')}</td><td>${x.type==='entrada'?'<span class="positive">Entrada</span>':'<span class="negative">Saída</span>'}</td><td>${esc(x.description||'—')}</td><td>${esc(x.source||'—')}</td><td>${money(x.value)}</td><td>${esc(x.category||'—')}</td><td>${c?.closedAt?'<span class="pill paid">Fechado</span>':`<button class="btn secondary" data-edit-cash-entry="${x.id}">Editar</button> <button class="btn danger" data-del-cash-entry="${x.id}">Excluir</button>`}</td></tr>`),['Hora','Tipo','Descrição','Origem / destino','Valor','Categoria','Ações'])}</div>`)
}
function receitasPage(tab='prevista'){
  const t=totals();
  layout('Receitas',`<div class="grid"><div class="card"><div class="label">Previstas</div><div class="value">${money(t.rp)}</div></div><div class="card"><div class="label">Recebidas</div><div class="value positive">${money(t.r)}</div></div><div class="card"><div class="label">Recebido hoje</div><div class="value positive">${money(db.transactions.filter(x=>x.type==='receita'&&x.date===today()&&x.status==='pago').reduce((a,x)=>a+num(x.value),0))}</div></div><div class="card"><div class="label">Livro caixa</div><div class="value">${db.cashbooks?.some(x=>x.date===today()&&!x.closedAt)?'Aberto':'Fechado'}</div></div></div><div class="tabs"><button class="tab ${tab==='prevista'?'active':''}" data-receita-tab="prevista">Receita prevista</button><button class="tab ${tab==='recebida'?'active':''}" data-receita-tab="recebida">Receita recebida</button></div><div class="actions"><button class="btn primary" data-new="receita">+ Nova receita prevista</button></div><div class="card section"><p>${tab==='prevista'?'Valores previstos não alteram o saldo atual. Ao receber, passam para Receita recebida e entram no saldo.':'Livro de receitas efetivamente recebidas. O fechamento do Livro Caixa diário também é lançado aqui como resultado líquido do dia.'}</p>${table(tab==='prevista'?receitaPrevistaRows():receitaRecebidaRows(),tab==='prevista'?['Vencimento','Origem','Categoria','Valor','Status','Ações']:['Data','Origem','Categoria','Valor','Ações'])}</div>`);
}
function debtForm(id=null){const d=id?db.debts.find(x=>x.id===id):null;layout(d?'Editar Dívida':'Nova Dívida',`<div class="card"><form id="debt-form" class="form"><div class="field"><label>Credor</label><input id="creditor" value="${esc(d?.creditor||'')}" required></div><div class="field"><label>Tipo</label><select id="kind"><option>Instituição</option><option>Pessoa física</option><option>Cartão</option><option>Financiamento</option><option>Outros</option></select></div><div class="field"><label>Valor original</label><input id="dvalue" type="number" step=".01" min="0" value="${d?.value??''}" required></div><div class="field"><label>Parcelas</label><input id="installments" type="number" min="1" value="${d?.installments||1}" required></div><div class="field"><label>Primeiro vencimento</label><input id="firstdate" type="date" value="${d?.firstDate||today()}" required></div><div class="field"><label>Juros (%)</label><input id="interest" type="number" step=".01" min="0" value="${d?.interest||0}"></div><div class="field full"><label>Observação</label><textarea id="dnote">${esc(d?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">${d?'Salvar':'Criar dívida e parcelas'}</button><button type="button" class="btn secondary" data-view="dividas">Cancelar</button></div></form></div>`);if(d)$('#kind').value=d.kind;$('#debt-form').onsubmit=e=>{e.preventDefault();const creditor=$('#creditor').value,kind=$('#kind').value,value=num($('#dvalue').value),installments=Math.max(1,num($('#installments').value)),firstDate=$('#firstdate').value,interest=num($('#interest').value),note=$('#dnote').value;const data={creditor,kind,value,installments,firstDate,interest,note,remaining:value};if(d){Object.assign(d,data);db.transactions=db.transactions.filter(x=>x.debtId!==d.id);const installment=value/installments;for(let i=0;i<installments;i++){const dt=new Date(iso(firstDate));dt.setMonth(dt.getMonth()+i);const date=dt.toISOString().slice(0,10);db.transactions.push({id:uid(),date,value:installment,category:'Empréstimos',person:creditor,status:'previsto',weekAssigned:weekOf(date),note:`Dívida ${d.id} — parcela ${i+1}/${installments}`,type:'despesa',debtId:d.id,installment:i+1})}toast('Dívida atualizada e parcelas recalculadas')}else{const id=uid();const debt={id,...data,remaining:value,createdAt:today()};db.debts.push(debt);const installment=value/installments;for(let i=0;i<installments;i++){const dt=new Date(iso(firstDate));dt.setMonth(dt.getMonth()+i);const date=dt.toISOString().slice(0,10);db.transactions.push({id:uid(),date,value:installment,category:'Empréstimos',person:creditor,status:'previsto',weekAssigned:weekOf(date),note:`Dívida ${id} — parcela ${i+1}/${installments}`,type:'despesa',debtId:id,installment:i+1})}toast('Dívida criada e parcelas geradas')}save();render('movimentos')}}
function debts(){const rows=db.debts.sort((a,b)=>a.firstDate.localeCompare(b.firstDate)).map(d=>`<tr><td>${esc(d.creditor)}</td><td>${esc(d.kind)}</td><td>${money(d.value)}</td><td>${d.installments}</td><td>${money(debtRemaining(d.id))}</td><td>${fmtDate(d.firstDate)}</td><td><button class="btn secondary" data-edit-debt="${d.id}">Editar</button> <button class="btn danger" data-del-debt="${d.id}">Excluir</button></td></tr>`);layout('Dívidas',`<div class="grid"><div class="card"><div class="label">Total em aberto</div><div class="value negative">${money(debtOutstanding())}</div></div><div class="card"><div class="label">Dívidas cadastradas</div><div class="value">${db.debts.length}</div></div></div><div class="actions"><button class="btn primary" data-new-debt>+ Nova dívida</button></div>${table(rows,['Credor','Tipo','Original','Parcelas','Restante','1º vencimento','Ações'])}`)}
function cardForm(id=null){const c=id?db.cards.find(x=>x.id===id):null;layout(c?'Editar Cartão':'Novo Cartão',`<div class="card"><form id="card-form" class="form"><div class="field"><label>Nome do cartão</label><input id="cname" value="${esc(c?.name||'')}" required></div><div class="field"><label>Instituição</label><input id="bank" value="${esc(c?.bank||'')}" required></div><div class="field"><label>Limite (R$)</label><input id="limit" type="number" step=".01" value="${c?.limit??''}" required></div><div class="field"><label>Dia de fechamento</label><input id="close" type="number" min="1" max="31" value="${c?.close||1}"></div><div class="field"><label>Dia de vencimento</label><input id="due" type="number" min="1" max="31" value="${c?.due||10}"></div><div class="field"><label>Observação</label><input id="cnote" value="${esc(c?.note||'')}"></div><div class="actions full"><button class="btn primary">Salvar cartão</button><button type="button" class="btn secondary" data-view="cartoes">Cancelar</button></div></form></div>`);$('#card-form').onsubmit=e=>{e.preventDefault();const data={name:$('#cname').value,bank:$('#bank').value,limit:num($('#limit').value),close:num($('#close').value),due:num($('#due').value),note:$('#cnote').value};if(c)Object.assign(c,data);else db.cards.push({id:uid(),...data,purchases:[]});save();toast('Cartão salvo');render('movimentos')}}
function cards(){const rows=db.cards.map(c=>{const used=db.transactions.filter(x=>x.cardId===c.id&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);return`<tr><td>${esc(c.name)}</td><td>${esc(c.bank)}</td><td>${money(c.limit)}</td><td>${money(used)}</td><td>${money(c.limit-used)}</td><td>${c.close}</td><td>${c.due}</td><td><button class="btn secondary" data-edit-card="${c.id}">Editar</button> <button class="btn primary" data-card-purchase="${c.id}">Compra</button> <button class="btn danger" data-del-card="${c.id}">Excluir</button></td></tr>`});layout('Cartões',`<div class="actions"><button class="btn primary" data-new-card>+ Novo cartão</button></div>${table(rows,['Cartão','Instituição','Limite','Utilizado','Disponível','Fechamento','Vencimento','Ações'])}`)}
function purchaseForm(cardId){const c=db.cards.find(x=>x.id===cardId);layout('Nova compra no cartão',`<div class="card"><p><b>${esc(c.name)}</b> • ${esc(c.bank)}</p><form id="purchase-form" class="form"><div class="field"><label>Data da compra</label><input id="pdate" type="date" value="${today()}" required></div><div class="field"><label>Valor total (R$)</label><input id="pvalue" type="number" step=".01" min="0" required></div><div class="field"><label>Parcelas</label><input id="pparts" type="number" min="1" value="1"></div><div class="field"><label>Categoria</label><select id="pcat">${categories('despesa')}</select></div><div class="field"><label>Estabelecimento</label><input id="pstore"></div><div class="field full"><label>Observação</label><textarea id="pnote"></textarea></div><div class="actions full"><button class="btn primary">Lançar compra</button></div></form></div>`);$('#purchase-form').onsubmit=e=>{e.preventDefault();const total=num($('#pvalue').value),parts=Math.max(1,num($('#pparts').value)),base=total/parts;for(let i=0;i<parts;i++){const dt=new Date(iso($('#pdate').value));dt.setMonth(dt.getMonth()+i);db.transactions.push({id:uid(),date:dt.toISOString().slice(0,10),value:base,category:$('#pcat').value,person:$('#pstore').value||c.name,status:'previsto',weekAssigned:weekOf(dt.toISOString().slice(0,10)),note:`Cartão ${c.name} — parcela ${i+1}/${parts}. ${$('#pnote').value}`,type:'despesa',cardId:c.id,installment:i+1})}save();toast('Compra parcelada lançada');cards()}}
function loans(){const rows=db.loans.map(l=>`<tr><td>${esc(l.kind)}</td><td>${esc(l.person)}</td><td>${money(l.value)}</td><td>${l.installments||1}</td><td>${statusPill(l.status||'previsto')}</td><td><button class="btn secondary" data-edit-loan="${l.id}">Editar</button> <button class="btn danger" data-del-loan="${l.id}">Excluir</button></td></tr>`);layout('Empréstimos',`<div class="actions"><button class="btn primary" data-new-loan>+ Novo empréstimo</button></div>${table(rows,['Tipo','Pessoa/Instituição','Valor','Parcelas','Status','Ações'])}`)}
function loanForm(id=null){const l=id?db.loans.find(x=>x.id===id):null;layout(l?'Editar Empréstimo':'Novo Empréstimo',`<div class="card"><form id="loan-form" class="form"><div class="field"><label>Tipo</label><select id="lkind"><option>Recebido</option><option>Concedido</option></select></div><div class="field"><label>Pessoa / instituição</label><input id="lperson" value="${esc(l?.person||'')}" required></div><div class="field"><label>Valor</label><input id="lvalue" type="number" step=".01" value="${l?.value??''}" required></div><div class="field"><label>Parcelas</label><input id="lparts" type="number" min="1" value="${l?.installments||1}"></div><div class="field"><label>Primeiro vencimento</label><input id="ldate" type="date" value="${l?.firstDate||today()}"></div><div class="field"><label>Status</label><select id="lstatus"><option>previsto</option><option>ativo</option><option>quitado</option></select></div><div class="actions full"><button class="btn primary">Salvar empréstimo</button></div></form></div>`);if(l)$('#lkind').value=l.kind,$('#lstatus').value=l.status;$('#loan-form').onsubmit=e=>{e.preventDefault();const data={kind:$('#lkind').value,person:$('#lperson').value,value:num($('#lvalue').value),installments:num($('#lparts').value),firstDate:$('#ldate').value,status:$('#lstatus').value};if(l){Object.assign(l,data);db.transactions=db.transactions.filter(x=>x.loanId!==l.id)}else{const id=uid();l={id,...data};db.loans.push(l)}if(data.status!=='quitado'){const sign=data.kind==='Recebido'?'receita':'despesa';const parts=Math.max(1,data.installments||1);const part=data.value/parts;for(let i=0;i<parts;i++){const dt=new Date(iso(data.firstDate));dt.setMonth(dt.getMonth()+i);const date=dt.toISOString().slice(0,10);db.transactions.push({id:uid(),date,value:part,category:'Empréstimos',person:data.person,status:i===0&&data.kind==='Recebido'?'pago':'previsto',weekAssigned:weekOf(date),note:`Empréstimo ${l.id} — ${data.kind} parcela ${i+1}/${parts}`,type:sign,loanId:l.id,installment:i+1})}}save();toast('Empréstimo salvo');loans()}}
function recurring(){const rows=db.recurring.map(r=>`<tr><td>${esc(r.description)}</td><td>${r.type}</td><td>${money(r.value)}</td><td>Dia ${r.day}</td><td>${r.active?'Ativa':'Inativa'}</td><td><button class="btn secondary" data-toggle-rec="${r.id}">${r.active?'Pausar':'Ativar'}</button> <button class="btn danger" data-del-rec="${r.id}">Excluir</button></td></tr>`);layout('Receitas / Despesas Recorrentes',`<div class="subnav"><button class="btn secondary" data-view="movimentos">← Dívidas e Despesas</button><button class="btn secondary" data-view="calendario">Calendário</button></div><div class="card"><form id="rec-form" class="form"><div class="field"><label>Descrição</label><input id="rdesc" required></div><div class="field"><label>Tipo</label><select id="rtype"><option value="receita">Receita</option><option value="despesa">Despesa</option></select></div><div class="field"><label>Valor</label><input id="rvalue" type="number" step=".01" required></div><div class="field"><label>Dia do mês</label><input id="rday" type="number" min="1" max="31" value="1"></div><div class="field"><label>Categoria</label><input id="rcat"></div><div class="field"><label>Pessoa / instituição</label><input id="rperson"></div><div class="actions full"><button class="btn primary">Criar recorrência</button></div></form></div><div class="section">${table(rows,['Descrição','Tipo','Valor','Periodicidade','Status','Ações'])}</div>`);$('#rec-form').onsubmit=e=>{e.preventDefault();db.recurring.push({id:uid(),description:$('#rdesc').value,type:$('#rtype').value,value:num($('#rvalue').value),day:num($('#rday').value),category:$('#rcat').value,person:$('#rperson').value,active:true,lastGenerated:null});save();ensureRecurring();toast('Recorrência criada');recurring()}}
function yearKey(d){if(d instanceof Date){const x=ymd(d);return x?x.slice(0,4):''}return String(d??'').slice(0,4)}
function monthName(m){return new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(new Date(`${m}-01T12:00:00`)).replace(/^./,c=>c.toUpperCase())}
function mondayOf(d){const x=iso(d);const day=x.getDay();const delta=day===0?-6:1-day;const r=new Date(x);r.setDate(x.getDate()+delta);return r}
function sundayOf(d){const r=mondayOf(d);r.setDate(r.getDate()+6);return r}
function ymd(d){return d instanceof Date&&!Number.isNaN(d.getTime())?d.toISOString().slice(0,10):''}
function shiftMonth(m,delta){const d=new Date(`${m}-01T12:00:00`);d.setMonth(d.getMonth()+delta);return d.toISOString().slice(0,7)}
function monthWeeks(month){
  const first=new Date(`${month}-01T12:00:00`), last=new Date(first.getFullYear(),first.getMonth()+1,0,12);
  let start=mondayOf(first); if(start<first)start=new Date(first);
  const out=[]; let n=1;
  while(start<=last){const end0=sundayOf(start), end=end0>last?new Date(last):end0;out.push({n,start:ymd(start),end:ymd(end)});const next=new Date(end);next.setDate(next.getDate()+1);start=next;n++}
  return out;
}
function weekItems(start,end){return db.transactions.filter(x=>x.date>=start&&x.date<=end)}
function creditorPanorama(){
  const map={};
  db.transactions.forEach(x=>{const name=(x.person||'Sem credor/origem').trim();const k=name.toLowerCase();if(!map[k])map[k]={name,monthly:0,debt:0,receivable:0};if(x.type==='despesa'&&x.status!=='pago')map[k].monthly+=num(x.value);if(x.type==='receita'&&x.status!=='pago')map[k].receivable+=num(x.value);if(x.debtId)map[k].debt+=num(x.value)})
  db.debts.forEach(d=>{const name=(d.creditor||'Sem credor').trim();const k=name.toLowerCase();if(!map[k])map[k]={name,monthly:0,debt:0,receivable:0};map[k].debt=Math.max(map[k].debt,debtRemaining(d.id))});
  return Object.values(map).filter(x=>x.monthly||x.debt||x.receivable).sort((a,b)=>(b.monthly+b.debt)-(a.monthly+a.debt));
}
function weekBlock(month,w){
  const items=weekItems(w.start,w.end); const pay=items.filter(x=>x.type==='despesa'&&x.status!=='pago'); const rec=items.filter(x=>x.type==='receita');
  const totalPay=pay.reduce((a,x)=>a+num(x.value),0), totalRec=rec.reduce((a,x)=>a+num(x.value),0), received=rec.filter(x=>x.status==='pago').reduce((a,x)=>a+num(x.value),0);
  const remaining=Math.max(0,totalPay-received); const now=iso(today()); const endDate=iso(w.end); const daysLeft=now<=endDate?Math.max(1,Math.floor((endDate-now)/86400000)+1):0; const daily=daysLeft?remaining/daysLeft:0;
  const dayRows=[]; let cursor=iso(w.start), finish=iso(w.end);
  while(cursor<=finish){const date=ymd(cursor), its=items.filter(x=>x.date===date), pays=its.filter(x=>x.type==='despesa'&&x.status!=='pago'), recs=its.filter(x=>x.type==='receita');const dayName=new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(cursor);dayRows.push(`<div class="plan-day"><div class="plan-day-title">${dayName} <span>${fmtDate(date)}</span></div><div class="plan-lines">${pays.length?pays.map(x=>`<div class="plan-line pay"><b>À pagar</b> ${money(x.value)} <span>${esc(x.category||x.person||'Compromisso')}</span>${x.person?`<em>${esc(x.person)}</em>`:''}${x.paymentSource?`<em>Fonte: ${esc(x.paymentSource)}</em>`:''}</div>`).join(''):`<div class="plan-line muted">À pagar —</div>`}${recs.length?recs.map(x=>`<div class="plan-line receive"><b>À receber</b> ${money(x.value)} <span>${esc(x.category||x.person||'Receita')}</span>${x.person?`<em>${esc(x.person)}</em>`:''}${x.repayable?`<em>Reembolsável${x.repayDate?` até ${fmtDate(x.repayDate)}`:''}</em>`:''}</div>`).join(''):`<div class="plan-line muted">À receber —</div>`}</div></div>`);cursor.setDate(cursor.getDate()+1)}
  return `<details class="plan-week"><summary><div><strong>Semana ${w.n}</strong><span>${fmtDate(w.start)} à ${fmtDate(w.end)}</span></div><div class="week-summary"><span>A pagar ${money(totalPay)}</span><span>A receber ${money(totalRec)}</span><b>Restante ${money(remaining)}</b></div></summary><div class="week-body"><div class="week-metrics"><div><small>Total a pagar</small><b class="negative">${money(totalPay)}</b></div><div><small>Total a receber</small><b class="positive">${money(totalRec)}</b></div><div><small>Recebido no ciclo</small><b>${money(received)}</b></div><div><small>Falta pagar</small><b class="negative">${money(remaining)}</b></div><div><small>Dias restantes</small><b>${daysLeft||0}</b></div><div><small>Meta diária restante</small><b>${money(daily)}</b></div></div><div class="days-grid">${dayRows.join('')}</div></div></details>`;
}

function planning(){
  const year=String(new Date().getFullYear());
  const relevantMonths=[...new Set(db.transactions.filter(x=>yearKey(x.date)===year&&x.type==='despesa').map(x=>monthKey(x.date)))].sort();
  const creditorRows=creditorPanorama().map(c=>`<tr><td>${esc(c.name)}</td><td>${money(c.monthly)}</td><td>${money(c.debt)}</td><td>${money(c.receivable)}</td><td>${money(c.monthly+c.debt)}</td></tr>`);
  const monthsHtml=relevantMonths.length?relevantMonths.map(m=>{const weeks=monthWeeks(m).filter(w=>weekItems(w.start,w.end).length);return `<section class="plan-month"><div class="plan-month-head"><div><span class="label">PLANEJAMENTO ANUAL</span><h2>${monthName(m)} de ${year}</h2></div><div class="month-total"><span>Compromissos</span><b>${money(db.transactions.filter(x=>monthKey(x.date)===m&&x.type==='despesa'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0))}</b></div></div>${weeks.length?weeks.map(w=>weekBlock(m,w)).join(''):`<div class="empty">Sem compromissos neste mês.</div>`}</section>`}).join(''):`<div class="empty">Ainda não existem despesas ou dívidas cadastradas para ${year}.</div>`;
  const t=totals();
  layout('Planejamento',`<div class="hero planning-hero"><div><small>VISÃO FINANCEIRA</small><h2>Planejamento anual</h2><small>Despesas, dívidas e receitas organizadas por mês, semana e dia.</small></div><div class="side"><small>FALTA PAGAR NO MÊS ATUAL</small><br><b>${money(t.dp)}</b><br><small>Receitas previstas ${money(t.rp)}</small></div></div><div class="grid"><div class="card"><div class="label">Saldo atual</div><div class="value">${money(currentBalance())}</div></div><div class="card"><div class="label">Receitas previstas</div><div class="value positive">${money(t.rp)}</div></div><div class="card"><div class="label">Despesas previstas</div><div class="value negative">${money(t.dp)}</div></div><div class="card"><div class="label">Saldo projetado</div><div class="value">${money(projectedBalance())}</div></div></div><div class="card panorama"><div class="section-head"><div><h3>Panorama por credor / origem</h3><p>Compromissos repetidos são consolidados pelo mesmo credor.</p></div></div>${table(creditorRows,['Credor / origem','A pagar no mês','Dívida total','A receber','Exposição total'])}</div><div class="section planning-year">${monthsHtml}</div><div class="actions"><button class="btn primary" data-view="recorrentes">Gerenciar recorrências</button></div>`)
}
function calendar(){const m=currentMonth();const rows=db.transactions.filter(x=>monthKey(x.date)===m).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(assignedWeekLabel(x))}</td><td>${x.type==='receita'?'Receita':'Despesa'}</td><td>${esc(x.category)}</td><td>${esc(x.person)}</td><td>${money(x.value)}</td><td>${esc(x.paymentSource||'—')}</td><td>${statusPill(x.status,x.priority)}</td><td><button class="btn secondary" data-edit="${x.id}">Editar</button></td></tr>`);layout('Calendário Financeiro',`<div class="card"><p>Os lançamentos são classificados automaticamente pela semana de segunda a sexta. Você pode realocar a semana manualmente na edição.</p>${table(rows,['Vencimento','Semana','Tipo','Categoria','Credor/Origem','Valor','Status','Ação'])}</div>`)}
function reports(){const t=totals();const cats={};db.transactions.filter(x=>x.type==='despesa'&&monthKey(x.date)===currentMonth()).forEach(x=>cats[x.category]=(cats[x.category]||0)+num(x.value));const rows=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${money(v)}</td><td>${((v/(t.d+t.dp||1))*100).toFixed(1)}%</td></tr>`);layout('Relatórios',`<div class="grid"><div class="card"><div class="label">Receitas pagas</div><div class="value positive">${money(t.r)}</div></div><div class="card"><div class="label">Despesas pagas</div><div class="value negative">${money(t.d)}</div></div><div class="card"><div class="label">Resultado</div><div class="value">${money(t.r-t.d)}</div></div><div class="card"><div class="label">Lançamentos</div><div class="value">${db.transactions.length}</div></div></div><div class="card"><h3>Despesas por categoria</h3>${table(rows,['Categoria','Valor','Participação'])}</div>`)}
function config(){
  layout('Configurações',`<div class="settings-shell">
    <div class="settings-intro"><div><span>RAQVOR</span><h2>Configurações</h2><p>Centralize aqui os parâmetros que controlam o aplicativo e os dados financeiros.</p></div><div class="settings-badge">● Sistema local</div></div>
    <form id="cfg" class="settings-grid">
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">◈</div><div><h3>Projeto e identidade</h3><p>Defina o nome do seu projeto e a base financeira.</p></div></div><div class="form settings-form"><div class="field"><label>Nome do projeto financeiro</label><input id="project" value="${esc(db.settings.project)}" placeholder="Ex.: Finanças da família"></div><div class="field"><label>Moeda</label><input value="BRL — Real brasileiro (R$)" disabled></div></div></section>
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">$</div><div><h3>Caixa inicial</h3><p>Valor disponível antes dos lançamentos registrados.</p></div></div><div class="form settings-form"><div class="field"><label>Saldo inicial (R$)</label><input id="bal" type="number" step="0.01" value="${db.balance}"></div><div class="settings-note"><b>Regra do caixa</b><span>Receitas recebidas aumentam o caixa. Pagamentos reduzem o caixa. Se houver pagamento sem receita recebida suficiente, o saldo ficará negativo para mostrar o déficit real.</span></div></div></section>
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">✓</div><div><h3>Categorias de receitas</h3><p>Personalize as categorias usadas nos lançamentos de entrada.</p></div></div><div class="field"><label>Categorias separadas por vírgula</label><textarea id="catsr">${esc(db.categories.receita.join(', '))}</textarea></div></section>
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">−</div><div><h3>Categorias de despesas</h3><p>Personalize as categorias usadas nos pagamentos e compromissos.</p></div></div><div class="field"><label>Categorias separadas por vírgula</label><textarea id="catsd">${esc(db.categories.despesa.join(', '))}</textarea></div></section>
      <section class="settings-card danger-zone"><div class="settings-card-head"><div class="settings-icon">!</div><div><h3>Dados locais</h3><p>Use com atenção. Esta ação remove os dados armazenados neste dispositivo.</p></div></div><div class="actions"><button class="btn primary">Salvar configurações</button><button type="button" class="btn danger" id="reset-data">Excluir dados locais</button></div></section>
    </form>
  </div>`);
  $('#cfg').onsubmit=e=>{e.preventDefault();db.balance=num($('#bal').value);db.settings.project=$('#project').value.trim()||'RAQVOR';db.categories.receita=$('#catsr').value.split(',').map(x=>x.trim()).filter(Boolean);db.categories.despesa=$('#catsd').value.split(',').map(x=>x.trim()).filter(Boolean);save();toast('Configurações salvas com sucesso');render('config')};
  $('#reset-data').onclick=()=>{if(confirm('Excluir todos os dados locais do RAQVOR?')){db=defaultDB();save();render('dashboard');toast('Dados locais excluídos')}}
}
/* FINANCE RAQVOR V1.5 — Dívidas/Despesas unificadas, empréstimos como dívida, calendário semanal e dashboard executivo */
function loanTotalPayable(principal, parts, installment){
  const p=num(principal), n=Math.max(1,num(parts)||1), v=num(installment);
  return v>0 ? v*n : p;
}
function cardOptions(selected=''){
  return `<option value="">Nenhum cartão</option>`+db.cards.map(c=>`<option value="${c.id}" ${selected===c.id?'selected':''}>${esc(c.name)} — ${esc(c.bank)}</option>`).join('');
}
function unifiedEntries(){
  const rows=[];
  db.transactions.forEach(x=>rows.push({id:x.id,kind:x.type==='receita'?'Receita':'Despesa',category:x.category||'—',person:x.person||'—',value:num(x.value),date:x.date,status:x.status,source:'Lançamento'}));
  db.loans.forEach(l=>rows.push({id:'loan-'+l.id,kind:'Empréstimo',category:'Empréstimo',person:l.person||'—',value:num(l.totalPayable||l.value),date:l.firstDate,status:l.status||'previsto',source:'Empréstimo'}));
  db.debts.filter(d=>!d.loanId&&!d.cardId).forEach(d=>rows.push({id:'debt-'+d.id,kind:'Dívida',category:d.kind||'Dívida',person:d.creditor||'—',value:num(d.value),date:d.firstDate,status:'previsto',source:'Dívida'}));
  db.cards.forEach(c=>rows.push({id:'card-'+c.id,kind:'Cartão de crédito',category:'Cartão de crédito',person:c.name,value:db.transactions.filter(x=>x.cardId===c.id&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0),date:'',status:'ativo',source:'Cartão'}));
  return rows;
}
function debtsExpenses(){
  const tx=db.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const debtRows=tx.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${x.type==='receita'?'Receita':'Despesa'}</td><td>${esc(x.category||'—')}</td><td>${esc(x.person||'—')}</td><td>${money(x.value)}</td><td>${esc(x.paymentSource||'—')}</td><td>${statusPill(x.status,x.priority)}</td><td><button class="btn secondary" data-edit="${x.id}">Editar</button> <button class="btn danger" data-del="${x.id}">Excluir</button></td></tr>`);
  const loansRows=db.loans.map(l=>`<tr><td>${esc(l.person||'—')}</td><td>${l.cardId?(esc(db.cards.find(c=>c.id===l.cardId)?.name||'Cartão')):'Empréstimo direto'}</td><td>${money(l.value)}</td><td>${l.installments||1} × ${money(l.installmentValue||0)}</td><td>${money(l.totalPayable||l.value)}</td><td>${esc(l.paymentSource||'—')}</td><td>${statusPill(l.status||'previsto')}</td><td><button class="btn secondary" data-edit-loan="${l.id}">Editar</button> <button class="btn danger" data-del-loan="${l.id}">Excluir</button></td></tr>`);
  const cardRows=db.cards.map(c=>{const used=db.transactions.filter(x=>x.cardId===c.id&&x.type==='despesa'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);return `<tr><td>${esc(c.name)}</td><td>${esc(c.bank)}</td><td>${money(c.limit)}</td><td>${money(used)}</td><td>${money(Math.max(0,num(c.limit)-used))}</td><td><button class="btn secondary" data-edit-card="${c.id}">Editar</button> <button class="btn primary" data-card-purchase="${c.id}">Nova compra</button> <button class="btn danger" data-del-card="${c.id}">Excluir</button></td></tr>`});
  layout('Dívidas e Despesas Cadastradas',`<div class="hero"><div><small>CONTROLE DE COMPROMISSOS</small><h2>Visão consolidada</h2><small>Despesas, dívidas, empréstimos e cartões em um único ponto de controle.</small></div><div class="side"><small>COMPROMISSOS EM ABERTO</small><br><b>${money(debtOutstanding()+totals().dp)}</b><br><small>Inclui parcelas e despesas previstas</small></div></div><div class="tabs"><button class="tab active">Todos</button><button class="tab" data-new="despesa">+ Despesa</button><button class="tab" data-new-debt>+ Dívida</button><button class="tab" data-new-loan>+ Empréstimo</button><button class="tab" data-new-card>+ Cartão de crédito</button></div><div class="card"><h3>Despesas e compromissos</h3>${table(debtRows,['Data','Tipo','Categoria','Credor / origem','Valor','Fonte do pagamento','Status','Ações'])}</div><div class="card section"><div class="section-head"><div><h3>Empréstimos</h3><p>Todo empréstimo adquirido pelo usuário é tratado como dívida.</p></div></div>${table(loansRows,['Credor / fonte','Cartão','Valor recebido','Parcelas','Total a pagar','Fonte do pagamento','Status','Ações'])}</div><div class="card section"><div class="section-head"><div><h3>Cartões de crédito</h3><p>Os gastos e empréstimos vinculados permanecem associados ao mesmo cartão.</p></div></div>${table(cardRows,['Cartão','Instituição','Limite','Utilizado','Disponível','Ações'])}</div>`);
}
function loanForm(id=null){
  const l=id?db.loans.find(x=>x.id===id):null;
  layout(l?'Editar Empréstimo':'Novo Empréstimo',`<div class="card"><div class="loan-warning"><b>⚠ Comprometimento de renda</b><span>Antes de contratar, confira se a parcela cabe no seu fluxo mensal. O sistema vai destacar o total a pagar para evitar excesso de endividamento.</span></div><form id="loan-form" class="form"><div class="field"><label>Onde o empréstimo foi adquirido</label><select id="lcard">${cardOptions(l?.cardId||'')}</select></div><div class="field"><label>Credor / instituição</label><input id="lperson" value="${esc(l?.person||'')}" required></div><div class="field"><label>Fonte do pagamento das parcelas</label><input id="lpayfrom" value="${esc(l?.paymentSource||'')}" placeholder="Conta, caixa, carteira, banco..."></div><div class="field"><label>Valor recebido (R$)</label><input id="lvalue" type="number" step="0.01" min="0" value="${l?.value??''}" required></div><div class="field"><label>Quantidade de parcelas</label><input id="lparts" type="number" min="1" value="${l?.installments||1}" required></div><div class="field"><label>Valor da parcela (R$)</label><input id="lpartvalue" type="number" step="0.01" min="0" value="${l?.installmentValue??''}" required></div><div class="field"><label>Total a pagar (automático)</label><input id="ltotal" type="number" step="0.01" value="${l?.totalPayable??''}" readonly></div><div class="field"><label>Primeiro vencimento</label><input id="ldate" type="date" value="${l?.firstDate||today()}" required></div><div class="field"><label>Status</label><select id="lstatus"><option value="previsto">Empréstimo previsto</option><option value="recebido">Já recebido</option></select></div><div class="field full"><label>Observação</label><textarea id="lnote">${esc(l?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">Salvar empréstimo</button><button type="button" class="btn secondary" data-view="movimentos">Cancelar</button></div></form></div>`);
  const recalc=()=>{$('#ltotal').value=loanTotalPayable($('#lvalue').value,$('#lparts').value,$('#lpartvalue').value).toFixed(2)};
  ['#lvalue','#lparts','#lpartvalue'].forEach(s=>$(s).addEventListener('input',recalc)); recalc();
  $('#loan-form').onsubmit=e=>{e.preventDefault();
    const value=num($('#lvalue').value), parts=Math.max(1,num($('#lparts').value)), part=num($('#lpartvalue').value), total=loanTotalPayable(value,parts,part), cardId=$('#lcard').value||null, status=$('#lstatus').value, person=$('#lperson').value, paymentSource=$('#lpayfrom').value, firstDate=$('#ldate').value, note=$('#lnote').value;
    const id=l?.id||uid();
    const data={id,person,value,installments:parts,installmentValue:part,totalPayable:total,firstDate,status,cardId,paymentSource,note,createdAt:l?.createdAt||today()};
    if(l) db.loans=db.loans.map(x=>x.id===id?data:x); else db.loans.push(data);
    db.transactions=db.transactions.filter(x=>x.loanId!==id);
    // O valor recebido só entra no caixa quando o empréstimo estiver efetivamente recebido.
    if(status==='recebido') db.transactions.push({id:uid(),date:today(),value,category:'Empréstimo recebido',person,cardId,paymentSource,status:'pago',weekAssigned:weekOf(today()),note:`Crédito do empréstimo ${id}`,type:'receita',loanId:id,loanPrincipal:true});
    const baseDate=iso(firstDate); for(let i=0;i<parts;i++){const dt=new Date(baseDate);dt.setMonth(dt.getMonth()+i);const date=ymd(dt);db.transactions.push({id:uid(),date,value:part,category:'Empréstimo',person,cardId,paymentSource,status:'previsto',weekAssigned:weekOf(date),note:`Empréstimo ${id} — parcela ${i+1}/${parts}`,type:'despesa',loanId:id,installment:i+1});}
    // Dívida consolidada para cruzamento por credor/cartão.
    db.debts=db.debts.filter(d=>d.loanId!==id);db.debts.push({id:uid(),loanId:id,cardId,creditor:person,kind:'Empréstimo',value,totalPayable:total,installments:parts,installmentValue:part,firstDate,status:status==='recebido'?'ativo':'previsto',remaining:total,paymentSource,createdAt:today()});
    save();toast('Empréstimo salvo como dívida');debtsExpenses();
  };
}
function loans(){debtsExpenses()}
function debtForm(id=null){const d=id?db.debts.find(x=>x.id===id):null;layout(d?'Editar Dívida':'Nova Dívida',`<div class="card"><form id="debt-form" class="form"><div class="field"><label>Credor</label><input id="creditor" value="${esc(d?.creditor||'')}" required></div><div class="field"><label>Tipo</label><select id="kind"><option>Instituição</option><option>Pessoa física</option><option>Financiamento</option><option>Outros</option></select></div><div class="field"><label>Valor da dívida (R$)</label><input id="dvalue" type="number" step=".01" min="0" value="${d?.value??''}" required></div><div class="field"><label>Parcelas</label><input id="installments" type="number" min="1" value="${d?.installments||1}" required></div><div class="field"><label>Valor da parcela (R$)</label><input id="dpart" type="number" step=".01" min="0" value="${d?.installmentValue??''}" required></div><div class="field"><label>Total a pagar</label><input id="dtotal" type="number" step=".01" value="${d?.totalPayable??''}" readonly></div><div class="field"><label>Fonte do pagamento</label><input id="dpayfrom" value="${esc(d?.paymentSource||'')}" placeholder="Conta, caixa, carteira, banco..."></div><div class="field"><label>Primeiro vencimento</label><input id="firstdate" type="date" value="${d?.firstDate||today()}" required></div><div class="field"><label>Status</label><select id="dstatus"><option value="previsto">Prevista</option><option value="pendente">Pendente</option><option value="pago">Paga / quitada</option></select></div><div class="field full"><label>Observação</label><textarea id="dnote">${esc(d?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">Salvar dívida</button><button type="button" class="btn secondary" data-view="movimentos">Cancelar</button></div></form></div>`); if(d){$('#kind').value=d.kind;$('#dstatus').value=d.status||'previsto'}const recalc=()=>$('#dtotal').value=loanTotalPayable($('#dvalue').value,$('#installments').value,$('#dpart').value).toFixed(2);['#dvalue','#installments','#dpart'].forEach(s=>$(s).addEventListener('input',recalc));recalc();$('#debt-form').onsubmit=e=>{e.preventDefault();const id=d?.id||uid(),value=num($('#dvalue').value),parts=Math.max(1,num($('#installments').value)),part=num($('#dpart').value),total=loanTotalPayable(value,parts,part),status=$('#dstatus').value,data={id,creditor:$('#creditor').value,kind:$('#kind').value,value,installments:parts,installmentValue:part,totalPayable:total,firstDate:$('#firstdate').value,paymentSource:$('#dpayfrom').value,status,note:$('#dnote').value,remaining:total,createdAt:d?.createdAt||today()};if(d){Object.assign(d,data);db.transactions=db.transactions.filter(x=>x.debtId!==id)}else db.debts.push(data);for(let i=0;i<parts;i++){const dt=new Date(iso(data.firstDate));dt.setMonth(dt.getMonth()+i);const date=ymd(dt);db.transactions.push({id:uid(),date,value:part,category:data.kind,person:data.creditor,paymentSource:data.paymentSource,status:i===0&&status==='pago'?'pago':'previsto',weekAssigned:weekOf(date),note:`Dívida ${id} — parcela ${i+1}/${parts}`,type:'despesa',debtId:id,installment:i+1})}save();toast('Dívida salva');debtsExpenses()}
}
function debts(){debtsExpenses()}
function unifiedDashboard(){
  const t=totals(), bal=currentBalance(), proj=projectedBalance();
  const pendingPay=db.transactions.filter(x=>x.type==='despesa'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
  const pendingRec=db.transactions.filter(x=>x.type==='receita'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
  const loanDebt=db.loans.reduce((a,l)=>a+Math.max(0,num(l.totalPayable)-db.transactions.filter(x=>x.loanId===l.id&&x.type==='despesa'&&x.status==='pago').reduce((s,x)=>s+num(x.value),0)),0);
  const month=currentMonth(), days=new Date().getDate();
  const monthlyNet=t.r-t.d;
  const monthRows=[]; for(let i=0;i<12;i++){const d=new Date(new Date().getFullYear(),i,1);const m=d.toISOString().slice(0,7);const a=db.transactions.filter(x=>monthKey(x.date)===m);const r=a.filter(x=>x.type==='receita'&&x.status==='pago').reduce((s,x)=>s+num(x.value),0);const e=a.filter(x=>x.type==='despesa'&&x.status==='pago').reduce((s,x)=>s+num(x.value),0);monthRows.push({label:new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(d).replace('.',''),r,e,net:r-e})}
  const max=Math.max(1,...monthRows.map(x=>Math.max(x.r,x.e)));
  const bars=monthRows.map(x=>`<div class="bar-col"><div class="bar-stack"><i class="bar receive" style="height:${Math.round(x.r/max*110)}px" title="Receitas ${money(x.r)}"></i><i class="bar expense" style="height:${Math.round(x.e/max*110)}px" title="Despesas ${money(x.e)}"></i></div><span>${esc(x.label)}</span></div>`).join('');
  const due=db.transactions.filter(x=>x.status!=='pago').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10);
  layout('Dashboard',`<div class="hero dashboard-hero"><div><small>RAQVOR • CONTROLE FINANCEIRO</small><h2>${money(bal)}</h2><small>Saldo atual disponível</small></div><div class="side"><small>SALDO PROJETADO</small><br><b>${money(proj)}</b><br><small>Após compromissos previstos</small></div></div><div class="grid dashboard-kpis"><div class="card"><div class="label">Receitas recebidas</div><div class="value positive">${money(t.r)}</div><small>mês atual</small></div><div class="card"><div class="label">Despesas pagas</div><div class="value negative">${money(t.d)}</div><small>mês atual</small></div><div class="card"><div class="label">A pagar</div><div class="value negative">${money(pendingPay)}</div><small>compromissos em aberto</small></div><div class="card"><div class="label">A receber</div><div class="value positive">${money(pendingRec)}</div><small>receitas previstas</small></div><div class="card"><div class="label">Dívidas</div><div class="value negative">${money(debtOutstanding()+loanDebt)}</div><small>saldo estimado em aberto</small></div><div class="card"><div class="label">Cartões</div><div class="value">${db.cards.length}</div><small>cadastrados</small></div><div class="card"><div class="label">Resultado do mês</div><div class="value ${monthlyNet>=0?'positive':'negative'}">${money(monthlyNet)}</div><small>receitas − despesas pagas</small></div><div class="card"><div class="label">Operações financeiras</div><div class="value">${db.transactions.length}</div><small>lançamentos registrados</small></div></div><div class="grid dashboard-panels"><div class="card"><div class="section-head"><div><h3>Fluxo mensal</h3><p>Receitas recebidas × despesas pagas</p></div></div><div class="chart-legend"><span><i class="dot receive"></i>Receitas</span><span><i class="dot expense"></i>Despesas</span></div><div class="bar-chart">${bars}</div></div><div class="card"><div class="section-head"><div><h3>Saúde financeira</h3><p>Visão resumida do mês atual</p></div></div><div class="health"><div><span>Resultado líquido</span><b class="${monthlyNet>=0?'positive':'negative'}">${money(monthlyNet)}</b></div><div><span>Compromissos em aberto</span><b>${money(pendingPay)}</b></div><div><span>Receitas ainda previstas</span><b class="positive">${money(pendingRec)}</b></div><div><span>Saldo projetado</span><b class="${proj>=0?'positive':'negative'}">${money(proj)}</b></div><div><span>${cashStatus().deficit?'Déficit de caixa':'Caixa após pagamentos'}</span><b class="${bal>=0?'positive':'negative'}">${money(bal)}</b></div></div></div></div><div class="card"><div class="section-head"><div><h3>Próximos pagamentos e recebimentos</h3><p>Calendário financeiro resumido</p></div><button class="btn primary" data-view="calendario">Abrir calendário</button></div>${table(due.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${x.type==='receita'?'Receber':'Pagar'}</td><td>${esc(x.person||x.category||'—')}</td><td>${money(x.value)}</td><td>${statusPill(x.status,x.priority)}</td></tr>`),['Data','Fluxo','Credor / origem','Valor','Status'])}</div><div class="card section"><div class="section-head"><div><h3>Panorama financeiro</h3><p>Dívidas, despesas, empréstimos, cartões e receitas em conjunto.</p></div><button class="btn secondary" data-view="movimentos">Gerenciar compromissos</button></div><div class="overview-strip"><div><small>Dívidas + empréstimos</small><b>${money(debtOutstanding()+loanDebt)}</b></div><div><small>Despesas previstas</small><b>${money(t.dp)}</b></div><div><small>Receitas previstas</small><b>${money(t.rp)}</b></div><div><small>Cartões utilizados</small><b>${money(db.cards.reduce((a,c)=>a+db.transactions.filter(x=>x.cardId===c.id&&x.status!=='pago').reduce((s,x)=>s+num(x.value),0),0))}</b></div></div></div>`)
}
function financialWeekRanges(month){
  const first=iso(`${month}-01`), last=iso(`${month}-${String(new Date(first.getFullYear(),first.getMonth()+1,0).getDate()).padStart(2,'0')}`);
  const ranges=[];
  let start=new Date(first);
  while(start<=last){
    const dow=start.getDay();
    let end=new Date(start);
    if(dow===6) end.setDate(end.getDate()+6);       // Sat → following Fri
    else if(dow===0) end.setDate(end.getDate()+5);  // Sun → following Fri
    else end.setDate(end.getDate()+(5-dow));       // Mon-Fri → Friday
    if(end>last)end=new Date(last);
    ranges.push({start:ymd(start),end:ymd(end),days:dateRange(start,end)});
    // Every subsequent operational week starts on Monday.
    const next=new Date(end);
    next.setDate(next.getDate()+1);
    if(next.getDay()!==1){const add=(8-next.getDay())%7;next.setDate(next.getDate()+add)}
    start=next;
  }
  // A first partial week with fewer than five weekdays is merged into the next week.
  if(ranges.length>1){
    const f=ranges[0];const weekdays=f.days.filter(d=>{const z=iso(d).getDay();return z>=1&&z<=5}).length;
    if(weekdays<5){
      ranges[1].start=f.start;
      ranges[1].days=dateRange(iso(ranges[1].start),iso(ranges[1].end));
      ranges.shift();
    }
  }
  // A final partial week with fewer than five weekdays is merged into the previous week.
  if(ranges.length>1){
    const l=ranges[ranges.length-1];const weekdays=l.days.filter(d=>{const z=iso(d).getDay();return z>=1&&z<=5}).length;
    if(weekdays<5){
      const p=ranges[ranges.length-2];p.end=l.end;p.days=dateRange(iso(p.start),iso(p.end));ranges.pop();
    }
  }
  return ranges.map((r,i)=>({...r,n:i+1}));
}

function dateRange(start,end){const out=[];let d=iso(start);const e=iso(end);if(Number.isNaN(d.getTime())||Number.isNaN(e.getTime()))return out;while(d<=e){out.push(ymd(d));d.setDate(d.getDate()+1)}return out}
function groupCreditor(items){
  const map=new Map();
  for(const x of (Array.isArray(items)?items:[])){
    const name=(x.person||x.creditor||x.category||'Sem credor').trim()||'Sem credor';
    const date=String(x.date||'');
    const key=`${name.toLowerCase()}|${date}`;
    if(!map.has(key))map.set(key,{name,total:0,items:[],date});
    const g=map.get(key);g.total+=num(x.value);g.items.push(x);
  }
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||b.total-a.total);
}
let calendarCursor=currentMonth();
function renderCalendarShift(delta){calendarCursor=shiftMonth(calendarCursor,delta);calendar(calendarCursor)}
function calendar(m=calendarCursor){
  const month=m||currentMonth(), weeks=financialWeekRanges(month), todayKey=today();
  const monthItems=db.transactions.filter(x=>monthKey(x.date)===month);
  const pendingPay=monthItems.filter(x=>x.type==='despesa'&&x.status!=='pago');
  const pendingRec=monthItems.filter(x=>x.type==='receita'&&x.status!=='pago');
  const totalPay=pendingPay.reduce((a,x)=>a+num(x.value),0);
  const totalRec=pendingRec.reduce((a,x)=>a+num(x.value),0);
  const cash=Math.max(0,currentBalance());
  const debt=Math.max(0,totalPay-cash);
  const remainingDays=Math.max(1,weeks.flatMap(w=>w.days).filter(d=>d>=todayKey&&!db.settings.daysOff.includes(d)).length);
  const dailyNeed=debt/remainingDays;
  const weekHtml=weeks.map((w,idx)=>{
    const items=monthItems.filter(x=>w.days.includes(x.date));
    const pay=items.filter(x=>x.type==='despesa'&&x.status!=='pago');
    const rec=items.filter(x=>x.type==='receita'&&x.status!=='pago');
    const payTotal=pay.reduce((a,x)=>a+num(x.value),0);
    const recTotal=rec.reduce((a,x)=>a+num(x.value),0);
    const weekDebt=Math.max(0,payTotal-recTotal-(idx===0?cash:0));
    const activeDays=w.days.filter(d=>d>=todayKey&&!db.settings.daysOff.includes(d));
    const daily=weekDebt/Math.max(1,activeDays.length);
    const byCreditor=groupCreditor(pay);
    const isCurrent=w.days.includes(todayKey);
    return `<section class="finance-week ${isCurrent?'current':''}">
      <div class="finance-week-head"><div><span class="eyebrow">SEMANA ${idx+1}${isCurrent?' • ATUAL':''}</span><h3>${fmtDate(w.start)} <span>até</span> ${fmtDate(w.end)}</h3></div><div class="week-head-metrics"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(recTotal)}</b></div><div><small>Diária</small><b>${money(daily)}</b></div></div></div>
      <div class="finance-week-body">${byCreditor.length?byCreditor.map(g=>`<div class="creditor-line"><div class="creditor-main"><b>${esc(g.name)}</b><span>${g.items.map(x=>`${fmtDate(x.date)} • ${esc(x.category||'compromisso')}`).join(' · ')}</span></div><strong class="negative">${money(g.total)}</strong></div>`).join(''):`<div class="empty">Nenhum pagamento previsto nesta semana.</div>`}${recTotal?`<div class="week-revenue"><span><b>Receitas da semana</b><small>Entradas previstas no período</small></span><strong class="positive">+ ${money(recTotal)}</strong></div>`:''}</div>
      <div class="finance-week-footer"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(recTotal)}</b></div><div><small>Caixa considerado</small><b>${money(idx===0?cash:0)}</b></div><div><small>Saldo da semana</small><b class="${weekDebt?'negative':'positive'}">${money(weekDebt)}</b></div><div><small>Busca diária</small><b>${money(daily)}</b><span>${activeDays.length} dia(s)</span></div></div>
    </section>`;
  }).join('');
  layout('Calendário Financeiro',`<div class="page-intro calendar-intro"><div><span class="eyebrow">FLUXO FINANCEIRO</span><h2>${monthName(month)} de ${yearKey(month)}</h2><p>Lista de pagamentos por semana e credor. O fechamento abaixo mostra exatamente quanto está coberto e quanto ainda precisa ser buscado.</p></div><div class="month-nav"><button class="btn secondary" data-month-prev>‹</button><b>${monthName(month)}</b><button class="btn secondary" data-month-next>›</button></div></div>
  <div class="finance-summary-banner"><div><small>EM CAIXA</small><strong class="positive">${money(cash)}</strong></div><div><small>TOTAL A PAGAR</small><strong class="negative">${money(totalPay)}</strong></div><div><small>SALDO DEVEDOR</small><strong class="${debt?'negative':'positive'}">${money(debt)}</strong></div><div class="featured"><small>BUSCA DIÁRIA</small><strong>${money(dailyNeed)}</strong><span>${remainingDays} dia(s) disponíveis</span></div></div>
  <div class="calendar-note">O saldo devedor é o total a pagar menos o caixa disponível. A diária é recalculada automaticamente quando qualquer pagamento, receita, vencimento ou dia de folga é alterado.</div>
  <div class="finance-weeks">${weekHtml||'<div class="empty">Nenhum movimento neste mês.</div>'}</div>`);
}
function cashbook(){
  db.cashbooks=db.cashbooks||[]; let c=db.cashbooks.find(x=>x.date===today()); if(!c){c={id:uid(),date:today(),openedAt:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),closedAt:null,entries:[],closingTransactionId:null};db.cashbooks.push(c);save();}
  const entries=c.entries||[], ins=entries.filter(x=>x.type==='entrada').reduce((a,x)=>a+num(x.value),0), outs=entries.filter(x=>x.type==='saida').reduce((a,x)=>a+num(x.value),0), net=ins-outs;
  const form=`<div class="cash-form-card ${c.closedAt?'closed':''}"><div class="cash-form-head"><div><span class="eyebrow">${c.closedAt?'CAIXA FECHADO':'CAIXA ABERTO'}</span><h3>${c.closedAt?'Movimento encerrado':'Registrar movimento'}</h3><p>${c.closedAt?'O caixa deste dia foi fechado.':'Registre entradas e saídas diretamente abaixo.'}</p></div>${c.closedAt?`<span class="pill paid">Fechado ${esc(c.closedAt)}</span>`:''}</div>${c.closedAt?'':`<form id="quick-cash-form" class="quick-cash-form"><select id="qc-type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select><input id="qc-value" type="number" step="0.01" min="0" placeholder="Valor" required><input id="qc-desc" placeholder="Descrição" required><input id="qc-source" placeholder="Origem / destino"><select id="qc-link"><option value="normal">Movimento normal</option><option value="emprestimo">Empréstimo recebido</option><option value="cartao">Compra/ajuste de cartão</option></select><button class="btn primary">Adicionar</button></form>`}</div>`;
  const rows=entries.slice().reverse().map(x=>`<tr><td>${esc(x.time||'—')}</td><td><span class="flow-badge ${x.type}">${x.type==='entrada'?'Entrada':'Saída'}</span></td><td>${esc(x.description)}</td><td>${esc(x.source||'—')}</td><td class="${x.type==='entrada'?'positive':'negative'}">${x.type==='entrada'?'+':'−'} ${money(x.value)}</td><td>${c.closedAt?'<span class="pill paid">Fechado</span>':`<button class="btn secondary mini" data-edit-cash-entry="${x.id}">Editar</button><button class="btn danger mini" data-del-cash-entry="${x.id}">Excluir</button>`}</td></tr>`).join('');
  layout('Livro Caixa',`<div class="page-intro cash-intro"><div><span class="eyebrow">LIVRO CAIXA DIÁRIO</span><h2>${fmtDate(today())}</h2><p>O formulário já está aberto. Registre tudo que realmente entrou ou saiu hoje.</p></div><div class="cash-result ${net>=0?'positive':'negative'}"><small>RESULTADO DO DIA</small><b>${money(net)}</b><span>${c.closedAt?'Fechado':'Em aberto'}</span></div></div><div class="grid compact-kpis"><div class="card"><div class="label">Saldo de abertura</div><div class="value">${money(num(db.balance))}</div></div><div class="card"><div class="label">Entradas</div><div class="value positive">${money(ins)}</div></div><div class="card"><div class="label">Saídas</div><div class="value negative">${money(outs)}</div></div><div class="card"><div class="label">Saldo líquido</div><div class="value ${net>=0?'positive':'negative'}">${money(net)}</div></div></div>${form}<div class="card data-card"><div class="section-head"><div><h3>Movimentações de hoje</h3><p>Ao fechar o caixa, o resultado líquido do dia é consolidado no histórico.</p></div>${c.closedAt?'':`<button class="btn danger" data-close-cash>Fechar caixa</button>`}</div>${rows?table(rows,['Hora','Tipo','Descrição','Origem / destino','Valor','Ações']):'<div class="empty">Nenhum movimento registrado hoje.</div>'}</div>`);
  const f=$('#quick-cash-form'); if(f)f.onsubmit=e=>{e.preventDefault();const type=$('#qc-type').value,value=num($('#qc-value').value),description=$('#qc-desc').value.trim(),source=$('#qc-source').value.trim(),link=$('#qc-link').value;const entry={id:uid(),type,value,description,source,category:link==='emprestimo'?'Empréstimo recebido':link==='cartao'?'Cartão de crédito':'Livro Caixa',note:'',time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})};c.entries.push(entry);if(link==='emprestimo'&&type==='entrada'){const loanId=uid();db.loans.push({id:loanId,person:source||description,value,installments:1,installmentValue:value,totalPayable:value,firstDate:today(),status:'recebido',paymentSource:'Caixa',note:'Criado a partir do Livro Caixa',createdAt:today()});db.debts.push({id:uid(),loanId,creditor:source||description,kind:'Empréstimo',value,totalPayable:value,installments:1,installmentValue:value,firstDate:today(),status:'ativo',remaining:value,paymentSource:'Caixa',createdAt:today()});db.transactions.push({id:uid(),date:today(),value,category:'Empréstimo recebido',person:source||description,paymentSource:'Caixa',status:'pago',weekAssigned:weekOf(today()),type:'receita',loanId,loanPrincipal:true});}save();toast('Movimento registrado');cashbook()};
}

function suporte(){
  layout('Suporte',`<div class="page-intro"><div><span class="eyebrow">ATENDIMENTO</span><h2>Central de suporte</h2><p>Converse diretamente com a equipe. O prazo padrão de resposta é de até 72 horas.</p></div></div><div class="support-layout-client"><section class="card"><div class="support-compose-head"><div><h3>Novo atendimento</h3><p>Abra um chamado e acompanhe tudo em uma conversa.</p></div></div><form id="support-form" class="form"><div class="field"><label>Assunto</label><input id="st-subject" required placeholder="Ex.: compra no cartão não apareceu"></div><div class="field"><label>Categoria</label><select id="st-category"><option>financeiro</option><option>cartão</option><option>empréstimo</option><option>problema técnico</option><option>outro</option></select></div><div class="field"><label>Prioridade</label><select id="st-priority"><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div><div class="field"><label>Mensagem</label><textarea id="st-body" required placeholder="Explique o que aconteceu..."></textarea></div><button class="btn primary">Abrir atendimento</button></form></section><section class="card"><div class="section-head"><div><h3>Meus atendimentos</h3><p>As respostas chegam em tempo real.</p></div></div><div id="support-list">Carregando...</div></section></div>`);
  const loadTickets=async()=>{const u=(await supabaseClient.auth.getUser()).data.user;const r=await supabaseClient.from('support_tickets').select('*').eq('user_id',u.id).order('created_at',{ascending:false});const el=$('#support-list');if(r.error){el.textContent=r.error.message;return}el.innerHTML=r.data?.length?r.data.map(t=>`<button class="client-ticket" data-support-ticket="${t.id}"><span><b>${esc(t.subject)}</b><small>${esc(t.category)} • ${fmtDate(t.created_at)} • SLA ${fmtDate(t.sla_due_at)}</small></span><em>${esc(t.status)}</em></button>`).join(''):'<div class="empty">Nenhum atendimento aberto.</div>';document.querySelectorAll('[data-support-ticket]').forEach(b=>b.onclick=()=>openClientSupportChat(b.dataset.supportTicket));};
  $('#support-form').onsubmit=async e=>{e.preventDefault();const u=(await supabaseClient.auth.getUser()).data.user;const r=await supabaseClient.from('support_tickets').insert({user_id:u.id,subject:$('#st-subject').value.trim(),category:$('#st-category').value,priority:$('#st-priority').value}).select().single();if(r.error)return toast(r.error.message);const m=await supabaseClient.from('support_messages').insert({ticket_id:r.data.id,sender_user_id:u.id,body:$('#st-body').value.trim(),message_type:'text'});if(m.error)return toast(m.error.message);$('#st-body').value='';toast('Atendimento aberto. A equipe responderá em até 72 horas.');loadTickets();};loadTickets();
}
async function openClientSupportChat(ticketId){const r=await supabaseClient.from('support_messages').select('*').eq('ticket_id',ticketId).order('created_at');const msgs=r.data||[];const me=(await supabaseClient.auth.getUser()).data.user;const el=document.createElement('div');el.className='modal';el.innerHTML=`<div class="modal-card support-chat-client"><div class="chat-head"><div><span class="eyebrow">ATENDIMENTO RAQVOR</span><h3>Conversa</h3></div><button class="btn secondary" id="close-chat">×</button></div><div class="chat-messages" id="client-chat-messages">${msgs.map(m=>`<div class="chat-bubble ${m.sender_user_id===me.id?'mine':'theirs'}">${esc(m.body||'Mensagem de voz')}<small>${fmtDate(m.created_at)}</small></div>`).join('')}</div><form id="client-chat-form"><input id="client-chat-input" placeholder="Digite sua mensagem..."><button class="btn primary">Enviar</button></form></div>`;document.body.appendChild(el);el.querySelector('#close-chat').onclick=()=>el.remove();el.querySelector('#client-chat-form').onsubmit=async e=>{e.preventDefault();const u=(await supabaseClient.auth.getUser()).data.user;const body=$('#client-chat-input').value.trim();if(!body)return;await supabaseClient.from('support_messages').insert({ticket_id:ticketId,sender_user_id:u.id,body,message_type:'text'});el.remove();openClientSupportChat(ticketId)}}
function render(v=view){view=v;const fn={dashboard:unifiedDashboard,caixa:cashbook,movimentos:()=>debtsExpenses('geral'),cartoes:()=>debtsExpenses('cartoes'),emprestimos:()=>debtsExpenses('emprestimos'),receitas:()=>receitasPage(),planejamento:planning,calendario:calendar,relatorios:reports,suporte,config,recorrentes:recurring};try{(fn[v]||unifiedDashboard)();document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===v))}catch(err){console.error('[RAQVOR][VIEW]',v,err);const c=$('#content');if(c)c.innerHTML=`<div class="card error-card"><span class="eyebrow">ERRO DE MÓDULO</span><h2>Não foi possível abrir esta seção.</h2><p>${esc(err?.message||'Erro inesperado.')}</p><div class="actions"><button class="btn primary" onclick="location.reload()">Recarregar</button><button class="btn secondary" data-view="dashboard">Voltar ao Dashboard</button></div></div>`;bindGlobal()}}
function bindGlobal(){
  // Navigation
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{render(b.dataset.view);$('#sidebar')?.classList.remove('open')});
  // Existing actions
  document.querySelectorAll('[data-new]').forEach(b=>b.onclick=()=>transactionForm(b.dataset.new));
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{editingId=b.dataset.edit;const x=db.transactions.find(z=>z.id===editingId);if(x)transactionForm(x.type,editingId)});
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{if(confirm('Excluir este lançamento?')){db.transactions=db.transactions.filter(x=>x.id!==b.dataset.del);save();render(view)}});
  document.querySelectorAll('[data-new-debt]').forEach(b=>b.onclick=()=>debtForm());
  document.querySelectorAll('[data-edit-debt]').forEach(b=>b.onclick=()=>debtForm(b.dataset.editDebt));
  document.querySelectorAll('[data-del-debt]').forEach(b=>b.onclick=()=>{if(confirm('Excluir dívida e parcelas?')){const id=b.dataset.delDebt;db.debts=db.debts.filter(x=>x.id!==id);db.transactions=db.transactions.filter(x=>x.debtId!==id);save();render('movimentos')}});
  document.querySelectorAll('[data-new-card]').forEach(b=>b.onclick=()=>cardForm());
  document.querySelectorAll('[data-edit-card]').forEach(b=>b.onclick=()=>cardForm(b.dataset.editCard));
  document.querySelectorAll('[data-del-card]').forEach(b=>b.onclick=()=>{if(confirm('Excluir cartão?')){db.cards=db.cards.filter(x=>x.id!==b.dataset.delCard);save();render('movimentos')}});
  document.querySelectorAll('[data-card-purchase]').forEach(b=>b.onclick=()=>purchaseForm(b.dataset.cardPurchase));
  document.querySelectorAll('[data-new-loan]').forEach(b=>b.onclick=()=>loanForm());
  document.querySelectorAll('[data-edit-loan]').forEach(b=>b.onclick=()=>loanForm(b.dataset.editLoan));
  document.querySelectorAll('[data-del-loan]').forEach(b=>b.onclick=()=>{if(confirm('Excluir empréstimo e parcelas?')){const id=b.dataset.delLoan;db.loans=db.loans.filter(x=>x.id!==id);db.debts=db.debts.filter(x=>x.loanId!==id);db.transactions=db.transactions.filter(x=>x.loanId!==id);save();render('movimentos')}});
  document.querySelectorAll('[data-toggle-paid]').forEach(b=>b.onclick=()=>togglePaid(b.dataset.togglePaid));
  document.querySelectorAll('[data-month-prev]').forEach(b=>b.onclick=()=>renderCalendarShift(-1));
  document.querySelectorAll('[data-month-next]').forEach(b=>b.onclick=()=>renderCalendarShift(1));
  document.querySelectorAll('[data-new-cash-entry]').forEach(b=>b.onclick=()=>cashEntryForm(b.dataset.newCashEntry));
  document.querySelectorAll('[data-edit-cash-entry]').forEach(b=>b.onclick=()=>cashEntryForm(null,b.dataset.editCashEntry));
  document.querySelectorAll('[data-del-cash-entry]').forEach(b=>b.onclick=()=>{const c=db.cashbooks?.find(x=>x.date===today());if(c&&!c.closedAt&&confirm('Excluir este movimento do caixa?')){c.entries=c.entries.filter(x=>x.id!==b.dataset.delCashEntry);save();cashbook()}});
  document.querySelectorAll('[data-open-cash]').forEach(b=>b.onclick=()=>cashbookOpen());
  document.querySelectorAll('[data-close-cash]').forEach(b=>b.onclick=()=>cashbookClose());
  // Final UX tabs
  document.querySelectorAll('[data-dd-tab]').forEach(b=>b.onclick=()=>debtsExpenses(b.dataset.ddTab));
  document.querySelectorAll('[data-card-tab]').forEach(b=>b.onclick=()=>debtsExpenses('cartoes',b.dataset.cardTab));
}

window.addEventListener('load',()=>initSupabase().catch(err=>{console.error('[RAQVOR][BOOT]',err);showAuth('login','Não foi possível iniciar o RAQVOR: '+authErrorMessage(err));}));

/* ==========================================================
   RAQVOR V2.13 — DESKTOP OPERACIONAL
   Caixa com meios de recebimento, credores, cartões separados,
   calendário financeiro consolidado, suporte IA/especialista e
   configurações comerciais.
   ========================================================== */
function cashOpening(c){return {cash:num(c?.openingCash),pix:num(c?.openingPix),card:num(c?.openingCard)}}
function ensureCashbookToday(){
  db.cashbooks=db.cashbooks||[];
  let c=db.cashbooks.find(x=>x.date===today());
  if(!c){c={id:uid(),date:today(),openedAt:null,closedAt:null,openingCash:0,openingPix:0,openingCard:0,entries:[],closingTransactionId:null};db.cashbooks.push(c)}
  c.entries=Array.isArray(c.entries)?c.entries:[];
  return c;
}
function openCashDialog(){
  const c=ensureCashbookToday();
  if(c.openedAt){cashbook();return}
  const el=document.createElement('div');el.className='modal open';
  el.innerHTML=`<div class="modal-card cash-open-modal"><div class="profile-head"><div><span class="eyebrow">ABERTURA DO CAIXA</span><h2>Informe o saldo inicial</h2><p>Registre separadamente o que existe hoje em dinheiro, Pix e na máquina de cartão.</p></div><button class="close" id="cash-open-close">×</button></div><form id="cash-open-form" class="form"><div class="cash-opening-grid"><div class="field"><label>Dinheiro</label><input id="open-cash" type="number" step="0.01" min="0" value="${c.openingCash||''}" placeholder="0,00"></div><div class="field"><label>Pix</label><input id="open-pix" type="number" step="0.01" min="0" value="${c.openingPix||''}" placeholder="0,00"></div><div class="field"><label>Cartão / máquina</label><input id="open-card" type="number" step="0.01" min="0" value="${c.openingCard||''}" placeholder="0,00"></div></div><div class="cash-open-total"><span>Total de abertura</span><b id="open-total">${money(num(c.openingCash)+num(c.openingPix)+num(c.openingCard))}</b></div><div class="actions"><button class="btn primary">Abrir Caixa</button><button type="button" class="btn secondary" id="cash-open-cancel">Cancelar</button></div></form></div>`;
  document.body.appendChild(el);
  const calc=()=>{$('#open-total').textContent=money(num($('#open-cash').value)+num($('#open-pix').value)+num($('#open-card').value))};
  ['#open-cash','#open-pix','#open-card'].forEach(x=>$(x).addEventListener('input',calc));
  $('#cash-open-close').onclick=()=>el.remove();$('#cash-open-cancel').onclick=()=>el.remove();
  $('#cash-open-form').onsubmit=e=>{e.preventDefault();c.openingCash=num($('#open-cash').value);c.openingPix=num($('#open-pix').value);c.openingCard=num($('#open-card').value);c.openedAt=new Date().toISOString();save();el.remove();toast('Caixa aberto com sucesso.');cashbook()};
}
function paymentMath(method,entered,mode){
  const v=num(entered);if(method==='pix'||method==='dinheiro')return{rate:0,charged:v,received:v,fee:0};
  const rate=method==='credito'?0.05:0.03;
  if(mode==='liquido'){const charged=v/(1-rate);return{rate,charged,received:v,fee:charged-v}}
  return{rate,charged:v,received:v*(1-rate),fee:v*rate};
}
function cashbook(){
  const c=ensureCashbookToday();
  const entries=c.entries||[];
  const opening=cashOpening(c), openingTotal=opening.cash+opening.pix+opening.card;
  const ins=entries.filter(x=>x.type==='entrada').reduce((a,x)=>a+num(x.receivedValue??x.value),0);
  const outs=entries.filter(x=>x.type==='saida').reduce((a,x)=>a+num(x.value),0);
  const net=openingTotal+ins-outs;
  const byMethod=['dinheiro','pix','credito','debito'].map(m=>[m,entries.filter(x=>x.type==='entrada'&&x.method===m).reduce((a,x)=>a+num(x.receivedValue??x.value),0)]);
  const rows=entries.slice().reverse().map(x=>`<tr><td>${esc(x.time||'—')}</td><td><span class="flow-badge ${x.type}">${x.type==='entrada'?'Entrada':'Saída'}</span></td><td>${esc(x.description||'—')}</td><td>${esc(x.methodLabel||'—')}</td><td>${x.type==='entrada'?`<small>cobrado ${money(x.chargedValue??x.value)}</small>`:'—'}</td><td class="${x.type==='entrada'?'positive':'negative'}">${x.type==='entrada'?'+':'−'} ${money(x.type==='entrada'?(x.receivedValue??x.value):x.value)}</td><td>${c.closedAt?'<span class="pill paid">Fechado</span>':`<button class="btn secondary mini" data-edit-cash-entry="${x.id}">Editar</button><button class="btn danger mini" data-del-cash-entry="${x.id}">Excluir</button>`}</td></tr>`).join('');
  layout('Livro Caixa',`<div class="page-intro cash-intro"><div><span class="eyebrow">LIVRO CAIXA</span><h2>${fmtDate(today())}</h2><p>${c.openedAt?'Caixa aberto. Registre cada entrada ou saída pelo meio correto.':'O caixa ainda não foi aberto.'}</p></div><div class="cash-result ${net>=0?'positive':'negative'}"><small>CAIXA REAL</small><b>${money(net)}</b><span>${c.closedAt?'Fechado':'Em aberto'}</span></div></div>
    ${!c.openedAt?`<div class="card cash-open-cta"><div><span class="eyebrow">INÍCIO DO DIA</span><h3>Abrir Caixa</h3><p>Informe dinheiro, Pix e saldo disponível na máquina de cartão.</p></div><button class="btn primary" data-open-cash>+ Abrir Caixa</button></div>`:`<><div class="grid compact-kpis"><div class="card"><div class="label">Abertura</div><div class="value">${money(openingTotal)}</div></div><div class="card"><div class="label">Entradas líquidas</div><div class="value positive">${money(ins)}</div></div><div class="card"><div class="label">Saídas</div><div class="value negative">${money(outs)}</div></div><div class="card"><div class="label">Saldo do caixa</div><div class="value ${net>=0?'positive':'negative'}">${money(net)}</div></div></div>
    <div class="cash-method-grid">${byMethod.map(([m,v])=>`<div class="cash-method"><span>${m==='dinheiro'?'Dinheiro':m==='pix'?'Pix':m==='credito'?'Crédito':'Débito'}</span><b>${money(v)}</b></div>`).join('')}</div>
    ${c.closedAt?'':`<div class="card cash-form-card"><div class="section-head"><div><span class="eyebrow">MOVIMENTO</span><h3>Registrar entrada ou saída</h3><p>Cartão calcula automaticamente taxa de 5% no crédito e 3% no débito.</p></div></div><form id="quick-cash-v213" class="quick-cash-v213"><select id="c13-type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select><select id="c13-method"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="credito">Cartão de crédito</option><option value="debito">Cartão de débito</option></select><select id="c13-mode"><option value="liquido">Quero receber o valor líquido informado</option><option value="cobrado">O valor informado já é o total cobrado</option></select><input id="c13-value" type="number" step="0.01" min="0" placeholder="Valor" required><input id="c13-desc" placeholder="Descrição" required><input id="c13-source" placeholder="Origem / destino"><div class="calc-box" id="c13-calc">Recebido: ${money(0)}</div><button class="btn primary">Registrar</button></form></div>`}</>`}
    <div class="card data-card"><div class="section-head"><div><h3>Movimentações de hoje</h3><p>O valor efetivamente recebido ou pago é o que altera o caixa.</p></div>${c.openedAt&&!c.closedAt?`<button class="btn danger" data-close-cash>Fechar Caixa</button>`:''}</div>${rows?table(rows,['Hora','Tipo','Descrição','Meio','Cobrado','Valor real','Ações']):'<div class="empty">Nenhum movimento registrado hoje.</div>'}</div>`);
  const f=$('#quick-cash-v213');
  if(f){const calc=()=>{const method=$('#c13-method').value,mode=$('#c13-mode').value,pm=paymentMath(method,$('#c13-value').value,mode);$('#c13-calc').innerHTML=`Cobrado: <b>${money(pm.charged)}</b> · Recebido: <b>${money(pm.received)}</b> · Taxa: ${money(pm.fee)}`;$('#c13-mode').disabled=$('#c13-type').value==='saida'||method==='pix'||method==='dinheiro';if($('#c13-type').value==='saida')$('#c13-calc').textContent='Saída: o valor informado será descontado integralmente do caixa.'};['#c13-value','#c13-method','#c13-mode','#c13-type'].forEach(x=>$(x).addEventListener('input',calc));f.onsubmit=e=>{e.preventDefault();const type=$('#c13-type').value,method=type==='saida'?'saida':$('#c13-method').value,mode=$('#c13-mode').value,raw=num($('#c13-value').value),pm=type==='saida'?{charged:raw,received:0,fee:0,rate:0}:paymentMath(method,raw,mode);const labels={pix:'Pix',dinheiro:'Dinheiro',credito:'Cartão de crédito',debito:'Cartão de débito'};c.entries.push({id:uid(),type:type==='saida'?'saida':'entrada',method:type==='saida'?'saida':method,methodLabel:type==='saida'?'Saída':labels[method],value:type==='saida'?raw:pm.charged,chargedValue:type==='saida'?raw:pm.charged,receivedValue:type==='saida'?0:pm.received,fee:type==='saida'?0:pm.fee,description:$('#c13-desc').value.trim(),source:$('#c13-source').value.trim(),time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});save();toast(type==='saida'?'Saída registrada.':'Entrada registrada.');cashbook()};calc()}
}
function closeCashToday(){const c=ensureCashbookToday();if(!c.openedAt||c.closedAt)return;const net=cashOpening(c).cash+cashOpening(c).pix+cashOpening(c).card+c.entries.filter(x=>x.type==='entrada').reduce((a,x)=>a+num(x.receivedValue??x.value),0)-c.entries.filter(x=>x.type==='saida').reduce((a,x)=>a+num(x.value),0);c.closedAt=new Date().toISOString();c.net=net;save();toast('Caixa fechado.');cashbook()}

function creditorRecords(){
  const list=Array.isArray(db.creditors)?db.creditors:[];const derived=[];
  db.debts.forEach(d=>derived.push({name:d.creditor,type:d.kind||'Credor'}));db.loans.forEach(l=>derived.push({name:l.person,type:'Instituição/Pessoa'}));
  for(const d of derived){if(d.name&&!list.some(x=>x.name.toLowerCase()===d.name.toLowerCase()))list.push({id:uid(),name:d.name,type:d.type})}
  db.creditors=list;return list;
}
function debtTotalsForCreditor(name){const tx=db.transactions.filter(x=>(x.person||'').trim().toLowerCase()===name.trim().toLowerCase()&&x.type==='despesa'&&x.status!=='pago');return{monthly:tx.reduce((a,x)=>a+num(x.value),0),count:tx.length}}
function registerDebtExpenseDialog(){
  const el=document.createElement('div');el.className='modal open';el.innerHTML=`<div class="modal-card register-modal"><div class="profile-head"><div><span class="eyebrow">NOVO REGISTRO</span><h2>O que você deseja registrar?</h2><p>Escolha o tipo. O RAQVOR abrirá somente os campos necessários.</p></div><button class="close" id="reg-close">×</button></div><div class="register-choice-grid"><button data-reg="payment"><b>Pagamento</b><small>Registre algo que já foi pago.</small></button><button data-reg="expense"><b>Despesa / dívida</b><small>Crie um compromisso a pagar.</small></button><button data-reg="loan"><b>Empréstimo</b><small>Recebido ou concedido, com parcelas.</small></button><button data-reg="recurring"><b>Recorrente</b><small>Mesmo valor e dia todos os meses.</small></button><button data-reg="card"><b>Compra no cartão</b><small>Parcelada ou à vista.</small></button><button data-reg="creditor"><b>Novo credor</b><small>Pessoa ou instituição.</small></button></div></div>`;document.body.appendChild(el);$('#reg-close').onclick=()=>el.remove();el.querySelectorAll('[data-reg]').forEach(b=>b.onclick=()=>{const k=b.dataset.reg;el.remove();if(k==='loan')loanForm();else if(k==='card')cardForm();else if(k==='recurring')recurring();else if(k==='creditor')creditorForm();else transactionForm(k==='payment'?'despesa':'despesa')})
}
function creditorForm(id=null){const c=(db.creditors||[]).find(x=>x.id===id);const el=document.createElement('div');el.className='modal open';el.innerHTML=`<div class="modal-card"><div class="profile-head"><div><span class="eyebrow">CREDOR</span><h2>${c?'Editar':'Cadastrar'} credor</h2></div><button class="close" id="cf-close">×</button></div><form id="cf-form" class="form"><div class="field"><label>Nome</label><input id="cf-name" required value="${esc(c?.name||'')}"></div><div class="field"><label>Tipo</label><select id="cf-type"><option>Pessoa</option><option>Instituição</option></select></div><div class="actions"><button class="btn primary">Salvar</button></div></form></div>`;document.body.appendChild(el);$('#cf-close').onclick=()=>el.remove();$('#cf-form').onsubmit=e=>{e.preventDefault();const name=$('#cf-name').value.trim();if(!name)return;db.creditors=db.creditors||[];if(c)Object.assign(c,{name,type:$('#cf-type').value});else db.creditors.push({id:uid(),name,type:$('#cf-type').value});save();el.remove();toast('Credor salvo.');debtsExpenses('creditors')};if(c)$('#cf-type').value=c.type||'Pessoa'}
function cardPage(){
  const cards=db.cards||[];const total=cards.reduce((a,c)=>a+db.transactions.filter(x=>x.cardId===c.id&&x.type==='despesa'&&x.status!=='pago').reduce((s,x)=>s+num(x.value),0),0);
  const cardsHtml=cards.map(c=>{const tx=db.transactions.filter(x=>x.cardId===c.id&&x.type==='despesa').sort((a,b)=>a.date.localeCompare(b.date));const open=tx.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);return `<section class="entity-card"><div class="entity-card-head"><div><span class="eyebrow">CARTÃO</span><h3>${esc(c.name)}</h3><p>${esc(c.bank||'')} · vence dia ${c.due||'—'}</p></div><div><b>${money(open)}</b><small>em aberto</small></div></div><div class="entity-metrics"><span>Limite <b>${money(c.limit)}</b></span><span>Disponível <b>${money(Math.max(0,num(c.limit)-open))}</b></span><span>Fechamento <b>dia ${c.close||'—'}</b></span></div><div class="card-purchase-list">${tx.length?tx.map(x=>`<div><span><b>${esc(x.person||x.category||'Compra')}</b><small>${fmtDate(x.date)} · ${x.installment?`parcela ${x.installment}`:''}</small></span><strong>${money(x.value)}</strong></div>`).join(''):'<div class="empty">Nenhuma compra registrada.</div>'}</div><div class="actions"><button class="btn primary" data-card-purchase="${c.id}">+ Nova compra</button><button class="btn secondary" data-edit-card="${c.id}">Editar</button></div></section>`}).join('');
  layout('Cartões de Crédito',`<div class="hero premium-hero"><div><small>CARTEIRA DE CARTÕES</small><h2>Cartões separados, sem mistura.</h2><small>Compras e parcelas ficam dentro do cartão correto.</small></div><div class="side"><small>COMPROMISSOS EM CARTÕES</small><br><b>${money(total)}</b></div></div><div class="actions"><button class="btn primary" data-new-card>+ Cadastrar cartão</button></div><div class="entity-grid">${cardsHtml||'<div class="empty">Nenhum cartão cadastrado.</div>'}</div>`)
}
function debtsExpenses(mode='overview'){
  creditorRecords();
  if(mode==='cartoes')return cardPage();
  if(mode==='creditors'){
    const cards=(db.creditors||[]).map(c=>{const tx=db.transactions.filter(x=>(x.person||'').trim().toLowerCase()===c.name.trim().toLowerCase()&&x.type==='despesa');const monthly=tx.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);const total=tx.reduce((a,x)=>a+num(x.value),0);return `<button class="creditor-card" data-creditor="${esc(c.id)}"><div><span class="creditor-avatar">${esc(c.name.charAt(0).toUpperCase())}</span><span><b>${esc(c.name)}</b><small>${esc(c.type||'Credor')}</small></span></div><strong>${money(monthly)}<small>mensal em aberto</small></strong><em>${tx.length} lançamentos</em></button>`}).join('');
    layout('Credores',`<div class="section-head"><div><span class="eyebrow">CREDORES</span><h2>Uma conta por credor</h2><p>Ao abrir um credor, todas as dívidas aparecem separadas por compromisso e data.</p></div><button class="btn primary" data-new-creditor>+ Novo credor</button></div><div class="creditor-list">${cards||'<div class="empty">Nenhum credor cadastrado.</div>'}</div><div class="card debt-chart"><h3>Onde está a maior parcela mensal?</h3><div>${(db.creditors||[]).sort((a,b)=>debtTotalsForCreditor(b.name).monthly-debtTotalsForCreditor(a.name).monthly).slice(0,8).map(c=>{const v=debtTotalsForCreditor(c.name).monthly;return `<div class="bar-row"><span>${esc(c.name)}</span><div><i style="width:${Math.min(100,v/(Math.max(1,...(db.creditors||[]).map(z=>debtTotalsForCreditor(z.name).monthly)))*100)}%"></i></div><b>${money(v)}</b></div>`}).join('')}</div></div>`);return;
  }
  const tx=db.transactions.filter(x=>x.type==='despesa').sort((a,b)=>a.date.localeCompare(b.date));
  const open=tx.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);const recurringOpen=(db.recurring||[]).filter(x=>x.active&&x.type==='despesa').reduce((a,x)=>a+num(x.value),0);const finished=db.debts.filter(d=>debtRemaining(d.id)<=0).length;
  const rows=tx.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.person||x.category||'—')}</td><td>${esc(x.category||'—')}</td><td>${money(x.value)}</td><td>${statusPill(x.status,x.priority)}</td><td><button class="btn secondary" data-edit="${x.id}">Editar</button></td></tr>`).join('');
  layout('Dívidas e Despesas',`<div class="hero premium-hero"><div><small>CONTROLE DE COMPROMISSOS</small><h2>O centro de tudo que existe a pagar.</h2><small>Credores, parcelas, recorrentes e compromissos em uma visão organizada.</small></div><div class="side"><small>EM ABERTO</small><br><b>${money(open)}</b><br><small>${finished} dívidas quitadas</small></div></div><div class="debt-kpi-grid"><div class="card"><span>Parcelados / com término</span><b>${money(open-recurringOpen)}</b><small>compromissos com prazo</small></div><div class="card"><span>Recorrentes</span><b>${money(recurringOpen)}</b><small>sem prazo de término</small></div><div class="card"><span>Credores</span><b>${db.creditors.length}</b><small>pessoas e instituições</small></div><div class="card"><span>Total em aberto</span><b>${money(open)}</b><small>próximos pagamentos</small></div></div><div class="actions"><button class="btn primary" data-register-debt>+ Registrar pagamento ou dívida</button><button class="btn secondary" data-new-creditor>+ Novo credor</button><button class="btn secondary" data-view="cartoes">Cartões de crédito</button></div><div class="debt-tabs"><button class="tab active" data-dd-tab="overview">Visão geral</button><button class="tab" data-dd-tab="creditors">Credores</button><button class="tab" data-dd-tab="cartoes">Cartões</button><button class="tab" data-view="recorrentes">Recorrentes</button></div><div class="card"><div class="section-head"><div><h3>Todos os pagamentos cadastrados</h3><p>A data de vencimento é a data usada no Calendário Financeiro.</p></div></div>${table(rows,['Vencimento','Credor','Categoria','Parcela/valor','Status','Ação'])}</div>`)
}
function registerDebtEvents(){document.querySelectorAll('[data-register-debt]').forEach(b=>b.onclick=registerDebtExpenseDialog);document.querySelectorAll('[data-new-creditor]').forEach(b=>b.onclick=()=>creditorForm());document.querySelectorAll('[data-creditor]').forEach(b=>b.onclick=()=>creditorDetail(b.dataset.creditor))}
function creditorDetail(id){const c=(db.creditors||[]).find(x=>x.id===id);if(!c)return;const tx=db.transactions.filter(x=>(x.person||'').trim().toLowerCase()===c.name.trim().toLowerCase()).sort((a,b)=>a.date.localeCompare(b.date));const rows=tx.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.category||'—')}</td><td>${esc(x.note||'—')}</td><td>${money(x.value)}</td><td>${statusPill(x.status)}</td></tr>`).join('');layout('Credor · '+c.name,`<div class="subnav"><button class="btn secondary" data-view="movimentos">← Dívidas e Despesas</button><button class="btn secondary" data-view="cartoes">Cartões</button><button class="btn secondary" data-view="calendario">Calendário</button><button class="btn secondary" data-view="recorrentes">Recorrentes</button></div><div class="hero"><div><small>${esc(c.type||'CREDOR')}</small><h2>${esc(c.name)}</h2><small>${tx.length} lançamentos vinculados</small></div><div class="side"><small>EM ABERTO</small><br><b>${money(tx.filter(x=>x.status!=='pago'&&x.type==='despesa').reduce((a,x)=>a+num(x.value),0))}</b></div></div><div class="card">${table(rows,['Data de pagamento','Tipo','Descrição','Valor','Status'])}</div><div class="actions"><button class="btn secondary" data-view="movimentos">Voltar</button><button class="btn primary" data-edit-creditor="${c.id}">Editar credor</button></div>`)}
function config(){layout('Configurações',`<div class="settings-shell"><div class="settings-intro"><div><span>RAQVOR</span><h2>Configurações</h2><p>O nome RAQVOR é fixo. Aqui você personaliza apenas o que muda a organização financeira.</p></div><div class="settings-badge">● sincronizado</div></div><form id="cfg" class="settings-grid"><section class="settings-card"><div class="settings-card-head"><div class="settings-icon">R</div><div><h3>Identidade</h3><p>O nome comercial do aplicativo é imutável.</p></div></div><div class="form settings-form"><div class="field"><label>Nome do aplicativo</label><input value="RAQVOR" disabled></div><div class="field"><label>Moeda</label><select id="currency"><option value="BRL">R$ — Real brasileiro</option><option value="USD">$ — Dólar americano</option><option value="EUR">€ — Euro</option></select></div></div></section><section class="settings-card"><div class="settings-card-head"><div class="settings-icon">◎</div><div><h3>Ciclo financeiro</h3><p>Defina a data de início e a duração usada nas projeções.</p></div></div><div class="form settings-form"><div class="field"><label>Primeiro dia do ciclo</label><input id="cycleStart" type="number" min="1" max="31" value="${db.settings.cycleStart||1}"></div><div class="field"><label>Período</label><select id="cycleLength"><option value="5">5 dias</option><option value="7">Semanal — 7 dias</option><option value="15">Quinzenal — 15 dias</option><option value="30">Mensal — 30 dias</option></select></div><div class="field"><label>Dias de folga para a busca diária</label><input id="daysOff" value="${esc((db.settings.daysOff||[]).join(', '))}" placeholder="Ex.: 01/09/2026, 07/09/2026"></div></div></section><section class="settings-card"><div class="settings-card-head"><div class="settings-icon">✓</div><div><h3>Pagamento da diária</h3><p>Por padrão a meta diária é dividida de domingo a domingo, sem folga.</p></div></div><div class="settings-note"><b>Regra atual</b><span>Somente os dias cadastrados em “Dias de folga” são retirados da contagem. Essa configuração altera o Desktop e é refletida no Mobile.</span></div></section><section class="settings-card danger-zone"><div class="settings-card-head"><div class="settings-icon">!</div><div><h3>Dados locais</h3><p>Use apenas se precisar limpar o cache deste dispositivo.</p></div></div><div class="actions"><button type="button" class="btn danger" id="reset-data">Limpar cache local</button></div></section><div class="actions full"><button class="btn primary">Salvar configurações</button></div></form></div>`);$('#currency').value=db.settings.currency||'BRL';$('#cycleLength').value=String(db.settings.cycleLength||30);$('#cfg').onsubmit=e=>{e.preventDefault();db.settings.currency=$('#currency').value;db.settings.cycleStart=Math.min(31,Math.max(1,num($('#cycleStart').value)||1));db.settings.cycleLength=num($('#cycleLength').value)||30;db.settings.daysOff=$('#daysOff').value.split(',').map(x=>x.trim()).filter(Boolean);save();toast('Configurações salvas.');render('config')};$('#reset-data').onclick=()=>{if(confirm('Limpar somente o cache local? Os dados do Supabase serão preservados.')){localStorage.removeItem(KEY);localStorage.removeItem(KEY+'_remote_updated_at');location.reload()}}}
function calendar(){
  const m=calendarCursor||currentMonth();
  const first=iso(`${m}-01`), last=iso(`${m}-${String(new Date(first.getFullYear(),first.getMonth()+1,0).getDate()).padStart(2,'0')}`), todayKey=today();
  const monthItems=db.transactions.filter(x=>monthKey(x.date)===m);
  const pendingPay=monthItems.filter(x=>x.type==='despesa'&&x.status!=='pago');
  const totalPay=pendingPay.reduce((a,x)=>a+num(x.value),0);
  const cash=Math.max(0,currentBalance());
  const debt=Math.max(0,totalPay-cash);
  const horizonStart=monthKey(first)===currentMonth()?iso(todayKey):first;
  let remainingDays=0;for(let d=new Date(horizonStart);d<=last;d.setDate(d.getDate()+1)){const k=ymd(d);if(!db.settings.daysOff.includes(k))remainingDays++}
  remainingDays=Math.max(1,remainingDays);
  const dailyNeed=debt/remainingDays;
  const weeks=financialWeekRanges(m);
  let carryCash=cash;
  const weekHtml=weeks.map((w,idx)=>{
    const items=db.transactions.filter(x=>monthKey(x.date)===m&&w.days.includes(x.date));
    const pay=items.filter(x=>x.type==='despesa'&&x.status!=='pago');
    const revenues=items.filter(x=>x.type==='receita');
    const payTotal=pay.reduce((a,x)=>a+num(x.value),0);
    const received=revenues.filter(x=>x.status==='pago').reduce((a,x)=>a+num(x.value),0);
    const plannedRevenue=revenues.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
    const cashBefore=carryCash;
    const weekRemaining=Math.max(0,payTotal-cashBefore-received);
    const activeDays=w.days.filter(d=>d>=todayKey&&!db.settings.daysOff.includes(d)).length||1;
    const daily=weekRemaining/activeDays;
    carryCash=Math.max(0,cashBefore+received-payTotal);
    const groups=groupCreditor(pay);
    const isCurrent=w.days.includes(todayKey);
    return `<section class="finance-week ${isCurrent?'current':''}">
      <div class="finance-week-head"><div><span class="eyebrow">SEMANA ${idx+1}${isCurrent?' • ATUAL':''}</span><h3>${fmtDate(w.start)} <span>até</span> ${fmtDate(w.end)}</h3></div><div class="week-head-metrics"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas recebidas</small><b class="positive">${money(received)}</b></div><div><small>Diária</small><b>${money(daily)}</b></div></div></div>
      <div class="finance-week-body">
        ${groups.length?groups.map(g=>`<div class="creditor-line"><div class="creditor-main"><b>${esc(g.name)}</b><span>${g.items.map(x=>`${fmtDate(x.date)} • ${esc(x.category||'pagamento')}`).join(' · ')}</span></div><strong class="negative">${money(g.total)}</strong></div>`).join(''):`<div class="empty">Nenhum pagamento previsto nesta semana.</div>`}
        <div class="week-revenue"><span><b>Receitas da semana</b><small>${received?`Recebidas ${money(received)}`:'Nenhuma recebida'}${plannedRevenue?` • previstas ${money(plannedRevenue)}`:''}</small></span><strong class="positive">+ ${money(received)}</strong></div>
      </div>
      <div class="finance-week-footer"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas recebidas</small><b class="positive">${money(received)}</b></div><div><small>Caixa trazido</small><b>${money(cashBefore)}</b></div><div><small>Caixa após semana</small><b class="${carryCash?'positive':'negative'}">${money(carryCash)}</b></div><div><small>Saldo ainda necessário</small><b class="${weekRemaining?'negative':'positive'}">${money(weekRemaining)}</b></div><div><small>Busca diária</small><b>${money(daily)}</b><span>${activeDays} dia(s)</span></div></div>
    </section>`;
  }).join('');
  layout('Calendário Financeiro',`<div class="page-intro calendar-intro"><div><span class="eyebrow">FLUXO FINANCEIRO</span><h2>${monthName(m)} de ${yearKey(m)}</h2><p>Lista de pagamentos por semana. O mesmo credor é unificado quando os vencimentos coincidem; datas diferentes permanecem separadas.</p></div><div class="month-nav"><button class="btn secondary" data-month-prev>‹</button><b>${monthName(m)}</b><button class="btn secondary" data-month-next>›</button></div></div>
  <div class="finance-summary-banner"><div><small>EM CAIXA</small><strong class="positive">${money(cash)}</strong></div><div><small>TOTAL A PAGAR</small><strong class="negative">${money(totalPay)}</strong></div><div><small>SALDO DEVEDOR</small><strong class="${debt?'negative':'positive'}">${money(debt)}</strong></div><div class="featured"><small>DIÁRIA DE BUSCA</small><strong>${money(dailyNeed)}</strong><span>${remainingDays} dia(s) considerados</span></div></div>
  <div class="calendar-rule">A diária é distribuída de domingo a domingo, sem folga por padrão. Dias configurados como folga são retirados somente do cálculo da busca.</div>
  <div class="finance-weeks">${weekHtml||'<div class="empty">Nenhum movimento neste mês.</div>'}</div>`);
}

function suporte(){
  layout('Suporte',`<div class="support-premium"><div class="support-hero"><div><span class="eyebrow">CENTRAL RAQVOR</span><h2>Como podemos ajudar?</h2><p>Primeiro você pode conversar com o Assistente. Se preferir uma pessoa, selecione Especialista e o atendimento será encaminhado à Central Administrativa.</p></div><div class="support-switch"><button class="support-mode active" data-support-mode="ia">✦ Assistente</button><button class="support-mode" data-support-mode="especialista">◉ Especialista</button></div></div><div class="support-ai-card" id="support-ai-card"><div class="support-chat-head"><div class="support-avatar">✦</div><div><b>Assistente RAQVOR</b><small>triagem inteligente</small></div></div><div id="support-ai-log" class="support-ai-log"><div class="support-bubble theirs">Olá! Me diga o que aconteceu. Se você preferir falar diretamente com uma pessoa, escolha <b>Especialista</b>.</div></div><div class="support-quick"><button data-support-intent="problema técnico">Problema técnico</button><button data-support-intent="cartão ou pagamento">Cartão / pagamento</button><button data-support-intent="sincronização">Sincronização</button><button data-support-intent="conta ou acesso">Conta / acesso</button></div><form id="support-ai-form"><input id="support-ai-input" placeholder="Digite sua dúvida..." autocomplete="off"><button class="btn primary">Enviar</button></form></div><div class="support-specialist-card" id="support-specialist-card" hidden><div class="section-head"><div><span class="eyebrow">ATENDIMENTO HUMANO</span><h3>Falar com especialista</h3><p>Seu relato será enviado ao painel Admin e você acompanhará a conversa como no WhatsApp.</p></div></div><form id="specialist-form" class="form"><input id="sp-subject" placeholder="Assunto" required><select id="sp-category"><option>financeiro</option><option>cartão</option><option>empréstimo</option><option>problema técnico</option><option>conta</option><option>outro</option></select><select id="sp-priority"><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select><textarea id="sp-body" required placeholder="Explique o que precisa que a equipe faça..."></textarea><button class="btn primary">Enviar ao especialista</button></form></div><div class="card support-my-tickets"><div class="section-head"><div><span class="eyebrow">MEUS ATENDIMENTOS</span><h3>Conversas</h3></div><span class="pill">tempo real</span></div><div id="support-ticket-list">Carregando...</div></div><div id="support-client-chat"></div></div>`);
  const log=$('#support-ai-log');const aiMessages=[];
  const append=(who,text)=>{log.insertAdjacentHTML('beforeend',`<div class="support-bubble ${who==='user'?'mine':'theirs'}">${esc(text)}<small>${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small></div>`);log.scrollTop=log.scrollHeight};
  async function ask(text){if(!text)return;append('user',text);try{const r=await supabaseClient.functions.invoke('raquor-support-ai',{body:{messages:[...aiMessages,{role:'user',content:text}]}});if(r.error)throw r.error;const d=r.data||{};append('assistant',d.assistant_text||'Entendi. Se preferir, posso encaminhar você para um especialista.');aiMessages.push({role:'user',content:text},{role:'assistant',content:d.assistant_text||''})}catch(e){append('assistant','Não consegui responder agora. Você pode selecionar Especialista para encaminhar o atendimento diretamente ao suporte.');console.error(e)}}
  $('#support-ai-form').onsubmit=e=>{e.preventDefault();const t=$('#support-ai-input').value.trim();$('#support-ai-input').value='';ask(t)};document.querySelectorAll('[data-support-intent]').forEach(b=>b.onclick=()=>ask(b.dataset.supportIntent));document.querySelectorAll('[data-support-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-support-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');const ai=b.dataset.supportMode==='ia';$('#support-ai-card').hidden=!ai;$('#support-specialist-card').hidden=ai});
  $('#specialist-form').onsubmit=async e=>{e.preventDefault();const u=currentUser;const t=await supabaseClient.from('support_tickets').insert({user_id:u.id,subject:$('#sp-subject').value.trim(),category:$('#sp-category').value,priority:$('#sp-priority').value}).select().single();if(t.error)return toast(t.error.message);const m=await supabaseClient.from('support_messages').insert({ticket_id:t.data.id,sender_user_id:u.id,body:$('#sp-body').value.trim(),message_type:'text'});if(m.error)return toast(m.error.message);toast('Atendimento encaminhado ao especialista.');loadClientTicketsV213()};
  loadClientTicketsV213();
}
async function loadClientTicketsV213(){const el=$('#support-ticket-list');if(!el||!supabaseClient||!currentUser)return;const r=await supabaseClient.from('support_tickets').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});if(r.error){el.textContent=r.error.message;return}el.innerHTML=(r.data||[]).map(t=>`<button class="client-ticket-v213" data-ticket-v213="${t.id}"><span><b>${esc(t.subject)}</b><small>${esc(t.category)} · ${new Date(t.created_at).toLocaleDateString('pt-BR')}</small></span><em>${esc(t.status)}</em></button>`).join('')||'<div class="empty">Nenhum atendimento.</div>';el.querySelectorAll('[data-ticket-v213]').forEach(b=>b.onclick=()=>openClientTicketV213(b.dataset.ticketV213))}
async function supportMessageStatus(m,meId){
  if(m.sender_user_id===meId){
    if(m.read_at)return '<span class="msg-check read">✓✓</span>';
    if(m.delivered_at)return '<span class="msg-check">✓✓</span>';
    return '<span class="msg-check">✓</span>';
  }
  return '';
}
async function openClientTicketV213(ticketId){
  const box=$('#support-client-chat');if(!box||!currentUser)return;
  const r=await supabaseClient.from('support_messages').select('*').eq('ticket_id',ticketId).order('created_at');
  if(r.error){box.innerHTML=`<div class="card error-card">${esc(r.error.message)}</div>`;return}
  const msgs=r.data||[];
  // Opening the conversation means incoming specialist messages are delivered/read.
  if(msgs.some(m=>m.sender_user_id!==currentUser.id&&(!m.delivered_at||!m.read_at))){
    await supabaseClient.rpc('mark_support_ticket_read',{p_ticket_id:ticketId});
  }
  box.innerHTML=`<div class="support-whatsapp"><div class="support-wa-head"><div><b>Atendimento RAQVOR</b><small>conversa com especialista</small></div><button class="close" id="close-client-wa">×</button></div><div class="support-wa-body" id="support-wa-body">${msgs.map(m=>`<div class="support-bubble ${m.sender_user_id===currentUser.id?'mine':'theirs'}"><div>${m.message_type==='voice'?'<span>🎙 Mensagem de voz</span>':esc(m.body||'')}</div><small>${new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} ${m.sender_user_id===currentUser.id?((m.read_at?'<span class="msg-check read">✓✓</span>':m.delivered_at?'<span class="msg-check">✓✓</span>':'<span class="msg-check">✓</span>')):''}</small></div>`).join('')}</div><form id="client-wa-form"><input id="client-wa-input" placeholder="Digite uma mensagem..." autocomplete="off"><button class="btn primary">Enviar</button></form></div>`;
  $('#close-client-wa').onclick=()=>box.innerHTML='';
  $('#client-wa-form').onsubmit=async e=>{e.preventDefault();const body=$('#client-wa-input').value.trim();if(!body)return;const rr=await supabaseClient.from('support_messages').insert({ticket_id:ticketId,sender_user_id:currentUser.id,body,message_type:'text'});if(rr.error)return toast(rr.error.message);openClientTicketV213(ticketId)};
  if(window.__clientSupportChannel)try{supabaseClient.removeChannel(window.__clientSupportChannel)}catch{}
  window.__clientSupportChannel=supabaseClient.channel('raqvor-client-ticket-'+ticketId).on('postgres_changes',{event:'*',schema:'public',table:'support_messages',filter:`ticket_id=eq.${ticketId}`},async()=>{if($('#support-client-chat'))openClientTicketV213(ticketId)}).subscribe();
}


/* Rebind actions after overridden renderers. */
const _bindGlobalV213=bindGlobal;
bindGlobal=function(){_bindGlobalV213();registerDebtEvents();document.querySelectorAll('[data-register-debt]').forEach(b=>b.onclick=registerDebtExpenseDialog);document.querySelectorAll('[data-new-creditor]').forEach(b=>b.onclick=()=>creditorForm());document.querySelectorAll('[data-open-cash]').forEach(b=>b.onclick=openCashDialog);document.querySelectorAll('[data-close-cash]').forEach(b=>b.onclick=closeCashToday);document.querySelectorAll('[data-edit-creditor]').forEach(b=>b.onclick=()=>creditorForm(b.dataset.editCreditor));}


/* ============================================================
   RAQVOR FINAL 2.15 — calendário, caixa, dívidas e reset
   Patch aditivo: preserva o estado existente e substitui apenas
   as rotinas necessárias para esta etapa.
   ============================================================ */
(function(){
  const rqDayName=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const rqMoney=n=>money(Number(n)||0);
  const rqYmd=d=>{const x=d instanceof Date?d:iso(d);return Number.isNaN(x.getTime())?'':x.toISOString().slice(0,10)};
  const rqMonthLabel=m=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(iso(m+'-01'));
  const rqMonthDays=m=>{const [y,mo]=m.split('-').map(Number),last=new Date(y,mo,0,12);const out=[];for(let i=1;i<=last.getDate();i++){const d=new Date(y,mo-1,i,12),k=rqYmd(d);out.push({date:k,d});}return out};
  const rqWeekStart=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);const n=x.getDay();x.setDate(x.getDate()-((n+6)%7));return x};
  const rqWeeksForMonth=m=>{const [y,mo]=m.split('-').map(Number);const first=new Date(y,mo-1,1,12),last=new Date(y,mo,0,12);let s=rqWeekStart(first),out=[];while(s<=last){const e=new Date(s);e.setDate(s.getDate()+6);out.push({start:new Date(s),end:e});s=new Date(s);s.setDate(s.getDate()+7)}return out};
  const rqOff=()=>Array.isArray(db.settings?.daysOff)?db.settings.daysOff:[];
  const rqIsOff=k=>rqOff().includes(k);
  const rqMonthTx=m=>(db.transactions||[]).filter(x=>monthKey(x.date)===m);
  const rqUnpaid=x=>x.type==='despesa'&&x.status!=='pago';

  /* ---------- CALENDÁRIO: segunda → domingo ---------- */
  calendar=function(m=calendarCursor||currentMonth()){
    calendarCursor=m;
    const rows=rqMonthTx(m), pay=rows.filter(rqUnpaid).reduce((a,x)=>a+num(x.value),0), rec=rows.filter(x=>x.type==='receita'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
    const cash=currentBalance(), netNeed=Math.max(0,pay-Math.max(0,cash)-rec);
    const days=rqMonthDays(m), todayKey=today(), isCurrent=m===currentMonth();
    const remaining=days.filter(q=>rqYmd(q.d)>=todayKey&&!rqIsOff(q.date));
    const daily=remaining.length?netNeed/remaining.length:0;
    const weeks=rqWeeksForMonth(m);
    const weeksHtml=weeks.map((w,wi)=>{
      const ds=[];for(let i=0;i<7;i++){const d=new Date(w.start);d.setDate(w.start.getDate()+i);const k=rqYmd(d);if(d.getMonth()===new Date(m+'-01T12:00:00').getMonth()||d>=new Date(m+'-01T12:00:00')&&d<=new Date(m+'-01T12:00:00'))ds.push({d,k});}
      const real=ds.filter(q=>monthKey(q.k)===m); if(!real.length)return '';
      const payW=real.flatMap(q=>rows.filter(x=>x.date===q.k&&x.type==='despesa'&&x.status!=='pago')).reduce((a,x)=>a+num(x.value),0);
      const recW=real.flatMap(q=>rows.filter(x=>x.date===q.k&&x.type==='receita'&&x.status!=='pago')).reduce((a,x)=>a+num(x.value),0);
      const active=real.filter(q=>!rqIsOff(q.k)&&(!isCurrent||q.k>=todayKey)).length;
      const need=Math.max(0,payW-recW); const weekDaily=active?need/active:0;
      const current=real.some(q=>q.k===todayKey);
      return `<section class="finance-week ${current?'current calendar-week-current':''}"><div class="finance-week-head"><div><span class="eyebrow">${current?'SEMANA ATUAL':'SEMANA '+(wi+1)}</span><h3>${fmtDate(real[0].k)} <span>até</span> ${fmtDate(real[real.length-1].k)}</h3></div><div class="week-head-metrics"><div><small>A pagar</small><b class="negative">${rqMoney(payW)}</b></div><div><small>A receber</small><b class="positive">${rqMoney(recW)}</b></div><div><small>Busca/dia</small><b>${rqMoney(weekDaily)}</b></div></div></div><div class="finance-week-days">${real.map(q=>{const tx=rows.filter(x=>x.date===q.k);const p=tx.filter(x=>x.type==='despesa'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);const r=tx.filter(x=>x.type==='receita'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);const off=rqIsOff(q.k);const isToday=q.k===todayKey;return `<div class="calendar-day ${isToday?'calendar-today':''} ${off?'calendar-day-off':''}"><div class="calendar-day-head"><div><b>${rqDayName[q.d.getDay()]}</b><span>${q.d.getDate().toString().padStart(2,'0')}</span></div><button type="button" class="btn secondary mini" data-toggle-day-off="${q.k}">${off?'Trabalhar':'Folga'}</button></div><div class="calendar-day-values"><span class="negative">${p?rqMoney(p):'—'}</span><span class="positive">${r?rqMoney(r):'—'}</span></div>${tx.length?tx.map(x=>`<div class="calendar-item"><span>${esc(x.person||x.category||'Compromisso')}</span><b class="${x.type==='receita'?'positive':'negative'}">${rqMoney(x.value)}</b></div>`).join(''):'<small class="muted">Sem lançamentos</small>'}</div>`}).join('')}</div><div class="finance-week-footer"><div><small>Total a pagar</small><b class="negative">${rqMoney(payW)}</b></div><div><small>Total a receber</small><b class="positive">${rqMoney(recW)}</b></div><div><small>Folgas</small><b>${real.filter(q=>rqIsOff(q.k)).length}</b></div><div><small>Falta cobrir</small><b>${rqMoney(need)}</b></div><div><small>Buscar por dia</small><b>${rqMoney(weekDaily)}</b><span>${active} dia(s) ativos</span></div></div></section>`;
    }).join('');
    layout('Calendário Financeiro',`<div class="page-intro calendar-intro"><div><span class="eyebrow">FLUXO FINANCEIRO</span><h2>${rqMonthLabel(m)}</h2><p>Semanas de segunda a domingo. Folgas alteram apenas a meta de busca diária.</p></div><div class="month-nav"><button class="btn secondary" data-month-prev>‹</button><b>${rqMonthLabel(m)}</b><button class="btn secondary" data-month-next>›</button></div></div><div class="grid compact-kpis calendar-kpis"><div class="card"><div class="label">Total a pagar</div><div class="value negative">${rqMoney(pay)}</div><small>Compromissos em aberto</small></div><div class="card"><div class="label">Total a receber</div><div class="value positive">${rqMoney(rec)}</div><small>Receitas previstas</small></div><div class="card"><div class="label">Em caixa</div><div class="value">${rqMoney(cash)}</div><small>Disponível hoje</small></div><div class="card highlight calendar-daily-highlight"><div class="label">Busca diária necessária</div><div class="value">${rqMoney(daily)}</div><small>${remaining.length} dia(s) ativos • ${rqOff().filter(x=>monthKey(x)===m).length} folga(s)</small></div></div><div class="calendar-note"><b>Regra:</b> a meta considera o que ainda falta pagar, desconta caixa e receitas previstas e distribui o saldo pelos dias ativos. Domingo permanece como dia de trabalho até ser marcado como folga.</div><div class="finance-weeks">${weeksHtml||'<div class="empty">Nenhum movimento neste mês.</div>'}</div>`);
  };

  /* ---------- LIVRO CAIXA: abertura + taxas + saldo líquido ---------- */
  function rqEnsureCash(){
    db.cashbooks=Array.isArray(db.cashbooks)?db.cashbooks:[];
    let c=db.cashbooks.find(x=>x.date===today());
    if(c){c.entries=Array.isArray(c.entries)?c.entries:[];c.opening=c.opening||{cash:0,pix:0,card:0};return c}
    return null;
  }
  function rqCashTotals(c){const e=c?.entries||[];const ins=e.filter(x=>x.type==='entrada').reduce((a,x)=>a+num(x.netValue??x.value),0),outs=e.filter(x=>x.type==='saida').reduce((a,x)=>a+num(x.value),0);return {ins,outs,net:ins-outs,opening:num(c?.opening?.cash)+num(c?.opening?.pix)+num(c?.opening?.card)};}
  function rqCashOpenDialog(){
    const html=`<div class="modal-overlay open" id="rq-cash-modal"><div class="modal-box cash-open-modal"><button class="modal-close" id="rq-cash-close">×</button><span class="eyebrow">ABERTURA DO CAIXA</span><h2>Abrir caixa de hoje</h2><p>Informe os valores existentes antes de iniciar os lançamentos.</p><form id="rq-open-form" class="form"><div class="field"><label>Dinheiro</label><input id="rq-open-cash" type="number" step="0.01" min="0" value="0"></div><div class="field"><label>Pix</label><input id="rq-open-pix" type="number" step="0.01" min="0" value="0"></div><div class="field"><label>Máquina de cartão</label><input id="rq-open-card" type="number" step="0.01" min="0" value="0"></div><div class="actions full"><button class="btn secondary" type="button" id="rq-cash-cancel">Cancelar</button><button class="btn primary">Abrir Caixa</button></div></form></div></div>`;document.body.insertAdjacentHTML('beforeend',html);const close=()=>document.querySelector('#rq-cash-modal')?.remove();$('#rq-cash-close').onclick=close;$('#rq-cash-cancel').onclick=close;$('#rq-open-form').onsubmit=e=>{e.preventDefault();const c={id:uid(),date:today(),openedAt:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),closedAt:null,opening:{cash:num($('#rq-open-cash').value),pix:num($('#rq-open-pix').value),card:num($('#rq-open-card').value)},entries:[]};db.cashbooks.push(c);save();close();toast('Caixa aberto');cashbook()};
  }
  function rqCashEntryModal(type='entrada'){
    const c=rqEnsureCash();if(!c){toast('Abra o caixa primeiro');rqCashOpenDialog();return}
    const html=`<div class="modal-overlay open" id="rq-entry-modal"><div class="modal-box cash-entry-modal"><button class="modal-close" id="rq-entry-close">×</button><span class="eyebrow">${type==='entrada'?'ENTRADA':'SAÍDA'} DE CAIXA</span><h2>Registrar ${type==='entrada'?'entrada':'saída'}</h2><form id="rq-entry-form" class="form"><div class="field"><label>Forma de pagamento</label><select id="rq-method"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="credito">Cartão de crédito</option><option value="debito">Cartão de débito</option></select></div><div class="field"><label>Modo do valor</label><select id="rq-mode"><option value="net">Quero receber o valor líquido informado</option><option value="gross">O valor informado já é o valor cobrado</option></select></div><div class="field"><label>Valor</label><input id="rq-value" type="number" step="0.01" min="0" required></div><div class="field"><label>Descrição</label><input id="rq-desc" required placeholder="Ex.: venda, pagamento, serviço..."></div><div class="field"><label>Origem / destino</label><input id="rq-source" placeholder="Opcional"></div><div class="field full"><div class="cash-calc" id="rq-calc">Sem acréscimo</div></div><div class="actions full"><button type="button" class="btn secondary" id="rq-entry-cancel">Cancelar</button><button class="btn primary">Registrar</button></div></form></div></div>`;document.body.insertAdjacentHTML('beforeend',html);const close=()=>document.querySelector('#rq-entry-modal')?.remove();$('#rq-entry-close').onclick=close;$('#rq-entry-cancel').onclick=close;const recalc=()=>{const method=$('#rq-method').value,mode=$('#rq-mode').value,v=num($('#rq-value').value);if(type==='saida'){ $('#rq-calc').textContent=`Saída exata: ${rqMoney(v)}`;return }let rate=method==='credito'?0.95:method==='debito'?0.97:1;let gross=mode==='net'?(rate?v/rate:v):v;let net=mode==='net'?v:v*rate;$('#rq-calc').innerHTML=`Cobrar: <b>${rqMoney(gross)}</b> • Receber líquido: <b>${rqMoney(net)}</b>${rate<1?` • Taxa: ${rqMoney(gross-net)}`:''}`};['#rq-method','#rq-mode','#rq-value'].forEach(s=>$(s).addEventListener('input',recalc));['#rq-method','#rq-mode'].forEach(s=>$(s).addEventListener('change',recalc));recalc();$('#rq-entry-form').onsubmit=e=>{e.preventDefault();const method=$('#rq-method').value,v=num($('#rq-value').value),mode=$('#rq-mode').value;let rate=method==='credito'?0.95:method==='debito'?0.97:1;const gross=type==='saida'?v:(mode==='net'?v/rate:v),net=type==='saida'?v:(mode==='net'?v:v*rate),fee=Math.max(0,gross-net);c.entries.push({id:uid(),type,method,grossValue:gross,netValue:net,value:type==='saida'?v:net,fee,description:$('#rq-desc').value.trim(),source:$('#rq-source').value.trim(),time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});save();close();toast('Movimento registrado');cashbook()};
  }
  cashbook=function(){
    const c=rqEnsureCash(); if(!c){layout('Livro Caixa',`<div class="page-intro cash-intro"><div><span class="eyebrow">LIVRO CAIXA</span><h2>Caixa diário</h2><p>Comece informando o dinheiro, Pix e cartão existentes na abertura.</p></div></div><div class="card cash-open-cta"><div><h3>Caixa ainda não aberto</h3><p>Abra o caixa para registrar vendas, entradas e saídas.</p></div><button class="btn primary" id="rq-open-cash">Abrir Caixa</button></div>`);$('#rq-open-cash').onclick=rqCashOpenDialog;return}
    const t=rqCashTotals(c), entries=c.entries||[];const rows=entries.slice().reverse().map(x=>`<tr><td>${esc(x.time||'—')}</td><td><span class="flow-badge ${x.type}">${x.type==='entrada'?'Entrada':'Saída'}</span></td><td>${esc(x.method||'—')}</td><td>${esc(x.description||'—')}</td><td>${esc(x.source||'—')}</td><td>${x.type==='entrada'?`<span class="positive">+ ${rqMoney(x.netValue??x.value)}</span>`:`<span class="negative">− ${rqMoney(x.value)}</span>`}</td><td>${x.fee?rqMoney(x.fee):'—'}</td><td>${c.closedAt?'<span class="pill paid">Fechado</span>':`<button class="btn danger mini" data-rq-del-cash="${x.id}">Excluir</button>`}</td></tr>`).join('');
    layout('Livro Caixa',`<div class="page-intro cash-intro"><div><span class="eyebrow">LIVRO CAIXA DIÁRIO</span><h2>${fmtDate(c.date)}</h2><p>${c.closedAt?'Caixa fechado':'Caixa aberto desde '+esc(c.openedAt)}</p></div><div class="cash-result ${t.net>=0?'positive':'negative'}"><small>SALDO LÍQUIDO</small><b>${rqMoney(t.net)}</b><span>${c.closedAt?'Fechado':'Em aberto'}</span></div></div><div class="grid compact-kpis"><div class="card"><div class="label">Abertura</div><div class="value">${rqMoney(t.opening)}</div><small>Dinheiro ${rqMoney(c.opening.cash)} • Pix ${rqMoney(c.opening.pix)} • Cartão ${rqMoney(c.opening.card)}</small></div><div class="card"><div class="label">Entradas líquidas</div><div class="value positive">${rqMoney(t.ins)}</div></div><div class="card"><div class="label">Saídas</div><div class="value negative">${rqMoney(t.outs)}</div></div><div class="card"><div class="label">Resultado</div><div class="value ${t.net>=0?'positive':'negative'}">${rqMoney(t.net)}</div></div></div><div class="actions"><button class="btn primary" id="rq-new-in" ${c.closedAt?'disabled':''}>+ Entrada</button><button class="btn secondary" id="rq-new-out" ${c.closedAt?'disabled':''}>− Saída</button>${c.closedAt?'':'<button class="btn danger" id="rq-close-cash">Fechar Caixa</button>'}</div><div class="card data-card"><div class="section-head"><div><h3>Movimentações</h3><p>Cartão de crédito: líquido = valor cobrado × 0,95. Débito: líquido = valor cobrado × 0,97.</p></div></div>${rows?table(rows,['Hora','Tipo','Forma','Descrição','Origem / destino','Recebido / Saída','Taxa','Ações']):'<div class="empty">Nenhum movimento registrado.</div>'}</div>`);
    $('#rq-new-in').onclick=()=>rqCashEntryModal('entrada');$('#rq-new-out').onclick=()=>rqCashEntryModal('saida');$('#rq-close-cash')?.addEventListener('click',()=>{if(confirm('Fechar o caixa de hoje? Depois do fechamento os lançamentos não poderão ser alterados.')){c.closedAt=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});c.net=rqCashTotals(c).net;save();toast('Caixa fechado');cashbook()}});document.querySelectorAll('[data-rq-del-cash]').forEach(b=>b.onclick=()=>{if(confirm('Excluir este movimento?')){c.entries=c.entries.filter(x=>x.id!==b.dataset.rqDelCash);save();cashbook()}});
  };

  /* ---------- DÍVIDAS: exclusão parcial + empréstimo com juros ---------- */
  function rqDebtDeleteFuture(id){const d=db.debts.find(x=>x.id===id);if(!d)return;if(!confirm('Excluir somente parcelas futuras desta dívida? Parcelas já pagas serão preservadas.'))return;db.transactions=db.transactions.filter(x=>!(x.debtId===id&&x.status!=='pago'));d.remaining=db.transactions.filter(x=>x.debtId===id&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);d.status=d.remaining>0?'ativo':'quitado';save();toast('Parcelas futuras removidas');debtsExpenses()}
  const rqOldDebtForm=debtForm;
  debtForm=function(id=null){const d=id?db.debts.find(x=>x.id===id):null;layout(d?'Editar Dívida':'Nova Dívida',`<div class="card"><form id="rq-debt-form" class="form"><div class="field"><label>Credor</label><input id="rq-creditor" value="${esc(d?.creditor||'')}" required></div><div class="field"><label>Tipo</label><select id="rq-kind"><option>Instituição</option><option>Pessoa física</option><option>Cartão</option><option>Financiamento</option><option>Outros</option></select></div><div class="field"><label>Valor original</label><input id="rq-dvalue" type="number" step="0.01" min="0" value="${d?.value??''}" required></div><div class="field"><label>Parcelas</label><input id="rq-installments" type="number" min="1" value="${d?.installments||1}" required></div><div class="field"><label>Primeiro vencimento</label><input id="rq-firstdate" type="date" value="${d?.firstDate||today()}" required></div><div class="field"><label>Juros (%)</label><input id="rq-interest" type="number" step="0.01" min="0" value="${d?.interest||0}"></div><div class="field"><label>Forma de pagamento</label><select id="rq-payment-type"><option value="unico">Pagamento único</option><option value="parcelado">Parcelado</option><option value="recorrente">Recorrente</option></select></div><div class="field full"><label>Observação</label><textarea id="rq-dnote">${esc(d?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">${d?'Salvar alterações':'Criar dívida'}</button><button type="button" class="btn secondary" data-view="movimentos">Cancelar</button></div></form></div>`);if(d){$('#rq-kind').value=d.kind||'Instituição';$('#rq-payment-type').value=d.paymentType||'parcelado'}$('#rq-debt-form').onsubmit=e=>{e.preventDefault();const creditor=$('#rq-creditor').value.trim(),kind=$('#rq-kind').value,value=num($('#rq-dvalue').value),parts=Math.max(1,num($('#rq-installments').value)),first=$('#rq-firstdate').value,interest=num($('#rq-interest').value),ptype=$('#rq-payment-type').value,note=$('#rq-dnote').value.trim();const total=value*(1+interest/100),part=ptype==='unico'?total:total/parts,id2=d?.id||uid();const data={id:id2,creditor,kind,value,totalPayable:total,installments:parts,installmentValue:part,firstDate:first,interest,paymentType:ptype,note,remaining:total,status:'ativo',createdAt:d?.createdAt||today()};if(d)db.debts=db.debts.map(x=>x.id===id2?{...x,...data}:x);else db.debts.push(data);db.transactions=db.transactions.filter(x=>x.debtId!==id2||x.status==='pago');if(ptype==='recorrente'){const dt=iso(first);db.transactions.push({id:uid(),date:rqYmd(dt),value:part,category:kind,person:creditor,status:'previsto',type:'despesa',debtId:id2,installment:1,installments:1,paymentType:'recorrente',note})}else{for(let i=0;i<parts;i++){const dt=iso(first);dt.setMonth(dt.getMonth()+i);db.transactions.push({id:uid(),date:rqYmd(dt),value:part,category:kind,person:creditor,status:'previsto',type:'despesa',debtId:id2,installment:i+1,installments:parts,paymentType:ptype,note:`${note} — parcela ${i+1}/${parts}`})}}save();toast(d?'Dívida atualizada':'Dívida criada');debtsExpenses()}}

  const rqOldLoanForm=loanForm;
  loanForm=function(id=null){const l=id?db.loans.find(x=>x.id===id):null;layout(l?'Editar Empréstimo':'Novo Empréstimo',`<div class="card"><div class="loan-warning"><b>Empréstimo</b><span>Informe o valor realmente recebido. Os juros são usados para calcular o total devido.</span></div><form id="rq-loan-form" class="form"><div class="field"><label>Credor / instituição</label><input id="rq-lperson" value="${esc(l?.person||'')}" required></div><div class="field"><label>Valor recebido</label><input id="rq-lvalue" type="number" step="0.01" min="0" value="${l?.value??''}" required></div><div class="field"><label>Juros (%)</label><input id="rq-linterest" type="number" step="0.01" min="0" value="${l?.interestRate||l?.interest||0}"></div><div class="field"><label>Pagamento</label><select id="rq-lmode"><option value="principal_juros">Principal + juros</option><option value="juros">Somente juros</option></select></div><div class="field"><label>Quantidade de parcelas</label><input id="rq-lparts" type="number" min="1" value="${l?.installments||1}" required></div><div class="field"><label>Primeiro vencimento</label><input id="rq-ldate" type="date" value="${l?.firstDate||today()}" required></div><div class="field"><label>Valor da parcela</label><input id="rq-lpart" type="number" step="0.01" value="${l?.installmentValue??''}" readonly></div><div class="field"><label>Total a pagar</label><input id="rq-ltotal" type="number" step="0.01" value="${l?.totalPayable??''}" readonly></div><div class="field full"><label>Observação</label><textarea id="rq-lnote">${esc(l?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">Salvar empréstimo</button><button type="button" class="btn secondary" data-view="movimentos">Cancelar</button></div></form></div>`);const calc=()=>{const p=num($('#rq-lvalue').value),i=num($('#rq-linterest').value),n=Math.max(1,num($('#rq-lparts').value)),mode=$('#rq-lmode').value,total=mode==='juros'?p*i/100*n:p*(1+i/100),part=total/n;$('#rq-lpart').value=part.toFixed(2);$('#rq-ltotal').value=total.toFixed(2)};['#rq-lvalue','#rq-linterest','#rq-lparts','#rq-lmode'].forEach(s=>$(s).addEventListener('input',calc));$('#rq-lmode').addEventListener('change',calc);calc();$('#rq-loan-form').onsubmit=e=>{e.preventDefault();const p=num($('#rq-lvalue').value),interest=num($('#rq-linterest').value),parts=Math.max(1,num($('#rq-lparts').value)),mode=$('#rq-lmode').value,first=$('#rq-ldate').value,total=mode==='juros'?p*interest/100*parts:p*(1+interest/100),part=total/parts,loanId=l?.id||uid(),person=$('#rq-lperson').value.trim();const data={id:loanId,person,value:p,interestRate:interest,interestMode:mode,installments:parts,installmentValue:part,totalPayable:total,firstDate:first,status:l?.status||'recebido',note:$('#rq-lnote').value.trim(),createdAt:l?.createdAt||today()};if(l)db.loans=db.loans.map(x=>x.id===loanId?data:x);else db.loans.push(data);db.transactions=db.transactions.filter(x=>x.loanId!==loanId);if(data.status==='recebido')db.transactions.push({id:uid(),date:today(),value:p,category:'Empréstimo recebido',person,type:'receita',status:'pago',loanId,note:'Valor efetivamente recebido'});for(let i=0;i<parts;i++){const dt=iso(first);dt.setMonth(dt.getMonth()+i);db.transactions.push({id:uid(),date:rqYmd(dt),value:part,category:'Empréstimo',person,status:'previsto',type:'despesa',loanId,installment:i+1,installments:parts,note:`Empréstimo ${loanId} — parcela ${i+1}/${parts}`})}db.debts=db.debts.filter(x=>x.loanId!==loanId);db.debts.push({id:uid(),loanId,creditor:person,kind:'Empréstimo',value:p,totalPayable:total,installments:parts,installmentValue:part,firstDate:first,interest,status:'ativo',remaining:total,note:data.note});save();toast('Empréstimo salvo');debtsExpenses()}}

  /* ---------- CONFIGURAÇÕES: reset financeiro completo ---------- */
  const rqOldConfig=config;
  config=function(){rqOldConfig();const oldReset=$('#reset-data');if(oldReset){const b=oldReset.cloneNode(true);oldReset.replaceWith(b);b.textContent='Restaurar configuração e apagar registros';b.className='btn danger';b.onclick=()=>{const ok=confirm('RESTORE RAQVOR\n\nTodos os registros financeiros deste espaço serão apagados. O histórico de uso do aplicativo não será alterado. Continuar?');if(!ok)return;db={...defaultDB(),settings:{...defaultDB().settings,currency:db.settings.currency||'BRL'}};db.settings.daysOff=[];db.creditors=[];save();toast('Configuração restaurada');setTimeout(()=>render('dashboard'),250)}}}

  /* ---------- bindings adicionais ---------- */
  const rqBind=bindGlobal;
  bindGlobal=function(){rqBind();document.querySelectorAll('[data-toggle-day-off]').forEach(b=>b.onclick=()=>{const k=b.dataset.toggleDayOff;db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];db.settings.daysOff=db.settings.daysOff.includes(k)?db.settings.daysOff.filter(x=>x!==k):[...db.settings.daysOff,k];save();calendar(calendarCursor||currentMonth())});document.querySelectorAll('[data-month-prev]').forEach(b=>b.onclick=()=>{calendarCursor=shiftMonth(calendarCursor||currentMonth(),-1);calendar(calendarCursor)});document.querySelectorAll('[data-month-next]').forEach(b=>b.onclick=()=>{calendarCursor=shiftMonth(calendarCursor||currentMonth(),1);calendar(calendarCursor)});document.querySelectorAll('[data-del-debt-future]').forEach(b=>b.onclick=()=>rqDebtDeleteFuture(b.dataset.delDebtFuture))}

  /* Add partial deletion action to debt tables after every render. */
  const rqDebtExpense=debtsExpenses;
  debtsExpenses=function(){rqDebtExpense.apply(this,arguments);document.querySelectorAll('[data-edit-debt]').forEach(b=>{const d=b.parentElement?.parentElement?.querySelector('td');});document.querySelectorAll('[data-del-debt]').forEach(b=>{const id=b.dataset.delDebt;if(!b.parentElement.querySelector(`[data-del-debt-future="${id}"]`)){b.insertAdjacentHTML('afterend',` <button class="btn secondary mini" data-del-debt-future="${id}">Excluir futuras</button>`)}})};
})();


/* ==========================================================
   RAQVOR V2.16 — DESKTOP FINAL OVERRIDES
   Dashboard preservado. Ajustes: caixa, calendário, dívidas,
   credores, recorrentes, parcelas/edição parcial e restauração.
   ========================================================== */
function toggleDayOff(date){
  db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];
  const i=db.settings.daysOff.indexOf(date);
  if(i>=0) db.settings.daysOff.splice(i,1); else db.settings.daysOff.push(date);
  save(); calendar(calendarCursor);
}
function calendar(m=calendarCursor||currentMonth()){
  calendarCursor=m;
  const first=iso(`${m}-01`);
  const lastDay=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const last=iso(`${m}-${String(lastDay).padStart(2,'0')}`), todayKey=today();
  const monthItems=db.transactions.filter(x=>monthKey(x.date)===m);
  const pendingPay=monthItems.filter(x=>x.type==='despesa'&&x.status!=='pago');
  const totalPay=pendingPay.reduce((a,x)=>a+num(x.value),0);
  const cash=currentBalance();
  const plannedReceipts=monthItems.filter(x=>x.type==='receita'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
  const receivedMonth=monthItems.filter(x=>x.type==='receita'&&x.status==='pago').reduce((a,x)=>a+num(x.value),0);
  const debt=Math.max(0,totalPay-Math.max(0,cash)-plannedReceipts);
  const offDays=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];
  let remainingDays=0;
  const calcStart=monthKey(first)===currentMonth()?iso(todayKey):first;
  for(let d=new Date(calcStart);d<=last;d.setDate(d.getDate()+1)){
    const k=ymd(d); if(!offDays.includes(k)) remainingDays++;
  }
  remainingDays=Math.max(1,remainingDays);
  const dailyNeed=debt/remainingDays;

  // Semanas do calendário: segunda-feira a domingo, recortadas ao mês corrente.
  const weeks=[]; let ws=new Date(first);
  while(ws.getDay()!==1) ws.setDate(ws.getDate()-1);
  while(ws<=last){
    const we=new Date(ws); we.setDate(we.getDate()+6);
    const start=ws<first?new Date(first):new Date(ws);
    const end=we>last?new Date(last):new Date(we);
    weeks.push({start:ymd(start),end:ymd(end),days:dateRange(start,end)});
    ws=new Date(ws); ws.setDate(ws.getDate()+7);
  }

  const weekHtml=weeks.map((w,idx)=>{
    const items=monthItems.filter(x=>x.date>=w.start&&x.date<=w.end);
    const pay=items.filter(x=>x.type==='despesa'&&x.status!=='pago').sort((a,b)=>a.date.localeCompare(b.date));
    const rec=items.filter(x=>x.type==='receita').sort((a,b)=>a.date.localeCompare(b.date));
    const payTotal=pay.reduce((a,x)=>a+num(x.value),0);
    const recPlanned=rec.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
    const recReceived=rec.filter(x=>x.status==='pago').reduce((a,x)=>a+num(x.value),0);
    const available=Math.max(0,cash);
    const weekNeed=Math.max(0,payTotal-available-recReceived-recPlanned);
    const activeDays=w.days.filter(d=>d>=todayKey&&!offDays.includes(d)).length||w.days.filter(d=>!offDays.includes(d)).length||1;
    const weekDaily=weekNeed/Math.max(1,activeDays);
    const rows=[...pay.map(x=>`<div class="calendar-ledger-row"><div class="ledger-value negative">${money(x.value)}</div><div class="ledger-desc"><b>${esc(x.person||x.category||'Pagamento')}</b><span>${fmtDate(x.date)}${x.category&&x.person?` • ${esc(x.category)}`:''}</span></div><div class="ledger-status"><span class="calendar-status ${x.status==='pago'?'paid':'pending'}">${x.status==='pago'?'Pago':'Previsto'}</span></div><div class="ledger-actions"><button class="btn primary mini" data-cal-paid="${x.id}">Marcar como pago</button><button class="btn secondary mini" data-cal-move="${x.id}">Realocar</button><button class="btn secondary mini" data-edit="${x.id}">Editar</button></div></div>`),...rec.map(x=>`<div class="calendar-ledger-row revenue-row"><div class="ledger-value positive">+ ${money(x.value)}</div><div class="ledger-desc"><b>${esc(x.person||x.category||'Receita')}</b><span>${fmtDate(x.date)}${x.category&&x.person?` • ${esc(x.category)}`:''}</span></div><div class="ledger-status"><span class="calendar-status ${x.status==='pago'?'paid':'pending'}">${x.status==='pago'?'Recebido':'Prevista'}</span></div><div class="ledger-actions"><button class="btn secondary mini" data-cal-move="${x.id}">Realocar</button><button class="btn secondary mini" data-edit="${x.id}">Editar</button></div></div>`)].join('');
    return `<section class="finance-week ${w.days.includes(todayKey)?'current':''}">
      <div class="finance-week-head"><div><span class="eyebrow">SEMANA ${idx+1}${w.days.includes(todayKey)?' • ATUAL':''}</span><h3>${fmtDate(w.start)} <span>até</span> ${fmtDate(w.end)}</h3></div><div class="week-head-metrics"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(recPlanned+recReceived)}</b></div><div><small>Busca diária</small><b>${money(weekDaily)}</b></div></div></div>
      <div class="calendar-ledger"><div class="calendar-ledger-head"><span>VALOR</span><span>DESCRIÇÃO</span><span>STATUS</span><span>AÇÃO</span></div>${rows||'<div class="calendar-empty">Nenhum pagamento ou receita registrado nesta semana.</div>'}</div>
      <div class="finance-week-footer"><div><small>Total a pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(recPlanned)}</b></div><div><small>Recebido</small><b class="positive">${money(recReceived)}</b></div><div><small>Busca diária</small><b class="${weekNeed?'negative':'positive'}">${money(weekDaily)}</b></div><div><small>Folgas</small><b>${w.days.filter(d=>offDays.includes(d)).length}</b></div></div>
    </section>`;
  }).join('');

  layout('Calendário Financeiro',`<div class="page-intro calendar-intro"><div><span class="eyebrow">CALENDÁRIO FINANCEIRO</span><h2>${monthName(m)} de ${yearKey(m)}</h2><p>Pagamentos e receitas organizados por semanas de <b>segunda a domingo</b>. Use as ações de cada lançamento para atualizar a programação.</p></div><div class="month-nav"><button class="btn secondary" data-month-prev>‹</button><b>${monthName(m)}</b><button class="btn secondary" data-month-next>›</button></div></div>
  <div class="finance-summary-banner"><div><small>EM CAIXA</small><strong class="${cash>=0?'positive':'negative'}">${money(cash)}</strong></div><div><small>TOTAL A PAGAR</small><strong class="negative">${money(totalPay)}</strong></div><div><small>SALDO DEVEDOR</small><strong class="${debt?'negative':'positive'}">${money(debt)}</strong></div><div><small>ENTRADAS NÃO RECEBIDAS</small><strong class="positive">${money(plannedReceipts)}</strong></div><div class="featured"><small>BUSCA DIÁRIA</small><strong>${money(dailyNeed)}</strong><span>${remainingDays} dias disponíveis para busca</span></div></div>
  <div class="calendar-note"><b>Regra:</b> o calendário é dividido de segunda a domingo. Um dia só deixa de participar da busca quando for marcado como folga. O valor da busca é recalculado conforme caixa, receitas e pagamentos.</div>
  <div class="finance-weeks">${weekHtml||'<div class="empty">Nenhum movimento neste mês.</div>'}</div>`);

  document.querySelectorAll('[data-cal-paid]').forEach(btn=>btn.onclick=()=>{
    const tx=db.transactions.find(x=>x.id===btn.dataset.calPaid); if(!tx)return;
    if(!confirm(`Marcar ${money(tx.value)} como pago e deduzir do caixa?`))return;
    tx.status='pago'; save(); toast('Pagamento marcado como pago e deduzido do caixa.'); calendar(calendarCursor);
  });
  document.querySelectorAll('[data-cal-move]').forEach(btn=>btn.onclick=()=>{
    const tx=db.transactions.find(x=>x.id===btn.dataset.calMove); if(!tx)return;
    const options=weeks.map((w,i)=>`${i+1}: ${fmtDate(w.start)} até ${fmtDate(w.end)}`).join('\n');
    const choice=prompt(`Escolha a semana para realocar:\n\n${options}\n\nDigite o número da semana:`);
    const n=Number(choice); if(!Number.isInteger(n)||n<1||n>weeks.length)return;
    const target=weeks[n-1];
    const original=iso(tx.date); const day=original.getDay();
    let newDate=iso(target.start); newDate.setDate(newDate.getDate()+Math.min(Math.max(day-1,0),6));
    if(newDate>iso(target.end))newDate=iso(target.end);
    tx.date=ymd(newDate); tx.weekAssigned=weekOf(tx.date); save(); toast(`Lançamento realocado para ${fmtDate(tx.date)}.`); calendar(calendarCursor);
  });
}
function deleteDebtInstallment(txId){
  const tx=db.transactions.find(x=>x.id===txId); if(!tx)return;
  if(!confirm(`Excluir somente a parcela de ${money(tx.value)} com vencimento em ${fmtDate(tx.date)}?`))return;
  const debtId=tx.debtId||tx.loanId;
  db.transactions=db.transactions.filter(x=>x.id!==txId);
  if(debtId){
    const d=db.debts.find(x=>x.id===debtId); if(d){d.remaining=Math.max(0,num(d.remaining??d.totalPayable)-num(tx.value));d.updatedAt=today();}
    const l=db.loans.find(x=>x.id===debtId); if(l)l.remaining=Math.max(0,num(l.remaining??l.totalPayable)-num(tx.value));
  }
  save();toast('Parcela excluída. O saldo restante foi recalculado.');debtsExpenses('overview');
}
function debtsExpenses(mode='overview'){
  creditorRecords();
  if(mode==='cartoes')return cardPage();
  if(mode==='recorrentes')return recurring();
  if(mode==='creditors'){
    const cards=(db.creditors||[]).map(c=>{const tx=db.transactions.filter(x=>(x.person||'').trim().toLowerCase()===c.name.trim().toLowerCase()&&x.type==='despesa');const monthly=tx.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);const total=tx.reduce((a,x)=>a+num(x.value),0);return `<button class="creditor-card" data-creditor="${esc(c.id)}"><div><span class="creditor-avatar">${esc(c.name.charAt(0).toUpperCase())}</span><span><b>${esc(c.name)}</b><small>${esc(c.type||'Credor')}</small></span></div><strong>${money(monthly)}<small>em aberto</small></strong><em>${tx.length} lançamentos</em></button>`}).join('');
    const vals=(db.creditors||[]).map(c=>debtTotalsForCreditor(c.name).monthly);const max=Math.max(1,...vals);
    layout('Credores',`<div class="section-head"><div><span class="eyebrow">DÍVIDAS E DESPESAS</span><h2>Credores</h2><p>Cada pessoa ou instituição possui sua própria visão. Dívidas com datas diferentes permanecem separadas.</p></div><button class="btn primary" data-new-creditor>+ Novo credor</button></div><div class="debt-tabs"><button class="tab" data-dd-tab="overview">Visão geral</button><button class="tab active" data-dd-tab="creditors">Credores</button><button class="tab" data-view="recorrentes">Recorrentes</button><button class="tab" data-view="cartoes">Cartões de crédito</button></div><div class="creditor-list">${cards||'<div class="empty">Nenhum credor cadastrado.</div>'}</div><div class="card debt-chart"><div class="section-head"><div><h3>Concentração mensal por credor</h3><p>Quanto cada credor representa no período atual.</p></div></div>${(db.creditors||[]).sort((a,b)=>debtTotalsForCreditor(b.name).monthly-debtTotalsForCreditor(a.name).monthly).slice(0,10).map(c=>{const v=debtTotalsForCreditor(c.name).monthly;return `<div class="bar-row"><span>${esc(c.name)}</span><div><i style="width:${Math.min(100,v/max*100)}%"></i></div><b>${money(v)}</b></div>`}).join('')}</div>`);return;
  }
  const tx=db.transactions.filter(x=>x.type==='despesa').sort((a,b)=>a.date.localeCompare(b.date));
  const open=tx.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);const recurringOpen=(db.recurring||[]).filter(x=>x.active&&x.type==='despesa').reduce((a,x)=>a+num(x.value),0);const finished=(db.debts||[]).filter(d=>debtRemaining(d.id)<=0).length;
  const rows=tx.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.person||x.category||'—')}</td><td>${esc(x.category||'—')}</td><td>${money(x.value)}</td><td>${statusPill(x.status,x.priority)}</td><td><button class="btn secondary mini" data-edit="${x.id}">Editar</button> <button class="btn danger mini" data-del="${x.id}">Excluir</button>${x.debtId||x.loanId?` <button class="btn danger mini" data-del-parcel="${x.id}">Excluir parcela</button>`:''}</td></tr>`).join('');
  layout('Dívidas e Despesas',`<div class="hero premium-hero"><div><small>CONTROLE DE COMPROMISSOS</small><h2>Tudo que existe a pagar, organizado.</h2><small>Parcelados, empréstimos, recorrentes e credores em estruturas separadas.</small></div><div class="side"><small>EM ABERTO</small><br><b>${money(open)}</b><br><small>${finished} dívidas quitadas</small></div></div><div class="debt-kpi-grid"><div class="card"><span>Com prazo</span><b>${money(Math.max(0,open-recurringOpen))}</b><small>parcelados e compromissos com término</small></div><div class="card"><span>Recorrentes</span><b>${money(recurringOpen)}</b><small>sem prazo de término</small></div><div class="card"><span>Credores</span><b>${db.creditors.length}</b><small>pessoas e instituições</small></div><div class="card"><span>Total em aberto</span><b>${money(open)}</b><small>parcelas ainda não pagas</small></div></div><div class="actions"><button class="btn primary" data-register-debt>+ Registrar pagamento ou dívida</button><button class="btn secondary" data-new-creditor>+ Novo credor</button><button class="btn secondary" data-view="cartoes">Cartões de crédito</button></div><div class="debt-tabs"><button class="tab active" data-dd-tab="overview">Visão geral</button><button class="tab" data-dd-tab="creditors">Credores</button><button class="tab" data-view="recorrentes">Recorrentes</button><button class="tab" data-view="cartoes">Cartões</button></div><div class="card"><div class="section-head"><div><h3>Pagamentos e parcelas</h3><p>A data de vencimento é a data de pagamento usada pelo Calendário Financeiro.</p></div></div>${table(rows,['Vencimento','Credor','Categoria','Valor','Status','Ações'])}</div>`);
}
function loanForm(id=null){
  const l=id?db.loans.find(x=>x.id===id):null;
  layout(l?'Editar Empréstimo':'Novo Empréstimo',`<div class="card"><div class="loan-warning"><b>Empréstimo e dívida são registrados juntos.</b><span>Informe o valor efetivamente recebido, juros e a forma de pagamento. O sistema gera as parcelas com os vencimentos informados.</span></div><form id="loan-form" class="form"><div class="field"><label>Credor / instituição</label><input id="lperson" value="${esc(l?.person||'')}" required></div><div class="field"><label>Cartão, se aplicável</label><select id="lcard">${cardOptions(l?.cardId||'')}</select></div><div class="field"><label>Valor efetivamente recebido</label><input id="lvalue" type="number" step="0.01" min="0" value="${l?.value??''}" required></div><div class="field"><label>Juros do empréstimo (%)</label><input id="linterest" type="number" step="0.01" min="0" value="${l?.interestRate??0}"></div><div class="field"><label>Forma de pagamento</label><select id="lpaymentType"><option value="principal_interest">Principal + juros parcelados</option><option value="interest_only">Somente juros</option><option value="total_at_end">Total no vencimento</option></select></div><div class="field"><label>Quantidade de parcelas / períodos</label><input id="lparts" type="number" min="1" value="${l?.installments||1}" required></div><div class="field"><label>Valor da parcela</label><input id="lpartvalue" type="number" step="0.01" min="0" value="${l?.installmentValue??''}" required></div><div class="field"><label>Total estimado a pagar</label><input id="ltotal" type="number" step="0.01" value="${l?.totalPayable??''}" readonly></div><div class="field"><label>Primeiro vencimento</label><input id="ldate" type="date" value="${l?.firstDate||today()}" required></div><div class="field"><label>Fonte do pagamento</label><input id="lpayfrom" value="${esc(l?.paymentSource||'')}" placeholder="Conta, banco, caixa..."></div><div class="field"><label>Status</label><select id="lstatus"><option value="previsto">Previsto</option><option value="recebido">Já recebido</option></select></div><div class="field full"><label>Observação</label><textarea id="lnote">${esc(l?.note||'')}</textarea></div><div class="actions full"><button class="btn primary">Salvar empréstimo</button><button type="button" class="btn secondary" data-view="movimentos">Cancelar</button></div></form></div>`);
  if(l)$('#lpaymentType').value=l.paymentType||'principal_interest';
  const recalc=()=>{const principal=num($('#lvalue').value),rate=num($('#linterest').value)/100,parts=Math.max(1,num($('#lparts').value)),type=$('#lpaymentType').value;let total=principal*(1+rate);let part=total/parts;if(type==='interest_only'){part=principal*rate;total=part*parts+principal}else if(type==='total_at_end'){part=0;total=principal*(1+rate)}if(num($('#lpartvalue').value)>0&&type==='principal_interest')part=num($('#lpartvalue').value);$('#lpartvalue').value=part.toFixed(2);$('#ltotal').value=total.toFixed(2)};
  ['#lvalue','#linterest','#lparts','#lpaymentType'].forEach(s=>$(s).addEventListener('input',recalc));recalc();
  $('#loan-form').onsubmit=e=>{e.preventDefault();const value=num($('#lvalue').value),rate=num($('#linterest').value),parts=Math.max(1,num($('#lparts').value)),part=num($('#lpartvalue').value),type=$('#lpaymentType').value;let total=num($('#ltotal').value);const person=$('#lperson').value.trim(),cardId=$('#lcard').value||null,firstDate=$('#ldate').value,paymentSource=$('#lpayfrom').value.trim(),status=$('#lstatus').value,note=$('#lnote').value;const lid=l?.id||uid();const data={id:lid,person,value,interestRate:rate,paymentType:type,installments:parts,installmentValue:part,totalPayable:total,remaining:total,firstDate,status,cardId,paymentSource,note,createdAt:l?.createdAt||today()};if(l){db.loans=db.loans.map(x=>x.id===lid?data:x)}else db.loans.push(data);db.transactions=db.transactions.filter(x=>x.loanId!==lid);if(status==='recebido')db.transactions.push({id:uid(),date:today(),value,category:'Empréstimo recebido',person,cardId,paymentSource,status:'pago',type:'receita',loanId:lid,loanPrincipal:true});const base=iso(firstDate);for(let i=0;i<parts;i++){const dt=new Date(base);dt.setMonth(dt.getMonth()+i);let v=part;if(type==='interest_only')v=part+(i===parts-1?value:0);if(type==='total_at_end')v=i===parts-1?total:0;if(v<=0)continue;db.transactions.push({id:uid(),date:ymd(dt),value:v,category:'Empréstimo',person,cardId,paymentSource,status:'previsto',weekAssigned:weekOf(dt),note:`Empréstimo ${lid} — período ${i+1}/${parts}`,type:'despesa',loanId:lid,installment:i+1})}db.debts=db.debts.filter(d=>d.loanId!==lid);db.debts.push({id:uid(),loanId:lid,cardId,creditor:person,kind:'Empréstimo',value,totalPayable:total,installments:parts,installmentValue:part,firstDate,status:status==='recebido'?'ativo':'previsto',remaining:total,paymentSource,interestRate:rate,paymentType:type,createdAt:today()});save();toast('Empréstimo registrado e parcelas geradas.');debtsExpenses('overview')};
}
function config(){
  layout('Configurações',`<div class="settings-shell"><div class="settings-intro"><div><span>RAQVOR</span><h2>Configurações</h2><p>O nome RAQVOR é imutável. As demais configurações controlam a organização financeira.</p></div><div class="settings-badge">● Supabase sincronizado</div></div><form id="cfg" class="settings-grid"><section class="settings-card"><div class="settings-card-head"><div class="settings-icon">R</div><div><h3>Identidade e moeda</h3><p>Nome fixo e moeda usada nos cálculos.</p></div></div><div class="form settings-form"><div class="field"><label>Nome do aplicativo</label><input value="RAQVOR" disabled></div><div class="field"><label>Moeda</label><select id="currency"><option value="BRL">R$ — Real brasileiro</option><option value="USD">$ — Dólar americano</option><option value="EUR">€ — Euro</option></select></div></div></section><section class="settings-card"><div class="settings-card-head"><div class="settings-icon">◎</div><div><h3>Ciclo financeiro</h3><p>O início e a duração podem ser ajustados pelo usuário.</p></div></div><div class="form settings-form"><div class="field"><label>Primeiro dia do ciclo</label><input id="cycleStart" type="number" min="1" max="31" value="${db.settings.cycleStart||1}"></div><div class="field"><label>Período</label><select id="cycleLength"><option value="5">5 dias</option><option value="7">Semanal — 7 dias</option><option value="15">Quinzenal — 15 dias</option><option value="30">Mensal — 30 dias</option></select></div></div></section><section class="settings-card"><div class="settings-card-head"><div class="settings-icon">✓</div><div><h3>Folgas</h3><p>Folgas retiram o dia da divisão da busca diária.</p></div></div><div class="field"><label>Datas de folga</label><input id="daysOff" value="${esc((db.settings.daysOff||[]).join(', '))}" placeholder="2026-08-31, 2026-09-07"></div></section><section class="settings-card danger-zone"><div class="settings-card-head"><div class="settings-icon">!</div><div><h3>Restaurar configuração</h3><p>Apaga os registros financeiros e mantém somente o histórico técnico de uso do aplicativo.</p></div></div><button type="button" class="btn danger" id="restore-all">Restaurar RAQVOR</button></section><div class="actions full"><button class="btn primary">Salvar configurações</button></div></form></div>`);
  $('#currency').value=db.settings.currency||'BRL';$('#cycleLength').value=String(db.settings.cycleLength||30);
  $('#cfg').onsubmit=e=>{e.preventDefault();db.settings.currency=$('#currency').value;db.settings.cycleStart=Math.min(31,Math.max(1,num($('#cycleStart').value)||1));db.settings.cycleLength=num($('#cycleLength').value)||30;db.settings.daysOff=$('#daysOff').value.split(',').map(x=>x.trim()).filter(Boolean);save();toast('Configurações salvas.');render('config')};
  $('#restore-all').onclick=async()=>{if(!confirm('ATENÇÃO: isso apagará receitas, despesas, dívidas, empréstimos, cartões, recorrentes, credores e livros caixa. O registro técnico de uso será preservado. Continuar?'))return;const usage=db.usage;db=defaultDB();if(usage!==undefined)db.usage=usage;save();try{await syncNow()}catch(e){console.error(e)}toast('RAQVOR restaurado.');render('dashboard')};
}

(function(){
 const oldBind=bindGlobal;
 bindGlobal=function(){oldBind();document.querySelectorAll('[data-toggle-dayoff]').forEach(b=>b.onclick=()=>toggleDayOff(b.dataset.toggleDayoff));document.querySelectorAll('[data-del-parcel]').forEach(b=>b.onclick=()=>deleteDebtInstallment(b.dataset.delParcel));document.querySelectorAll('[data-register-debt]').forEach(b=>b.onclick=registerDebtExpenseDialog);document.querySelectorAll('[data-new-creditor]').forEach(b=>b.onclick=()=>creditorForm());document.querySelectorAll('[data-creditor]').forEach(b=>b.onclick=()=>creditorDetail(b.dataset.creditor));};
})();

/* ============================================================
   RAQVOR V2.17 — CALENDÁRIO FINANCEIRO FINAL
   - Semana operacional: segunda → domingo
   - Exibe somente registros (não cria uma grade por dia)
   - Receita prevista reduz a necessidade de busca
   - Receita recebida entra no caixa via currentBalance()
   - Pagamento pode ser marcado como pago e perguntar se deve
     consumir o valor disponível/caixa
   - Realocação de pagamentos dentro do mês
   - Folgas continuam editáveis em uma janela própria
   ============================================================ */
(function(){
  const oldTxAmount=txAmount;
  txAmount=function(x){
    if(x?.type==='despesa' && x.status==='pago' && x.cashDeducted===false) return 0;
    return oldTxAmount(x);
  };

  function rq17MonthDays(m){
    const [y,mo]=m.split('-').map(Number); const last=new Date(y,mo,0,12); const out=[];
    for(let i=1;i<=last.getDate();i++){const d=new Date(y,mo-1,i,12);out.push(ymd(d));}
    return out;
  }
  function rq17Weeks(m){
    const days=rq17MonthDays(m), set=new Set(days), out=[];
    if(!days.length)return out;
    let start=iso(days[0]); start.setDate(start.getDate()-((start.getDay()+6)%7));
    const last=iso(days[days.length-1]);
    while(start<=last){
      const end=new Date(start);end.setDate(end.getDate()+6);
      const inMonth=[];for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const k=ymd(d);if(set.has(k))inMonth.push(k)}
      if(inMonth.length)out.push({start:inMonth[0],end:inMonth[inMonth.length-1],days:inMonth});
      start=new Date(start);start.setDate(start.getDate()+7);
    }
    return out;
  }
  function rq17PendingPayments(rows){return rows.filter(x=>x.type==='despesa'&&x.status!=='pago');}
  function rq17PendingRevenue(rows){return rows.filter(x=>x.type==='receita'&&x.status!=='pago');}
  function rq17RecordHtml(x){
    const isRec=x.type==='receita';
    const status=x.status==='pago'?(isRec?'Recebida':'Paga'):(x.status==='atrasado'?'Atrasada':'Prevista');
    return `<div class="calendar-record ${isRec?'record-revenue':'record-payment'}" data-calendar-record="${x.id}">
      <div class="calendar-record-date"><b>${fmtDate(x.date)}</b><small>${esc(new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(iso(x.date)).replace('.',''))}</small></div>
      <div class="calendar-record-main"><strong>${esc(x.person||x.category|| (isRec?'Receita':'Pagamento'))}</strong><span>${esc(x.category||'')} ${x.installment?`• parcela ${x.installment}${x.installments?'/'+x.installments:''}`:''}</span></div>
      <div class="calendar-record-value ${isRec?'positive':'negative'}">${isRec?'+':'−'} ${money(x.value)}</div>
      <div class="calendar-record-status">${statusPill(x.status,x.priority)}</div>
      <div class="calendar-record-actions">${!isRec&&x.status!=='pago'?`<button class="btn primary mini" data-calendar-pay="${x.id}">Marcar pago</button>`:''}<button class="btn secondary mini" data-calendar-move="${x.id}">Realocar</button><button class="btn secondary mini" data-edit="${x.id}">Editar</button></div>
    </div>`;
  }

  calendar=function(m=calendarCursor||currentMonth()){
    calendarCursor=m;
    const rows=(db.transactions||[]).filter(x=>monthKey(x.date)===m);
    const payments=rq17PendingPayments(rows);
    const pendingRevenue=rq17PendingRevenue(rows);
    const totalPay=payments.reduce((a,x)=>a+num(x.value),0);
    const receivedRevenue=rows.filter(x=>x.type==='receita'&&x.status==='pago').reduce((a,x)=>a+num(x.value),0);
    const cash=Math.max(0,currentBalance());
    /* Receita futura é uma fonte prevista; receita já recebida já está refletida no caixa. */
    const available=cash+pendingRevenue.reduce((a,x)=>a+num(x.value),0);
    const debt=Math.max(0,totalPay-available);
    const todayKey=today();
    const monthDays=rq17MonthDays(m);
    const activeDays=monthDays.filter(k=>(m!==currentMonth()||k>=todayKey)&&!(db.settings.daysOff||[]).includes(k));
    const remaining=Math.max(0,activeDays.length);
    const daily=remaining?debt/remaining:0;
    const weeks=rq17Weeks(m);
    const weeksHtml=weeks.map((w,wi)=>{
      const items=rows.filter(x=>w.days.includes(x.date)).sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='despesa'? -1:1));
      const pay=items.filter(x=>x.type==='despesa'&&x.status!=='pago');
      const rec=items.filter(x=>x.type==='receita');
      const payTotal=pay.reduce((a,x)=>a+num(x.value),0);
      const recTotal=rec.reduce((a,x)=>a+num(x.value),0);
      const recPending=rec.filter(x=>x.status!=='pago').reduce((a,x)=>a+num(x.value),0);
      const weekOff=w.days.filter(k=>(db.settings.daysOff||[]).includes(k)).length;
      const weekActive=w.days.filter(k=>(m!==currentMonth()||k>=todayKey)&&!(db.settings.daysOff||[]).includes(k)).length;
      const weekNeed=Math.max(0,payTotal-recPending-(wi===0?cash:0));
      const weekDaily=weekActive?weekNeed/weekActive:0;
      const current=w.days.includes(todayKey);
      return `<section class="finance-week ${current?'current':''}">
        <div class="finance-week-head">
          <div><span class="eyebrow">${current?'SEMANA ATUAL':'SEMANA '+(wi+1)}</span><h3>${fmtDate(w.start)} <span>até</span> ${fmtDate(w.end)}</h3></div>
          <div class="week-head-metrics"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(recTotal)}</b></div><div><small>Busca/dia</small><b>${money(weekDaily)}</b></div></div>
        </div>
        <div class="calendar-week-toolbar"><span>${items.length} registro(s) · ${weekOff} folga(s)</span><button class="btn secondary mini" data-calendar-folgas="${w.start}|${w.end}">Gerenciar folgas</button></div>
        <div class="calendar-record-list">${items.length?items.map(rq17RecordHtml).join(''):'<div class="empty">Nenhum pagamento ou receita registrado nesta semana.</div>'}</div>
        <div class="finance-week-footer"><div><small>Total a pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(recTotal)}</b></div><div><small>Receitas previstas</small><b class="positive">${money(recPending)}</b></div><div><small>Folgas</small><b>${weekOff}</b></div><div><small>Busca diária</small><b>${money(weekDaily)}</b><span>${weekActive} dia(s) ativos</span></div></div>
      </section>`;
    }).join('');

    layout('Calendário Financeiro',`<div class="page-intro calendar-intro"><div><span class="eyebrow">CALENDÁRIO FINANCEIRO</span><h2>${monthName(m)} de ${yearKey(m)}</h2><p>Semanas de segunda a domingo. A página mostra somente pagamentos e receitas; os dias individuais ficam disponíveis apenas para administrar folgas.</p></div><div class="month-nav"><button class="btn secondary" data-month-prev>‹</button><b>${monthName(m)}</b><button class="btn secondary" data-month-next>›</button></div></div>
      <div class="finance-summary-banner calendar-summary-v217"><div><small>EM CAIXA</small><strong class="positive">${money(cash)}</strong></div><div><small>TOTAL A PAGAR</small><strong class="negative">${money(totalPay)}</strong></div><div><small>RECEITAS PREVISTAS</small><strong class="positive">${money(pendingRevenue.reduce((a,x)=>a+num(x.value),0))}</strong></div><div><small>SALDO DEVEDOR</small><strong class="${debt?'negative':'positive'}">${money(debt)}</strong></div><div class="featured"><small>BUSCA DIÁRIA</small><strong>${money(daily)}</strong><span>${remaining} dia(s) ativos</span></div></div>
      <div class="calendar-note"><b>Como funciona:</b> o total a pagar é reduzido pelo dinheiro disponível em caixa e pelas receitas ainda previstas. Quando uma receita é registrada como recebida, ela passa a compor o caixa e o calendário se recalcula automaticamente. Ao marcar um pagamento como pago, o RAQVOR pergunta se o valor deve ser deduzido do caixa disponível.</div>
      <div class="finance-weeks">${weeksHtml||'<div class="empty">Nenhum movimento neste mês.</div>'}</div>`);
  };

  function openMoveModal(id){
    const x=db.transactions.find(t=>t.id===id); if(!x)return;
    const month=calendarCursor||currentMonth();
    const html=`<div class="modal-overlay open" id="rq17-move-modal"><div class="modal-box calendar-action-modal"><button class="modal-close" id="rq17-move-close">×</button><span class="eyebrow">REALOCAR REGISTRO</span><h2>${x.type==='receita'?'Receita':'Pagamento'}</h2><p>${esc(x.person||x.category||'Registro')} · ${money(x.value)}</p><form id="rq17-move-form" class="form"><div class="field"><label>Nova data dentro de ${monthName(month)}</label><input id="rq17-move-date" type="date" value="${x.date}" min="${month}-01" max="${month}-${String(new Date(iso(month+'-01').getFullYear(),iso(month+'-01').getMonth()+1,0).getDate()).padStart(2,'0')}" required></div><div class="actions full"><button type="button" class="btn secondary" id="rq17-move-cancel">Cancelar</button><button class="btn primary">Salvar nova data</button></div></form></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);const close=()=>$('#rq17-move-modal')?.remove();$('#rq17-move-close').onclick=close;$('#rq17-move-cancel').onclick=close;
    $('#rq17-move-form').onsubmit=e=>{e.preventDefault();const d=$('#rq17-move-date').value;if(monthKey(d)!==month){toast('A realocação deve permanecer no mês selecionado.');return}x.date=d;x.weekAssigned=weekOf(d);x.manuallyRelocated=true;save();close();toast('Registro realocado.');calendar(month)};
  }
  function openPayModal(id){
    const x=db.transactions.find(t=>t.id===id);if(!x||x.status==='pago')return;
    const html=`<div class="modal-overlay open" id="rq17-pay-modal"><div class="modal-box calendar-action-modal"><button class="modal-close" id="rq17-pay-close">×</button><span class="eyebrow">CONFIRMAR PAGAMENTO</span><h2>Marcar como pago?</h2><p>${esc(x.person||x.category||'Pagamento')} · <b>${money(x.value)}</b></p><p class="modal-question">Deseja também deduzir este valor do dinheiro disponível/caixa?</p><div class="actions"><button class="btn secondary" id="rq17-pay-no">Não, só marcar como pago</button><button class="btn primary" id="rq17-pay-yes">Sim, deduzir do caixa</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);const close=()=>$('#rq17-pay-modal')?.remove();$('#rq17-pay-close').onclick=close;
    const finish=(deduct)=>{x.status='pago';x.cashDeducted=deduct; x.paidAt=new Date().toISOString(); save(); close(); toast(deduct?'Pagamento marcado como pago e deduzido do caixa.':'Pagamento marcado como pago sem deduzir do caixa.'); calendar(calendarCursor||currentMonth())};
    $('#rq17-pay-no').onclick=()=>finish(false);$('#rq17-pay-yes').onclick=()=>finish(true);
  }
  function openFolgasModal(range){
    const [start,end]=range.split('|'), ds=[];let d=iso(start),e=iso(end);while(d<=e){ds.push(ymd(d));d.setDate(d.getDate()+1)}
    const html=`<div class="modal-overlay open" id="rq17-off-modal"><div class="modal-box calendar-action-modal"><button class="modal-close" id="rq17-off-close">×</button><span class="eyebrow">FOLGAS DA SEMANA</span><h2>Escolha os dias sem trabalho</h2><p>Somente as folgas marcadas deixam de entrar no cálculo da busca diária.</p><div class="calendar-off-list">${ds.map(k=>`<label class="off-check"><input type="checkbox" data-off-check="${k}" ${(db.settings.daysOff||[]).includes(k)?'checked':''}><span>${new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(iso(k))}</span><b>${fmtDate(k)}</b></label>`).join('')}</div><div class="actions"><button class="btn primary" id="rq17-off-save">Salvar folgas</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);const close=()=>$('#rq17-off-modal')?.remove();$('#rq17-off-close').onclick=close;
    $('#rq17-off-save').onclick=()=>{db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];ds.forEach(k=>{const checked=document.querySelector(`[data-off-check="${k}"]`)?.checked;if(checked&&!db.settings.daysOff.includes(k))db.settings.daysOff.push(k);if(!checked)db.settings.daysOff=db.settings.daysOff.filter(x=>x!==k)});save();close();toast('Folgas atualizadas.');calendar(calendarCursor||currentMonth())};
  }

  const prevBind=bindGlobal;
  bindGlobal=function(){prevBind();
    document.querySelectorAll('[data-calendar-pay]').forEach(b=>b.onclick=()=>openPayModal(b.dataset.calendarPay));
    document.querySelectorAll('[data-calendar-move]').forEach(b=>b.onclick=()=>openMoveModal(b.dataset.calendarMove));
    document.querySelectorAll('[data-calendar-folgas]').forEach(b=>b.onclick=()=>openFolgasModal(b.dataset.calendarFolgas));
  };
})();
