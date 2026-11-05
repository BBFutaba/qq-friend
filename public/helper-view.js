// 帮手 block on the 人格与模型 page: on/off, its own Claude SDK model and effort, the Codex fallback, the limits, and the
// latest tasks.
const statusNames={running:'进行中',done:'办完了',failed:'没办成',declined:'未通过审核',cancelled:'已取消'};
export function helperPanel(state,{esc,pill,time,modelPicker}){const h=state.config.helper,tasks=state.helperTasks||[],groups=new Map((state.config.groups||[]).map(g=>[g.id,g.name]));
 const where=id=>id.startsWith('private:')?'私聊':esc(groups.get(id)||id);
 const row=t=>`<article class="memory-card ${t.status==='running'?'pending':''}"><div class="card-head">${pill(statusNames[t.status]||t.status,t.status==='running'?true:t.status==='done'?false:'mute')}<span class="muted">${where(t.groupId)} · ${time(t.startedAt)}${t.owner?' · 主人发起':''}${t.via==='codex'?' · Codex 代办':''}</span></div><p class="memory-text">${esc(t.request)}</p>${t.result?`<p class="hint clamp">${esc(t.result)}</p>`:''}${(t.sources||[]).map(u=>`<a href="${esc(u)}" target="_blank" rel="noreferrer">${esc(u)}</a>`).join('<br>')}</article>`;
 return `<section class="panel"><h2>帮手（SDK 代办）</h2><p class="muted">回复模型遇到要多步上网的事——做在线测试（比如 MBTI）、读打不开或很长的网页、对比几个来源查资料——会把它交给帮手：用本地 Claude Agent SDK 在后台办，只开放 WebSearch 和 WebFetch（只读公开网页，不碰本机和内网），带着当时的聊天；要以角色身份作答时才读取人格设定。办完后回复模型再用自己的口吻说结果。你本人发起的直接办，其他人的先过工具审核。Claude 没办成时（比如本地登录过期）可以改用 Codex 再办一次：它的网页搜索和打开网页由 OpenAI 的服务器执行，同样碰不到本机和内网。</p>
 <form id="helper-form"><label class="check"><input type="checkbox" name="enabled" ${h.enabled?'checked':''}>启用帮手</label>${modelPicker({provider:'claude',model:h.model,effort:h.effort,sdkOnly:true},'helper','helperModel','helperEffort','帮手')}
 <label class="check section"><input type="checkbox" name="fallback" ${h.fallback?'checked':''}>Claude 没办成时改用 Codex</label>${modelPicker({provider:'codex',model:h.fallbackModel,effort:h.fallbackEffort,sdkOnly:true},'helper-fallback','fallbackModel','fallbackEffort','备用 Codex ')}
 <div class="fields">${[['dailyTasks','每天最多（次）',1,200],['maxTurns','每次最多轮数',5,100],['timeoutSeconds','每次时限（秒）',60,900]].map(([k,n,a,b])=>`<div><label for="helper-${k}">${n}</label><input id="helper-${k}" type="number" name="${k}" min="${a}" max="${b}" value="${h[k]}"></div>`).join('')}</div>
 <button class="primary section">保存帮手设置</button></form>
 <details class="section" data-k="helper-tasks" ${tasks.length?'open':''}><summary>最近的任务 · ${tasks.length}</summary>${tasks.length?tasks.map(row).join(''):'<p class="hint">还没有交给帮手的事。</p>'}</details></section>`;
}
