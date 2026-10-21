import assets from './assets.generated.js';
const COOKIE = '__Secure-saints_session';
const baseHeaders = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply = (data,status=200,extra={}) => new Response(JSON.stringify(data),{status,headers:{...baseHeaders,'Content-Type':'application/json',...extra}});
const cookie = (token,age=0) => `${COOKIE}=${token}; Path=/app/api/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
const session = req => (req.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1) || '';
export async function webApp(req,env,ctx,dispatch) {
  const url=new URL(req.url),path=url.pathname;
  if(path!=='/app' && !path.startsWith('/app/')) return null;
  if(path==='/app') return new Response(null,{status:308,headers:{...baseHeaders,Location:'/app/'}});
  if(!path.startsWith('/app/api/')) {
    if(!['GET','HEAD'].includes(req.method)) return reply({error:'Method not allowed'},405);
    const asset=assets[path];if(!asset) return reply({error:'Not found'},404);
    const headers={...baseHeaders,'Content-Type':asset.type,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Frame-Options':'DENY'};
    if(path==='/app/sw.js') headers['Service-Worker-Allowed']='/app/';
    const body=asset.base64 ? Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)) : asset.body;
    return new Response(req.method==='HEAD'?null:body,{headers});
  }
  // A custom header and same-origin check prevent form/image and cross-site
  // cookie requests. Browser sessions never travel to the original CORS APIs.
  if(req.headers.get('X-Saints-Request')!=='1' || (req.headers.get('Origin') && req.headers.get('Origin')!==url.origin) || (req.headers.get('Sec-Fetch-Site') && !['same-origin','none'].includes(req.headers.get('Sec-Fetch-Site')))) return reply({error:'Same-origin app request required'},403);
  const forwarded=async(route,{method='GET',body,token,owner,id}={})=>{
    const headers=new Headers({'Content-Type':'application/json'});
    if(token) headers.set('X-GPA-Mobile',token);
    if(owner) headers.set('Authorization','Bearer '+owner);
    if(id) headers.set('X-Operation-ID',id);
    // Preserve the client IP for pairing throttles; never accept one in JSON.
    const ip=req.headers.get('CF-Connecting-IP');if(ip) headers.set('CF-Connecting-IP',ip);
    return dispatch(new Request(url.origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
  };
  const parsed=async()=>{const text=await req.text();if(text.length>2000000) throw Error('Request too large');return JSON.parse(text);};
  const route=path.slice('/app/api'.length);
  try {
    if(['/login','/pair'].includes(route)) {
      if(req.method!=='POST') return reply({error:'Method not allowed'},405);
      const b=await parsed();if(!b || typeof b!=='object' || typeof b.name!=='string' || !b.name.trim() || b.name.length>60) return reply({error:'Enter a device name (up to 60 characters)'},400);
      let code=b.code;
      if(route==='/login') {
        if(typeof b.ownerToken!=='string' || !b.ownerToken || b.ownerToken.length>4096) return reply({error:'Enter the owner credential'},400);
        const r=await forwarded('/admin/mobile/pair',{method:'POST',owner:b.ownerToken,body:{role:'owner'}});
        if(!r.ok) return reply(await r.json(),r.status);
        code=(await r.json()).code;
      }
      const r=await forwarded('/mobile/pair',{method:'POST',body:{code,name:b.name}}),data=await r.json();
      if(!r.ok) return reply(data,r.status);
      if(!/^[a-f0-9]{64}$/.test(data.token || '') || !data.device?.expiresAt) return reply({error:'Invalid pairing response'},502);
      const maxAge=Math.max(0,Math.min(604800,Math.floor((data.device.expiresAt-Date.now())/1000)));
      return reply({ok:true,device:data.device},200,{'Set-Cookie':cookie(data.token,maxAge)});
    }
    const token=session(req);
    if(!/^[a-f0-9]{64}$/.test(token)) return reply({error:'Sign in to Saints Command'},401,{'Set-Cookie':cookie('')});
    if(route==='/logout') {
      if(req.method!=='POST') return reply({error:'Method not allowed'},405);
      const identity=await forwarded('/admin/whoami',{token});let revoked=false;
      if(identity.ok) {const d=await identity.json();if(d.device?.id){const r=await forwarded('/admin/mobile/revoke',{method:'POST',token,id:crypto.randomUUID(),body:{id:d.device.id}});revoked=r.ok;}}
      return reply({ok:true,revoked},200,{'Set-Cookie':cookie('')});
    }
    if(!/^\/admin\/[a-z/]+$/.test(route) || !['GET','POST'].includes(req.method)) return reply({error:'Not found'},404);
    const result=await forwarded(route+url.search,{token,method:req.method,body:req.method==='POST'?await parsed():undefined,id:req.headers.get('X-Operation-ID') || undefined});
    // Strip original wildcard CORS headers: this gateway is same-origin only.
    return new Response(result.body,{status:result.status,headers:{...baseHeaders,'Content-Type':'application/json',...(result.status===401?{'Set-Cookie':cookie('')}:{})}});
  }catch {return reply({error:'Unable to complete request. Check connection and inspect any pending operation before repeating.'},503);}
}
