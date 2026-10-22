import { pathToFileURL } from 'node:url';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
try{
 const input=JSON.parse(raw);const {query}=await import(pathToFileURL(input.sdk).href);
 const options={cwd:process.cwd(),tools:[],mcpServers:{},settingSources:[],plugins:[],skills:[],permissionMode:'dontAsk',persistSession:false,maxTurns:1,canUseTool:async()=>({behavior:'deny',message:'No tools in QQ text sessions'}),env:{...process.env,ANTHROPIC_API_KEY:undefined,ANTHROPIC_AUTH_TOKEN:undefined}};
 if(input.spec){options.model=input.spec.model;if(input.spec.effort)options.effort=input.spec.effort;options.systemPrompt=input.prompt.system;}
 let unlock;const gate=new Promise(resolve=>{unlock=resolve;});
 async function* messages(){await gate;if(input.catalog)return;yield {type:'user',message:{role:'user',content:[{type:'text',text:JSON.stringify(input.prompt?.data||{})},...(input.images||[]).map(url=>{const m=url.match(/^data:([^;]+);base64,(.*)$/s);return {type:'image',source:{type:'base64',media_type:m[1],data:m[2]}};})]}};}
 const q=query({prompt:messages(),options});
 if(input.catalog){const models=await q.supportedModels();q.close();unlock();console.log(JSON.stringify({models:models.map(m=>({id:m.value,name:m.displayName||m.value,efforts:m.supportedEffortLevels||[]}))}));}
 else{const models=await q.supportedModels();const model=models.find(m=>m.value===input.spec.model);if(!model||input.spec.effort&&!(model.supportedEffortLevels||[]).includes(input.spec.effort)){q.close();unlock();throw new Error(`Claude 未提供模型/强度 ${input.spec.model} / ${input.spec.effort}，请在后台选择实际值`);}unlock();
 let result;for await(const m of q){if(m.type==='result')result=m;if(m.type==='assistant'&&m.message?.content?.some(c=>c.type==='tool_use')){q.close();throw new Error('禁用工具的 Claude 会话产生工具调用');}}
 if(!result||result.is_error||result.subtype!=='success')throw new Error('Claude 未成功完成：'+(result?.errors?.join(';')||result?.subtype||'unknown'));
 console.log(JSON.stringify({text:result.result,usage:result.usage,model:input.spec.model}));}
}catch(e){console.log(JSON.stringify({error:String(e.message).slice(0,600)}));process.exitCode=1;}
