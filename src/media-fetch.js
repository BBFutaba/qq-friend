import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits);
const v6=new BlockList();v6.addSubnet('2000::',3,'ipv6');
export function publicAddress(address){return isIP(address)===4?!blocked.check(address):isIP(address)===6&&v6.check(address,'ipv6')&&!address.toLowerCase().startsWith('2001:db8:');}
export function allowedMediaUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||isIP(u.hostname)||!['qpic.cn','qq.com','qq.com.cn'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw new Error('媒体必须来自 QQ 的 HTTPS CDN');return u;}
export async function fetchMedia(raw,signal,maxBytes=25*1024*1024){const u=allowedMediaUrl(raw);const answers=await lookup(u.hostname,{all:true});if(!answers.length||answers.some(x=>!publicAddress(x.address)))throw new Error('拒绝内部网络媒体地址');const pinned=answers[0];
 return new Promise((resolve,reject)=>{const req=https.get(u,{signal,lookup:(_host,opts,cb)=>opts.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family),timeout:20000},res=>{if(res.statusCode!==200){res.resume();reject(new Error('媒体请求失败或重定向'));return;}let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(new Error('媒体超过下载大小上限'));return;}chunks.push(chunk);});res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);});req.on('timeout',()=>req.destroy(new Error('媒体下载超时')));req.on('error',reject);});
}
