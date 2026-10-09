const DB_NAME = 'love-letter-card-studio';
const DB_VERSION = 1;
const STORE = 'projects';
const PROJECT_KEY = 'main';
const LETTER_MIN = 5;
const LETTER_MAX = 100;
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || Date.now()+'_'+Math.random().toString(16).slice(2)}`;
const legacyDefaultNames = {char_m1:'沈屿',char_m2:'陆川',char_m3:'周野',char_m4:'顾言',char_f1:'林夏',char_f2:'苏晴',char_f3:'许栀',char_f4:'程雾'};
const initialCharacters = [
  ['char_m1','知渡','male','#8ea6b5'],['char_m2','望尋','male','#9ba889'],
  ['char_m3','亦淮','male','#a79083'],['char_m4','承嶼','male','#9d99b4'],
  ['char_f1','清禾','female','#d99aa5'],['char_f2','予安','female','#b8a2c9'],
  ['char_f3','晚紓','female','#d1ab80'],['char_f4','初漾','female','#8da9bd']
].map(([id,name,gender,color])=>({id,name,gender,color,enabled:true,image:null}));
const initialRounds = Array.from({length:5},(_,i)=>({id:`round_${i+1}`,name:`第${i+1}轮`}));
const presets = {
  cream:{primary:'#e8b4bb',paper:'#fffaf0',text:'#49383a',decor:'ribbon',fontSize:50,imageRatio:50,letterRatio:27},
  blue:{primary:'#a9c5d1',paper:'#f6fbfc',text:'#34444b',decor:'minimal',fontSize:50,imageRatio:50,letterRatio:27},
  lavender:{primary:'#c6b2d5',paper:'#fdf9ff',text:'#433849',decor:'stars',fontSize:50,imageRatio:50,letterRatio:27}
};
const defaultState = ()=>({version:1,characters:structuredClone(initialCharacters),rounds:structuredClone(initialRounds),letters:{},settings:{...presets.cream,preset:'cream'},activeRoundId:'round_1',previewRoundId:'round_1',previewCharacterId:'char_m1',updatedAt:new Date().toISOString()});
let state = defaultState();
let db = null;
let saveTimer = null;
let pendingImageCharacter = null;
let toastTimer = null;
let exporting = false;
const imageCache = new Map();

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function dbGet(){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(PROJECT_KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function dbPut(value){return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(value,PROJECT_KEY);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
function validProject(p){return p&&Array.isArray(p.characters)&&Array.isArray(p.rounds)&&p.letters&&typeof p.letters==='object'&&p.settings}
function repairState(p){
  const base=defaultState();
  p.characters=p.characters.filter(c=>c&&c.id).map(c=>{const {alias,...character}=c,preset=initialCharacters.find(x=>x.id===c.id),name=legacyDefaultNames[c.id]===c.name&&preset?preset.name:String(c.name||'未命名角色');return {...character,name,gender:c.gender||'other',color:c.color||'#d5909f',enabled:c.enabled!==false,image:c.image||null}});
  p.rounds=p.rounds.filter(r=>r&&r.id).map(r=>({...r,name:String(r.name||'未命名轮次')}));
  if(!p.rounds.length)p.rounds=base.rounds;
  p.settings={...base.settings,...p.settings};
  p.letters=Object.fromEntries(Object.entries(p.letters).map(([key,value])=>[key,truncateLetter(String(value||''))]));
  p.activeRoundId=p.rounds.some(r=>r.id===p.activeRoundId)?p.activeRoundId:p.rounds[0].id;
  p.previewRoundId=p.rounds.some(r=>r.id===p.previewRoundId)?p.previewRoundId:p.activeRoundId;
  p.previewCharacterId=p.characters.some(c=>c.id===p.previewCharacterId)?p.previewCharacterId:p.characters[0]?.id||'';
  return p;
}
async function persistNow(){
  clearTimeout(saveTimer); $('#globalSaveStatus').textContent='保存中…';
  try{state.updatedAt=new Date().toISOString();await dbPut(state);$('#globalSaveStatus').textContent='已保存到本机';$$('.save-state').forEach(x=>x.textContent='已保存')}
  catch(err){console.error(err);$('#globalSaveStatus').textContent='保存失败';showToast('保存失败：浏览器存储空间可能不足，请先导出备份。',true)}
}
function scheduleSave(){
  $('#globalSaveStatus').textContent='保存中…';$$('.save-state').forEach(x=>x.textContent='保存中…');clearTimeout(saveTimer);saveTimer=setTimeout(persistNow,420);
}
function letterKey(roundId,characterId){return `${roundId}::${characterId}`}
function getLetter(roundId,characterId){return state.letters[letterKey(roundId,characterId)]||''}
function setLetter(roundId,characterId,value){state.letters[letterKey(roundId,characterId)]=value;scheduleSave()}
function countChars(text){return Array.from(String(text).replace(/[\s]/gu,'')).length}
function truncateLetter(text,limit=LETTER_MAX){let n=0,out='';for(const ch of Array.from(text)){if(/\s/u.test(ch)){out+=ch;continue}if(n>=limit)continue;out+=ch;n++}return out}
function autoResizeTextarea(textarea){textarea.style.height='auto';textarea.style.height=`${Math.min(Math.max(textarea.scrollHeight,168),360)}px`;textarea.style.overflowY=textarea.scrollHeight>360?'auto':'hidden'}
function sanitizeFileName(s){return String(s).replace(/[\\/:*?"<>|\x00-\x1F]/g,'_').replace(/[. ]+$/g,'').trim()||'未命名角色'}
function roundFileName(round){const m=round.name.match(/第\s*(\d+)\s*轮/);return m?`第${m[1]}轮`:sanitizeFileName(round.name)}
function showToast(msg,error=false){const t=$('#toast');t.textContent=msg;t.style.background=error?'#873f46':'#3e3536';t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3300)}
function confirmAction(title,message,okText='确认'){
  return new Promise(resolve=>{const d=$('#confirmDialog');$('#confirmTitle').textContent=title;$('#confirmMessage').textContent=message;$('#confirmOk').textContent=okText;d.showModal();d.addEventListener('close',()=>resolve(d.returnValue==='confirm'),{once:true})})
}
function genderLabel(g){return g==='male'?'男嘉宾':g==='female'?'女嘉宾':'其他'}
function enabledCharacters(){return state.characters.filter(c=>c.enabled)}
function roundProgress(roundId){const chars=enabledCharacters();const done=chars.filter(c=>countChars(getLetter(roundId,c.id))>0).length;return {done,total:chars.length}}
function getRound(id){return state.rounds.find(r=>r.id===id)}
function getCharacter(id){return state.characters.find(c=>c.id===id)}

function goPage(name){
  $$('.page').forEach(p=>p.classList.toggle('active-page',p.id===`page-${name}`));
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  if(name==='preview') renderPreview();
  if(name==='export') updateExportUI();
  scrollTo({top:0,behavior:'smooth'});
}
function renderRoundOptions(){
  const html=state.rounds.map(r=>`<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');
  $('#letterRoundSelect').innerHTML=html;$('#letterRoundSelect').value=state.activeRoundId;
}
function escapeHTML(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function renderOverview(){
  const p=roundProgress(state.activeRoundId),r=getRound(state.activeRoundId);
  $('#metricCharacters').textContent=enabledCharacters().length;$('#metricRounds').textContent=state.rounds.length;$('#metricProgress').textContent=`${p.done}/${p.total}`;
  $('#overviewRoundName').textContent=r?.name||'未选择轮次';$('#activeRoundLabel').textContent=r?.name||'未选择轮次';
  $('#overviewRoundHint').textContent=p.total-p.done?`还有 ${p.total-p.done} 封来信等待填写`:'本轮来信已经全部填写';
}
function renderCharacters(){
  $('#characterCountText').textContent=`${state.characters.length} 位角色 · ${enabledCharacters().length} 位启用`;
  $('#characterList').innerHTML=state.characters.map(c=>`<article class="character-card ${c.enabled?'':'disabled'}" data-id="${c.id}">
    <div class="portrait-thumb">${c.image?`<img src="${c.image}" alt="${escapeHTML(c.name)}立绘">`:'<span class="portrait-placeholder">◇</span>'}</div>
    <div class="character-info"><span class="character-meta"><i class="color-chip" style="background:${c.color}"></i>${genderLabel(c.gender)}</span><h3>${escapeHTML(c.name)}</h3>
      <div class="character-actions"><button class="edit-role">编辑资料</button><button class="upload-role">${c.image?'更换':'上传'}立绘</button>${c.image?'<button class="remove-image">移除立绘</button>':''}<button class="delete-role">删除</button></div>
    </div><button class="enable-pill">${c.enabled?'已启用':'已停用'}</button></article>`).join('')||'<div class="empty-mini">尚无角色，请新增角色。</div>';
}
function renderLetterEditors(){
  const r=getRound(state.activeRoundId),chars=enabledCharacters();
  $('#letterEditors').innerHTML=chars.map((c,i)=>{const val=getLetter(r.id,c.id),n=countChars(val);return `<details class="letter-editor" data-id="${c.id}" ${i===0?'open':''}><summary>
    <span class="editor-avatar">${c.image?`<img src="${c.image}" alt="">`:'◇'}</span><span class="editor-title"><b>${escapeHTML(c.name)}</b><small>${escapeHTML(r.name)} · ${genderLabel(c.gender)}</small></span><span class="letter-state ${n?'done':''}">${n?'已填写':'待填写'}</span>
    </summary><div class="editor-body"><textarea class="letter-textarea" placeholder="写下 5～100 字的心意……" aria-label="${escapeHTML(c.name)}的来信">${escapeHTML(val)}</textarea><div class="editor-foot"><span><b class="count-text ${n&&n<LETTER_MIN?'short':''} ${n>=LETTER_MAX?'full':''}">目前 ${n} / ${LETTER_MAX} 字${n&&n<LETTER_MIN?' · 可暂存，导出前会提醒':''}</b><br><small class="save-state">已保存</small></span><button class="clear-letter">清空内容</button></div></div></details>`}).join('')||'<div class="empty-mini">没有启用的角色，请先到角色管理启用角色。</div>';
  requestAnimationFrame(()=>$$('.letter-textarea',$('#letterEditors')).forEach(autoResizeTextarea));
  updateRoundProgress();
}
function updateRoundProgress(){
  const p=roundProgress(state.activeRoundId);$('#roundProgressText').textContent=`已完成 ${p.done} / ${p.total}`;$('#roundProgressBar').style.width=`${p.total?p.done/p.total*100:0}%`;renderOverview();
}
function renderCharacterSelect(){
  const chars=enabledCharacters();if(!chars.some(c=>c.id===state.previewCharacterId))state.previewCharacterId=chars[0]?.id||state.characters[0]?.id||'';
  $('#previewCharacterSelect').innerHTML=chars.map(c=>`<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');$('#previewCharacterSelect').value=state.previewCharacterId;
}
function renderSettings(){const s=state.settings;$('#settingPrimary').value=s.primary;$('#settingPaper').value=s.paper;$('#settingText').value=s.text;$('#settingDecor').value=s.decor;$('#settingFontSize').value=s.fontSize;$('#fontSizeOut').textContent=`${s.fontSize}px`;$$('.preset').forEach(b=>b.classList.toggle('active',b.dataset.preset===s.preset))}
function renderAll(){renderRoundOptions();renderOverview();renderCharacters();renderLetterEditors();renderCharacterSelect();renderSettings();updateExportUI()}

function openCharacterDialog(c=null){
  $('#characterDialogTitle').textContent=c?'编辑角色':'新增角色';$('#characterId').value=c?.id||'';$('#characterName').value=c?.name||'';$('#characterGender').value=c?.gender||'male';$('#characterColor').value=c?.color||'#d5909f';$('#characterEnabled').checked=c?.enabled!==false;$('#characterDialog').showModal();
}
async function deleteCharacter(id){
  const c=getCharacter(id);const has=Object.keys(state.letters).some(k=>k.endsWith(`::${id}`)&&countChars(state.letters[k]));
  if(!await confirmAction('删除角色？',`${c.name}${has?'已有来信资料，删除后这些来信也会一并移除。':'尚无来信资料。'} 此操作无法撤销。`,'删除角色'))return;
  state.characters=state.characters.filter(x=>x.id!==id);Object.keys(state.letters).forEach(k=>{if(k.endsWith(`::${id}`))delete state.letters[k]});if(state.previewCharacterId===id)state.previewCharacterId=enabledCharacters()[0]?.id||'';scheduleSave();renderAll();showToast('角色已删除');
}
function readImageFile(file){
  return new Promise((resolve,reject)=>{if(!['image/png','image/jpeg','image/webp'].includes(file.type))return reject(new Error('仅支持 PNG、JPG、JPEG 或 WebP 图片。'));if(file.size>12*1024*1024)return reject(new Error('图片超过 12MB，请先压缩后再上传。'));const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('图片读取失败。'));r.readAsDataURL(file)})
}

function roundedRect(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath()}
function hexAlpha(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`}
function loadImage(src){
  if(!src)return Promise.resolve(null);if(imageCache.has(src))return imageCache.get(src);
  const p=new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('图片载入失败'));im.src=src});imageCache.set(src,p);return p;
}
function drawContain(ctx,img,x,y,w,h,pad=0){if(!img)return;const scale=Math.min((w-pad*2)/img.naturalWidth,(h-pad*2)/img.naturalHeight);const dw=img.naturalWidth*scale,dh=img.naturalHeight*scale;ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh)}
function splitLines(ctx,text,maxWidth){
  const result=[];let line='';for(const ch of Array.from(text.replace(/\n+/g,' '))){const test=line+ch;if(ctx.measureText(test).width>maxWidth&&line){result.push(line.trimEnd());line=ch.trimStart()}else line=test}if(line||!result.length)result.push(line.trimEnd());return result;
}
function journeyEntries(character){
  return state.rounds.map(round=>({round,text:getLetter(round.id,character.id).trim()})).filter(item=>countChars(item.text));
}
async function renderJourneyCard(canvas,character,settings=state.settings){
  const s=settings,entries=journeyEntries(character),fontSize=Number(s.fontSize),lineHeight=Math.round(fontSize*1.55),maxTextWidth=830;
  canvas.width=1200;canvas.height=100;let ctx=canvas.getContext('2d');ctx.font=`600 ${fontSize}px "Noto Serif SC","Songti SC",serif`;
  const sections=entries.map(item=>{const lines=splitLines(ctx,item.text,maxTextWidth);return {...item,lines,height:150+lines.length*lineHeight}});
  const headerH=690,footerH=170,emptyH=330,gap=34;
  const contentH=sections.length?sections.reduce((n,x)=>n+x.height,0)+gap*Math.max(0,sections.length-1):emptyH;
  const totalH=Math.max(1320,headerH+contentH+footerH);
  canvas.width=1200;canvas.height=totalH;ctx=canvas.getContext('2d');
  ctx.fillStyle='#f7f1e8';ctx.fillRect(0,0,1200,totalH);
  const glow=ctx.createRadialGradient(950,180,30,950,180,820);glow.addColorStop(0,hexAlpha(s.primary,.48));glow.addColorStop(1,hexAlpha(s.primary,0));ctx.fillStyle=glow;ctx.fillRect(0,0,1200,980);
  for(let y=85;y<totalH-60;y+=18){ctx.fillStyle=`rgba(100,78,72,${y%36?'.017':'.01'})`;ctx.fillRect(70,y,1060,1)}
  ctx.strokeStyle=hexAlpha(s.primary,.52);ctx.lineWidth=3;roundedRect(ctx,44,44,1112,totalH-88,32);ctx.stroke();ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=2;roundedRect(ctx,56,56,1088,totalH-112,26);ctx.stroke();
  let portrait=null;try{portrait=await loadImage(character?.image)}catch(e){console.warn(e)}
  ctx.fillStyle=hexAlpha(s.text,.78);ctx.font='18px Georgia';ctx.textAlign='left';ctx.fillText('LOVE LETTER · COMPLETE JOURNEY',82,105);
  ctx.save();ctx.translate(1040,112);ctx.rotate(.06);ctx.strokeStyle=hexAlpha(s.primary,.9);ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,59,0,Math.PI*2);ctx.stroke();ctx.font='bold 18px Georgia';ctx.textAlign='center';ctx.fillStyle=hexAlpha(s.text,.72);ctx.fillText('ALL',0,-7);ctx.font='14px Georgia';ctx.fillText('STAGES',0,17);ctx.restore();
  ctx.fillStyle='rgba(255,255,255,.43)';roundedRect(ctx,76,150,1048,370,30);ctx.fill();ctx.strokeStyle=hexAlpha(s.primary,.3);ctx.lineWidth=2;roundedRect(ctx,76,150,1048,370,30);ctx.stroke();
  if(portrait)drawContain(ctx,portrait,96,168,1008,334);else{ctx.fillStyle=hexAlpha(s.primary,.12);roundedRect(ctx,96,168,1008,334,22);ctx.fill();ctx.fillStyle=hexAlpha(s.text,.42);ctx.font='28px "Noto Serif SC",serif';ctx.textAlign='center';ctx.fillText('尚未上传角色立绘',600,345)}
  ctx.fillStyle=s.text;ctx.font='600 58px "Noto Serif SC",serif';ctx.textAlign='center';ctx.fillText(character?.name||'未选择角色',600,590);
  ctx.fillStyle=hexAlpha(s.text,.55);ctx.font='17px Georgia';ctx.fillText(`${sections.length} / ${state.rounds.length} STAGES ARCHIVED`,600,628);
  let y=headerH;
  if(!sections.length){ctx.fillStyle=s.paper;roundedRect(ctx,105,y,990,emptyH-24,28);ctx.fill();ctx.strokeStyle=hexAlpha(s.primary,.38);ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=hexAlpha(s.text,.38);ctx.font='30px "Noto Serif SC",serif';ctx.textAlign='center';ctx.fillText('还没有已填写的阶段来信',600,y+145)}
  sections.forEach((section,index)=>{
    ctx.save();ctx.shadowColor='rgba(64,43,40,.12)';ctx.shadowBlur=22;ctx.shadowOffsetY=10;ctx.fillStyle=s.paper;roundedRect(ctx,105,y,990,section.height,28);ctx.fill();ctx.restore();
    ctx.strokeStyle=hexAlpha(s.primary,.43);ctx.lineWidth=2;roundedRect(ctx,105,y,990,section.height,28);ctx.stroke();
    ctx.fillStyle=s.primary;roundedRect(ctx,137,y+30,190,48,24);ctx.fill();ctx.fillStyle='#fff';ctx.font='600 22px "Noto Serif SC",serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(section.round.name,232,y+54);
    ctx.fillStyle=hexAlpha(s.text,.34);ctx.font='15px Georgia';ctx.textAlign='right';ctx.fillText(String(index+1).padStart(2,'0')+'  /  '+String(sections.length).padStart(2,'0'),1055,y+58);
    if(s.decor==='stars'){ctx.fillStyle=hexAlpha(s.primary,.7);ctx.font='25px serif';ctx.fillText('✦  ·',1010,y+101)}
    else if(s.decor==='ribbon'){ctx.strokeStyle=hexAlpha(s.primary,.68);ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(956,y+96);ctx.bezierCurveTo(992,y+75,1020,y+122,1056,y+92);ctx.stroke()}
    else{ctx.strokeStyle=hexAlpha(s.primary,.65);ctx.lineWidth=2;ctx.strokeRect(1008,y+84,44,34)}
    ctx.font=`600 ${fontSize}px "Noto Serif SC","Songti SC",serif`;ctx.fillStyle=s.text;ctx.textAlign='center';ctx.textBaseline='middle';
    const textTop=y+112;section.lines.forEach((line,i)=>ctx.fillText(line,600,textTop+lineHeight*(i+.5)));
    y+=section.height+gap;
  });
  ctx.fillStyle=hexAlpha(s.text,.5);ctx.font='14px Georgia';ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText('EVERY CHAPTER · EVERY LETTER · ONE COMPLETE STORY',600,totalH-88);
  return {height:totalH,missingImage:!portrait,entryCount:sections.length,totalRounds:state.rounds.length};
}
async function renderPreview(){
  const character=getCharacter(state.previewCharacterId);if(!character)return;
  const result=await renderJourneyCard($('#cardCanvas'),character);
  const warnings=[];if(result.missingImage)warnings.push('当前角色尚未上传立绘，将以留白提示区输出。');if(!result.entryCount)warnings.push('这个角色还没有已填写的来信，暂时无法下载。');
  $('#layoutWarning').textContent=warnings.join(' ');$('#layoutWarning').classList.toggle('hidden',!warnings.length);
  $('#previewRangeInfo').textContent=`已填写 ${result.entryCount} / ${result.totalRounds} 个阶段`;
  $('#singleExportInfo').textContent=`${character.name} · ${result.entryCount} 个阶段 · 1200 × ${result.height} px`;
}

