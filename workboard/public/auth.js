import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,setPersistence,browserSessionPersistence,signInWithCustomToken,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
const $=id=>document.getElementById(id),emailForm=$('login-email-form'),codeForm=$('login-code-form');
let auth,challenge=null,email='',busy=false,waitUntil=0;
function message(text){$('login-message').textContent=text;}
async function call(path,options={}){const headers={'Content-Type':'application/json',...options.headers};if(auth?.currentUser)headers.Authorization='Bearer '+await auth.currentUser.getIdToken();const response=await fetch('/api'+path,{...options,headers,cache:'no-store'});let payload;try{payload=await response.json();}catch{throw Error('The workboard API is not configured. Complete the Firebase setup.');}if(!response.ok){const error=Error(payload.error||'Request failed.');error.status=response.status;throw error;}return payload;}
function lock(value){busy=value;emailForm.querySelector('button').disabled=value;codeForm.querySelector('button').disabled=value;refreshResend();}
function refreshResend(){const seconds=Math.max(0,Math.ceil((waitUntil-Date.now())/1000));$('login-resend').disabled=busy||seconds>0;$('login-resend').textContent=seconds?`Resend in ${seconds}s`:'Resend code';}
async function requestCode(){
 if(busy)return;const value=$('login-email').value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._+-]{0,63}@vedaengg\.com$/.test(value)){message('Use your @vedaengg.com work email.');return;}
 lock(true);message('Sending your code…');try{const result=await call('/auth/request-code',{method:'POST',body:JSON.stringify({email:value})});email=value;challenge=result.challenge;waitUntil=Date.now()+result.resendAfter*1000;codeForm.hidden=false;$('login-code').value='';$('login-code').focus();message(`A code was sent to ${email}. It expires in 10 minutes.`);}catch(error){message(error.message);}finally{lock(false);}
}
emailForm.onsubmit=e=>{e.preventDefault();requestCode();};$('login-resend').onclick=requestCode;
$('login-email').oninput=()=>{codeForm.hidden=true;challenge=null;};
codeForm.onsubmit=async e=>{e.preventDefault();if(busy||!challenge)return;lock(true);message('Verifying…');try{const {customToken}=await call('/auth/verify-code',{method:'POST',body:JSON.stringify({email,challenge,code:$('login-code').value.trim()})});await signInWithCustomToken(auth,customToken);}catch(error){message(error.message);}finally{lock(false);}};
setInterval(refreshResend,1000);
try{
 const response=await fetch('/__/firebase/init.json',{cache:'no-store'});if(!response.ok)throw Error('Open this app through the configured Firebase Hosting site.');const config=await response.json();
 auth=getAuth(initializeApp(config,'vepl-workboard'));await setPersistence(auth,browserSessionPersistence);
 onAuthStateChanged(auth,async user=>{if(!user){message('Enter your work email to receive a one-time code.');return;}try{const initial=await call('/state');window.resolveWorkboard({actor:initial.actor,initial,api:call,logout:async()=>{await signOut(auth);location.reload();}});}catch(error){await signOut(auth);message(error.message);}});
}catch(error){message(error.message);emailForm.querySelector('button').disabled=true;}
