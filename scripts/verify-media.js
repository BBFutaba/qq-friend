import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ROOT, DATA } from '../src/config.js';
import { decodeMedia,confinedMediaPath } from '../src/media-worker.js';
const report=[];
for(const [action,name] of [['image','test-image.png'],['video','test-video.mp4'],['audio','test-voice.wav']]){
 const start=Date.now();try{const result=await decodeMedia(action,join(ROOT,'workspace','media',name),AbortSignal.timeout(60000));const transcript=result.notes.find(n=>n.type==='transcript')?.text;report.push({action,images:result.images.length,transcript,passed:action==='audio'?/local|audio|test/i.test(transcript||''):result.images.length>0,elapsedMs:Date.now()-start});}catch(e){report.push({action,passed:false,error:e.message});}
}
try{confinedMediaPath(join(ROOT,'package.json'));report.push({action:'path-boundary',passed:false});}catch{report.push({action:'path-boundary',passed:true});}
writeFileSync(join(DATA,'media-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(report.some(r=>!r.passed))process.exitCode=1;
