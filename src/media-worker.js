import { spawn } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { ROOT } from './config.js';
export function mediaReady(){return existsSync(join(ROOT,'workspace','media-ready.json'))&&existsSync(join(ROOT,'workspace','.venv','Scripts','python.exe'));}
export function confinedMediaPath(path){const root=realpathSync(join(ROOT,'workspace','media')),actual=realpathSync(path),rel=relative(root,actual);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('媒体路径超出独立工作目录');return actual;}
export function decodeMedia(action,file,signal){if(!['image','audio','video'].includes(action))throw new Error('不允许的媒体操作');file=confinedMediaPath(file);if(!mediaReady())throw new Error('请先安装独立媒体环境');
 return new Promise((resolve,reject)=>{const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:join(ROOT,'workspace','tmp'),TMP:join(ROOT,'workspace','tmp'),PYTHONUTF8:'1',PYTHONNOUSERSITE:'1',HF_HUB_OFFLINE:'1',HF_HOME:join(ROOT,'workspace','models')};
  const p=spawn(join(ROOT,'workspace','.venv','Scripts','python.exe'),['-I','-X','utf8',join(ROOT,'worker','media.py')],{cwd:join(ROOT,'workspace'),env,stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';
  const abort=()=>{p.kill();reject(new Error('媒体处理已取消或超时'));};const timer=setTimeout(abort,60000);signal?.addEventListener('abort',abort,{once:true});p.stdout.setEncoding('utf8');p.stdout.on('data',s=>{output+=s;if(output.length>4e6)abort();});p.stderr.resume();p.stdin.on('error',()=>{});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};p.on('error',e=>{cleanup();reject(e);});p.on('close',code=>{cleanup();try{const result=JSON.parse(output);if(code||result.error)throw new Error(result.error||'媒体解码失败');resolve(result);}catch(e){reject(e);}});p.stdin.end(JSON.stringify({action,file}));if(signal?.aborted)abort();});
}
