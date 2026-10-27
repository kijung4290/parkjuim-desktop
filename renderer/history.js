const $=selector=>document.querySelector(selector);
const labels={claude:'Claude',gemini:'Gemini',openai:'GPT'};
export function createHistory({bridge,onOpen,onNew}){
  let items=[],activeId=null,busy=false,loading=false,editing=null,mode='',generation=0;
  const panel=$('#history-panel'),list=$('#history-list');
  const feedback=text=>{$('#history-feedback').textContent=text;};
  function button(text,className,action){const control=document.createElement('button');control.type='button';control.textContent=text;control.className=className;control.disabled=busy||loading;control.addEventListener('click',action);return control;}
  function render(){
    $('#open-history').disabled=busy;$('#history-new').disabled=busy||loading;$('#history-count').textContent=`${items.length}/50`;
    list.replaceChildren();const query=$('#history-search').value.trim().toLocaleLowerCase();
    const visible=items.filter(record=>`${record.title} ${labels[record.provider]} ${record.model}`.toLocaleLowerCase().includes(query));
    $('#history-empty').hidden=!!visible.length;$('#history-empty').textContent=query?'이름에 맞는 대화가 없어요.':'함께 나눈 대화가 여기에 차곡차곡 모여요.';
    for(const record of visible){
      const row=document.createElement('article');row.className=`history-item${record.id===activeId?' current':''}`;row.dataset.id=record.id;
      const open=button('','history-open',async()=>operate(async()=>{const result=await bridge.historyOpen(record.id);if(result?.error)throw new Error(result.error);await onOpen(result);close(true);}));
      const title=document.createElement('strong');title.textContent=record.title;
      const meta=document.createElement('span');meta.className='history-meta';meta.textContent=`${labels[record.provider]} · ${record.count}회 대화 · ${new Date(record.updatedAt).toLocaleDateString('ko-KR',{month:'short',day:'numeric'})}`;
      const preview=document.createElement('span');preview.className='history-preview';preview.textContent=record.preview;open.append(title,meta,preview);open.title=`${record.model} · 대화 이어가기`;row.append(open);
      if(editing===record.id&&mode==='rename'){
        const form=document.createElement('form');form.className='history-edit';const input=document.createElement('input');input.type='text';input.value=record.title;input.maxLength=60;input.required=true;input.setAttribute('aria-label','대화 이름');input.disabled=busy||loading;
        const actions=document.createElement('div');actions.className='history-actions';actions.append(button('이름 저장','text-button',()=>form.requestSubmit()),button('취소','text-button',()=>{editing=null;render();}));form.append(input,actions);
        form.addEventListener('submit',event=>{event.preventDefault();const title=input.value;operate(async()=>{const result=await bridge.historyRename(record.id,title);if(result?.error)throw new Error(result.error);editing=null;await refresh();feedback('대화 이름을 바꿨어요.');});});row.append(form);
      }else if(editing===record.id&&mode==='delete'){
        const confirm=document.createElement('div');confirm.className='history-edit';const text=document.createElement('p');text.textContent='이 PC에 저장된 이 대화를 삭제할까요? 되돌릴 수 없어요.';confirm.append(text);
        const actions=document.createElement('div');actions.className='history-actions';actions.append(button('이 대화 삭제','text-button danger',()=>operate(async()=>{const result=await bridge.historyDelete(record.id);if(result?.error)throw new Error(result.error);editing=null;await refresh();feedback('대화를 삭제했어요.');})),button('취소','text-button',()=>{editing=null;render();}));confirm.append(actions);row.append(confirm);
      }else{
        const actions=document.createElement('div');actions.className='history-actions';actions.append(button('이름 변경','text-button',()=>{editing=record.id;mode='rename';render();list.querySelector(`[data-id="${record.id}"] input`)?.focus();}),button('삭제','text-button danger',()=>{editing=record.id;mode='delete';render();}));
        if(record.id===activeId){const current=document.createElement('span');current.className='history-current';current.textContent='현재 대화';actions.append(current);}row.append(actions);
      }
      list.append(row);
    }
  }
  async function refresh(){
    if(!bridge){items=[];render();feedback('대화 저장은 실제 앱에서 사용할 수 있어요.');return;}
    const token=++generation,result=await bridge.historyList();if(token!==generation)return;
    if(result?.error)throw new Error(result.error);items=result.items;activeId=result.activeId;render();
  }
  async function operate(action){if(busy||loading)return;loading=true;feedback('처리하고 있어요…');render();try{await action();}catch(error){feedback(error.message);}finally{loading=false;render();}}
  function close(toComposer=false){panel.hidden=true;editing=null;$(toComposer?'#message':'#open-history').focus();}
  $('#open-history').addEventListener('click',()=>{if(busy)return;panel.hidden=false;editing=null;feedback('');operate(async()=>{await refresh();feedback('');});$('#history-search').focus();});
  $('#close-history').addEventListener('click',()=>close());$('#history-search').addEventListener('input',render);
  $('#history-new').addEventListener('click',()=>operate(async()=>{if(await onNew())close(true);}));
  render();
  return {close,isOpen:()=>!panel.hidden,setBusy:value=>{busy=value;render();},changed(id){activeId=id;if(!panel.hidden)refresh().catch(error=>feedback(error.message));}};
}
