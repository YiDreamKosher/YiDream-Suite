import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@10.3.1';
import { applicationMessage } from './messages.js';
const allowedOrigins=new Set(['https://yidreamkosher.github.io']);
const json=(body:unknown,status=200,origin='')=>Response.json(body,{status,headers:{...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{}),'Cache-Control':'no-store'}});
export async function handler(req:Request){
 const origin=req.headers.get('origin')||'';
 if(origin&&!allowedOrigins.has(origin))return json({error:'Origin refused'},403);
 if(req.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST'}});
 if(req.method!=='POST')return json({error:'Method not allowed'},405,origin);
 const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const bearer=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 if(!bearer)return json({error:'Sign in required'},401,origin);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 // A service-role invocation is reserved for a scheduled retry worker.
 let actor:string|null=null;
 const worker=bearer===serviceKey;
 if(!worker){const {data,error}=await admin.auth.getUser(bearer);if(error||!data.user)return json({error:'Sign in required'},401,origin);actor=data.user.id;}
 let body;try{if(Number(req.headers.get('content-length')||0)>1024)return json({error:'Invalid request'},400,origin);const raw=await req.text();if(raw.length>1024)return json({error:'Invalid request'},400,origin);body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request'},400,origin);}catch{return json({error:'Invalid request'},400,origin);}
 const applicationId=body.applicationId||null;
 if(!worker&&(!applicationId||!(typeof applicationId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId))))return json({error:'Application required'},400,origin);
 if(!Deno.env.get('GMAIL_APP_PASSWORD'))return json({error:'Email sender is not configured',code:'MAIL_NOT_CONFIGURED'},503,origin);
 const {data:messages,error}=await admin.rpc('claim_application_emails',{target_application:applicationId,actor_id:actor});
 if(error)return json({error:'Cannot access this application'},403,origin);
 const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:'yiddishdream@gmail.com',pass:Deno.env.get('GMAIL_APP_PASSWORD')},connectionTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true});
 let sent=0,failed=0;
 for(const message of messages||[]){
  try{
   const content=applicationMessage(message.event);
   const result=await transport.sendMail({from:'YiDream <yiddishdream@gmail.com>',to:message.recipient,...content,messageId:`<application-${message.id}@yidream.local>`});
   if(!result.accepted?.length)throw Error('SMTP refused recipient');
   const {error:updateError}=await admin.from('application_emails').update({status:'sent',sent_at:new Date().toISOString(),lease_until:null,last_error:null}).eq('id',message.id).eq('status','sending');
   if(updateError)throw updateError;
   sent++;
  }catch{
   failed++;
   await admin.from('application_emails').update({status:'failed',lease_until:null,next_attempt_at:new Date(Date.now()+600000).toISOString(),last_error:'Delivery attempt failed. Check private function and Gmail settings.'}).eq('id',message.id).eq('status','sending');
  }
 }
 transport.close();
 return json({sent,failed},failed?502:200,origin);
}
if(import.meta.main)Deno.serve(handler);
