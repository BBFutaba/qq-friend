// 记忆整理 panel on the 群友与记忆 page: start a sorting pass for this chat, watch it run, then review the proposed changes
// (all ticked by default), untick what you disagree with, and apply. Nothing changes before 应用.
const categories={fact:'成员事实',event:'群事件',impression:'人格印象',topic:'短期话题'};
const actions={merge:'合并冗余',update:'精简改写',archive:'归档',expire:'过期',keep:'分类 / 键'};
export function sortPanel(state,groupId,ui,{esc,pill,empty,time}){
 const plans=(state.memorySorts||[]).filter(p=>p.groupId===groupId).sort((a,b)=>b.startedAt-a.startedAt),plan=plans[0],people=new Map((state.members||[]).map(m=>[m.userId,m.nickname||m.name]));
 const who=id=>id?esc(people.get(id)||id):'群级';
 const start=`<button data-sort-start="${esc(groupId)}">${plan?'重新整理本群记忆':'整理本群记忆'}</button>`;
 const head=(body,action=start)=>`<section class="panel section" data-sort-panel><div class="row between"><h2>记忆整理</h2>${action}</div>${body}</section>`;
 if(!plan||plan.status==='discarded')return head('<p class="hint">让记忆模型逐人审计本群的有效记忆：合并说法不同的重复记忆，把啰嗦的精简成一句，把没有长期价值的临时记忆归档（平时不带进对话，聊到相关内容时才调出），让过时的过期，并补上分类和稳定键。结果先给你审核，应用前什么都不会改。</p>');
 if(plan.status==='running')return head(`<p class="hint">正在整理：${plan.done||0} / ${plan.total} 条记忆…完成后这里会列出建议。</p>`,'<button data-action="refresh">刷新</button>');
 if(plan.status==='failed')return head(`<p class="hint">整理失败：${esc(plan.error||'未知原因')}${plan.items?.length?`（已得到 ${plan.items.length} 条建议，未保存）`:''}</p>`);
 if(plan.status==='applied')return head(`<p class="hint">${time(plan.appliedAt)} 应用了 ${plan.applied} 条整理建议${plan.skipped?`，跳过 ${plan.skipped} 条（记忆在整理后又被改过，或合并目标没有一起应用）`:''}。</p>`);
 const items=plan.items||[];if(!items.length)return head(`<p class="hint">整理完了 ${plan.total} 条记忆，没有需要调整的。</p>`);
 const checked=i=>!ui.unchecked.has(i.id),count=items.filter(checked).length,byAction=a=>items.filter(i=>i.action===a);
 const tags=(x,y)=>`${x.category!==y.category?`${pill(categories[x.category]||x.category,'mute')} → ${pill(categories[y.category]||y.category,'soft')}`:pill(categories[y.category]||y.category,'soft')}${x.key!==y.key?` <code class="key">${esc(x.key||'无键')}</code> → <code class="key">${esc(y.key)}</code>`:y.key?` <code class="key">${esc(y.key)}</code>`:''}`;
 const row=i=>{const into=i.into&&items.find(x=>x.memoryId===i.into);return `<label class="memory-card sort-item ${i.action==='keep'?'':'pending'}"><div class="card-head"><input type="checkbox" class="pick" data-sort-item="${esc(i.id)}" data-nodirty ${checked(i)?'checked':''}>${pill(actions[i.action],i.action==='keep'?'soft':true)}<span>${who(i.userId)}</span>${tags(i.before,i.after)}</div>
  ${i.action==='update'?`<p class="memory-text muted"><s>${esc(i.before.content)}</s></p><p class="memory-text">${esc(i.after.content)}</p>`:`<p class="memory-text">${esc(i.before.content)}</p>`}
  ${i.action==='merge'?`<p class="hint">并入：${esc(into?into.after.content:(state.memories||[]).find(m=>m.id===i.into)?.content||i.into)}</p>`:''}${i.reason?`<p class="hint">${esc(i.reason)}</p>`:''}</label>`;};
 const section=a=>{const list=byAction(a);return list.length?`<details class="section" data-k="sort-${a}" open><summary>${actions[a]} · ${list.length}</summary>${list.map(row).join('')}</details>`:'';};
 const chosen=items.filter(checked),leaving=chosen.filter(i=>['merge','archive','expire'].includes(i.action)),saved=leaving.reduce((n,i)=>n+i.before.content.length,0)+chosen.filter(i=>i.action==='update').reduce((n,i)=>n+i.before.content.length-i.after.content.length,0);
 return head(`<p class="hint">${time(plan.finishedAt)} 审计了 ${plan.total} 条有效记忆，建议调整 ${items.length} 条。按当前勾选应用后：常用记忆减少 ${leaving.length} 条（其中归档 ${chosen.filter(i=>i.action==='archive').length} 条，聊到相关内容时仍会调出），少 ${saved} 字。取消勾选你不同意的，再应用；合并会连同保留那条的改写一起应用。</p>${['merge','update','archive','expire','keep'].map(section).join('')}
  <div class="row section"><button class="primary" data-sort-apply="${esc(plan.id)}" ${count?'':'disabled'}>应用所选 ${count} 条</button><button data-sort-discard="${esc(plan.id)}">放弃这次整理</button></div>`,'');
}
export function bindSort(state,ui,{api,run,refresh,refreshSoon,toast,render}){
 const all=document.querySelectorAll.bind(document);
 all('[data-sort-start]').forEach(b=>b.onclick=()=>run(async()=>{const p=await api('memory/sort','POST',{groupId:b.dataset.sortStart});ui.unchecked.clear();toast(`开始整理 ${p.total} 条记忆`);await refresh();},b));
 all('[data-sort-item]').forEach(c=>c.onchange=()=>{c.checked?ui.unchecked.delete(c.dataset.sortItem):ui.unchecked.add(c.dataset.sortItem);render();});
 all('[data-sort-apply]').forEach(b=>b.onclick=()=>run(async()=>{const plan=(state.memorySorts||[]).find(p=>p.id===b.dataset.sortApply);const ids=plan.items.filter(i=>!ui.unchecked.has(i.id)).map(i=>i.id);if(!confirm(`应用 ${ids.length} 条整理建议？`))return;const r=await api('memory/sort/apply','POST',{id:plan.id,itemIds:ids});ui.unchecked.clear();toast(`已应用 ${r.applied} 条${r.skipped?`，跳过 ${r.skipped} 条`:''}`);await refresh();},b));
 all('[data-sort-discard]').forEach(b=>b.onclick=()=>run(async()=>{if(!confirm('放弃这次整理？记忆不会有任何改动。'))return;await api('memory/sort','DELETE',{id:b.dataset.sortDiscard});ui.unchecked.clear();await refresh();},b));
 if((state.memorySorts||[]).some(p=>p.status==='running'))refreshSoon();
}
