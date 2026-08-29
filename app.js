let KEY='finance_nexora_v1';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const num=n=>Number(n)||0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=(d)=>{if(d instanceof Date)return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);if(!d)return new Date(NaN);const s=String(d).slice(0,10);return new Date(`${s}T12:00:00`)};
function defaultDB(){return{balance:0,transactions:[],debts:[],cards:[],loans:[],recurring:[],cashbooks:[],categories:{receita:['Salário','Trabalho','Freelance','Investimentos','Outros'],despesa:['Moradia','Alimentação','Transporte','Saúde','Educação','Lazer','Assinaturas','Cartões','Empréstimos','Impostos','Outros']},settings:{theme:'light',project:'Gestão financeira NEXORA',weekMode:'seg-sex'}}}
let db=(()=>{try{return JSON.parse(localStorage.getItem(KEY))||defaultDB()}catch{return defaultDB()}})();
const SUPABASE_URL='https://zowmlsusgnzqskuplxcu.supabase.co';
const SUPABASE_KEY='sb_publishable_vkoEbQBCeSDsoFRZxJ4VoA_gVWhQf5M';
let supabaseClient=null;
let supabaseWorkspaceId=null;
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
  realtimeChannel=supabaseClient.channel('nexora-app-state-'+supabaseWorkspaceId)
    .on('postgres_changes',{event:'*',schema:'public',table:'app_state',filter:`workspace_id=eq.${supabaseWorkspaceId}`},payload=>{
      const row=payload.new||null;
      if(!row||!row.state)return;
      const remoteTime=row.updated_at||'';
      if(syncDirty && remoteTime!==lastRemoteUpdatedAt)return;
      if(!lastRemoteUpdatedAt || remoteTime>=lastRemoteUpdatedAt){
        applyRemoteState(row.state,remoteTime);
        syncDirty=false;
        setSyncStatus('V1.15 • Supabase sincronizado',true);
        render(view);
      }
    })
    .subscribe(status=>{
      if(status==='SUBSCRIBED')setSyncStatus('V1.15 • Supabase conectado',true);
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
  box.innerHTML=`<div class="auth-shell"><div class="auth-brand"><img src="./assets/nexora-finance-logo.png" alt="Gestão financeira NEXORA"><span>GESTÃO FINANCEIRA NEXORA</span></div><div class="auth-card"><div class="auth-kicker">${isReg?'COMECE SEU CONTROLE':'BEM-VINDO DE VOLTA'}</div><h1>${isReg?'Criar sua conta':'Entrar no NEXORA'}</h1><p class="auth-sub">${isReg?'Cadastre seu e-mail, telefone e crie sua senha. O telefone ficará vinculado ao seu perfil.':'Acesse suas finanças em qualquer dispositivo.'}</p>${message?`<div class="auth-alert">${esc(message)}</div>`:''}<form id="auth-form" class="auth-form">${isReg?`<label>Nome completo<input id="auth-name" autocomplete="name" required placeholder="Seu nome"></label>`:''}<label>E-mail<input id="auth-email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></label>${isReg?`<label>Número de celular<input id="auth-phone" inputmode="tel" autocomplete="tel" required placeholder="(81) 99999-9999"></label>`:''}<label>Senha<input id="auth-password" type="password" minlength="6" autocomplete="${isReg?'new-password':'current-password'}" required placeholder="Mínimo de 6 caracteres"></label>${isReg?`<label>Confirmar senha<input id="auth-password2" type="password" minlength="6" autocomplete="new-password" required placeholder="Repita sua senha"></label>`:''}<button class="btn primary auth-submit" type="submit">${isReg?'Criar conta':'Entrar'}</button></form><div class="auth-switch">${isReg?'Já possui uma conta?':'Ainda não possui uma conta?'} <button type="button" id="auth-switch">${isReg?'Entrar':'Criar conta'}</button></div></div><div class="auth-foot">Seus dados financeiros ficam vinculados à sua conta no Supabase.</div></div>`;
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
    }catch(err){console.error('[NEXORA][AUTH]',err);showAuth(isReg?'register':'login',authErrorMessage(err));}
    finally{const b=document.querySelector('.auth-submit');if(b){b.disabled=false;b.textContent=isReg?'Criar conta':'Entrar'}}
  };
}
function showUserMenu(user){
  const side=document.querySelector('#sidebar'); if(!side)return;
  let el=document.querySelector('#user-panel');
  if(!el){el=document.createElement('div');el.id='user-panel';side.insertBefore(el,side.querySelector('.side-foot'));}
  const name=esc(user?.user_metadata?.full_name||'Usuário NEXORA');
  const phone=esc(user?.user_metadata?.phone||user?.phone||'');
  el.innerHTML=`<div class="user-avatar">${name.charAt(0).toUpperCase()}</div><div class="user-meta"><b>${name}</b><small>${phone}</small></div><button id="logout-btn" title="Sair">↪</button>`;
  document.querySelector('#logout-btn').onclick=async()=>{await supabaseClient.auth.signOut();location.reload()};
}
async function ensureWorkspace(){
  const {data,error}=await supabaseClient.rpc('get_or_create_my_workspace');
  if(error)throw error;
  if(!data)throw new Error('Não foi possível obter o espaço financeiro da conta.');
  supabaseWorkspaceId=typeof data==='string'?data:data.id;
  return supabaseWorkspaceId;
}
async function startAuthenticatedApp(user){
  const auth=document.querySelector('#auth-screen');if(auth)auth.style.display='none';
  const app=document.querySelector('.app');if(app)app.style.display='grid';
  showUserMenu(user);
  const baseKey='finance_nexora_v1_'+user.id;
  if(!localStorage.getItem(baseKey)){
    const old=localStorage.getItem('finance_nexora_v1'); if(old)localStorage.setItem(baseKey,old);
  }
  KEY=baseKey;
  try{db=JSON.parse(localStorage.getItem(KEY))||defaultDB()}catch{db=defaultDB()}
  db=normalizeRemoteState(db);
  lastRemoteUpdatedAt=localStorage.getItem(KEY+'_remote_updated_at')||'';
  Object.assign(db,defaultDB(),db,{settings:{...defaultDB().settings,...(db.settings||{})},categories:{...defaultDB().categories,...(db.categories||{})}});
  db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];
  const theme=document.querySelector('#theme'),open=document.querySelector('#open-menu'),close=document.querySelector('#close-menu'),side=document.querySelector('#sidebar');
  if(open)open.onclick=()=>side.classList.add('open'); if(close)close.onclick=()=>side.classList.remove('open');
  if(theme){theme.textContent=db.settings.theme==='dark'?'☀':'☾';theme.onclick=()=>{db.settings.theme=db.settings.theme==='dark'?'light':'dark';save();document.body.classList.toggle('dark',db.settings.theme==='dark');theme.textContent=db.settings.theme==='dark'?'☀':'☾'}}
  document.body.classList.toggle('dark',db.settings.theme==='dark');
  normalizeOverdue(); render();
  await connectUserWorkspace();
}
async function connectUserWorkspace(){
  try{
    setSyncStatus('V1.15 • Supabase: conectando...');
    await ensureWorkspace();
    const stateRes=await supabaseClient.from('app_state').select('state,updated_at').eq('workspace_id',supabaseWorkspaceId).maybeSingle();
    if(stateRes.error)throw stateRes.error;
    const remoteState=stateRes.data?.state||null;
    if(remoteState){applyRemoteState(remoteState,stateRes.data.updated_at);syncDirty=false;render(view)}
    else {await syncNow()}
    syncReady=true;subscribeRealtime();await pullRemoteState({force:false});setSyncStatus('V1.15 • Supabase conectado',true);
  }catch(err){console.error('[NEXORA][SUPABASE]',err);setSyncStatus('V1.15 • Supabase indisponível');toast(authErrorMessage(err))}
}
async function initSupabase(){
  if(!window.supabase||!window.supabase.createClient)throw new Error('Biblioteca Supabase não carregada');
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{headers:{'x-nexora-client':'finance-nexora-v1.14'}}});
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
    setSyncStatus('V1.15 • Supabase sincronizado',true);
  }catch(err){
    console.error('[NEXORA][SYNC]',err);
    setSyncStatus('V1.15 • erro de sincronização');
  }finally{syncInProgress=false}
}
function queueSync(){
  if(!syncReady)return;
  syncDirty=true;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(syncNow,250);
}
window.addEventListener('online',()=>{if(syncReady){syncDirty=true;syncNow().catch(()=>{})}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&syncReady&&!syncDirty)pullRemoteState().catch(err=>console.error('[NEXORA][PULL]',err))});
window.addEventListener('focus',()=>{if(syncReady&&!syncDirty)pullRemoteState().catch(err=>console.error('[NEXORA][PULL]',err))});
window.addEventListener('pagehide',()=>{if(syncDirty)syncNow().catch(()=>{})});

