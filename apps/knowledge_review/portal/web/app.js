'use strict';
const $ = s => document.querySelector(s);
const main = $('#main'), status = $('#status');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extraTools = (id,label,kind) => window.OwnerPortal?.button(id,label,kind) || '';
const prose = v => `<div class="bodytext">${KnowledgeMath.render(v)}</div>`;
const verbs = {USES:'运用',REPRESENTED_BY:'可表示为',TRANSFORMS_TO:'可转化为',JUSTIFIED_BY:'依据',IS_A:'属于',ANALOGOUS_TO:'类比于',CONTRASTS_WITH:'对比于',PART_OF:'是其组成部分',REQUIRES:'需要'};
let state = {}, catalog, allPoints = [], session = {admin:false}, datasets = [], generation = 0;
let fusionStatus = null, fusionCatalog = null, fusionScopeKey = '', fusionRelations = null;
const SYLLABUS_LABEL = '考纲';
const fusionOn = () => state.fusion !== 'off' && fusionStatus?.available !== false;
const sylRef = id => !!(fusionOn() && fusionCatalog && fusionCatalog.points && fusionCatalog.points[id] && fusionCatalog.points[id].hasSyllabusReference);
const sylExt = id => !!(fusionOn() && fusionCatalog && fusionCatalog.points && fusionCatalog.points[id] && fusionCatalog.points[id].hasSyllabusInlineExtension);
function sylBadge(text='考纲', hint='') {
  const title = hint || (text === '考纲' ? '含考纲扩展或有关联考纲知识' : text);
  return `<span class="syl-badge" title="${esc(title)}">${esc(text)}<span class="sr">（来源：考纲）</span></span>`;
}
function pointBadge(id){ return sylExt(id)?sylBadge('内容补充','此知识卡已融入考纲补充内容'):sylRef(id)?sylBadge('相关考纲','仅有关联，不代表同点内容融合'):''; }
function resetFusion(){ fusionCatalog = null; fusionScopeKey = ''; fusionRelations = null; }
let graphBox;
const url = patch => '#' + new URLSearchParams({...state, ...patch}).toString();
const link = (text, patch, cls='') => `<a class="${cls}" href="${esc(url(patch))}">${esc(text)}</a>`;
const pointName = id => allPoints.find(p => p.id === id)?.name || '知识点';
const pointLink = id => link(pointName(id), {view:'card',point:id,relation:''});
const relationLink = id => link('查看关系详解',{view:'relations',relation:id,point:'',q:'',group:'',subgroup:'',sequence:'',topic:'',syltopic:'',type:'',fsrc:'',syl:''});
function clearPrivate(){ window.OwnerPortal?.clear(); }
async function api(path, params={}, body) {
  const intent = generation;
  const response = await fetch(path + (Object.keys(params).length ? '?' + new URLSearchParams(params) : ''), {
    cache:'no-store', credentials:'same-origin', ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})
  });
  const data = await response.json();
  if (intent !== generation) throw new Error('导航已切换');
  if (!response.ok) {
    if (response.status === 401) { session.admin = false; clearPrivate(); document.querySelectorAll('[data-source]').forEach(el=>el.remove()); }
    throw new Error(data.error || '请求失败');
  }
  return data;
}
const params = extra => ({dataset:state.dataset,version:state.version,...extra});
function empty(text='没有匹配的知识') { return `<div class="empty"><h2>${esc(text)}</h2><p>可以清空筛选，或返回知识目录重新浏览。</p>${link('清空筛选',{view:state.view === 'card' ? 'catalog' : state.view,q:'',group:'',topic:'',type:'',point:'',relation:''})}</div>`; }
function options(items, selected, caption) { return `<option value="">${caption}</option>` + items.map(x=>`<option value="${esc(x.id)}" ${x.id === selected?'selected':''}>${esc(x.name)}</option>`).join(''); }
function pointGroup(p) {
  const seq = catalog.sequences.find(x => p.sequenceIds?.includes(x.id));
  const sub = catalog.subgroups.find(x => x.id === seq?.subgroupId);
  return sub?.groupId;
}
function topicMatches(id, chosen) {
  if (!chosen) return true;
  let cursor = id;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    if (cursor === chosen) return true;
    seen.add(cursor); cursor = catalog.topics.find(t=>t.id===cursor)?.parentId;
  }
  return false;
}
const matches = p => (!state.syl || sylRef(p.id)) && (!state.sequence || p.sequenceIds.includes(state.sequence)) && (!state.subgroup || p.sequenceIds.some(id=>catalog.sequences.some(seq=>seq.id===id&&seq.subgroupId===state.subgroup))) && (!state.group || pointGroup(p) === state.group) && topicMatches(p.topicId, state.topic);
function filters(relation=false) {
  const source = relation && fusionOn() ? `<select aria-label="关系来源" data-filter="fsrc"><option value="">含考纲关联</option><option value="6a" ${state.fsrc==='6a'?'selected':''}>只看 6A 内部关系</option><option value="cross" ${state.fsrc==='cross'?'selected':''}>只看考纲关联</option></select>` : '';
  return `<div class="filters"><select aria-label="知识单元" data-filter="group">${options(catalog.groups,state.group,'全部知识单元')}</select><select aria-label="知识主题" data-filter="topic">${options(catalog.topics,state.topic,'全部知识主题')}</select>${source}${relation?`<select aria-label="关系类型" data-filter="type">${options(Object.entries(verbs).map(([id,name])=>({id,name})),state.type,'全部关系类型')}</select><select aria-label="关联知识" data-filter="point">${options(allPoints.map(p=>({id:p.id,name:p.name})),state.point,'全部知识点')}</select>`:''}${link('清空筛选',{q:'',topic:'',group:'',subgroup:'',sequence:'',type:'',point:'',relation:'',syl:'',fsrc:''})}</div>`;
}
function scrollSection(id){
  const target=document.getElementById(id), reader=$('.reader-scroll');if(!target)return;
  if(reader?.contains(target))reader.scrollTo({top:reader.scrollTop+target.getBoundingClientRect().top-reader.getBoundingClientRect().top-18});
  else target.scrollIntoView();
}
function bindFilters() { document.querySelectorAll('[data-filter]').forEach(el=>el.onchange=()=>{location.hash=url({[el.dataset.filter]:el.value,syltopic:'',relation:''});}); }
function tiles(points) {
  return `<div class="point-list">${points.map(p=>`<a class="point-link" href="${esc(url({view:'card',point:p.id,relation:''}))}"><strong>${esc(p.name)} <span aria-hidden="true">↗</span></strong><p>${esc(p.snippet || p.lead)}</p></a>`).join('')}</div>`;
}
function hero(title, sub) {
  return `<div class="page-heading"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>`;
}
let panePositions = new Map();
let readerPositions = new Map();
function scopeTree() {
  const pick = patch => ({view:'catalog',point:'',mobile:'',syltopic:'',...patch});
  const mark = (kind,id) => {
    if(!fusionOn()||!fusionCatalog?.[kind]?.[id])return '';
    const members=allPoints.filter(p=>kind==='topics'?topicMatches(p.topicId,id):kind==='groups'?pointGroup(p)===id:kind==='sequences'?p.sequenceIds.includes(id):p.sequenceIds.some(sid=>catalog.sequences.some(seq=>seq.id===sid&&seq.subgroupId===id)));
    return members.some(p=>sylExt(p.id))?sylBadge('内容补充','下级知识卡已融入考纲内容'):sylBadge('相关考纲','下级知识仅与考纲相关');
  };
  return `<aside class="scope-tree pane"><div class="pane-heading">知识范围</div><div class="scope-body">${link('全部知识',pick({group:'',subgroup:'',sequence:'',topic:''}),!state.group&&!state.topic?'current':'')}${catalog.groups.map((g,i)=>`<details ${!state.group||state.group===g.id?'open':''}><summary>${String(i+1).padStart(2,'0')}　${esc(g.name)}${mark('groups',g.id)}</summary>${link('浏览本单元',pick({group:g.id,subgroup:'',sequence:'',topic:''}),state.group===g.id&&!state.subgroup?'current':'')}${catalog.subgroups.filter(sub=>sub.groupId===g.id).map(sub=>`<details ${state.subgroup===sub.id?'open':''}><summary>${esc(sub.name)}${mark('subgroups',sub.id)}</summary>${link('全部 '+sub.name,pick({group:g.id,subgroup:sub.id,sequence:'',topic:''}))}${catalog.sequences.filter(seq=>seq.subgroupId===sub.id).map(seq=>link(seq.name,pick({group:g.id,subgroup:sub.id,sequence:seq.id,topic:''}),state.sequence===seq.id?'current':'')).join('')}</details>`).join('')}</details>`).join('')}<h3>知识主题</h3>${catalog.topics.filter(t=>!t.parentId).map(t=>`<a href="${esc(url(pick({topic:t.id,group:'',subgroup:'',sequence:''})))}" class="${state.topic===t.id?'current':''}">${esc(t.name)}${mark('topics',t.id)}</a>`).join('')}${fusionOn()&&fusionCatalog?.addedTopics?.length?`<h3>考纲独立主题</h3><p class="tree-note">单独的知识范围，包含后续年级内容</p>${fusionCatalog.addedTopics.map(t=>`<a href="${esc(url(pick({syltopic:t.id,topic:'',group:'',subgroup:'',sequence:''})))}" class="${state.syltopic===t.id?'current':''}">${esc(t.name)}${sylBadge('新增主题','由考纲新增的独立主题入口')}<small> ${t.pointCount} 项</small></a>`).join('')}`:''}</div></aside>`;
}
function navigation() {
  if(session.mathBrain && !document.querySelector('#math-brain-link')) {
    const brain=document.createElement('a');brain.id='math-brain-link';brain.href='/math-brain/';brain.textContent='数学大脑 ↗';
    document.querySelector('.navline').append(brain);
  }
  if(!$('#fusion-toggle')){
    const box=document.querySelector('.navline');
    const button=document.createElement('button');button.id='fusion-toggle';button.type='button';button.className='fusion-toggle';
    button.onclick=()=>{location.hash=url({fusion:fusionOn()?'off':'on',syl:'',gmode:fusionOn()?'base':'fused',point:state.point||'',relation:state.relation||''});};
    box.append(button);
  }
  const toggle=$('#fusion-toggle');
  toggle.textContent=fusionOn()?'考纲融合：已开启':'考纲融合：已关闭';
  toggle.classList.toggle('on',fusionOn());
  toggle.hidden=!(fusionStatus && fusionStatus.available);
  toggle.title=fusionOn()?'关闭后回到融合前的 6A 目录、卡片、关系与图谱':'开启后显示考纲来源标记、考纲扩展与考纲关联';
  if(!$('#nav').children.length) $('#nav').innerHTML=['catalog','relations','graph','practice'].map((view,i)=>`<a data-view="${view}">${['知识目录','知识关系','知识图谱','配套练习'][i]}</a>`).join('');
  $('#nav').querySelectorAll('a').forEach(a=>{a.href=url({view:a.dataset.view,relation:'',subgroup:'',sequence:'',mobile:''});a.classList.toggle('active',state.view===a.dataset.view || a.dataset.view==='catalog'&&state.view==='card' || a.dataset.view==='practice'&&['exercise','print','practice-result'].includes(state.view));});
  const chosen=datasets.find(d=>d.datasetId===state.dataset&&d.version===state.version);
  $('#policy').textContent=session.notice || '内容由AI辅助分析或生成，可能存在错误或遗漏，请自行核实、审慎使用。';
  $('#query').value=state.q || '';
  $('#dataset').value=state.dataset+'|'+state.version;
}
let directoryKey='', displayedPoint='', loadedScope='', renderedView='', renderedAdmin=false, relationRows=null, graphData=null;
async function directory() {
  const key=[state.dataset,state.version,state.q,state.group,state.subgroup,state.sequence,state.topic,state.syltopic,state.syl,fusionOn()?1:0].join('|');
  const newShell=!$('.workspace');
  if(newShell){
    directoryKey='';displayedPoint='';
    main.innerHTML=`<div class="workspace">${scopeTree()}<section class="results-pane pane"><div class="pane-heading"><h1></h1><span></span></div><div class="result-controls"><select aria-label="知识主题" data-filter="topic"></select>${fusionOn()?'<label class="syl-filter"><input type="checkbox" id="syl-only"> 仅看带考纲的知识</label>':''}<a data-clear>清空筛选</a></div><div class="result-scroll"></div></section><section class="reader-pane pane"><div class="reader-tools"><button id="return-results">← 返回结果</button><span>知识正文</span><button id="expand-sections">展开所有条目</button></div><div class="section-jumps"></div><div class="reader-scroll"></div></section></div>`;
    $('#return-results').onclick=()=>location.hash=url({mobile:'',point:''});
    $('#expand-sections').onclick=e=>{const expand=e.target.textContent.startsWith('展开');document.querySelectorAll('.reading details').forEach(d=>d.open=expand);e.target.textContent=expand?'收起所有条目':'展开所有条目';};
    if($('#syl-only'))$('#syl-only').onchange=e=>{location.hash=url({syl:e.target.checked?'1':'',point:''});};
    bindFilters();
  }
  const markKey=(fusionOn()&&fusionCatalog?'on':'off')+'|'+loadedScope;
  if($('.scope-tree') && $('.scope-tree').dataset.markKey!==markKey){
    $('.scope-tree').outerHTML=scopeTree();
    $('.scope-tree').dataset.markKey=markKey;
    if($('#syl-only'))$('#syl-only').closest('.syl-filter').hidden=!fusionOn();
  }
  if(directoryKey!==key){
    const independent=fusionOn()&&state.syltopic;
    const points=independent?(fusionCatalog?.independentPoints||[]).filter(p=>p.topicId===state.syltopic&&(!state.q||(p.name+p.lead).includes(state.q))):state.q?await api('/api/points',params({q:state.q,fusion:fusionOn()?'1':'0'})):allPoints;
    const order=p=>Math.min(...p.sequenceIds.map(id=>catalog.sequences.find(s=>s.id===id)?.order??999));
    const visible=independent?points:points.filter(matches).sort((a,b)=>order(a)-order(b));
    const title=independent?fusionCatalog.addedTopics.find(t=>t.id===state.syltopic)?.name:state.q?`“${state.q}”的搜索结果`:catalog.sequences.find(x=>x.id===state.sequence)?.name||catalog.subgroups.find(x=>x.id===state.subgroup)?.name||catalog.groups.find(x=>x.id===state.group)?.name||'全部知识';
    $('.results-pane h1').textContent=title;$('.results-pane .pane-heading span').textContent=visible.length+' 项';
    $('.result-scroll').innerHTML=visible.length?visible.map(p=>`<a class="point-link" data-point="${esc(p.id)}"><strong>${esc(p.name)}${independent?sylBadge('新增主题'):pointBadge(p.id)}</strong><p>${KnowledgeMath.render(p.snippet||p.lead)}</p><small>${independent?'考纲独立知识 · 跨年级':esc(catalog.topics.find(t=>t.id===p.topicId)?.name)}</small></a>`).join(''):empty(state.syl?'本范围没有带考纲的知识':'没有匹配的知识');
    $('.result-scroll').scrollTop=panePositions.get(key)||0;
    $('.result-scroll').dataset.positionKey=key;
    $('.result-scroll').onscroll=e=>panePositions.set(key,e.target.scrollTop);
    $('[data-filter="topic"]').innerHTML=options(catalog.topics,state.topic,'全部知识主题');
    if($('#syl-only'))$('#syl-only').checked=state.syl==='1';
    $('[data-clear]').href=url({q:'',group:'',subgroup:'',sequence:'',topic:'',syltopic:'',point:'',mobile:'',syl:''});
    directoryKey=key;
  }
  $('.workspace').classList.toggle('mobile-reading',state.mobile==='read');
  $('.scope-tree').querySelectorAll('a').forEach(a=>{
    const old=Object.fromEntries(new URLSearchParams(a.hash.slice(1)));
    a.href=url({view:'catalog',point:'',mobile:'',group:old.group||'',subgroup:old.subgroup||'',sequence:old.sequence||'',topic:old.topic||'',syltopic:old.syltopic||''});
    a.classList.toggle('current',['group','subgroup','sequence','topic','syltopic'].every(k=>(old[k]||'')===(state[k]||'')));
  });
  const choices=[...document.querySelectorAll('.result-scroll [data-point]')];
  const id=choices.find(a=>a.dataset.point===state.point)?.dataset.point||choices[0]?.dataset.point||'';
  choices.forEach(a=>{a.href=url({view:'catalog',point:a.dataset.point,mobile:'read'});a.classList.toggle('selected',a.dataset.point===id);a.setAttribute('aria-current',String(a.dataset.point===id));});
  const pointKey=id+(session.admin?'|admin':'')+(fusionOn()&&fusionCatalog?'':'|nofusion');
  if(pointKey!==displayedPoint || newShell){
    const oldReader=$('.reader-scroll');
    if(oldReader.dataset.positionKey)readerPositions.set(oldReader.dataset.positionKey,oldReader.scrollTop);
    if(id){
      const fragment=document.createElement('div');
      if(id.startsWith('MATHSYL-')) await syllabusCard(fragment,id); else await card(fragment,id);
      oldReader.replaceChildren(fragment.querySelector('.reading'));
      $('.section-jumps').replaceChildren(fragment.querySelector('.sidebar'));
    }else{oldReader.innerHTML=empty();$('.section-jumps').replaceChildren();}
    displayedPoint=pointKey;
    $('#expand-sections').textContent='展开所有条目';
    $('.reader-tools span').textContent=catalog.sequences.find(s=>allPoints.find(p=>p.id===id)?.sequenceIds?.includes(s.id))?.name||'知识正文';
    const readerKey=[state.dataset,state.version,id].join('|');
    oldReader.scrollTop=readerPositions.get(readerKey)||0;oldReader.dataset.positionKey=readerKey;
    oldReader.onscroll=e=>readerPositions.set(readerKey,e.target.scrollTop);
  }
}
function relationHTML(r, compact=false) {
  return `<article class="relation" id="rel-${esc(r.id)}"><h3>${pointLink(r.fromId)}<span class="verb">→ ${esc(verbs[r.type]||r.type)} →</span>${pointLink(r.toId)}${(sylRef(r.fromId)||sylRef(r.toId))?sylBadge():''}</h3>${prose(r.explanation)}<div class="toolbar">${compact?relationLink(r.id):''}${link('在图谱中查看',{view:'graph',relation:r.id,point:r.fromId,mode:'local'})}${extraTools(r.id, '查看条目详情', 'point')}</div></article>`;
}
function bindSources(root=document){ window.OwnerPortal?.bind(root); }
async function card(target=main, pointId=state.point) {
  const [{point:p,contexts},relations,fus]=await Promise.all([api('/api/point',params({id:pointId})),api('/api/relations',params({point:pointId})),fusionOn()?api('/api/fusion/point',params({id:pointId})):Promise.resolve(null)]);
  const elements=p.elements || [];
  const contextMap=Object.fromEntries(contexts.map(c=>[c.id,c]));
  function body(e) {
    if (e.contextIds?.length) return e.contextIds.map(id=>`<h3>${esc(contextMap[id]?.title || '关联知识背景')}</h3>${prose(contextMap[id]?.body || '关联内容暂不可用')}`).join('');
    return prose(e.body);
  }
  const sections=[['understand','深入理解',['DEFINITION','CORE_RULE','ESSENCE','EDGE_CASE','ALGORITHM','REPRESENTATION']],['reason','数学依据与直观理解',['RATIONALE','INTUITION','FORMATION']],['distinguish','关键辨析与理解难点',['MISCONCEPTION','CONCEPT_DIFFICULTY','KEY_IDEA']],['scope','适用条件',['SCOPE_LIMIT']],['examples','例子与应用',['ILLUSTRATION','APPLICATION']],['context','知识脉络',['KNOWLEDGE_CONTEXT','CONNECTION']]].filter(([, ,types])=>elements.some(e=>types.includes(e.type)));
  const index=allPoints.findIndex(x=>x.id===p.id), seq=catalog.sequences.find(x=>p.sequenceIds.includes(x.id)), sub=catalog.subgroups.find(x=>x.id===seq?.subgroupId), group=catalog.groups.find(x=>x.id===sub?.groupId);
  target.innerHTML=`<div class="back"><button id="back">← 返回上一位置</button></div><div class="breadcrumb">${link('知识目录',{view:'catalog',point:''})} / ${esc(group?.name || '')} / ${esc(sub?.name || '')} / ${esc(seq?.name || '')}</div><div class="layout"><aside class="sidebar"><h2>本页内容</h2><a href="#core" data-anchor="core">核心内容</a>${sections.map(([id,name])=>`<a href="#${id}" data-anchor="${id}">${name}</a>`).join('')}<a href="#mastery" data-anchor="mastery">掌握要点</a><a href="#complete" data-anchor="complete">完整知识卡</a><a href="#related" data-anchor="related">相关知识</a></aside><article class="reading"><span class="eyebrow">知识卡片</span><h1>${esc(p.name)}</h1><p class="lead">${KnowledgeMath.render(p.lead)}</p><div class="toolbar">${link('在图谱定位',{view:'graph',point:p.id,mode:'local',relation:''})}${session.preview?link('相关练习 ↗',{view:'practice',kp:p.id,kgroup:'',ksub:'',kseq:'',pbook:'',pchapter:'',psection:'',pdiff:'',pq:'',ppage:1,prole:'direct'},'practice-entry'):''}<button id="copy">复制正文</button>${extraTools(p.id, '查看条目详情', 'point')}</div><div id="core" class="core">${(p.core||p.summary||'').split(/\n\s*\n/).map(t=>`<p class="bodytext">${KnowledgeMath.render(t)}</p>`).join('')}</div>${sections.map(([id,name,types])=>`<section id="${id}"><h2>${name}</h2>${id==='reason' && p.explanation?prose(p.explanation):''}${elements.filter(e=>types.includes(e.type)).map(e=>`<details><summary>${KnowledgeMath.render(e.title)}</summary>${body(e)}${extraTools(e.id, '对照这一条的说明', 'point')}</details>`).join('')}</section>`).join('')}<section id="mastery"><h2>掌握要点 <span class="count">${p.mastery.length} 项</span></h2>${p.mastery.map(m=>`<details><summary>${KnowledgeMath.render(m.action)} · ${KnowledgeMath.render(m.statement)}</summary>${prose(m.verification)}${extraTools(m.id, '对照这一条的说明', 'point')}</details>`).join('')}</section><section id="complete"><h2>完整知识卡</h2><p class="muted">按原有顺序保留全部提炼条目。</p><details id="all-elements"><summary>查看全部原始提炼条目（${elements.length} 项）</summary>${elements.map(e=>`<article class="entry" data-element="${esc(e.id)}"><h3>${KnowledgeMath.render(e.title)}</h3>${body(e)}</article>`).join('')}${p.summary && p.summary!==p.core?`<h3>简要结论</h3>${prose(p.summary)}`:''}${p.explanation?`<h3>完整数学解释</h3>${prose(p.explanation)}`:''}</details></section><section id="related"><h2>相关知识</h2>${relations.length?relations.map(r=>relationHTML(r,true)).join(''):'<p>暂未建立直接知识关系。</p>'+link('浏览同主题知识',{view:'catalog',point:'',topic:p.topicId,q:''})}</section><div class="prevnext">${index>0?link('← '+allPoints[index-1].name,{view:'card',point:allPoints[index-1].id}):'<span></span>'}${index<allPoints.length-1?link(allPoints[index+1].name+' →',{view:'card',point:allPoints[index+1].id}):''}</div><button id="top">↑ 返回顶部</button></article></div>`;
  target.querySelector('#back').onclick=()=>history.length>1?history.back():location.assign(url({view:'catalog',point:''}));
  target.querySelector('#top').onclick=()=>{const reader=$('.reader-scroll');if(reader)reader.scrollTo({top:0});else window.scrollTo({top:0});};
  target.querySelectorAll('[data-anchor]').forEach(a=>a.onclick=e=>{e.preventDefault();scrollSection(a.dataset.anchor);});
  target.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText([p.name,p.lead,p.core,p.explanation,p.summary,...elements.map(e=>e.title+'\n'+(e.contextIds?.length?e.contextIds.map(id=>contextMap[id]?.body||'').join('\n'):e.body)),...p.mastery.map(m=>m.statement+'\n'+m.verification)].join('\n\n'));status.textContent='正文已复制';}catch{status.textContent='复制未成功，可直接选择正文复制';}};
  bindSources(target);
  applyFusionToCard(target, p, fus);
}
function applyFusionToCard(target, p, fus){
  if(!fus?.available) return;
  const reading=target.querySelector('.reading'), sidebar=target.querySelector('.sidebar');
  reading.querySelector('h1').insertAdjacentHTML('beforeend',pointBadge(p.id));
  const groups=[['understand','深入理解',['DEFINITION','CORE_RULE','PROPERTY','ESSENCE','EDGE_CASE','ALGORITHM','REPRESENTATION']],['reason','数学依据与直观理解',['RATIONALE','INTUITION','FORMATION']],['distinguish','关键辨析与理解难点',['MISCONCEPTION','CONCEPT_DIFFICULTY','KEY_IDEA']],['scope','适用条件',['SCOPE_LIMIT']],['examples','例子与应用',['ILLUSTRATION','APPLICATION']],['context','知识脉络',['KNOWLEDGE_CONTEXT','CONNECTION']]];
  for(const ext of fus.extensions||[])reading.querySelector('.toolbar').insertAdjacentHTML('beforeend',extraTools(ext.syllabusPointId,'查看条目详情','syllabus'));
  const seen=new Set(p.elements.map(e=>e.body?.replace(/\s/g,'')));
  for(const ext of fus.extensions||[]){
    for(const e of ext.elements||[]){
      const key=e.body?.replace(/\s/g,''); if(seen.has(key))continue;seen.add(key);
      const [id,name]=groups.find(g=>g[2].includes(e.type))||groups[0];
      let section=reading.querySelector('#'+id);
      if(!section){section=document.createElement('section');section.id=id;section.innerHTML=`<h2>${name}</h2>`;reading.querySelector('#mastery').before(section);sidebar?.insertAdjacentHTML('beforeend',`<a data-anchor="${id}" href="#${id}">${name}</a>`);}
      section.insertAdjacentHTML('beforeend',`<article class="entry integrated-element" data-syl-element="${esc(e.id)}"><h3>${KnowledgeMath.render(e.title)} ${sylBadge('考纲补充')}</h3>${prose(e.body)}<p class="syl-scope">${esc(ext.scopeNote)}</p></article>`);
    }
    for(const m of ext.mastery||[]) reading.querySelector('#mastery').insertAdjacentHTML('beforeend',`<article class="entry integrated-element"><h3>${KnowledgeMath.render(m.action)} ${sylBadge('考纲补充')}</h3>${prose(m.statement)}<p class="syl-scope">${esc(ext.scopeNote)}</p></article>`);
  }
  if(fus.related?.length){
    reading.querySelector('#related').insertAdjacentHTML('beforeend',`<h3>相关考纲知识</h3>${fus.related.map(e=>`<details class="syl-related"><summary>${esc(e.syllabusPointName)} ${sylBadge('相关考纲')}</summary>${prose(e.differenceSummary)}<p class="syl-scope">${esc(e.scopeNote)}</p>${link('阅读相关知识',{view:'syllabus',point:e.syllabusPointId})}</details>`).join('')}`);
  }
  target.querySelectorAll('[data-anchor]').forEach(a=>a.onclick=e=>{e.preventDefault();scrollSection(a.dataset.anchor);});
  bindSyllabusSources(target);
}
function bindSyllabusSources(root){ window.OwnerPortal?.bind(root); }
async function syllabusCard(target=main,id=state.point){
  const {point:p}=await api('/api/fusion/syllabus-point',params({id}));
  target.innerHTML=`<aside class="sidebar"><h2>本页内容</h2><a href="#core" data-anchor="core">核心内容</a></aside><article class="reading"><span class="eyebrow">相关考纲知识 · 跨年级</span><h1>${esc(p.name)} ${sylBadge('考纲知识')}</h1><p class="lead">${KnowledgeMath.render(p.lead)}</p><div class="toolbar"><button id="syllabus-back">返回上一位置</button>${extraTools(p.id, '查看条目详情', 'syllabus')}</div><div id="core" class="core">${prose(p.core)}</div>${p.elements.map(e=>`<article class="entry" data-syl-element="${esc(e.id)}"><h3>${KnowledgeMath.render(e.title)}</h3>${prose(e.body)}</article>`).join('')}<section><h2>掌握要点</h2>${p.mastery.map(m=>prose(m.statement)).join('')}</section></article>`;
  target.querySelector('#syllabus-back').onclick=()=>history.back();bindSyllabusSources(target);
}
let relationListKey='';
function crossRowHTML(e) {
  return `<article class="relation cross" id="rel-${esc(e.id)}"><h3><a href="${esc(syllabusUrl(e))}">${esc(e.fromLabel)}</a><span class="verb">→ ${esc(e.label)} →</span><a href="${esc(url({view:'card',point:e.toId,relation:''}))}">${esc(e.toLabel)}</a>${sylBadge()}</h3>${prose(e.explanation)}<p class="syl-scope"><b>适用边界：</b>${esc(e.scopeNote)}</p><div class="toolbar">${extraTools(e.toId, '查看条目详情', 'point')}</div></article>`;
}
function syllabusUrl(e){ return url({view:'syllabus',point:e.fromId,relation:'',q:''}); }
async function relations(){
  if(!relationRows)relationRows=await api('/api/relations',params());
  if(fusionOn() && !fusionRelations) fusionRelations=await api('/api/fusion/relations',params());
  const cross=(fusionOn() && fusionRelations && fusionRelations.available)?fusionRelations.edges:[];
  const fsrc=state.fsrc||'';
  const local=relationRows.filter(r=>(!state.type||r.type===state.type)&&(!state.point||[r.fromId,r.toId].includes(state.point))&&[r.fromId,r.toId].some(id=>matches(allPoints.find(p=>p.id===id)))&&(!state.q||(pointName(r.fromId)+pointName(r.toId)+r.explanation).includes(state.q)));
  const remote=cross.filter(r=>(!state.point||r.fromId===state.point||r.toId===state.point)&&(!state.q||(r.fromLabel+r.toLabel+r.explanation).includes(state.q)));
  const rows=fsrc==='cross'?remote.map(r=>({kind:'cross',row:r})):fsrc==='6a'?local.map(r=>({kind:'6a',row:r})):[...local.map(r=>({kind:'6a',row:r})),...remote.map(r=>({kind:'cross',row:r}))];
  const key=[loadedScope,state.type,state.point,state.topic,state.group,state.sequence,state.subgroup,state.q,fsrc].join('|');
  if(!$('.relation-workspace')){
    main.innerHTML=hero('知识关系','选择关系，查看方向、数学解释与两端知识。'+(fusionOn()?'带考纲标签的行来自考纲对照，未与 6A 关系混同。':''))+filters(true)+'<div class="relation-workspace"><div class="relation-list pane"></div><section class="relation-detail pane"></section></div>';
    relationListKey='';bindFilters();
  }
  if(key!==relationListKey){$('.relation-list').innerHTML=`<div class="pane-heading">${rows.length} 条知识关系</div>`+rows.map(({kind,row:r})=>kind==='cross'?`<a class="relation-choice" data-relation="${esc(r.id)}"><strong>${esc(r.fromLabel)}</strong><span>${esc(r.label)} →</span><strong>${esc(r.toLabel)}</strong>${sylBadge()}</a>`:`<a class="relation-choice" data-relation="${esc(r.id)}"><strong>${esc(pointName(r.fromId))}</strong><span>${esc(verbs[r.type])} →</span><strong>${esc(pointName(r.toId))}</strong></a>`).join('');relationListKey=key;}
  const target=rows.find(x=>x.row.id===state.relation)||rows[0];
  $('.relation-list').querySelectorAll('a').forEach(a=>{a.href=url({relation:a.dataset.relation});a.classList.toggle('selected',a.dataset.relation===target?.row.id);});
  const detail=$('.relation-detail');
  if(detail.dataset.object===(target?.row.id||'none'))return;
  let content=empty(fusionOn()?'当前筛选下没有知识关系':'暂未建立直接知识关系');
  if(target && target.kind==='cross'){
    const e=target.row;
    content=`<div class="pane-heading">关系详解</div><div class="detail-body">${crossRowHTML(e)}<div class="comparison"><div><h2><a href="${esc(syllabusUrl(e))}">${esc(e.fromLabel)}</a>${sylBadge()}</h2><p class="muted">考纲知识点 · ${esc(e.fromDataset)} / ${esc(e.fromVersion)}</p>${prose(e.differenceSummary||'')}</div><div><h2>${pointLink(e.toId)}</h2><p class="muted">6A 知识点</p>${prose(allPoints.find(p=>p.id===e.toId)?.lead||'')}</div></div></div>`;
  } else if(target){
    const pointData=await Promise.all([target.row.fromId,target.row.toId].map(id=>api('/api/point',params({id}))));
    content=`<div class="pane-heading">关系详解</div><div class="detail-body">${relationHTML(target.row)}<div class="comparison">${pointData.map(({point:p})=>`<div><h2>${pointLink(p.id)}</h2>${prose(p.lead)}<div class="endpoint-core">${prose(p.core||p.summary)}</div></div>`).join('')}</div></div>`;
  }
  detail.innerHTML=content;detail.dataset.object=(target?`${target.kind}:${target.row.id}`:'none');detail.scrollTop=0;bindSources(detail);
}
function graphPositions(nodes, edges, local) {
  const w=local?1000:2200,h=local?650:1500;
  const pts=nodes.map((n,i)=>({...n,x:w/2+Math.cos(i*2.399)*Math.sqrt(i+1)*65,y:h/2+Math.sin(i*2.399)*Math.sqrt(i+1)*45,vx:0,vy:0}));
  const byId=Object.fromEntries(pts.map(n=>[n.id,n]));
  if (!local) {
    // Stable slots prevent unreadable overlapping labels in the overview.
    const remaining=new Set(nodes.map(n=>n.id)), ordered=[];
    while(remaining.size){const queue=[remaining.values().next().value];remaining.delete(queue[0]);while(queue.length){const id=queue.shift();ordered.push(byId[id]);for(const e of edges){const other=e.fromId===id?e.toId:e.toId===id?e.fromId:null;if(other&&remaining.delete(other))queue.push(other);}}}
    ordered.forEach((n,i)=>{n.x=180+(i%6)*360;n.y=55+Math.floor(i/6)*95;});
    return {pts,byId,w,h:Math.max(650,Math.ceil(nodes.length/6)*95+30)};
  }
  // Bounded force layout for current reference-sized sets; render all nodes, never sample.
  for(let step=0;step<180;step++) {
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++) {
      const a=pts[i],b=pts[j],dx=a.x-b.x,dy=(a.y-b.y)*2,d2=Math.max(dx*dx+dy*dy,100),f=14000/d2;
      a.vx+=dx/Math.sqrt(d2)*f;b.vx-=dx/Math.sqrt(d2)*f;a.vy+=dy/Math.sqrt(d2)*f;b.vy-=dy/Math.sqrt(d2)*f;
    }
    for(const e of edges) {const a=byId[e.fromId],b=byId[e.toId];if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1,f=(dist-240)*.009;a.vx+=dx/dist*f;b.vx-=dx/dist*f;a.vy+=dy/dist*f;b.vy-=dy/dist*f;}
    for(const n of pts){n.vx+=(w/2-n.x)*.0009;n.vy+=(h/2-n.y)*.0009;n.x=Math.max(130,Math.min(w-130,n.x+Math.max(-12,Math.min(12,n.vx))));n.y=Math.max(35,Math.min(h-35,n.y+Math.max(-12,Math.min(12,n.vy))));n.vx*=.6;n.vy*=.6;}
  }
  return {pts,byId,w,h};
}
const GRAPH_MODES = [['base','6A 基础'],['fused','6A + 考纲融合'],['syllabus','考纲关联子图']];
async function graph() {
  const gmode=(state.gmode==='fused'||state.gmode==='syllabus')&&fusionOn()?state.gmode:'base';
  const local=state.mode!=='all';
  const focus=state.point||allPoints[0]?.id;
  const depth=Math.min(3,Math.max(1,Number(state.depth)||1));
  let nodes, edges, fusedInfo=null;
  if(gmode==='base'){
    const data=graphData||await api('/api/graph',params());
    graphData=data;
    let base=state.type?data.edges.filter(e=>e.type===state.type):data.edges.slice();
    const allowed=new Set(allPoints.filter(matches).map(p=>p.id));
    const adjacent=new Set([focus]);
    if(local){for(let step=0;step<depth;step++){const next=base.filter(e=>adjacent.has(e.fromId)||adjacent.has(e.toId));next.forEach(e=>{adjacent.add(e.fromId);adjacent.add(e.toId);});}base=base.filter(e=>adjacent.has(e.fromId)&&adjacent.has(e.toId));}
    nodes=data.nodes.filter(n=>allowed.has(n.id)&&(!local||adjacent.has(n.id))).map(n=>({id:n.id,label:n.label,kind:'g6a',datasetId:state.dataset,sequenceIds:n.sequenceIds||[],hasRef:sylRef(n.id)}));
    const ids=new Set(nodes.map(n=>n.id));
    edges=base.filter(e=>ids.has(e.fromId)&&ids.has(e.toId)).map(e=>({id:e.id,fromId:e.fromId,toId:e.toId,type:e.type,label:verbs[e.type]||e.type,explanation:e.explanation,kind:'g6a'}));
  } else {
    const model=await api('/api/fusion/graph',params({mode:gmode,point:focus,depth:String(depth),type:state.type||''}));
    if(!model.available){nodes=[];edges=[];}
    else{
      fusedInfo=model.counts;
      const allowed=new Set(allPoints.filter(matches).map(p=>p.id));
      nodes=model.nodes.filter(n=>n.kind==='syllabus'||allowed.has(n.id)).map(n=>({id:n.id,label:n.label,kind:n.kind,datasetId:n.datasetId,sequenceIds:n.sequenceIds||[],hasRef:!!n.hasSyllabusReference,hasExt:!!n.hasSyllabusInlineExtension}));
      const ids=new Set(nodes.map(n=>n.id));
      edges=model.edges.filter(e=>ids.has(e.fromId)&&ids.has(e.toId)).map(e=>({id:e.id,fromId:e.fromId,toId:e.toId,type:e.type,label:e.kind==='cross'?(e.label||'考纲关联'):(verbs[e.type]||e.type),explanation:e.explanation,kind:e.kind,fromDataset:e.fromDataset,toId2:e.toId}));
    }
  }
  const labelOf=new Map(nodes.map(n=>[n.id,n.label]));
  const nodeOf=id=>nodes.find(n=>n.id===id);
  const nameOf=id=>labelOf.get(id)||pointName(id);
  const found=state.q?nodes.find(n=>n.label.includes(state.q)):null;
  const selected=edges.find(e=>e.id===state.relation);
  const layoutKey=[loadedScope,state.point,state.mode,state.depth,state.type,state.topic,state.group,state.sequence,state.subgroup,state.q,gmode].join('|');
  if($('.graph-workspace')&&main.dataset.graphKey===layoutKey){
    document.querySelectorAll('.graph-edge').forEach(e=>e.classList.toggle('chosen',e.dataset.edge===state.relation));
    $('#graph-detail').innerHTML=selected?edgeDetail(selected,nameOf,nodeOf):'<h2>关系说明</h2><p>点击连线查看解释。</p>';bindSources($('#graph-detail'));return;
  }
  main.dataset.graphKey=layoutKey;
  const {pts,byId,w,h}=graphPositions(nodes,edges,local);
  const modeSelect=`<select id="graph-mode" aria-label="图谱模式">${GRAPH_MODES.map(([id,name])=>`<option value="${id}" ${id===gmode?'selected':''}>${name}</option>`).join('')}</select>`;
  const summary=fusedInfo?`${fusedInfo.g6aNodes} 个 6A 知识点 / ${fusedInfo.syllabusNodes} 个考纲知识点 · ${fusedInfo.g6aEdges} 条 6A 关系 / ${fusedInfo.crossEdges} 条考纲关联${fusedInfo.syllabusEdges?' / '+fusedInfo.syllabusEdges+' 条考纲内部关系':''}`:`${nodes.length} 个知识点 / ${edges.length} 条关系`;
  main.innerHTML=hero('知识图谱','局部关联与完整知识网络')+`<div class="toolbar">${modeSelect}${link('局部视图',{mode:'local',point:focus},local?'tag':'')}${link('完整全量视图',{mode:'all'},!local?'tag':'')}<select id="graph-focus" aria-label="定位知识点">${allPoints.map(p=>`<option value="${esc(p.id)}" ${p.id===focus?'selected':''}>${esc(p.name)}</option>`).join('')}</select>${pointLink(focus)}${fusionOn()?sylBadge():''}</div>`+filters(true)+`<p class="graph-help">${gmode==='base'?'基础视图':local?'局部视图':'当前筛选'}：${summary}。边箭头表示原始关系方向；考纲节点用虚线框并标考纲，展开时才出现，不作为当前范围的基础知识点。${state.q&&!found?'当前范围没有匹配节点。':''}</p><button class="graph-mobile" id="show-graph">展开可缩放图谱</button><div class="graph-panel"><div class="toolbar"><button id="zoom-in" aria-label="放大图谱">＋</button><button id="zoom-out" aria-label="缩小图谱">−</button><button id="fit">适应屏幕</button><span class="graph-help">拖动平移 · 点击知识名称打开卡片 · 点击边查看解释</span></div><div class="graph-wrap"><svg aria-label="知识关系图，另有下方可读列表" viewBox="0 0 ${w} ${h}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#688e78"/></marker></defs>${edges.map(e=>{const a=byId[e.fromId],b=byId[e.toId];if(!a||!b)return '';const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;return `<line data-edge="${esc(e.id)}" class="graph-edge ${e.kind==='cross'?'cross':''} ${e.id===state.relation?'chosen':''}" x1="${a.x}" y1="${a.y}" x2="${b.x-dx/d*110}" y2="${b.y-dy/d*20}" ${e.kind==='cross'?'stroke-dasharray="6 4"':''} marker-end="url(#arrow)" tabindex="0" role="button" aria-label="${esc(nameOf(e.fromId)+' '+e.label+' '+nameOf(e.toId))}"/><text class="graph-label" data-edge="${esc(e.id)}" x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2-5}">${esc(e.label)}</text>`;}).join('')}${pts.map(n=>`<a class="graph-node ${n.kind==='syllabus'?'syllabus-node':''} ${n.id===(found?.id||focus)?'chosen':''}" href="${esc(n.kind==='syllabus'?url({view:'syllabus',point:n.id,relation:'',q:''}):url({view:'card',point:n.id,relation:''}))}" aria-label="打开${esc(n.label)}"><rect x="${n.x-112}" y="${n.y-21}" width="224" height="42" rx="8"/><text x="${n.x}" y="${n.y+5}" text-anchor="middle">${esc(n.label.length>15?n.label.slice(0,14)+'…':n.label)}</text>${n.kind==='syllabus'||n.hasRef||n.hasExt?`<text class="node-source" x="${n.x+110}" y="${n.y-26}" text-anchor="end">${n.kind==='syllabus'?'考纲知识':n.hasExt?'内容补充':'相关考纲'}</text>`:''}<title>${esc(n.label)}</title></a>`).join('')}</svg></div></div><section id="graph-detail">${selected?edgeDetail(selected,nameOf,nodeOf):''}</section><h2>${local?'直接相连的知识':'图谱中的知识'}</h2>${local&&!edges.length?'<p>暂未建立直接知识关系。</p>':''}${local?edges.map(e=>edgeDetail(e,nameOf,nodeOf)).join(''):tiles(nodes.filter(n=>n.kind==='g6a').map(n=>allPoints.find(p=>p.id===n.id)).filter(Boolean))}`;
  $('#graph-mode').onchange=e=>{location.hash=url({gmode:e.target.value,relation:'',depth:'1'});};
  $('#graph-focus').onchange=e=>location.hash=url({point:e.target.value,relation:'',q:''});
  const expansion=document.createElement('div');expansion.className='toolbar';
  expansion.innerHTML=`${local&&gmode==='base'?link('再展开一层真实联系',{depth:String(depth+1)})+`<span class="graph-help">当前 ${depth} 跳范围</span>`:''}<form id="node-search"><label>定位图谱节点 <input id="node-query" value="${esc(state.q||'')}" placeholder="输入知识名称"></label><button>定位</button></form>`;
  main.querySelector('.graph-help').before(expansion);
  $('#node-search').onsubmit=e=>{e.preventDefault();location.hash=url({q:$('#node-query').value.trim()});};
  $('#show-graph').onclick=()=>{$('.graph-panel').classList.toggle('show');};
  bindFilters();bindSources();
  const canvas=$('.graph-panel'), detail=$('#graph-detail');
  const graphWorkspace=document.createElement('div');graphWorkspace.className='graph-workspace';canvas.before(graphWorkspace);graphWorkspace.append(canvas,detail);
  if(!selected)detail.innerHTML=`<h2>关系说明</h2><p class="muted">点击连线查看解释；点击知识点打开正文。</p><h3>当前知识</h3>${pointLink(focus)}${prose(allPoints.find(p=>p.id===focus)?.lead)}`;
  const svg=$('svg');graphBox=[0,0,w,h];
  function apply(){svg.setAttribute('viewBox',graphBox.join(' '));}
  function zoom(scale){const [x,y,bw,bh]=graphBox;graphBox=[x+bw*(1-scale)/2,y+bh*(1-scale)/2,bw*scale,bh*scale];apply();}
  $('#zoom-in').onclick=()=>zoom(.75);$('#zoom-out').onclick=()=>zoom(1.3);$('#fit').onclick=()=>{graphBox=[0,0,w,h];apply();};
  if(found&&byId[found.id]){graphBox=[byId[found.id].x-400,byId[found.id].y-260,800,520];apply();}
  let drag;
  svg.onpointerdown=e=>{if(e.target.closest('a,[data-edge]'))return;drag={x:e.clientX,y:e.clientY,box:[...graphBox]};svg.setPointerCapture(e.pointerId);};
  svg.onpointermove=e=>{if(!drag)return;graphBox=[drag.box[0]-(e.clientX-drag.x)*drag.box[2]/svg.clientWidth,drag.box[1]-(e.clientY-drag.y)*drag.box[3]/svg.clientHeight,drag.box[2],drag.box[3]];apply();};
  svg.onpointerup=()=>drag=null;svg.onpointercancel=()=>drag=null;
  document.querySelectorAll('[data-edge]').forEach(el=>{const open=()=>location.hash=url({relation:el.dataset.edge});el.onclick=open;el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}};});
}
function edgeDetail(e,nameOf,nodeOf){
  const a=nodeOf(e.fromId)||{},b=nodeOf(e.toId)||{};
  const head=`<h3>${a.kind==='syllabus'?`<a href="${esc(url({view:'syllabus',point:e.fromId,relation:'',q:''}))}">${esc(nameOf(e.fromId))}</a>`:pointLink(e.fromId)}<span class="verb">→ ${esc(e.label)} →</span>${b.kind==='syllabus'?`<a href="${esc(url({view:'syllabus',point:e.toId,relation:'',q:''}))}">${esc(nameOf(e.toId))}</a>`:pointLink(e.toId)}${e.kind==='cross'?sylBadge():''}</h3>`;
  return `<article class="relation ${e.kind==='cross'?'cross':''}" id="rel-${esc(e.id)}">${head}${prose(e.explanation)}<div class="toolbar">${link('在图谱中查看',{view:'graph',relation:e.id,point:e.fromId})}${relationLink(e.id)}${extraTools(e.toId, '查看条目详情', 'point')}</div></article>`;
}
async function refreshDatasets(){
  datasets=await api('/api/datasets');
  $('#dataset').innerHTML=datasets.map(d=>`<option value="${esc(d.datasetId+'|'+d.version)}">${esc(d.label+' · '+d.version)}</option>`).join('');
}
async function render(){
  const turn=++generation;
  PracticePortal.close();
  clearPrivate();
  const previous={...state};
  state=Object.fromEntries(new URLSearchParams(location.hash.slice(1)));state.view||='catalog';
  const busy=state.view==='catalog'?$('.reader-pane'):state.view==='relations'?$('.relation-detail'):main;
  busy?.setAttribute('aria-busy','true');
  status.textContent='正在加载…';
  try{
    if(!loadedScope || window.OwnerPortal?.isView(state.view)){
      session=await api('/api/session');await refreshDatasets();
    }
    if(!state.dataset){state.dataset=datasets[0]?.datasetId;state.version=datasets[0]?.version;}
    if(!state.dataset&&!window.OwnerPortal?.isView(state.view)){main.innerHTML=empty('当前没有已发布的知识集');return;}
    const scope=state.dataset+'|'+state.version;
    const scopeChanged=scope!==loadedScope;
    if(previous.fusion!==state.fusion){resetFusion();}
    if(!window.OwnerPortal?.isView(state.view)&&(scopeChanged||previous.fusion!==state.fusion)){
      const [c,p]=await Promise.all([api('/api/catalog',params()),api('/api/points',params())]);
      catalog=c;allPoints=p;loadedScope=scope;relationRows=null;graphData=null;fusionRelations=null;
      if(fusionScopeKey!==scope){
        fusionStatus=await api('/api/fusion/status',params());fusionCatalog=null;
        if(fusionOn()&&fusionStatus.available){const fc=await api('/api/fusion/catalog',params());fusionCatalog=fc.available?fc:null;}
        fusionScopeKey=scope;fusionRelations=null;
      } else if(fusionOn()&&!fusionCatalog&&fusionStatus&&fusionStatus.available){
        const fc=await api('/api/fusion/catalog',params());fusionCatalog=fc.available?fc:null;fusionRelations=null;
      }
      if(!fusionOn()){fusionCatalog=null;fusionRelations=null;fusionScopeKey='';}
    }
    if(scopeChanged || renderedView!==state.view || renderedAdmin!==session.admin){main.replaceChildren();renderedView=state.view;renderedAdmin=session.admin;}
    navigation();
    await ({catalog:directory,card,syllabus:syllabusCard,relations,graph,...(window.OwnerPortal?.views||{}),practice:PracticePortal.render,exercise:PracticePortal.render,print:PracticePortal.render,'practice-result':PracticePortal.render}[state.view]||directory)();
    if(turn!==generation)return;
    main.dataset.view=state.view;
    document.title=(state.point?pointName(state.point)+' · ':'')+'数学知识探索平台';
    if(previous.view!==state.view || scopeChanged){main.focus({preventScroll:true});window.scrollTo(0,0);}
    status.textContent='';
  }catch(e){
    if(turn!==generation)return;
    status.replaceChildren(document.createTextNode(e.message+' '));
    const retry=document.createElement('button');retry.textContent='重试';retry.onclick=render;status.append(retry);
  }finally{if(turn===generation){busy?.removeAttribute('aria-busy');main.removeAttribute('aria-busy');main.style.visibility='visible';}}
}
$('#search').onsubmit=e=>{e.preventDefault();location.hash=url({q:$('#query').value.trim(),view:'catalog',point:'',relation:'',mobile:''});};
$('#dataset').onchange=e=>{const [dataset,version]=e.target.value.split('|');location.hash='#'+new URLSearchParams({dataset,version,view:'catalog'});};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#query').focus();$('#query').select();}});
window.addEventListener('hashchange',render);
render();
