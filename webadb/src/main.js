import './admin-store.js';
import { runGate } from './gate.js';
import { renderAndroid } from './ui-android.js';
import { DISCLAIMER_TEXT } from './legal.js';
import * as cloud from './cloud-admin.js';

window.yidreamUI = { renderAndroid, legalText: DISCLAIMER_TEXT };

function blocked(message){
  const layer=document.createElement('div');
  layer.style.cssText='position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:22px;background:#f6f8fc;color:#102448;font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  layer.innerHTML='<section style="max-width:540px;width:100%;padding:28px;border:1px solid #dce5f2;border-radius:20px;background:#fff;box-shadow:0 18px 50px #1c3c7012"><h1 style="margin:0 0 8px;font-size:25px">Accès à YiDream Suite</h1><p id="accessMessage" style="color:#73819a"></p><a id="adminLink" style="display:inline-block;padding:10px 15px;border-radius:10px;background:#7257d6;color:#fff;text-decoration:none;font-weight:700">Ouvrir le portail administrateur</a></section>';
  layer.querySelector('#accessMessage').textContent=message;
  const base=new URL('./',location.href);
  layer.querySelector('#adminLink').href=new URL('admin/?login=1',base).href;
  document.body.append(layer);
}
async function authorizeConfigurator(){
  await cloud.ready;
  if(!cloud.configured)throw new Error('La connexion Supabase n’est pas configurée.');
  const session=await cloud.session();
  if(!session){
    const base=new URL('./',location.href);
    location.replace(new URL('admin/?login=1',base).href);
    return false;
  }
  const role=await cloud.platformRole();
  if(!['owner','admin'].includes(role)){
    blocked('Votre compte est connecté, mais il ne dispose pas encore de droits administrateur. Déposez une candidature dans le portail YiDream Suite.');
    return false;
  }
  runGate();
  return true;
}
authorizeConfigurator().catch(error=>blocked(error?.message||'Impossible de vérifier les droits du compte.'));
