const $=selector=>document.querySelector(selector);
export function createAttachments({bridge,notify,onChange=()=>{}}){
  let files=[],busy=false,loading=false,search=false;
  function render(){
    const list=$('#attachment-list');list.replaceChildren();
    for(const file of files){
      const item=document.createElement('div');item.className='attachment-chip';
      const badge=document.createElement('span');badge.className='attachment-format';badge.textContent=file.format;
      const name=document.createElement('span');name.className='attachment-name';name.textContent=file.name;name.title=file.name;
      const size=document.createElement('small');size.textContent=file.size>=1024*1024?`${(file.size/1024/1024).toFixed(1)}MB`:`${Math.ceil(file.size/1024)}KB`;
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`${file.name} 첨부 해제`);remove.disabled=busy||loading;
      remove.addEventListener('click',async()=>{
        const result=await bridge?.removeAttachment(file.id);if(result?.error){notify(result.error);return;}
        files=files.filter(item=>item.id!==file.id);render();
      });
      item.append(badge,name,size,remove);list.append(item);
    }
    list.hidden=!files.length;$('#attachment-note').hidden=!files.length;
    $('#attach-file').disabled=busy||loading||files.length>=4;
    $('#toggle-search').disabled=busy||loading;
    $('#attach-file').setAttribute('aria-busy',String(loading));
    $('#attachment-count').textContent=loading?'파일 읽는 중…':files.length?`${files.length}/4`:'파일당 최대 6MB';
    onChange({loading});
  }
  $('#attach-file').addEventListener('click',async()=>{
    if(!bridge){notify('파일 첨부는 Windows 앱에서 사용할 수 있어요.');return;}
    if(busy||loading)return;loading=true;render();
    try{
      const result=await bridge.chooseAttachments(4-files.length);
      if(result?.error)throw new Error(result.error);
      files.push(...result.files);if(result.errors?.length)notify(result.errors.join('\n'));else if(result.files.length)notify('보내기를 누르면 첨부한 파일 내용이 선택한 AI로 전송돼요.');
    }catch(error){notify(error.message);}finally{loading=false;render();}
  });
  $('#toggle-search').addEventListener('click',()=>{
    search=!search;$('#toggle-search').setAttribute('aria-pressed',String(search));
    notify(search?'웹 검색을 켰어요. 검색이 실행되면 추가 API 사용료가 발생해요.':'웹 검색을 껐어요.');
  });
  render();
  return {snapshot:()=>files.map(file=>({...file})),isLoading:()=>loading,search:()=>search,setBusy:value=>{busy=value;render();},consume:ids=>{files=files.filter(file=>!ids.includes(file.id));render();},restore:previous=>{if(!files.length)files=previous.map(file=>({...file}));render();},clear:()=>{files=[];render();}};
}
export function showAttachedFiles(element,files,search=false){
  if(!files.length&&!search)return;
  const group=document.createElement('div');group.className='sent-attachments';
  for(const file of files){const item=document.createElement('span');item.textContent=`${file.format} · ${file.name}`;group.append(item);}
  if(search){const item=document.createElement('span');item.textContent='웹 검색 켬';group.append(item);}
  element.append(group);
}
export function showSources(element,sources,bridge,notify){
  if(!sources?.length)return;
  const group=document.createElement('div');group.className='answer-sources';group.setAttribute('aria-label','답변 출처');
  const label=document.createElement('span');label.className='source-label';label.textContent='출처';group.append(label);
  for(const [index,source]of sources.entries()){
    const item=document.createElement(source.kind==='web'?'button':'div');item.className='answer-source';
    const title=document.createElement('span');title.textContent=`${index+1}. ${source.title}`;
    const site=document.createElement('small');site.textContent=source.site;item.append(title,site);
    if(source.kind==='web'){
      item.type='button';item.title='브라우저에서 출처 열기';
      item.addEventListener('click',async()=>{const result=await bridge?.openSource(source.id);if(result?.error)notify(result.error);});
    }
    group.append(item);
  }
  element.append(group);
}
