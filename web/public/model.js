export const sections=[
 ['Users','/admin/users','users.view'],['Proxy monitor','/admin/proxy','users.view'],['AI & Usage','/admin/ai?days=7','ai.view'],['Memory','/admin/memory/stats','memory.view'],['Security','/admin/security','security.view'],['Moderation','/admin/reports','moderation.view'],['Content & Data','','moderation.view'],['System','/admin/config/view','system.view'],['Automation','/admin/jobs','automation.run'],['Developer','','system.view'],['Audit','/admin/audit','audit.view'],['Danger Zone','','danger.execute']
];
export function permits(identity,p){return p==='owner'?identity?.role==='owner':!!identity?.perms?.some(v=>v==='*'||v===p);}
export function payload(op,values){
 const out={...op.fixed};for(const f of op.fields){const v=String(values[f.key]??'').trim();if(!v){if(f.required)throw Error(f.label+' is required');continue;}
 if(f.choices&&!f.choices.includes(v))throw Error('Invalid '+f.label);
 switch(f.kind){
 case 'number':{const n=Number(v);if(!Number.isFinite(n)||n<0||(f.key!=='hours'&&!Number.isInteger(n)))throw Error(f.label+' must be a nonnegative '+(f.key==='hours'?'number':'whole number'));out[f.key]=n;break;}
 case 'bool':if(!['true','false'].includes(v))throw Error('Invalid '+f.label);out[f.key]=v==='true';break;
 case 'array':out[f.key]=v==='[]'?[]:v.split(',').map(x=>x.trim()).filter(Boolean);break;
 case 'json':try{out[f.key]=JSON.parse(v);}catch{throw Error(f.label+' must contain valid JSON');}break;
 default:out[f.key]=v==='""'?'':v;
 }}
 if(op.id==='broadcast')out.broadcast=String(values.broadcast??'');
 if(op.id==='user-delete'&&out.confirm!==out.u)throw Error('Type the target username to confirm');
 if(op.confirmation&&op.confirmation!=='CONFIRM'){if(values._confirmation!==op.confirmation)throw Error('Type '+op.confirmation+' to confirm');if(op.path==='/admin/danger')out.confirm=op.confirmation;}
 return op.id==='restore'?out.backup:out;
}
