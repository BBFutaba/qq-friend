// 帮手 runner: one Claude Agent SDK session with WebSearch, WebFetch and an in-process character tool that returns the
// character text it was given (no shell, files, other MCP, user settings or skills), every call checked by helperPermission.
// The input stays open until the result, so permission checks can still be answered. The owner's claude.ai connectors are
// kept out (strictMcpConfig, disableClaudeAiConnectors): they are not the helper's to use, and cost ~60k tokens a turn.
// Prints {text, usage, model, rounds, tools}; text is the helper's {"result","sources"} JSON.
import { pathToFileURL } from 'node:url';
import { HELPER_TOOLS, CHARACTER_TOOL, CHARACTER_NOTE, helperPermission, helperJson } from '../src/helper.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
try{
 const input=JSON.parse(raw);const {query,tool,createSdkMcpServer}=await import(pathToFileURL(input.sdk).href);
 const character=createSdkMcpServer({name:'qq',version:'1.0.0',tools:[tool('character',CHARACTER_NOTE,{},async()=>({content:[{type:'text',text:input.character||'（没有人格设定）'}]}),{alwaysLoad:true})]});
 const options={cwd:process.cwd(),tools:HELPER_TOOLS,allowedTools:['WebSearch',CHARACTER_TOOL],disallowedTools:['Bash','Read','Write','Edit','Glob','Grep','NotebookEdit','Task','Agent','Skill'],mcpServers:{qq:character},settingSources:[],plugins:[],skills:[],strictMcpConfig:true,settings:{disableClaudeAiConnectors:true},permissionMode:'default',persistSession:false,maxTurns:input.maxTurns||30,model:input.spec.model,...(input.spec.effort?{effort:input.spec.effort}:{}),systemPrompt:input.prompt.system,canUseTool:(name,toolInput)=>helperPermission(name,toolInput),env:{...process.env,ANTHROPIC_API_KEY:undefined,ANTHROPIC_AUTH_TOKEN:undefined}};
 let finished;const end=new Promise(resolve=>{finished=resolve;});
 async function* messages(){yield {type:'user',message:{role:'user',content:[{type:'text',text:JSON.stringify(input.prompt.data)}]}};await end;}
 const tools=[];let result,last='';
 for await(const m of query({prompt:messages(),options})){if(m.type==='assistant')for(const b of m.message?.content||[]){if(b.type==='tool_use')tools.push({name:String(b.name).slice(0,40),status:'completed'});if(b.type==='text'&&b.text.trim())last=b.text;}if(m.type==='result'){result=m;finished();}}
 // Out of turns, the last thing it said is still worth passing on.
 const text=result?.subtype==='success'&&result.result?.trim()?result.result:last;if(!text.trim())throw new Error('帮手没有给出结果：'+(result?.errors?.join(';')||result?.subtype||'unknown'));
 console.log(JSON.stringify({text:helperJson(text),usage:result?.usage,model:input.spec.model,rounds:result?.num_turns,tools}));
}catch(e){console.log(JSON.stringify({error:String(e.message).slice(0,600)}));process.exitCode=1;}
