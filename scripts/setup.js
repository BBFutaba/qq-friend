// First-run setup. Safe to re-run: it only fills in missing local settings and never prints tokens.
// Optional environment variables (handy for agents): ONEBOT_HTTP_URL, ONEBOT_WS_URL, ONEBOT_TOKEN,
// ONEBOT_WS_TOKEN, CLAUDE_AGENT_SDK, DEEPSEEK_HARNESS_CMD, PYTHON. Pass --media to also install the
// optional image/voice/video decoder (downloads Python wheels and the Whisper base model).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, DATA, ensureSecrets, saveSecrets } from '../src/config.js';
import { localUrl } from '../src/onebot.js';
const media=process.argv.includes('--media'),notes=[];
const secrets=ensureSecrets(),env=process.env;
if(env.ONEBOT_HTTP_URL)secrets.httpUrl=localUrl(env.ONEBOT_HTTP_URL);
if(env.ONEBOT_WS_URL)secrets.wsUrl=localUrl(env.ONEBOT_WS_URL,true);
if(env.ONEBOT_TOKEN)secrets.token=env.ONEBOT_TOKEN.trim();
if(env.ONEBOT_WS_TOKEN||env.ONEBOT_TOKEN)secrets.wsToken=(env.ONEBOT_WS_TOKEN||env.ONEBOT_TOKEN).trim();
const run=(cmd,args)=>spawnSync(cmd,args,{windowsHide:true,encoding:'utf8'});
// Claude Agent SDK: an explicit path, the project-local install in workspace/claude-sdk, or a global npm install.
const sdkIn=dir=>join(dir,'@anthropic-ai','claude-agent-sdk','sdk.mjs');
const npmRoot=env.APPDATA&&join(env.APPDATA,'npm','node_modules');
const sdk=[env.CLAUDE_AGENT_SDK,secrets.claudeSdk,sdkIn(join(ROOT,'workspace','claude-sdk','node_modules')),sdkIn(join(ROOT,'node_modules')),npmRoot&&sdkIn(npmRoot)].find(p=>p&&existsSync(p));
secrets.claudeSdk=sdk||'';if(!sdk)notes.push('未找到 Claude Agent SDK：需要 Claude 人格或后台模型时，运行 npm install --prefix workspace/claude-sdk @anthropic-ai/claude-agent-sdk 后重新运行 setup。');
// DeepSeek Harness is optional; only the DeepSeek persona uses it.
const dsh=[env.DEEPSEEK_HARNESS_CMD,secrets.deepseekCommand,env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Programs','DeepSeek Harness','resources','runtime','cli','bin','dsh.cmd')].find(p=>p&&existsSync(p));
secrets.deepseekCommand=dsh||'';
saveSecrets(secrets);
for(const dir of ['media','harness','tmp'])mkdirSync(join(ROOT,'workspace',dir),{recursive:true});
writeFileSync(join(DATA,'deepseek-text.patch.yml'),readFileSync(join(ROOT,'worker','deepseek-text.patch.yml')));
writeFileSync(join(DATA,'admin-token.txt'),secrets.adminToken+'\n');
// Python venv for the fixed media decoder. Missing Python only disables media understanding.
const venvPython=join(ROOT,'workspace','.venv','Scripts','python.exe');
if(!existsSync(venvPython)){
 const python=[env.PYTHON&&[env.PYTHON],['py','-3.13'],['py','-3'],['python']].filter(Boolean).find(([cmd,...a])=>/Python 3\.(1[1-9])/.test(run(cmd,[...a,'--version']).stdout||''));
 if(!python)notes.push('未找到 Python 3.11+：图片、语音、视频理解不可用，其余功能正常。安装 Python 3.13 后重新运行 setup。');
 else{const temp=join(ROOT,'workspace','tmp');const p=spawnSync(python[0],[...python.slice(1),'-m','venv',join(ROOT,'workspace','.venv')],{windowsHide:true,encoding:'utf8',env:{...env,TEMP:temp,TMP:temp,PYTHONUTF8:'1'}});if(p.status!==0)notes.push('独立 venv 创建失败：'+String(p.stderr).slice(0,300));}
}
if(media&&existsSync(venvPython)){
 const pip=spawnSync(venvPython,['-m','pip','install','-r',join(ROOT,'worker','requirements-lock.txt')],{stdio:'inherit',windowsHide:true});
 const model=pip.status===0&&spawnSync(venvPython,[join(ROOT,'scripts','setup-media.py')],{stdio:'inherit',windowsHide:true});
 if(pip.status!==0||model.status!==0)notes.push('媒体环境安装失败，可稍后重试 node scripts/setup.js --media。');
}
const mediaReady=existsSync(join(ROOT,'workspace','media-ready.json'))&&existsSync(venvPython);
if(!mediaReady&&!media)notes.push('媒体理解为可选项：需要时运行 node scripts/setup.js --media。');
if(!secrets.httpUrl||!secrets.wsUrl||!secrets.token)notes.push('OneBot 连接还没填：在后台「连接与环境」填写，或设置 ONEBOT_HTTP_URL / ONEBOT_WS_URL / ONEBOT_TOKEN 后重新运行 setup。');
console.log(JSON.stringify({onebotConfigured:!!(secrets.httpUrl&&secrets.token),websocketConfigured:!!secrets.wsUrl,claudeSdkFound:!!secrets.claudeSdk,deepseekFound:!!secrets.deepseekCommand,venv:existsSync(venvPython),mediaReady,adminToken:'data/admin-token.txt（不要发给别人）',notes},null,2));
