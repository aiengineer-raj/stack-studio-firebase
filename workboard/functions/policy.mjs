import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
export const MANAGER='rohit.hotkar@vedaengg.com';
export const EMPTY={version:1,employees:[],projects:[],tasks:[],timeOff:[],scheduleDecisions:[],deadlineRequests:[]};
export function fail(status,message){const e=new Error(message);e.status=status;throw e;}
export function emailOf(value){const email=String(value||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._+-]{0,63}@vedaengg\.com$/.test(email))fail(400,'Use your @vedaengg.com work email.');return email;}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const roleOf=email=>emailOf(email)===MANAGER?'manager':'employee';
export const otpDigest=(secret,email,challenge,code)=>createHmac('sha256',secret).update(`${email}\n${challenge}\n${code}`).digest('hex');
export function checkOtp(record,{email,challenge,code,secret,now}){
 if(!record||record.challenge!==challenge||!record.delivered||record.used||record.expiresAt<=now||record.attempts>=5)return {ok:false,error:'Code expired or unavailable. Request a new code.'};
 const expected=Buffer.from(record.digest,'hex'),given=Buffer.from(otpDigest(secret,email,challenge,code),'hex');
 if(expected.length!==given.length||!timingSafeEqual(expected,given))return {ok:false,attempts:record.attempts+1,error:'Incorrect code.'};
 return {ok:true};
}
const sections=Object.keys(EMPTY).filter(k=>k!=='version');
const date=v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v)));
export function normalize(input){const out={version:1};for(const key of sections)out[key]=input?.[key]||[];return out;}
export function validate(state){
 if(!state||state.version!==1)fail(400,'Invalid workboard data.');
 for(const key of sections){if(!Array.isArray(state[key])||state[key].length>2000)fail(400,`Invalid ${key}.`);if(key==='scheduleDecisions')continue;const ids=new Set();for(const r of state[key]){if(!r||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.id)||ids.has(r.id))fail(400,`Invalid or duplicate ${key} ID.`);ids.add(r.id);}}
 const people=new Set(state.employees.map(e=>e.id)),projects=new Set(state.projects.map(p=>p.id)),emails=new Set();
 for(const e of state.employees){if(typeof e.name!=='string'||!e.name.trim()||e.name.length>100)fail(400,'Employee name required.');const email=emailOf(e.email);if(email!==e.email||emails.has(email))fail(400,'Each employee needs a unique normalized work email.');emails.add(email);if(e.dailyCapacity!=null&&(!Number.isFinite(Number(e.dailyCapacity))||Number(e.dailyCapacity)<0||Number(e.dailyCapacity)>24))fail(400,'Invalid daily capacity.');}
 for(const p of state.projects)if(!people.has(p.leadId))fail(400,'Project lead must be an employee.');
 for(const t of state.tasks){if(!people.has(t.employeeId)||!projects.has(t.projectId)||typeof t.title!=='string'||!t.title.trim()||!['To do','Work in progress','Pending action','Done'].includes(t.status)||!date(t.dueDate||''))fail(400,'Invalid task or assignment.');}
 if(Buffer.byteLength(JSON.stringify(state))>750000)fail(413,'This pilot board has reached its 750 KB limit. Export records before expanding storage.');
 return state;
}
export function viewFor(state,email){
 if(roleOf(email)==='manager')return structuredClone(state);
 const self=state.employees.find(e=>e.email===email);if(!self)fail(403,'Your employee record is unavailable. Sign out and sign in again.');
 const tasks=state.tasks.filter(t=>t.employeeId===self.id),taskIds=new Set(tasks.map(t=>t.id));
 const projects=state.projects.filter(p=>p.leadId===self.id||tasks.some(t=>t.projectId===p.id)).map(p=>p.leadId===self.id?p:{id:p.id,code:p.code,name:p.name,client:p.client||'',dueDate:p.dueDate||'',leadId:''});
 return {version:1,employees:[structuredClone(self)],projects:structuredClone(projects),tasks:structuredClone(tasks),timeOff:structuredClone(state.timeOff.filter(x=>x.employeeId===self.id||x.employeeId==='all')),scheduleDecisions:structuredClone(state.scheduleDecisions.filter(x=>x.employeeId===self.id&&(x.taskIds||[]).every(id=>taskIds.has(id)))),deadlineRequests:structuredClone(state.deadlineRequests.filter(x=>x.employeeId===self.id&&taskIds.has(x.taskId)))};
}
const taskEditable=['title','detail','status','pendingReason','completionNote','startDate','priority','estimatedHours','workDate','ddKey','ddRow','ddFile','ddSerial','documentNo','revision','kind','responsible','actualEndDate','sourceStatus','remark'];
const taskClientMetadata=['history','editHistory','sourceHistory','updatedAt','completedAt','createdAt'];
function onlyChanged(before,after,allowed){for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(!equal(before[key],after[key])&&!allowed.includes(key))fail(403,`You cannot change ${key}.`);}
export function applyWrite(old,input,email,now=new Date().toISOString()){
 const next=normalize(input);
 for(const key of sections)if(!Array.isArray(next[key]))fail(400,`Invalid ${key}.`);
 if(Buffer.byteLength(JSON.stringify(next))>750000)fail(413,"Request too large.");
 if(roleOf(email)==='manager'){
   validate(next);
   // Every live review is attributed to the verified manager rather than a typed name.
   for(const q of next.deadlineRequests){const prev=old.deadlineRequests.find(r=>r.id===q.id);if(prev?.status==='pending'&&['approved','rejected'].includes(q.status)){q.reviewer=email;q.reviewedAt=now;}}
   return next;
 }
 const before=viewFor(old,email),self=before.employees[0];
 for(const key of ['employees','projects','timeOff'])if(!equal(before[key],next[key]))fail(403,`Only the manager can change ${key}.`);
 const merged=structuredClone(old),owned=new Map(before.tasks.map(t=>[t.id,t]));
 if(before.tasks.some(t=>!next.tasks.some(n=>n.id===t.id)))fail(403,'Only the manager can remove tasks.');
 for(const t of next.tasks){const prev=owned.get(t.id);if(t.employeeId!==self.id)fail(403,'You cannot assign work to another employee.');
   if(!prev){if(old.tasks.some(x=>x.id===t.id)||!old.projects.some(p=>p.id===t.projectId&&p.leadId===self.id))fail(403,'You can add deliverables only to a project you lead.');merged.tasks.push({...t,status:'To do',pendingReason:'',completionNote:'',completedAt:null,createdAt:now,history:[],editHistory:[],sourceHistory:[]});continue;}
   onlyChanged(prev,t,[...taskEditable,...taskClientMetadata]);
   const updated={...prev};for(const key of taskEditable)if(key in t)updated[key]=t[key];
   if(updated.status==='Pending action'&&String(updated.pendingReason||'').trim().length<3)fail(400,'A pending-action reason is required.');
   if(updated.status==='Done'&&prev.status!=='Done'&&String(updated.completionNote||'').trim().length<3)fail(400,'A completion note is required.');
   if(!equal(updated,prev)){updated.updatedAt=now;updated.editHistory=[...(prev.editHistory||[]),{at:now,by:email,fields:taskEditable.filter(k=>!equal(prev[k],updated[k]))}];}
   if(updated.status!==prev.status||updated.pendingReason!==prev.pendingReason){updated.history=[...(prev.history||[]),{at:now,by:email,from:prev.status,to:updated.status,reason:updated.status==='Done'?updated.completionNote:updated.pendingReason||''}];updated.completedAt=updated.status==='Done'?now:null;}
   merged.tasks[merged.tasks.findIndex(x=>x.id===t.id)]=updated;
 }
 const mine=new Set(merged.tasks.filter(t=>t.employeeId===self.id).map(t=>t.id));
 if(next.scheduleDecisions.length<before.scheduleDecisions.length||!equal(next.scheduleDecisions.slice(0,before.scheduleDecisions.length),before.scheduleDecisions))fail(403,'Saved decisions cannot be rewritten.');
 for(const d of next.scheduleDecisions.slice(before.scheduleDecisions.length)){if(d.employeeId!==self.id||!Array.isArray(d.taskIds)||!d.taskIds.every(id=>mine.has(id))||!d.taskIds.includes(d.focusTaskId)||!Array.isArray(d.reasons)||d.reasons.length!==d.taskIds.length-1||new Set(d.reasons.map(r=>r.taskId)).size!==d.reasons.length||d.reasons.some(r=>!d.taskIds.includes(r.taskId)||r.taskId===d.focusTaskId||String(r.reason||'').trim().length<3))fail(403,'Invalid work priority decision.');merged.scheduleDecisions.push({...d,at:now,by:email});}
 for(const q of before.deadlineRequests){const n=next.deadlineRequests.find(x=>x.id===q.id);if(!n)fail(403,'Requests cannot be removed.');onlyChanged(q,n,['status']);if(q.status!==n.status&&!(q.status==='pending'&&n.status==='superseded'))fail(403,'Only the manager can review requests.');if(n.status!==q.status)merged.deadlineRequests.find(x=>x.id===q.id).status=n.status;}
 for(const q of next.deadlineRequests.filter(x=>!before.deadlineRequests.some(p=>p.id===x.id))){const task=old.tasks.find(t=>t.id===q.taskId);if(old.deadlineRequests.some(x=>x.id===q.id)||!task||!mine.has(task.id)||q.employeeId!==self.id||q.status!=='pending'||q.originalDate!==(task.dueDate||'')||!q.proposedDate||!date(q.proposedDate)||String(q.reason||'').trim().length<3)fail(403,'Invalid deadline request.');merged.deadlineRequests.push({id:q.id,taskId:q.taskId,employeeId:self.id,originalDate:q.originalDate,proposedDate:q.proposedDate,reason:q.reason,status:'pending',createdAt:now,by:email});}
 return validate(merged);
}
