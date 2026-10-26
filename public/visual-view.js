// 画面图鉴 on the 表情包管理 page: catalogued only from image interpretations the owner wrote; 画面识别 uses it to call
// recurring characters by the same name. The owner can rename, rewrite or delete an entry; an edited one is never rewritten.
export function visualPanel(state,ui,{esc,pill,empty}){
 const list=(state.visuals||[]).slice().sort((a,b)=>(b.hashes||[]).length-(a.hashes||[]).length),todo=state.visualTodo||0,notes=state.ownerNotes||0;
 const card=e=>{const id=esc(e.id),editing=ui.editing===e.id;return `<article class="memory-card ${e.source==='owner'?'':'change'}" data-visual="${id}"><div class="card-head"><strong>${esc(e.name)}</strong>${e.source==='owner'?pill('你改过','soft'):pill('模型整理','mute')}${(e.aliases||[]).length?pill('别名：'+e.aliases.join('、'),'soft'):''}<span class="time grow">来自 ${(e.hashes||[]).length} 张图</span></div>
  ${editing?`<div class="editor"><div class="fields"><div><label>名字</label><input data-visual-field="name" maxlength="20" value="${esc(e.name)}"></div><div><label>别名（逗号分隔）</label><input data-visual-field="aliases" value="${esc((e.aliases||[]).join('，'))}"></div><div><label>外观特征</label><textarea data-visual-field="look">${esc(e.look)}</textarea></div><div><label>是谁 / 含义</label><textarea data-visual-field="notes">${esc(e.notes)}</textarea></div></div></div>`
   :`${e.look?`<p class="memory-text"><b>外观</b>　${esc(e.look)}</p>`:''}${e.notes?`<p class="memory-text"><b>说明</b>　${esc(e.notes)}</p>`:''}`}
  ${(e.hashes||[]).length?`<div class="row visual-thumbs">${e.hashes.slice(-4).map(h=>`<img src="/api/media/image?hash=${esc(h)}" alt="" loading="lazy" width="56" height="56">`).join('')}</div>`:''}
  <div class="card-foot"><span></span><div class="row actions">${editing?`<button class="small primary" data-visual-save="${id}">保存</button><button class="small" data-visual-cancel>取消</button>`:`<button class="small" data-visual-edit="${id}">编辑</button><button class="small danger" data-visual-delete="${id}">删除</button>`}</div></div></article>`;};
 return `<section class="panel section"><div class="row between"><h2>画面图鉴 · ${list.length}</h2><button data-visual-rebuild ${notes?'':'disabled'}>重新整理全部 ${notes} 条解读</button></div>
 <p class="hint">只从你手写的图片解读整理，模型写的解读不算。画面识别看到符合外观的角色，会用同一个名字称呼。${todo?`有 ${todo} 条你写的解读还没整理（编辑解读后约 20 秒自动整理）。`:''}</p>
 ${list.length?list.map(card).join(''):empty(notes?'还没有整理：点「重新整理全部」，或编辑一张图的解读。':'在下面的图片里写下你的解读，就会被整理进图鉴。')}</section>`;
}
export function bindVisual(state,ui,{api,run,refresh,toast,render}){
 const all=document.querySelectorAll.bind(document),find=id=>(state.visuals||[]).find(e=>e.id===id);
 all('[data-visual-edit]').forEach(b=>b.onclick=()=>{ui.editing=b.dataset.visualEdit;render();});
 all('[data-visual-cancel]').forEach(b=>b.onclick=()=>{ui.editing='';render();});
 all('[data-visual-save]').forEach(b=>b.onclick=()=>run(async()=>{const e=find(b.dataset.visualSave),patch={};b.closest('[data-visual]').querySelectorAll('[data-visual-field]').forEach(i=>patch[i.dataset.visualField]=i.value);await api('visual','PUT',{id:e.id,version:e.version,...patch});ui.editing='';toast('已保存，以后不会被自动改写');await refresh();},b));
 all('[data-visual-delete]').forEach(b=>b.onclick=()=>run(async()=>{if(!confirm('删除这个图鉴条目？'))return;await api('visual','DELETE',{id:b.dataset.visualDelete});toast('已删除');await refresh();},b));
 all('[data-visual-rebuild]').forEach(b=>b.onclick=()=>run(async()=>{const r=await api('visual/rebuild','POST',{});toast(`开始整理 ${r.count} 条解读，完成后刷新可见`);},b));
}
