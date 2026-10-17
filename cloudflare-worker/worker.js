// Nordvolt EL — Cloudflare Worker API (se README.md)
// Bind en KV namespace med navnet LEADS_KV inden produktionsbrug.
const maxBody = 16000;
const clean = (x,n) => typeof x === 'string' ? x.trim().slice(0,n) : '';
const validPhone = s => /^[+\d][\d\s().-]{5,23}$/.test(s);
const validEmail = s => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function permitted(origin,env) {
  if (!origin || !env.ALLOWED_ORIGIN) return false;
  return env.ALLOWED_ORIGIN.split(',').map(x=>x.trim().replace(/\/$/,'')).includes(origin.replace(/\/$/,''));
}
function json(data,status=200,origin=''){
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(origin){h['Access-Control-Allow-Origin']=origin;h['Vary']='Origin';}
  return new Response(JSON.stringify(data),{status,headers:h});
}
function details(l){const q=l.quote;return [
  'Ny tilbudsforespørgsel – Nordvolt EL',`Reference: ${l.id}`,`Modtaget: ${l.receivedAt}`,
  `Navn: ${l.name}`,`Telefon: ${l.phone}`,`E-mail: ${l.email||'Ikke angivet'}`,
  `Opgave: ${l.service}`,`Ladeboks: ${l.product||'Ikke valgt'}`,`Besked: ${l.message||'Ingen'}`,
  ...(q?[`Eksisterende kabel: ${q.existingCable?'Ja':'Nej'}`,`Kabel: ${q.meters.cable} m á 60 kr.`,
    `Stålrør: ${q.meters.pipe} m á 32,75 kr.`,`Kabelkanal: ${q.meters.channel} m á 28 kr.`,
    `Plads i eltavlen: ${q.spaceInBoard?'Ja':'Nej'}`,`Undertavle: ${q.spaceInBoard?'Nej':'Ja'} (100 kr.)`,
    `Relæ: ${q.relay?'Ja':'Nej'} (150 kr.)`,`Beregnet tillæg: ${q.total.toFixed(2)} kr.`,
    'Dette er ikke en samlet installationspris.']:['Ingen prisberegning'])].join('\n');}
async function notifyMail(l,env){
  if(!env.RESEND_API_KEY || !env.LEADS_NOTIFY_TO || !env.LEADS_FROM)throw Error('E-mail ikke konfigureret');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.LEADS_FROM,to:[env.LEADS_NOTIFY_TO],subject:`Nyt Nordvolt EL-tilbud: ${l.name}`,text:details(l)})});
  if(!r.ok)throw Error(`Resend HTTP ${r.status}: ${(await r.text()).slice(0,250)}`);
}
async function notifySms(l,env){
  if(!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM || !env.LEADS_SMS_TO)throw Error('SMS ikke konfigureret');
  const body=new URLSearchParams({To:env.LEADS_SMS_TO,From:env.TWILIO_FROM,Body:`Nordvolt EL: Nyt tilbud fra ${l.name}, tlf. ${l.phone}. ${l.product||l.service}. Se e-mail. Ref: ${l.id.slice(0,8)}`});
  const auth=btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded'},body});
  if(!r.ok)throw Error(`Twilio HTTP ${r.status}: ${(await r.text()).slice(0,250)}`);
}
export default {async fetch(request,env,ctx){
  const origin=request.headers.get('Origin')||'';
  if(!permitted(origin,env))return json({error:'Websiden er ikke tilladt.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400','Vary':'Origin'}});
  if(request.method!=='POST')return json({error:'Kun POST er tilladt'},405,origin);
  if(!env.LEADS_KV)return json({error:'Tilbudssystemet mangler lageropsætning.'},503,origin);
  if(!env.RESEND_API_KEY || !env.LEADS_NOTIFY_TO || !env.LEADS_FROM || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM || !env.LEADS_SMS_TO)return json({error:'Varslinger er endnu ikke konfigureret.'},503,origin);
  const size=Number(request.headers.get('content-length')||0);
  if(size>maxBody)return json({error:'Forespørgslen er for stor.'},413,origin);
  let raw;try{raw=await request.text()}catch{return json({error:'Kunne ikke læse forespørgslen.'},400,origin)}
  if(raw.length>maxBody)return json({error:'Forespørgslen er for stor.'},413,origin);
  let p;try{p=JSON.parse(raw)}catch{return json({error:'Ugyldigt dataformat.'},400,origin)}
  if(!p||typeof p!=='object'||Array.isArray(p))return json({error:'Ugyldigt dataformat.'},400,origin);
  if(p.website)return json({ok:true},200,origin); // spam-fælde
  const l={id:crypto.randomUUID(),receivedAt:new Date().toISOString(),name:clean(p.name,100),phone:clean(p.phone,24),email:clean(p.email,120),service:clean(p.service,60),product:clean(p.product,120),message:clean(p.message,2000),consent:p.consent===true,quote:null,notificationStatus:'pending'};
  if(!l.consent||!l.name||!validPhone(l.phone)||!validEmail(l.email))return json({error:'Kontrollér navn, telefonnummer og samtykke.'},400,origin);
  if(p.quote&&typeof p.quote==='object'){
    const q=p.quote,m=q.meters||{},num=x=>Math.min(1000,Math.max(0,Number(x)||0));
    const existing=q.existingCable===true,space=q.spaceInBoard===true,relay=q.relay===true;
    const cable=existing?0:num(m.cable),pipe=num(m.pipe),channel=num(m.channel);
    l.quote={existingCable:existing,spaceInBoard:space,relay,meters:{cable,pipe,channel},total:Math.round((cable*60+pipe*32.75+channel*28+(space?0:100)+(relay?150:0))*100)/100};
  }
  try{await env.LEADS_KV.put(`lead:${l.receivedAt}:${l.id}`,JSON.stringify(l),{expirationTtl:60*60*24*90});}
  catch(e){console.error('KV write failed',e);return json({error:'Tilbuddet kunne ikke gemmes. Prøv igen.'},503,origin)}
  ctx.waitUntil((async()=>{
    const status=await Promise.allSettled([notifyMail(l,env),notifySms(l,env)]);
    const record={...l,notificationStatus:status.map((v,i)=>({channel:i?'sms':'email',status:v.status==='fulfilled'?'sent':'failed'}))};
    for(const [i,v] of status.entries())if(v.status==='rejected')console.error(i?'SMS failed':'Email failed',v.reason);
    try{await env.LEADS_KV.put(`lead:${l.receivedAt}:${l.id}`,JSON.stringify(record),{expirationTtl:60*60*24*90});}catch(e){console.error('status update',e)}
  })());
  return json({ok:true,message:'Vi har modtaget din forespørgsel og ringer dig op.'},201,origin);
}};
