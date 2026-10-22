// Read-only deployment check. Never sends QQ messages and never prints tokens.
// Exit code 0 when every required check passes; each failed check carries a "fix" hint.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSecrets, identityReady, ROOT, DATA } from '../src/config.js';
import { OneBot } from '../src/onebot.js';
import { Store } from '../src/store.js';
import { Providers } from '../src/providers.js';
import { mediaReady } from '../src/media-worker.js';
const secrets=ensureSecrets(),store=new Store(join(DATA,'friend.sqlite')),c=store.config(),providers=new Providers(store,secrets),checks=[];
const add=(name,ok,detail,fix,required=true)=>checks.push({name,ok,required,detail,...(ok?{}:{fix})});
add('node',Number(process.versions.node.split('.')[0])>=24,process.version,'安装 Node.js 24 或更新版本（node:sqlite 需要）');
add('dependencies',existsSync(join(ROOT,'node_modules','ws')),'node_modules/ws','在项目目录运行 npm ci');
add('onebot-settings',!!(secrets.httpUrl&&secrets.wsUrl&&secrets.token),`HTTP ${secrets.httpUrl||'未填'} · WS ${secrets.wsUrl||'未填'} · Token ${secrets.token?'已保存':'未填'}`,'在后台「连接与环境」填写 OneBot 地址和 Token，或设置 ONEBOT_HTTP_URL / ONEBOT_WS_URL / ONEBOT_TOKEN 后运行 node scripts/setup.js');
let who=null;
if(secrets.httpUrl&&secrets.token){try{who=await new OneBot(secrets,c.botId).whoami();add('onebot-login',!!who.account,`OneBot 当前登录 QQ ${who.account||'未知'}`,'确认 QQ 已登录且 OneBot 实现正在运行');}catch(e){add('onebot-login',false,e.message,'确认 QQ 和 OneBot 实现（NapCat / LLOneBot 等）正在运行，HTTP 服务已开启，地址与 Token 一致');}}
add('identity',identityReady(c),`机器人 ${c.botId||'未设置'} · 审批 ${c.ownerId||'未设置'} · 启用群 ${c.groups.filter(g=>g.enabled).map(g=>g.id).join('、')||'无'} · 白名单 ${c.privateAllowlist.length} 人`,'node scripts/configure.js --bot <机器人QQ> --owner <你的QQ> --group <群号>:<群名>，或在后台「连接与环境」填写');
if(who?.account&&c.botId)add('bot-qq-matches',who.account===c.botId,`配置 ${c.botId} / 实际登录 ${who.account}`,`把机器人 QQ 改为 ${who.account}，或在 OneBot 里登录配置的账号`);
const catalog=async name=>{try{const models=await providers.catalog(name);return {ok:Array.isArray(models)&&models.length>0,detail:`${models.length} 个模型`};}catch(e){return {ok:false,detail:String(e.message).slice(0,240)};}};
const codex=await catalog('codex'),claude=secrets.claudeSdk?await catalog('claude'):{ok:false,detail:'未找到 Claude Agent SDK'};
add('codex',codex.ok,codex.detail,'安装 Codex CLI 并用 ChatGPT 账号登录（codex login），GPT 人格与默认后台 agent 需要它',false);
add('claude',claude.ok,claude.detail,'安装并登录 Claude Code，再运行 npm install --prefix workspace/claude-sdk @anthropic-ai/claude-agent-sdk 和 node scripts/setup.js',false);
const roleProviders=[...new Set(Object.values(c.roles).map(r=>c.roleModels[r].provider))];
add('background-models',roleProviders.every(p=>({codex,claude})[p]?.ok),`后台 agent 使用 ${roleProviders.join(' + ')}`,codex.ok||claude.ok?'到「人格与模型 → 后台 agent」把四个角色切换到已可用的后端并保存':'至少需要 Codex（ChatGPT 登录）或 Claude Agent SDK 之一');
const enabled=c.groups.filter(g=>g.enabled),personaReady=g=>{const p=c.personas[g.persona];return !!p.prompt.trim()&&(p.provider!=='claude'||claude.ok)&&(p.provider!=='codex'||codex.ok)&&(p.provider!=='deepseek'||!!secrets.deepseekCommand);};
add('personas',enabled.length>0&&enabled.every(personaReady),enabled.map(g=>`${g.name}→${c.personas[g.persona].name}${c.personas[g.persona].prompt.trim()?'':'（设定为空）'}`).join('；')||'没有启用的群','到「人格与模型」为启用群使用的人格填写设定，并确认该人格的后端可用');
add('deepseek',!!secrets.deepseekCommand,secrets.deepseekCommand?'已找到 DeepSeek Harness':'未安装（只有 DeepSeek 人格需要）','安装 DeepSeek Harness 或设置 DEEPSEEK_HARNESS_CMD 后运行 node scripts/setup.js',false);
add('media',mediaReady(),mediaReady()?'图片 / 语音 / 视频解码已就绪':'未安装（不影响文字聊天）','node scripts/setup.js --media',false);
const health=await fetch(`http://127.0.0.1:${process.env.PORT||4891}/healthz`,{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).catch(()=>null);
const report={at:new Date().toISOString(),passed:checks.every(x=>x.ok||!x.required),server:health?`运行中 v${health.version}`:'未运行',paused:c.paused,debug:c.debug,checks,notes:['模型目录只证明客户端提供该选项，成功推理才证明账户当前可用：可运行 node scripts/probe-models.js。','本检查未向 QQ 发送任何消息。']};
providers.stop();store.close();writeFileSync(join(DATA,'doctor.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