function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('浏览器无法生成 PNG 图片。')),'image/png'))}
function downloadBlob(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
async function downloadCurrent(){
  if(exporting)return;const character=getCharacter(state.previewCharacterId);if(!character)return showToast('请先选择角色。',true);const entries=journeyEntries(character);if(!entries.length)return showToast('这个角色还没有已填写的阶段来信。',true);const short=entries.filter(x=>countChars(x.text)<LETTER_MIN);if(short.length&&!await confirmAction(`有 ${short.length} 个阶段少于 ${LETTER_MIN} 字`,`仍要输出“${character.name}”的完整阶段长卡吗？`,'继续导出'))return;
  try{exporting=true;await document.fonts?.ready;const canvas=document.createElement('canvas');await renderJourneyCard(canvas,character);downloadBlob(await canvasBlob(canvas),`全阶段_${sanitizeFileName(character.name)}.png`);showToast('完整阶段长图已生成并开始下载');}
  catch(e){showToast(`导出失败：${e.message}`,true)}finally{exporting=false}
}
async function renderAllCards(){
  const box=$('#allCardsList');box.innerHTML='';for(const c of enabledCharacters()){
    const entries=journeyEntries(c),item=document.createElement('article');item.className='mini-card-item';
    if(entries.length){const canvas=document.createElement('canvas');const info=document.createElement('div');info.className='mini-card-info';info.innerHTML=`<h4>${escapeHTML(c.name)}</h4><p>已收录 ${entries.length} / ${state.rounds.length} 个阶段，全部整合在同一张长图。</p><button class="secondary-btn">设为当前预览</button>`;item.append(canvas,info);await renderJourneyCard(canvas,c);info.querySelector('button').onclick=()=>{state.previewCharacterId=c.id;$('#previewCharacterSelect').value=c.id;renderPreview();item.scrollIntoView({behavior:'smooth',block:'center'})};}
    else item.innerHTML=`<div class="empty-mini">尚无阶段来信</div><div class="mini-card-info"><h4>${escapeHTML(c.name)}</h4><p>至少填写一个阶段后，才会参与批量导出。</p><button class="secondary-btn">前往填写</button></div>`,item.querySelector('button').onclick=()=>goPage('letters');
    box.append(item);await new Promise(r=>setTimeout(r,0));
  }
}
function exportItems(){return enabledCharacters().map(character=>({character,entries:journeyEntries(character)})).filter(item=>item.entries.length)}
function updateExportUI(){
  $('#exportCount').textContent=exportItems().length;
}
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function u16(n){return new Uint8Array([n&255,(n>>>8)&255])}function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255])}
function concatBytes(parts){const len=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(len);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length}return out}
async function makeZip(files){
  const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
  for(const file of files){const name=enc.encode(file.name),data=new Uint8Array(await file.blob.arrayBuffer()),crc=crc32(data),local=concatBytes([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);locals.push(local);
    const central=concatBytes([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);centrals.push(central);offset+=local.length}
  const centralBlock=concatBytes(centrals),end=concatBytes([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralBlock.length),u32(offset),u16(0)]);return new Blob([...locals,centralBlock,end],{type:'application/zip'})
}
async function batchExport(){
  if(exporting)return;const items=exportItems();if(!items.length)return showToast('没有可导出的非空白来信。',true);const short=items.flatMap(x=>x.entries).filter(x=>countChars(x.text)<LETTER_MIN);if(short.length&&!await confirmAction('发现短来信',`有 ${short.length} 个阶段少于 ${LETTER_MIN} 字。仍要继续批量导出吗？`,'继续导出'))return;
  const progress=$('#exportProgress');progress.classList.remove('hidden');$('#exportProgressBar').style.width='0%';const files=[],failures=[];exporting=true;$('#batchExportBtn').disabled=true;
  try{await document.fonts?.ready;for(let i=0;i<items.length;i++){const item=items[i];$('#exportProgressText').textContent=`正在产生完整长卡：${i+1} / ${items.length}`;$('#exportProgressCount').textContent=`${i} / ${items.length}`;try{const canvas=document.createElement('canvas');await renderJourneyCard(canvas,item.character);files.push({name:`全阶段_${sanitizeFileName(item.character.name)}.png`,blob:await canvasBlob(canvas)})}catch(e){failures.push(`${item.character.name}：${e.message}`)}$('#exportProgressCount').textContent=`${i+1} / ${items.length}`;$('#exportProgressBar').style.width=`${(i+1)/items.length*100}%`;await new Promise(r=>setTimeout(r,25))}
    if(!files.length)throw new Error('所有角色长卡均生成失败。');$('#exportProgressText').textContent='正在封装 ZIP…';downloadBlob(await makeZip(files),'恋爱综艺_全阶段角色长卡.zip');if(failures.length)showToast(`已导出 ${files.length} 张，${failures.length} 张失败：${failures.join('；')}`,true);else showToast(`已成功生成 ${files.length} 张角色长卡`);$('#exportProgressText').textContent=failures.length?'导出完成，部分失败':'导出成功';
  }catch(e){$('#exportProgressText').textContent='导出失败';showToast(`ZIP 导出失败：${e.message}`,true)}finally{exporting=false;$('#batchExportBtn').disabled=false}
}

function exportBackup(){
  try{const payload={format:'love-letter-card-studio',formatVersion:1,exportedAt:new Date().toISOString(),project:state};downloadBlob(new Blob([JSON.stringify(payload)],{type:'application/json'}),`恋爱综艺来信小卡项目_${new Date().toISOString().slice(0,10)}.json`);showToast('项目备份已导出')}
  catch(e){showToast(`备份失败：${e.message}`,true)}
}
async function previewBackup(file){
  try{if(file.size>80*1024*1024)throw new Error('备份文件超过 80MB。');const parsed=JSON.parse(await file.text());if(parsed.format!=='love-letter-card-studio'||!validProject(parsed.project))throw new Error('不是有效的本工具备份文件。');const p=repairState(parsed.project),letters=Object.values(p.letters).filter(x=>countChars(x)).length,box=$('#backupPreview');box.classList.remove('hidden');box.innerHTML=`<b>备份内容预览</b><p>${p.characters.length} 位角色 · ${p.rounds.length} 个轮次 · ${letters} 封非空白来信</p><p>导出时间：${escapeHTML(parsed.exportedAt||'未知')}</p><button class="primary-btn" id="restoreBackupBtn">覆盖并还原此备份</button>`;
    $('#restoreBackupBtn').onclick=async()=>{if(!await confirmAction('覆盖现有项目？','还原会用备份内容覆盖当前角色、立绘、轮次、来信与设置。建议先导出当前备份。','确认还原'))return;state=p;await persistNow();renderAll();await renderPreview();box.classList.add('hidden');$('#backupImportInput').value='';showToast('备份已成功还原')};
  }catch(e){$('#backupImportInput').value='';showToast(`无法导入备份：${e.message}`,true)}
}

function bindEvents(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>goPage(b.dataset.page));$$('[data-go]').forEach(b=>b.onclick=()=>goPage(b.dataset.go));
  $('#letterEditors').addEventListener('toggle',e=>{if(e.target.matches('.letter-editor[open]'))requestAnimationFrame(()=>autoResizeTextarea($('.letter-textarea',e.target)))},true);
  $('#letterRoundSelect').onchange=e=>{state.activeRoundId=e.target.value;renderLetterEditors();renderOverview();scheduleSave()};
  $('#previewCharacterSelect').onchange=e=>{state.previewCharacterId=e.target.value;renderPreview();scheduleSave()};
  $('#addRoundBtn').onclick=async()=>{const name=prompt('请输入新轮次名称：',`第${state.rounds.length+1}轮`);if(!name?.trim())return;const r={id:uid('round'),name:name.trim().slice(0,30)};state.rounds.push(r);state.activeRoundId=r.id;state.previewRoundId=r.id;renderAll();scheduleSave();showToast('已新增空白轮次')};
  $('#renameRoundBtn').onclick=()=>{const r=getRound(state.activeRoundId),name=prompt('修改轮次名称：',r.name);if(!name?.trim())return;r.name=name.trim().slice(0,30);renderAll();renderPreview();scheduleSave()};
  $('#deleteRoundBtn').onclick=async()=>{if(state.rounds.length<=1)return showToast('至少需要保留一个轮次。',true);const r=getRound(state.activeRoundId),has=state.characters.some(c=>countChars(getLetter(r.id,c.id)));if(!await confirmAction('删除轮次？',`${r.name}${has?'包含已填写来信，删除后无法恢复。':'目前没有来信。'} 确定删除吗？`,'删除轮次'))return;state.rounds=state.rounds.filter(x=>x.id!==r.id);Object.keys(state.letters).forEach(k=>{if(k.startsWith(`${r.id}::`))delete state.letters[k]});state.activeRoundId=state.rounds[0].id;if(state.previewRoundId===r.id)state.previewRoundId=state.activeRoundId;renderAll();renderPreview();scheduleSave()};
  $('#letterEditors').addEventListener('input',e=>{if(!e.target.classList.contains('letter-textarea'))return;const details=e.target.closest('.letter-editor'),id=details.dataset.id,clean=truncateLetter(e.target.value);if(clean!==e.target.value){const pos=e.target.selectionStart;e.target.value=clean;e.target.setSelectionRange(Math.min(pos,clean.length),Math.min(pos,clean.length));showToast(`每封来信最多 ${LETTER_MAX} 个非空白字符。`)};autoResizeTextarea(e.target);setLetter(state.activeRoundId,id,e.target.value);const n=countChars(e.target.value),ct=$('.count-text',details),badge=$('.letter-state',details);ct.textContent=`目前 ${n} / ${LETTER_MAX} 字${n&&n<LETTER_MIN?' · 可暂存，导出前会提醒':''}`;ct.className=`count-text ${n&&n<LETTER_MIN?'short':''} ${n>=LETTER_MAX?'full':''}`;badge.textContent=n?'已填写':'待填写';badge.classList.toggle('done',!!n);updateRoundProgress()});
  $('#letterEditors').addEventListener('click',async e=>{if(!e.target.classList.contains('clear-letter'))return;const d=e.target.closest('.letter-editor'),t=$('.letter-textarea',d);if(t.value&&!await confirmAction('清空来信？','这封来信的内容会被清空。','清空'))return;t.value='';t.dispatchEvent(new Event('input',{bubbles:true}))});
  $('#addCharacterBtn').onclick=()=>openCharacterDialog();
  $('#characterList').onclick=async e=>{const card=e.target.closest('.character-card');if(!card)return;const c=getCharacter(card.dataset.id);if(e.target.classList.contains('edit-role'))openCharacterDialog(c);else if(e.target.classList.contains('upload-role')){pendingImageCharacter=c.id;$('#hiddenImageInput').click()}else if(e.target.classList.contains('remove-image')){if(await confirmAction('移除立绘？','角色资料与来信会保留，只移除图片。','移除')){c.image=null;imageCache.clear();renderAll();renderPreview();scheduleSave()}}else if(e.target.classList.contains('enable-pill')){c.enabled=!c.enabled;renderAll();renderPreview();scheduleSave()}else if(e.target.classList.contains('delete-role'))deleteCharacter(c.id)};
  $('#hiddenImageInput').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||!pendingImageCharacter)return;try{const data=await readImageFile(file),c=getCharacter(pendingImageCharacter);if(!c)throw new Error('目标角色已不存在。');c.image=data;imageCache.clear();renderAll();await renderPreview();scheduleSave();showToast('立绘已保存到当前浏览器')}catch(err){showToast(err.message,true)}finally{pendingImageCharacter=null}};
  $('#characterForm').addEventListener('submit',e=>{e.preventDefault();const id=$('#characterId').value,name=$('#characterName').value.trim();if(!name)return showToast('角色名称不能为空。',true);const data={name:name.slice(0,20),gender:$('#characterGender').value,color:$('#characterColor').value,enabled:$('#characterEnabled').checked};if(id)Object.assign(getCharacter(id),data);else state.characters.push({id:uid('char'),...data,image:null});$('#characterDialog').close();renderAll();renderPreview();scheduleSave();showToast(id?'角色资料已更新':'角色已新增')});
  $('#downloadCurrentBtn').onclick=downloadCurrent;$('#downloadCurrentBtn2').onclick=downloadCurrent;
  $('#showAllBtn').onclick=async()=>{$('#allCardsSection').classList.remove('hidden');$('#showAllBtn').disabled=true;try{await renderAllCards();$('#allCardsSection').scrollIntoView({behavior:'smooth'})}finally{$('#showAllBtn').disabled=false}};$('#hideAllBtn').onclick=()=>$('#allCardsSection').classList.add('hidden');
  $$('.preset').forEach(b=>b.onclick=()=>{state.settings={...presets[b.dataset.preset],preset:b.dataset.preset};renderSettings();renderPreview();scheduleSave()});
  ['settingPrimary','settingPaper','settingText','settingDecor','settingFontSize'].forEach(id=>{$(`#${id}`).oninput=e=>{const map={settingPrimary:'primary',settingPaper:'paper',settingText:'text',settingDecor:'decor',settingFontSize:'fontSize'},key=map[id];state.settings[key]=e.target.type==='range'?Number(e.target.value):e.target.value;state.settings.preset='custom';renderSettings();renderPreview();scheduleSave()}});
  $('#batchExportBtn').onclick=batchExport;$('#backupExportBtn').onclick=exportBackup;$('#backupImportInput').onchange=e=>e.target.files[0]&&previewBackup(e.target.files[0]);
  addEventListener('beforeunload',()=>{if(saveTimer)persistNow()});
}

async function init(){
  try{db=await openDB();const saved=await dbGet();if(validProject(saved))state=repairState(saved);else await dbPut(state);bindEvents();renderAll();await document.fonts?.ready;await renderPreview();$('#globalSaveStatus').textContent='已保存到本机'}
  catch(e){console.error(e);showToast('无法启用本机存储。请检查浏览器隐私设置；本次内容可能无法保留。',true);bindEvents();renderAll();renderPreview()}
}
init();
