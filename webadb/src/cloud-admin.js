const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://jqrznghqwdjbizjehzrm.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_YG9zgjQ5Y56WiBtKdJMQvA_-UBAFv9B';
let db = null;
export let configured = false;
export const ready = (async () => {
  const clientLib = await (window.supabaseReady || Promise.resolve(window.supabase));
  configured = Boolean(SUPABASE_URL && KEY && clientLib?.createClient);
  if (configured) db = clientLib.createClient(SUPABASE_URL, KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, autoRefreshToken: true, persistSession: true }
  });
  return configured;
})();

const mustDb = () => { if (!db) throw new Error('Supabase n’est pas configuré.'); return db; };
export async function session(){ if(!db) return null; const {data,error}=await db.auth.getSession(); if(error) throw error; return data.session; }
export function onAuthChange(fn){ if(!db) return () => {}; const {data}=db.auth.onAuthStateChange((_event,s)=>fn(s)); return ()=>data.subscription.unsubscribe(); }
export async function signUp({shopName,email,password}) {
  const {data,error}=await mustDb().auth.signUp({email,password,options:{data:{shop_name:shopName},emailRedirectTo:location.origin+location.pathname}});
  if(error) throw error; return data;
}
export async function signIn({email,password}){const {data,error}=await mustDb().auth.signInWithPassword({email,password});if(error)throw error;return data;}
export async function signInGoogle(){const {data,error}=await mustDb().auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{access_type:'offline',prompt:'select_account'},skipBrowserRedirect:true}});if(error)throw error;if(!data?.url)throw new Error('Supabase n’a pas renvoyé de lien Google. Vérifiez que le fournisseur Google est activé.');window.location.assign(data.url);}
export async function signOut(){const {error}=await mustDb().auth.signOut();if(error)throw error;}
export async function user(){const {data,error}=await mustDb().auth.getUser();if(error)throw error;return data.user;}
export async function ensureProfile(shopName='') {
  const u=await user(); const {data,error}=await mustDb().from('reseller_profiles').select('*').eq('user_id',u.id).maybeSingle();
  if(error)throw error; if(data)return data;
  const name=(shopName||u.user_metadata?.shop_name||'').trim(); if(!name)return null;
  const {data:created,error:insertError}=await mustDb().from('reseller_profiles').insert({user_id:u.id,shop_name:name,email:u.email}).select().single();
  if(insertError)throw insertError; await log('Compte revendeur créé'); return created;
}
export async function updateShopName(shopName){const u=await user();const {data,error}=await mustDb().from('reseller_profiles').update({shop_name:shopName.trim(),updated_at:new Date().toISOString()}).eq('user_id',u.id).select().single();if(error)throw error;await log('Nom de la boutique modifié');return data;}
export async function loadData(){
 const d=mustDb(), u=await user(); const [profile,clients,devices,logs]=await Promise.all([
  d.from('reseller_profiles').select('*').eq('user_id',u.id).single(),
  d.from('clients').select('*').eq('user_id',u.id).order('created_at',{ascending:false}),
  d.from('devices').select('*').eq('user_id',u.id).order('created_at',{ascending:false}),
  d.from('activity_logs').select('*').eq('user_id',u.id).order('created_at',{ascending:false}).limit(100)
 ]);
 for(const r of [profile,clients,devices,logs])if(r.error)throw r.error;
 return {profile:profile.data,clients:clients.data,devices:devices.data,logs:logs.data};
}
export async function addClient({name,group}){const u=await user();const {data,error}=await mustDb().from('clients').insert({user_id:u.id,name:name.trim(),group_name:(group||'').trim()}).select().single();if(error)throw error;await log('Client ajouté : '+data.name);return data;}
export async function removeClient(id){const {error}=await mustDb().from('clients').delete().eq('id',id);if(error)throw error;await log('Client supprimé');}
export async function addDevice({name,platform,clientId,note}){const u=await user();const {data,error}=await mustDb().from('devices').insert({user_id:u.id,name:name.trim(),platform,client_id:clientId||null,note:(note||'').trim()}).select().single();if(error)throw error;await log('Appareil enregistré : '+data.name);return data;}
export async function removeDevice(id){const {error}=await mustDb().from('devices').delete().eq('id',id);if(error)throw error;await log('Appareil retiré');}
export async function log(action){if(!db)return;const u=await user();const {error}=await db.from('activity_logs').insert({user_id:u.id,action});if(error)throw error;}


