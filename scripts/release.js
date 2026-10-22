// Build dist/qq-friend-v<version>.zip from the committed tree with `git archive` (export-ignore paths are left
// out), then scan the zip and every tracked file for personal data. The markers to look for live in the
// untracked data/release-markers.txt (one per line), so the list itself is never published.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, DATA } from '../src/config.js';
const git=(...a)=>execFileSync('git',['-c','core.quotepath=false',...a],{cwd:ROOT,encoding:'utf8'});
const markerFile=join(DATA,'release-markers.txt');
if(!existsSync(markerFile))throw new Error(`缺少 ${markerFile}：每行写一个绝不能出现在发行包里的个人标记（QQ 号、群号、本机用户名、路径、邮箱等），然后再打包`);
const markers=[...new Set(readFileSync(markerFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')))];
if(!markers.length)throw new Error('data/release-markers.txt 里没有任何标记');
if(git('status','--porcelain').trim())throw new Error('工作区有未提交的修改，先提交再打包');
const scan=(root,paths)=>paths.flatMap(p=>{const text=readFileSync(join(root,p),'utf8');return markers.filter(m=>text.includes(m)).map(m=>`${p}: ${markers.indexOf(m)+1} 号标记`);});
// Everything tracked is what a repository clone exposes, whether or not it ships in the zip.
const tracked=git('ls-files').split('\n').filter(Boolean),trackedLeaks=scan(ROOT,tracked);
if(trackedLeaks.length)throw new Error('仓库里被跟踪的文件包含个人信息：\n'+trackedLeaks.join('\n'));
const {version}=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')),name=`qq-friend-v${version}`,zip=join(ROOT,'dist',name+'.zip');
mkdirSync(join(ROOT,'dist'),{recursive:true});
git('archive','--format=zip',`--prefix=${name}/`,'-o',zip,'HEAD');
const temp=mkdtempSync(join(tmpdir(),'qq-friend-release-'));
try{
 // Windows' bsdtar reads zip; Git's GNU tar (often first on PATH) would treat "E:" as a remote host.
 execFileSync(process.platform==='win32'?join(process.env.SystemRoot,'System32','tar.exe'):'tar',['-xf',zip,'-C',temp]);
 const files=[];const walk=d=>{for(const e of readdirSync(d)){const p=join(d,e);statSync(p).isDirectory()?walk(p):files.push(p);}};walk(join(temp,name));
 const rel=files.map(f=>relative(join(temp,name),f).replaceAll('\\','/'));
 const leaked=scan(join(temp,name),rel),forbidden=rel.filter(f=>/^(data|workspace|verification|node_modules|dist)\//.test(f)||/^scripts\/release\.js$|^\.gitattributes$/.test(f));
 if(leaked.length||forbidden.length)throw new Error('发行包包含个人信息或不该发布的文件：\n'+[...leaked,...forbidden].join('\n'));
 const bytes=readFileSync(zip);
 console.log(JSON.stringify({zip,files:rel.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),commit:git('rev-parse','--short','HEAD').trim(),scanned:`${markers.length} markers in ${tracked.length} tracked files and the zip, none found`},null,2));
}catch(e){rmSync(zip,{force:true});throw e;}
finally{rmSync(temp,{recursive:true,force:true});}
