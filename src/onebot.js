// Ported from Tulpa onebot.py / onebot_events.py. See docs/REUSE.md.
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { cardText } from './links.js';
export function localUrl(value,ws=false){let u;try{u=new URL(value);}catch{throw new Error('OneBot 地址无效');}if(!(ws?['ws:','wss:']:['http:','https:']).includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('OneBot 必须使用本机地址，令牌不得放入 URL');return u.href.replace(/\/$/,'');}
export class OneBot extends EventEmitter {
 constructor(secrets,botId){super();this.secrets=secrets;this.botId=botId;this.state={status:'stopped',account:'',lastEventAt:0,lastMessageAt:0,note:'尚未连接'};this.stopped=true;this.delay=1000;}
 change(status,note){this.state={...this.state,status,note};this.emit('state',this.state);}
 async action(action,payload={},writing=false){
  const allowed=writing?['send_group_msg','send_private_msg']:['get_login_info','get_status','get_group_list','get_group_member_list','get_image','get_record','get_video'];
  if(!allowed.includes(action))throw new Error('OneBot 接口不在允许范围');
  const url=localUrl(this.secrets.httpUrl);if(!this.secrets.token)throw new Error('OneBot 令牌尚未配置');
  try{const response=await fetch(`${url}/${action}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.secrets.token}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Object.assign(new Error(`OneBot HTTP ${response.status}`),{confirmedRejected:response.status>=400&&response.status<500});
   let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8*1024*1024)throw new Error('OneBot 响应过大');chunks.push(chunk);}
   const r=JSON.parse(Buffer.concat(chunks).toString());if(r.status==='failed'||(Number.isInteger(r.retcode)&&r.retcode!==0))throw Object.assign(new Error(`OneBot 拒绝操作 (${r.retcode})`),{confirmedRejected:true});
   if(r.status!=='ok'||r.retcode!==0)throw new Error('OneBot 回执格式无效');return r.data;
  }catch(e){if(writing&&!e.confirmedRejected)throw Object.assign(new Error('发送结果未知，不会自动重试，请在 QQ 核对'),{uncertain:true});throw e;}
 }
 async whoami(){const data=await this.action('get_login_info');return {account:String(data?.user_id||''),nickname:String(data?.nickname||'')};}
 async probe(){const who=await this.whoami();if(who.account!==this.botId)throw new Error(this.botId?`OneBot 当前登录 QQ ${who.account}，与配置的机器人 QQ ${this.botId} 不一致`:`OneBot 当前登录 QQ ${who.account}；请在「连接与环境」把它填为机器人 QQ`);this.state.account=this.botId;return who;}
 // quote: the QQ message id this text answers, shown as a reply when newer messages came in between.
 async send(type,target,text,quote=''){await this.probe();return this.action(type==='group'?'send_group_msg':'send_private_msg',{[type==='group'?'group_id':'user_id']:Number(target),message:[...(/^-?\d{1,20}$/.test(String(quote))?[{type:'reply',data:{id:String(quote)}}]:[]),{type:'text',data:{text}}],auto_escape:true},true);}
 // Stickers are sent from the local cache as base64; sub_type 1 asks the client to show it as an emoji image.
 async sendImage(type,target,bytes){await this.probe();return this.action(type==='group'?'send_group_msg':'send_private_msg',{[type==='group'?'group_id':'user_id']:Number(target),message:[{type:'image',data:{file:'base64://'+bytes.toString('base64'),sub_type:1,summary:'[动画表情]'}}]},true);}
 start(){if(!this.stopped)return;this.stopped=false;this.connect();}
 async connect(){if(this.stopped)return;if(!this.secrets.httpUrl||!this.secrets.wsUrl){this.change('unconfigured','请配置 OneBot HTTP 和事件 WebSocket');return;}if(!this.botId){this.change('unconfigured','请在「连接与环境」填写机器人 QQ');return;}
  try{await this.probe();if(this.stopped)return;this.change('connecting','正在连接事件通道');const ws=new WebSocket(localUrl(this.secrets.wsUrl,true),{headers:{Authorization:`Bearer ${this.secrets.wsToken||this.secrets.token}`},maxPayload:1024*1024,handshakeTimeout:5000});this.ws=ws;
   ws.on('open',()=>{this.change('verifying','连接已建立，等待同账号事件');this.state.lastEventAt=Date.now();});
   ws.on('message',raw=>{let event;try{event=JSON.parse(raw);}catch{return;}if(!event.post_type)return;if(String(event.self_id)!==this.botId){this.change('account_mismatch','事件账号不匹配');ws.close();return;}this.state.lastEventAt=Date.now();if(event.post_type==='message')this.state.lastMessageAt=Date.now();this.delay=1000;
    if(event.meta_event_type==='heartbeat'&&(event.status?.online===false||event.status?.good===false)){this.change('upstream_offline','QQ 接收链路离线');return;}
    this.change('connected','账号已验证，正在接收消息');this.emit('event',event);
   });ws.on('error',()=>this.change('disconnected','连接失败，请检查地址、Token 与 QQ 状态'));
   ws.on('close',()=>{clearInterval(this.heartbeat);if(!this.stopped){this.change('disconnected','事件通道断开；断线消息不保证补齐');this.reconnect();}});
   this.heartbeat=setInterval(()=>{if(Date.now()-this.state.lastEventAt>90000)ws.terminate();},10000);this.heartbeat.unref();
  }catch(e){this.change('disconnected',/当前登录 QQ/.test(e.message)?e.message:'OneBot 连接或账号校验失败');this.reconnect();}
 }
 reconnect(){if(this.stopped)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.connect(),this.delay);this.timer.unref();this.delay=Math.min(30000,this.delay*2);}
 stop(){this.stopped=true;clearTimeout(this.timer);clearInterval(this.heartbeat);this.ws?.terminate();this.change('stopped','已停止接收');}
}
export function normalizeEvent(event,config){
 if(event.post_type!=='message'||String(event.self_id)!==config.botId||String(event.user_id)===config.botId)return null;
 const userId=String(event.user_id||'');const type=event.message_type;if(!['group','private'].includes(type))return null;
 if(type==='private'&&!config.privateAllowlist.includes(userId))return null;
 const groupId=type==='group'?String(event.group_id):`private:${userId}`;
 if(type==='group'&&!config.groups.some(g=>g.enabled&&g.id===groupId))return null;
 if(!/^\d+$/.test(userId)||event.message_id===undefined)return null;
 const segments=Array.isArray(event.message)?event.message:[{type:'text',data:{text:String(event.raw_message||event.message||'')}}];
 let text='';const media=[];let replyId='',mentioned=false;
 for(const s of segments){if(s.type==='text')text+=String(s.data?.text||'');else if(s.type==='reply')replyId=String(s.data?.id||'');else if(s.type==='at'){mentioned ||= String(s.data?.qq)===config.botId;text+=` [@${s.data?.qq}] `;}else if(['image','record','video'].includes(s.type)){media.push({type:s.type,file:String(s.data?.file||''),url:String(s.data?.url||''),...(s.type==='image'&&(s.data?.sub_type!==undefined||s.data?.summary)?{subType:Number(s.data.sub_type)||0,summary:String(s.data.summary||'').slice(0,40)}:{})});text+=` [${s.type}] `;}else{const card=cardText(s);if(card)text+=` ${card} `;}}
 return {groupId,userId,type,externalId:String(event.message_id),text:text.slice(0,12000),name:String(event.sender?.card||event.sender?.nickname||userId).slice(0,80),nickname:String(event.sender?.nickname||'').slice(0,80),media:media.slice(0,5),replyId,mentioned,at:Number(event.time||Date.now()/1000)*1000,direction:'in'};
}
