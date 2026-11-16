import {onRequest} from 'firebase-functions/v2/https';
import {defineSecret,defineString} from 'firebase-functions/params';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {randomInt,randomBytes} from 'node:crypto';
import {EMPTY,fail,emailOf,hash,roleOf,otpDigest,checkOtp,normalize,validate,viewFor,applyWrite} from './policy.mjs';
const app=initializeApp(),auth=getAuth(app);
const resendKey=defineSecret('WORKBOARD_RESEND_API_KEY'),pepper=defineSecret('WORKBOARD_OTP_PEPPER');
const origin=defineString('WORKBOARD_ORIGIN'),sender=defineString('WORKBOARD_EMAIL_FROM');
const database=defineString('WORKBOARD_DATABASE',{default:'vepl-workboard'});
function resources(){const db=getFirestore(app,database.value()),root=db.collection('veplWorkboard').doc('main');return {db,root,board:root.collection('data').doc('board')};}
function bodyOf(req){let b=req.body;if(Buffer.isBuffer(b))b=JSON.parse(b.toString());if(typeof b==='string')b=JSON.parse(b);if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'JSON body required.');return b;}
function current(snap){const d=snap.data()||{};return {revision:d.revision||0,state:normalize(d.state||EMPTY)};}
async function limit(key,max,windowMs){const {db,root}=resources(),ref=root.collection('limits').doc(hash(key)),now=Date.now();const allowed=await db.runTransaction(async tx=>{const s=await tx.get(ref),v=s.data()||{},start=v.start||0,count=now-start<windowMs?(v.count||0):0;if(count>=max)return false;tx.set(ref,{start:now-start<windowMs?start:now,count:count+1});return true;});if(!allowed)fail(429,'Too many attempts. Please try again later.');}
async function sendCode(req,res){
 const {email:raw}=bodyOf(req),email=emailOf(raw),{db,root}=resources(),now=Date.now();
 await limit(`send-ip:${req.ip||'unknown'}`,20,3600000);
 await limit('send-global-day',500,86400000);
 const challenge=randomBytes(24).toString('hex'),code=String(randomInt(0,1000000)).padStart(6,'0'),ref=root.collection('otp').doc(hash(email));
 const allowed=await db.runTransaction(async tx=>{const s=await tx.get(ref),old=s.data()||{},count=now-(old.windowStart||0)<3600000?(old.sent||0):0;if(now-(old.lastSent||0)<60000||count>=5)return false;tx.set(ref,{challenge,digest:otpDigest(pepper.value(),email,challenge,code),expiresAt:now+600000,attempts:0,used:false,delivered:false,lastSent:now,windowStart:count?old.windowStart:now,sent:count+1});return true;});
 if(!allowed)fail(429,'Wait 60 seconds before requesting another code. Maximum five requests per hour.');
 let response;
 try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey.value()}`,'Content-Type':'application/json','Idempotency-Key':`otp-${challenge}`},body:JSON.stringify({from:sender.value(),to:[email],subject:'Your VEPL Workboard sign-in code',text:`Your sign-in code is ${code}. It expires in 10 minutes and can be used once. If you did not request it, ignore this email.`}),signal:AbortSignal.timeout(12000)});}catch{fail(503,'Email delivery could not be confirmed. Please try again in a minute.');}
 if(!response.ok){
   // Record only sanitized diagnostic fields; never log API keys, OTPs, or full addresses.
   let details={};try{details=await response.json();}catch{}
   const safeDetail=String(details.message||details.error||'No error detail returned')
     .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
     .replace(/re_[A-Za-z0-9_-]+/g,'[redacted-key]')
     .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
     .slice(0,300);
   console.error('Resend rejected Workboard email request',{status:response.status,code:details.name||details.code||null,detail:safeDetail,requestId:response.headers.get('x-resend-id')||null});
   fail(503,'Email delivery is unavailable. Please try again later.');
 }
 await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.challenge===challenge)tx.update(ref,{delivered:true});});
 res.json({challenge,expiresIn:600,resendAfter:60});
}
async function verifyCode(req,res){
 const b=bodyOf(req),email=emailOf(b.email);if(!/^[a-f0-9]{48}$/.test(b.challenge||'')||!/^\d{6}$/.test(b.code||''))fail(400,'Enter the six-digit code from your email.');
 await limit(`verify-ip:${req.ip||'unknown'}`,100,3600000);
 const {db,root,board}=resources(),ref=root.collection('otp').doc(hash(email));
 const result=await db.runTransaction(async tx=>{const s=await tx.get(ref),check=checkOtp(s.data(),{email,challenge:b.challenge,code:b.code,secret:pepper.value(),now:Date.now()});if(check.ok)tx.update(ref,{used:true,usedAt:Date.now()});else if(check.attempts!=null)tx.update(ref,{attempts:check.attempts});return check;});
 if(!result.ok)fail(401,result.error);
 // A dedicated custom-auth UID avoids modifying existing VEPLWorks password/provider accounts.
 const uid='wb_'+hash(email);
 let user;try{user=await auth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;try{user=await auth.createUser({uid,displayName:email});}catch(error){if(error.code!=='auth/uid-already-exists')throw error;user=await auth.getUser(uid);}}
 if(user.disabled)fail(403,'This account is disabled.');
 await db.runTransaction(async tx=>{const snap=await tx.get(board),old=current(snap);if(!old.state.employees.some(e=>e.email===email)){const name=email.split('@')[0].split(/[._-]/).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');old.state.employees.push({id:user.uid,email,name,role:roleOf(email)==='manager'?'Manager':'Engineer',createdAt:new Date().toISOString()});validate(old.state);tx.set(board,{state:old.state,revision:old.revision+1});}});
 const customToken=await auth.createCustomToken(user.uid,{workboardOtp:true,workboardEmail:email});
 res.json({customToken});
}
async function identity(req){
 const match=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(!match)fail(401,'Sign in to continue.');
 let decoded;try{decoded=await auth.verifyIdToken(match[1],true);}catch{fail(401,'Session expired. Sign in again.');}
 if(decoded.workboardOtp!==true)fail(403,'Use Workboard email OTP sign-in.');
 const email=emailOf(decoded.workboardEmail);if(decoded.uid!=='wb_'+hash(email))fail(403,'Verified workboard identity required.');
 const user=await auth.getUser(decoded.uid);if(user.disabled)fail(403,'This account is disabled.');
 return {uid:user.uid,email,role:roleOf(email)};
}
export const workboardApi=onRequest({region:'asia-south1',invoker:'public',secrets:[resendKey,pepper],timeoutSeconds:30,maxInstances:5,memory:'256MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
   if(['POST','PUT','DELETE'].includes(req.method)&&req.headers.origin!==origin.value())fail(403,'Request origin is not allowed.');
   const path=req.path.replace(/^\/api/,'');
   if(req.method==='POST'&&path==='/auth/request-code')return await sendCode(req,res);
   if(req.method==='POST'&&path==='/auth/verify-code')return await verifyCode(req,res);
   const actor=await identity(req),{db,root,board}=resources();
   if(req.method==='GET'&&path==='/state'){const old=current(await board.get());return res.json({actor,revision:old.revision,state:viewFor(old.state,actor.email)});}
   if(req.method==='PUT'&&path==='/state'){
     const body=bodyOf(req);if(!Number.isSafeInteger(body.revision))fail(400,'Revision required.');
     const result=await db.runTransaction(async tx=>{const old=current(await tx.get(board));if(old.revision!==body.revision)fail(409,'Records changed elsewhere. Reload the latest records and try your change again.');const next=applyWrite(old.state,body.state,actor.email);tx.set(board,{state:next,revision:old.revision+1,updatedAt:FieldValue.serverTimestamp()});tx.create(root.collection('audit').doc(),{uid:actor.uid,email:actor.email,role:actor.role,fromRevision:old.revision,toRevision:old.revision+1,at:FieldValue.serverTimestamp(),taskCount:next.tasks.length});return {actor,revision:old.revision+1,state:viewFor(next,actor.email)};});return res.json(result);
   }
   fail(404,'Not found.');
 }catch(error){const status=error.status||500;if(status===500)console.error('Workboard request failed',{code:error.code||'internal',path:req.path});res.status(status).json({error:status===500?'The server could not complete this request. Please try again.':error.message});}
});
