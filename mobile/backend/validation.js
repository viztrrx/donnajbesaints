// Validate mobile request types without duplicating existing business rules.
export function validateMutation(path,b) {
  if(!b || Array.isArray(b) || typeof b!=='object') return 'A JSON object is required';
  const text=(keys,max=600)=>keys.every(k=>!(k in b) || typeof b[k]==='string' && b[k].length<=max);
  const nums=keys=>keys.every(k=>!(k in b) || typeof b[k]==='number' && Number.isFinite(b[k]) && b[k]>=0 && b[k]<=1000000000);
  const bools=keys=>keys.every(k=>!(k in b) || typeof b[k]==='boolean');
  const lists=keys=>keys.every(k=>!(k in b) || Array.isArray(b[k]) && b[k].length<=250 && b[k].every(v=>typeof v==='string' && v.length<=200));
  const flags=f=>f && !Array.isArray(f) && typeof f==='object' && Object.keys(f).length<=200 && Object.entries(f).every(([k,v])=>/^[a-zA-Z0-9_-]{1,80}$/.test(k) && typeof v==='boolean');
  if(!text(['action','user','u','id','target','role','confirm','reason','message','note','name','brandName','defaultTheme','broadcast'])) return 'Invalid text field';
  if(!nums(['hours','seconds','quotaDaily','quotaMonthly','dailyQuota','monthlyQuota','rpm','maxTokens'])) return 'Invalid numeric field';
  if(['seconds','quotaDaily','quotaMonthly','dailyQuota','monthlyQuota','rpm','maxTokens'].some(k=>k in b && !Number.isInteger(b[k]))) return 'Quotas, token limits, and slow-mode seconds must be whole numbers';
  if(!bools(['all','write','privateMode','readOnly','approvalMode','requireSessions','memoryEnabled','bumpReload','remove'])) return 'Invalid boolean field';
  if(!lists(['users','allowedModels','blockedCountries','allowedOrigins'])) return 'Invalid list field';
  if('features' in b && !flags(b.features)) return 'Feature switches must be a map of boolean values';
  if(path==='/admin/assignkey' && 'key' in b && (typeof b.key!=='string' || b.key.length>1024 || b.key && !b.key.startsWith('sk-'))) return 'Enter a valid OpenAI key or leave it empty to remove';
  if('announcement' in b && b.announcement!==null && (!b.announcement || Array.isArray(b.announcement) || typeof b.announcement!=='object' || Object.entries(b.announcement).some(([k,v])=>!['title','text'].includes(k) || typeof v!=='string' || v.length>600))) return 'Announcement must contain title/text strings or null';
  if(path==='/admin/restore' && (!b.config && !b.mods && !b.rooms && !b.roomCfgs && !b.audit)) return 'Not a server backup';
  return null;
}