export async function platformRole(){
  const u=await user();
  const {data,error}=await mustDb().from('platform_admins').select('*').eq('user_id',u.id).maybeSingle();
  if(error)throw error;
  if(data?.role==='admin'&&data.is_active===false)return 'suspended';
  return data?.role||null;
}
export async function sendApplicationEmail(applicationId){
  try { const {data,error}=await mustDb().functions.invoke('application-mail',{body:{applicationId}});return !error&&data?.failed===0; } catch { return false; }
}
export async function applicationEmailStatus(applicationId){
  const {data,error}=await mustDb().from('application_emails').select('event,status,sent_at').eq('application_id',applicationId).order('created_at',{ascending:false});
  if(error)return null;return data;
}
export async function submitAdminApplication(details){
  const {data,error}=await mustDb().rpc('submit_admin_application',{details});
  if(error){if(error.code==='23505'){const existing=await myAdminApplication();if(existing?.status==='pending')return existing;}throw error;}
  await sendApplicationEmail(data.id);
  return data;
}
export async function myAdminApplication(){
  const u=await user();
  const {data,error}=await mustDb().from('admin_applications').select('*').eq('user_id',u.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  return data;
}
export async function loadOwnerData(){
  const role=await platformRole();
  if(role!=='owner')throw new Error('Accès propriétaire requis.');
  const d=mustDb();
  const [applications,admins,stores,clients,devices,logs]=await Promise.all([
    d.from('admin_applications').select('*').order('created_at',{ascending:false}),
    d.from('platform_admins').select('*').order('created_at',{ascending:false}),
    d.from('reseller_profiles').select('*').order('created_at',{ascending:false}),
    d.from('clients').select('*').order('created_at',{ascending:false}),
    d.from('devices').select('*').order('created_at',{ascending:false}),
    d.from('activity_logs').select('*').order('created_at',{ascending:false}).limit(100)
  ]);
  for(const r of [applications,admins,stores,clients,devices,logs])if(r.error)throw r.error;
  return {applications:applications.data,admins:admins.data,stores:stores.data,clients:clients.data,devices:devices.data,logs:logs.data};
}
export async function reviewAdminApplication(id,approve){
  const {error}=await mustDb().rpc('review_admin_application',{application_id:id,approve});
  if(error)throw error;
  await sendApplicationEmail(id);
}
export async function setPlatformAdmin(userId,makeAdmin){
  const {error}=await mustDb().rpc('set_platform_admin',{target_user_id:userId,make_admin:makeAdmin});
  if(error)throw error;
}
export async function setPlatformAdminAccess(userId,enabled){
  const {error}=await mustDb().rpc('set_platform_admin_access',{target_user_id:userId,enabled});
  if(error){
    const details=`${error.message||''} ${error.details||''} ${error.hint||''}`;
    if(error.code==='PGRST202'||/set_platform_admin_access|schema cache/i.test(details)){
      throw new Error('Le contrôle d’accès doit d’abord être activé dans Supabase. Exécute la migration 20261030000000_admin_access_control.sql dans le SQL Editor, puis recharge la page.');
    }
    throw error;
  }
}
export async function getAndroidUnlockMaterial(){
  const {data,error}=await mustDb().rpc('get_android_unlock_material');
  if(error){
    const details=`${error.message||''} ${error.details||''} ${error.hint||''}`;
    if(error.code==='PGRST202'||details.includes('get_android_unlock_material')){
      throw new Error('Cette fonction manque dans Supabase. Exécute la migration 20261008000000_android_admin_unlock_key.sql dans le SQL Editor, puis recharge la page.');
    }
    throw error;
  }
  if(!data?.code||!data?.intermediate_key)throw new Error('La clé sécurisée Android est indisponible.');
  return data;
}

export async function setDeviceConfigured(id,configured){
  const {error}=await mustDb().rpc('set_device_configured',{target_device_id:id,is_configured:configured});
  if(error)throw error;
}

export async function updateStoreName(userId,shopName){
  const {error}=await mustDb().from('reseller_profiles').update({shop_name:shopName.trim(),updated_at:new Date().toISOString()}).eq('user_id',userId);
  if(error)throw error;
}


/** Données anonymes agrégées pour le tableau YZ MDM (propriétaire uniquement). */
export async function loadYzMdmMetrics(days=30){
  if(await platformRole()!=='owner') throw new Error('Accès propriétaire requis.');
  const since=new Date(Date.now()-Math.max(1,days)*86400000).toISOString().slice(0,10);
  const {data,error}=await mustDb().from('yz_mdm_metrics_daily').select('day,metric,count').gte('day',since).order('day',{ascending:true});
  if(error) throw error;
  return data||[];
}
