function collectRendered(){
 const site=location.hostname;
 if(/(?:^|\.)x\.com$|(?:^|\.)twitter\.com$/.test(site)){
  if(/^\/(messages|settings|i\/flow|notifications)/.test(location.pathname))return [];
  return [...document.querySelectorAll('article')].slice(0,12).map(a=>{const links=[...a.querySelectorAll('a[href]')];const link=links.find(l=>/\/status\/\d+/.test(l.pathname));return link?{url:link.href,title:(a.innerText||'').split('\n').slice(0,2).join(' '),text:(a.innerText||'').slice(0,5000)}:null;}).filter(Boolean);
 }
 if(!/(^|\.)bilibili\.com$/.test(site)||/message|account|passport/.test(site))return [];
 if(location.pathname.startsWith('/video/'))return [{url:location.href.split('?')[0],title:document.title,text:(document.body.innerText||'').slice(0,6000)}];
 const links=[...document.querySelectorAll('a[href]')].filter(a=>a.href.includes('bilibili.com/video/')&&(a.innerText||a.title||'').trim());
 return [...new Map(links.map(a=>[a.href.split('?')[0],{url:a.href.split('?')[0],title:(a.innerText||a.title||'').slice(0,200),text:(a.closest('article')?.innerText||a.parentElement?.innerText||a.innerText||a.title||'').slice(0,2000)}])).values()].slice(0,12);
}
async function collect(){const cfg=await chrome.storage.local.get(['token','enabled']);if(!cfg.enabled||!cfg.token)return {error:'请先保存配对令牌并启用采集'};const tabs=await chrome.tabs.query({url:['https://www.bilibili.com/*','https://bilibili.com/*','https://t.bilibili.com/*','https://space.bilibili.com/*','https://x.com/*','https://www.x.com/*','https://twitter.com/*']});const items=[];
 for(const tab of tabs.slice(0,4)){try{const r=await chrome.scripting.executeScript({target:{tabId:tab.id},func:collectRendered});items.push(...(r[0]?.result||[]));}catch{}}
 if(!items.length)return {error:'未发现可读取内容，请打开哔哩哔哩推荐页、视频页或 X 时间线'};
 const r=await fetch('http://127.0.0.1:4891/api/browser/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.token},body:JSON.stringify({items:items.slice(0,20)})});const result=await r.json();await chrome.storage.local.set({lastResult:{...result,at:Date.now()}});return result;}
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('collect',{periodInMinutes:30}));
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='collect')collect().catch(()=>{});});
chrome.runtime.onMessage.addListener((m,sender,respond)=>{if(sender.id!==chrome.runtime.id)return;if(m.action==='collect'){collect().then(respond).catch(e=>respond({error:e.message}));return true;}});