db.cashbooks=db.cashbooks||[]; db.cashbooks.forEach(c=>{c.entries=Array.isArray(c.entries)?c.entries:[]});
db.cashbooks=db.cashbooks||[]; db.cashbooks.forEach(c=>{c.entries=Array.isArray(c.entries)?c.entries:[]}); db.transactions.forEach(x=>{if(x.paymentSource===undefined)x.paymentSource='';if(x.type==='receita'&&x.repayable===undefined)x.repayable=false}); db.debts.forEach(x=>{if(x.paymentSource===undefined)x.paymentSource=''}); db.loans.forEach(x=>{if(x.paymentSource===undefined)x.paymentSource=''}); Object.assign(db,defaultDB(),db,{settings:{...defaultDB().settings,...(db.settings||{})},categories:{...defaultDB().categories,...(db.categories||{})}}); db.settings.daysOff=Array.isArray(db.settings.daysOff)?db.settings.daysOff:[];
let view='dashboard'; let editingId=null;
function save(){saveLocal();queueSync()}
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(window._toast);window._toast=setTimeout(()=>t.style.display='none',2200)}
function fmtDate(d){if(!d)return'—';return new Intl.DateTimeFormat('pt-BR').format(iso(d))}
function monthKey(d){return d.slice(0,7)}
function currentMonth(){return monthKey(today())}
function weekOf(d){const x=iso(d);if(Number.isNaN(x.getTime()))return null;const first=new Date(x.getFullYear(),x.getMonth(),1,12);const offset=(first.getDay()+6)%7;const monday=new Date(first);monday.setDate(first.getDate()-offset);return Math.floor((x-monday)/86400000/7)+1}
function weekLabel(d){const w=weekOf(d);return w?`Semana ${w}`:'Fora da semana operacional'}
function assignedWeekLabel(x){return x.weekAssigned?`Semana ${x.weekAssigned}`:weekLabel(x.date)}
function txAmount(x){return x.type==='receita'?num(x.value):-num(x.value)}
function paidTransactions(){return db.transactions.filter(x=>x.status==='pago')}
function ensureRecurring(){const base=new Date();for(const r of db.recurring.filter(x=>x.active)){for(let i=0;i<12;i++){const lastDay=new Date(base.getFullYear(),base.getMonth()+i+1,0).getDate();const dt=new Date(base.getFullYear(),base.getMonth()+i,Math.min(r.day,lastDay),12);const date=dt.toISOString().slice(0,10);const exists=db.transactions.some(x=>x.recurringId===r.id&&x.date===date);if(!exists)db.transactions.push({id:uid(),date,value:num(r.value),category:r.category||'Recorrente',person:r.person||'',status:'previsto',weekAssigned:weekOf(date),note:`Lançamento recorrente — ${r.description}`,type:r.type,recurringId:r.id})}}save()}
function totals(m=currentMonth()){const arr=db.transactions.filter(x=>monthKey(x.date)===m);return{r:arr.filter(x=>x.type==='receita'&&x.status==='pago').reduce((a,x)=>a+num(x.value),0),d:arr.filter(x=>x.type==='despesa'&&x.status==='pago').reduce((a,x)=>a+num(x.value),0),rp:arr.filter(x=>x.type==='receita'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0),dp:arr.filter(x=>x.type==='despesa'&&x.status!=='pago').reduce((a,x)=>a+num(x.value),0)}}
function currentBalance(){return num(db.balance)+paidTransactions().filter(x=>x.cashApplied!==false).reduce((a,x)=>a+txAmount(x),0)}
function cashStatus(){const bal=currentBalance();const received=paidTransactions().filter(x=>x.type==='receita').reduce((a,x)=>a+num(x.value),0);const paid=paidTransactions().filter(x=>x.type==='despesa').reduce((a,x)=>a+num(x.value),0);return{balance:bal,received,paid,deficit:received===0&&paid>0&&bal<0}}
function projectedBalance(){return currentBalance()+db.transactions.filter(x=>x.status!=='pago').reduce((a,x)=>a+txAmount(x),0)}
function debtOutstanding(){return db.debts.reduce((a,d)=>{const paid=db.transactions.filter(x=>x.debtId===d.id&&x.status==='pago').reduce((s,x)=>s+num(x.value),0);return a+Math.max(0,num(d.value)-paid)},0)}
function debtRemaining(id){const d=db.debts.find(x=>x.id===id);if(!d)return 0;const paid=db.transactions.filter(x=>x.debtId===id&&x.status==='pago').reduce((s,x)=>s+num(x.value),0);return Math.max(0,num(d.value)-paid)}
function table(rows,heads){return rows.length?`<div class="table-wrap"><table class="table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<div class="empty">Nenhum registro encontrado.</div>`}
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
function recurring(){const rows=db.recurring.map(r=>`<tr><td>${esc(r.description)}</td><td>${r.type}</td><td>${money(r.value)}</td><td>Dia ${r.day}</td><td>${r.active?'Ativa':'Inativa'}</td><td><button class="btn secondary" data-toggle-rec="${r.id}">${r.active?'Pausar':'Ativar'}</button> <button class="btn danger" data-del-rec="${r.id}">Excluir</button></td></tr>`);layout('Receitas / Despesas Recorrentes',`<div class="card"><form id="rec-form" class="form"><div class="field"><label>Descrição</label><input id="rdesc" required></div><div class="field"><label>Tipo</label><select id="rtype"><option value="receita">Receita</option><option value="despesa">Despesa</option></select></div><div class="field"><label>Valor</label><input id="rvalue" type="number" step=".01" required></div><div class="field"><label>Dia do mês</label><input id="rday" type="number" min="1" max="31" value="1"></div><div class="field"><label>Categoria</label><input id="rcat"></div><div class="field"><label>Pessoa / instituição</label><input id="rperson"></div><div class="actions full"><button class="btn primary">Criar recorrência</button></div></form></div><div class="section">${table(rows,['Descrição','Tipo','Valor','Periodicidade','Status','Ações'])}</div>`);$('#rec-form').onsubmit=e=>{e.preventDefault();db.recurring.push({id:uid(),description:$('#rdesc').value,type:$('#rtype').value,value:num($('#rvalue').value),day:num($('#rday').value),category:$('#rcat').value,person:$('#rperson').value,active:true,lastGenerated:null});save();ensureRecurring();toast('Recorrência criada');recurring()}}
function yearKey(d){return d.slice(0,4)}
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
function reports(){const t=totals();const cats={};db.transactions.filter(x=>x.type==='despesa'&&monthKey(x.date)===currentMonth()).forEach(x=>cats[x.category]=(cats[x.category]||0)+num(x.value));const rows=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${money(v)}</td><td>${((v/(t.d+t.dp||1))*100).toFixed(1)}%</td></tr>`);layout('Relatórios',`<div class="grid"><div class="card"><div class="label">Receitas pagas</div><div class="value positive">${money(t.r)}</div></div><div class="card"><div class="label">Despesas pagas</div><div class="value negative">${money(t.d)}</div></div><div class="card"><div class="label">Resultado</div><div class="value">${money(t.r-t.d)}</div></div><div class="card"><div class="label">Lançamentos</div><div class="value">${db.transactions.length}</div></div></div><div class="card"><h3>Despesas por categoria</h3>${table(rows,['Categoria','Valor','Participação'])}</div>`)}
function config(){
  layout('Configurações',`<div class="settings-shell">
    <div class="settings-intro"><div><span>GESTÃO FINANCEIRA NEXORA</span><h2>Configurações</h2><p>Centralize aqui os parâmetros que controlam o aplicativo e os dados financeiros.</p></div><div class="settings-badge">● Sistema local</div></div>
    <form id="cfg" class="settings-grid">
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">◈</div><div><h3>Projeto e identidade</h3><p>Defina o nome do seu projeto e a base financeira.</p></div></div><div class="form settings-form"><div class="field"><label>Nome do projeto financeiro</label><input id="project" value="${esc(db.settings.project)}" placeholder="Ex.: Finanças da família"></div><div class="field"><label>Moeda</label><input value="BRL — Real brasileiro (R$)" disabled></div></div></section>
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">$</div><div><h3>Caixa inicial</h3><p>Valor disponível antes dos lançamentos registrados.</p></div></div><div class="form settings-form"><div class="field"><label>Saldo inicial (R$)</label><input id="bal" type="number" step="0.01" value="${db.balance}"></div><div class="settings-note"><b>Regra do caixa</b><span>Receitas recebidas aumentam o caixa. Pagamentos reduzem o caixa. Se houver pagamento sem receita recebida suficiente, o saldo ficará negativo para mostrar o déficit real.</span></div></div></section>
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">✓</div><div><h3>Categorias de receitas</h3><p>Personalize as categorias usadas nos lançamentos de entrada.</p></div></div><div class="field"><label>Categorias separadas por vírgula</label><textarea id="catsr">${esc(db.categories.receita.join(', '))}</textarea></div></section>
      <section class="settings-card"><div class="settings-card-head"><div class="settings-icon">−</div><div><h3>Categorias de despesas</h3><p>Personalize as categorias usadas nos pagamentos e compromissos.</p></div></div><div class="field"><label>Categorias separadas por vírgula</label><textarea id="catsd">${esc(db.categories.despesa.join(', '))}</textarea></div></section>
      <section class="settings-card danger-zone"><div class="settings-card-head"><div class="settings-icon">!</div><div><h3>Dados locais</h3><p>Use com atenção. Esta ação remove os dados armazenados neste dispositivo.</p></div></div><div class="actions"><button class="btn primary">Salvar configurações</button><button type="button" class="btn danger" id="reset-data">Excluir dados locais</button></div></section>
    </form>
  </div>`);
  $('#cfg').onsubmit=e=>{e.preventDefault();db.balance=num($('#bal').value);db.settings.project=$('#project').value.trim()||'Gestão financeira NEXORA';db.categories.receita=$('#catsr').value.split(',').map(x=>x.trim()).filter(Boolean);db.categories.despesa=$('#catsd').value.split(',').map(x=>x.trim()).filter(Boolean);save();toast('Configurações salvas com sucesso');render('config')};
  $('#reset-data').onclick=()=>{if(confirm('Excluir todos os dados locais do Gestão financeira NEXORA?')){db=defaultDB();save();render('dashboard');toast('Dados locais excluídos')}}
}
/* FINANCE NEXORA V1.5 — Dívidas/Despesas unificadas, empréstimos como dívida, calendário semanal e dashboard executivo */
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
  layout('Dashboard',`<div class="hero dashboard-hero"><div><small>GESTÃO FINANCEIRA NEXORA • CONTROLE FINANCEIRO</small><h2>${money(bal)}</h2><small>Saldo atual disponível</small></div><div class="side"><small>SALDO PROJETADO</small><br><b>${money(proj)}</b><br><small>Após compromissos previstos</small></div></div><div class="grid dashboard-kpis"><div class="card"><div class="label">Receitas recebidas</div><div class="value positive">${money(t.r)}</div><small>mês atual</small></div><div class="card"><div class="label">Despesas pagas</div><div class="value negative">${money(t.d)}</div><small>mês atual</small></div><div class="card"><div class="label">A pagar</div><div class="value negative">${money(pendingPay)}</div><small>compromissos em aberto</small></div><div class="card"><div class="label">A receber</div><div class="value positive">${money(pendingRec)}</div><small>receitas previstas</small></div><div class="card"><div class="label">Dívidas</div><div class="value negative">${money(debtOutstanding()+loanDebt)}</div><small>saldo estimado em aberto</small></div><div class="card"><div class="label">Cartões</div><div class="value">${db.cards.length}</div><small>cadastrados</small></div><div class="card"><div class="label">Resultado do mês</div><div class="value ${monthlyNet>=0?'positive':'negative'}">${money(monthlyNet)}</div><small>receitas − despesas pagas</small></div><div class="card"><div class="label">Operações financeiras</div><div class="value">${db.transactions.length}</div><small>lançamentos registrados</small></div></div><div class="grid dashboard-panels"><div class="card"><div class="section-head"><div><h3>Fluxo mensal</h3><p>Receitas recebidas × despesas pagas</p></div></div><div class="chart-legend"><span><i class="dot receive"></i>Receitas</span><span><i class="dot expense"></i>Despesas</span></div><div class="bar-chart">${bars}</div></div><div class="card"><div class="section-head"><div><h3>Saúde financeira</h3><p>Visão resumida do mês atual</p></div></div><div class="health"><div><span>Resultado líquido</span><b class="${monthlyNet>=0?'positive':'negative'}">${money(monthlyNet)}</b></div><div><span>Compromissos em aberto</span><b>${money(pendingPay)}</b></div><div><span>Receitas ainda previstas</span><b class="positive">${money(pendingRec)}</b></div><div><span>Saldo projetado</span><b class="${proj>=0?'positive':'negative'}">${money(proj)}</b></div><div><span>${cashStatus().deficit?'Déficit de caixa':'Caixa após pagamentos'}</span><b class="${bal>=0?'positive':'negative'}">${money(bal)}</b></div></div></div></div><div class="card"><div class="section-head"><div><h3>Próximos pagamentos e recebimentos</h3><p>Calendário financeiro resumido</p></div><button class="btn primary" data-view="calendario">Abrir calendário</button></div>${table(due.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${x.type==='receita'?'Receber':'Pagar'}</td><td>${esc(x.person||x.category||'—')}</td><td>${money(x.value)}</td><td>${statusPill(x.status,x.priority)}</td></tr>`),['Data','Fluxo','Credor / origem','Valor','Status'])}</div><div class="card section"><div class="section-head"><div><h3>Panorama financeiro</h3><p>Dívidas, despesas, empréstimos, cartões e receitas em conjunto.</p></div><button class="btn secondary" data-view="movimentos">Gerenciar compromissos</button></div><div class="overview-strip"><div><small>Dívidas + empréstimos</small><b>${money(debtOutstanding()+loanDebt)}</b></div><div><small>Despesas previstas</small><b>${money(t.dp)}</b></div><div><small>Receitas previstas</small><b>${money(t.rp)}</b></div><div><small>Cartões utilizados</small><b>${money(db.cards.reduce((a,c)=>a+db.transactions.filter(x=>x.cardId===c.id&&x.status!=='pago').reduce((s,x)=>s+num(x.value),0),0))}</b></div></div></div>`)
}
let calendarCursor=currentMonth();
function renderCalendarShift(delta){calendarCursor=shiftMonth(calendarCursor,delta);calendar(calendarCursor)}
function calendar(m=calendarCursor){
  calendarCursor=m||currentMonth();
  const month=calendarCursor;
  const weeks=financialWeekRanges(month);
  const todayKey=today();
  const monthItems=db.transactions.filter(x=>monthKey(x.date)===month);
  const unpaidPay=monthItems.filter(x=>x.type==='despesa'&&x.status!=='pago');
  const pendingRec=monthItems.filter(x=>x.type==='receita'&&x.status!=='pago');
  const totalPay=unpaidPay.reduce((a,x)=>a+num(x.value),0);
  const totalRec=pendingRec.reduce((a,x)=>a+num(x.value),0);
  const cash=currentBalance();
  const coverage=Math.max(0,cash)+totalRec;
  const remainingToCover=Math.max(0,totalPay-coverage);

  const monthStart=iso(`${month}-01`);
  const monthEnd=new Date(monthStart.getFullYear(),monthStart.getMonth()+1,0,12);
  const availableDays=[];
  let cursor=new Date(todayKey>month?todayKey:monthStart);
  if(cursor<monthStart)cursor=new Date(monthStart);
  cursor.setHours(12,0,0,0);
  while(cursor<=monthEnd){
    const d=ymd(cursor);
    if(!db.settings.daysOff.includes(d))availableDays.push(d);
    cursor.setDate(cursor.getDate()+1);
  }
  const dailyNeed=remainingToCover/Math.max(1,availableDays.length);
  const monthStatus=remainingToCover<=0?'Cobertura garantida':'Busca necessária';

  const weekHtml=weeks.map((w,idx)=>{
    const items=calendarWeekItems(month,w);
    const pay=items.filter(x=>x.type==='despesa'&&x.status!=='pago');
    const receipts=items.filter(x=>x.type==='receita');
    const recPending=receipts.filter(x=>x.status!=='pago');
    const recPaid=receipts.filter(x=>x.status==='pago');
    const payTotal=pay.reduce((a,x)=>a+num(x.value),0);
    const recPendingTotal=recPending.reduce((a,x)=>a+num(x.value),0);
    const recPaidTotal=recPaid.reduce((a,x)=>a+num(x.value),0);
    const weekCoverage=recPendingTotal+recPaidTotal;
    const weekNeed=Math.max(0,payTotal-weekCoverage);
    const weekStart=iso(w.start);
    const weekEnd=iso(w.end);
    const weekDays=[];
    let wd=new Date(weekStart);
    while(wd<=weekEnd){
      const d=ymd(wd);
      if(!db.settings.daysOff.includes(d) && d>=todayKey)weekDays.push(d);
      wd.setDate(wd.getDate()+1);
    }
    const weekDaily=weekNeed/Math.max(1,weekDays.length);
    const isCurrent=todayKey>=w.start&&todayKey<=w.end&&month===currentMonth();

    const records=[...pay,...receipts].sort((a,b)=>a.date.localeCompare(b.date));
    const rows=records.length?records.map(x=>{
      const isPay=x.type==='despesa';
      const currentWeek=weeks.findIndex(q=>x.date>=q.start&&x.date<=q.end);
      const movedWeek=Number.isInteger(Number(x.weekAssigned))?Number(x.weekAssigned):currentWeek+1;
      const options=weeks.map((q,i)=>`<option value="${i+1}" ${movedWeek===i+1?'selected':''}>Semana ${i+1} • ${fmtDate(q.start)}–${fmtDate(q.end)}</option>`).join('');
      return `<div class="calendar-record ${isPay?'pay':'receive'}">
        <div class="calendar-record-main">
          <div class="calendar-record-top"><span class="calendar-flow ${isPay?'pay':'receive'}">${isPay?'PAGAMENTO':'RECEITA'}</span><span class="calendar-date">${fmtDate(x.date)}</span>${statusPill(x.status,x.priority)}</div>
          <strong>${esc(x.person||x.category||'Sem identificação')}</strong>
          <small>${esc(x.category||'')} ${x.note?`• ${esc(x.note)}`:''}</small>
        </div>
        <div class="calendar-record-value ${isPay?'negative':'positive'}">${isPay?'−':'+'} ${money(x.value)}</div>
        <div class="calendar-record-actions">
          <button class="btn ${x.status==='pago'?'secondary':'primary'} mini" data-toggle-paid="${x.id}">${x.status==='pago'?(isPay?'Reverter pago':'Reverter recebimento'):(isPay?'Marcar pago':'Marcar recebido')}</button>
          <button class="btn secondary mini" data-edit="${x.id}">Editar</button>
          <label class="calendar-move"><span>Realocar</span><select data-move-week="${x.id}">${options}</select></label>
        </div>
      </div>`;
    }).join(''):`<div class="calendar-empty-week">Nenhum pagamento ou receita nesta semana.</div>`;

    return `<section class="finance-week ${isCurrent?'current':''}">
      <div class="finance-week-head">
        <div><span class="eyebrow">SEMANA ${idx+1}${isCurrent?' • ATUAL':''}</span><h3>${fmtDate(w.start)} <span>até</span> ${fmtDate(w.end)}</h3></div>
        <div class="week-head-metrics"><div><small>A pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas</small><b class="positive">${money(weekCoverage)}</b></div><div><small>Falta cobrir</small><b class="${weekNeed?'negative':'positive'}">${money(weekNeed)}</b></div><div><small>Busca diária</small><b>${money(weekDaily)}</b></div></div>
      </div>
      <div class="finance-week-body">${rows}</div>
      <div class="finance-week-footer"><div><small>Total a pagar</small><b class="negative">${money(payTotal)}</b></div><div><small>Receitas do ciclo</small><b class="positive">${money(weekCoverage)}</b></div><div><small>Recebido</small><b class="positive">${money(recPaidTotal)}</b></div><div><small>Falta cobrir</small><b class="${weekNeed?'negative':'positive'}">${money(weekNeed)}</b></div><div><small>Busca diária</small><b>${money(weekDaily)}</b><span>${weekDays.length} dia(s) disponíveis</span></div></div>
    </section>`;
  }).join('');

  layout('Calendário Financeiro',`
    <div class="page-intro calendar-intro"><div><span class="eyebrow">FLUXO FINANCEIRO</span><h2>${monthName(month)} de ${yearKey(month)}</h2><p>Visão mensal organizada em semanas de segunda a domingo. Aqui aparecem somente pagamentos e receitas.</p></div><div class="month-nav"><button class="btn secondary" data-month-prev>‹</button><b>${monthName(month)}</b><button class="btn secondary" data-month-next>›</button></div></div>
    <div class="grid compact-kpis calendar-kpis"><div class="card"><div class="label">Em caixa</div><div class="value ${cash>=0?'positive':'negative'}">${money(cash)}</div><small>Disponível para cobertura</small></div><div class="card"><div class="label">Total a pagar</div><div class="value negative">${money(totalPay)}</div><small>Compromissos em aberto</small></div><div class="card"><div class="label">Receitas previstas</div><div class="value positive">${money(totalRec)}</div><small>Receitas ainda não recebidas</small></div><div class="card"><div class="label">Saldo a buscar</div><div class="value ${remainingToCover?'negative':'positive'}">${money(remainingToCover)}</div><small>Total a pagar − caixa − receitas</small></div><div class="card highlight"><div class="label">Busca diária</div><div class="value">${money(dailyNeed)}</div><small>${availableDays.length} dia(s) disponíveis • ${monthStatus}</small></div></div>
    <div class="calendar-note"><b>Regra do calendário:</b> pagamentos em aberto aumentam o saldo a buscar; dinheiro já em caixa e receitas previstas reduzem esse saldo. Ao registrar/receber uma receita, pagar uma conta, editar um vencimento ou marcar uma folga, a busca diária é recalculada.</div>
    <div class="calendar-toolbar"><div><b>Organização do mês</b><span>Realocar permite mover um pagamento para outra semana sem alterar sua data de vencimento.</span></div><button class="btn secondary" data-manage-days-off>Gerenciar folgas</button></div>
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
function render(v=view){view=v;const fn={dashboard:unifiedDashboard,caixa:cashbook,movimentos:()=>debtsExpenses('geral'),cartoes:()=>debtsExpenses('cartoes'),emprestimos:()=>debtsExpenses('emprestimos'),receitas:()=>receitasPage(),planejamento:planning,calendario:calendar,relatorios:reports,config};(fn[v]||unifiedDashboard)();document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===v))}
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
  document.querySelectorAll('[data-move-week]').forEach(sel=>sel.onchange=()=>{
    const x=db.transactions.find(z=>z.id===sel.dataset.moveWeek);
    if(!x)return;
    x.weekAssigned=Number(sel.value)||null;
    save();
    toast(`Pagamento/receita realocado para a Semana ${sel.value}`);
    calendar(calendarCursor);
  });
  document.querySelectorAll('[data-manage-days-off]').forEach(b=>b.onclick=()=>{
    const day=prompt('Informe a data da folga no formato AAAA-MM-DD. Deixe vazio para cancelar:');
    if(!day)return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){toast('Data inválida');return;}
    const idx=db.settings.daysOff.indexOf(day);
    if(idx>=0){db.settings.daysOff.splice(idx,1);toast('Folga removida')}else{db.settings.daysOff.push(day);db.settings.daysOff.sort();toast('Folga adicionada')}
    save();calendar(calendarCursor);
  });
}
