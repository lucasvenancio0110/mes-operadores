import secureApplication from './secure-main.js';
import { ensureAuthTables } from './auth.js';
import { handleProductionCounter, productionCounterHealth } from './production-counter.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

export default {
  async fetch(request,env,context){
    const url=new URL(request.url);
    if(url.pathname==='/api/v1/auth/production-counter-health'&&request.method==='GET'){
      try{
        const result=await productionCounterHealth(env);
        return json(result,result.ok?200:500);
      }catch(error){
        return json({ok:false,version:'6.4.0',counter:'estimated-not-official',history:true,error:error instanceof Error?error.message:String(error)},500);
      }
    }
    if(url.pathname.startsWith('/api/v1/production-counter/')){
      await ensureAuthTables(env);
      const response=await handleProductionCounter(request,env);
      if(response)return response;
    }
    return secureApplication.fetch(request,env,context);
  }
};
