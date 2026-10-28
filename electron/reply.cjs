const CONTINUE_PROMPT='앞선 답변이 출력 길이 한도로 중간에 멈췄습니다. 이미 작성한 내용과 서론을 반복하지 말고 끊긴 문장이나 코드의 바로 다음부터 이어서 원래 요청을 끝까지 완성해 주세요.';
const CONTINUE_PROGRESS='긴 답변을 이어서 받고 있어요 · 중지 버튼으로 멈출 수 있어요';
const MAX_CONTEXT_BYTES=28*1024*1024;
function checkContext(context){
  if(Buffer.byteLength(JSON.stringify(context))>MAX_CONTEXT_BYTES)throw new Error('대화와 파일이 문맥 용량에 도달했어요. 받은 답변은 화면에 남아 있어요. 새 대화에서 이어갈 부분을 보내 주세요.');
}
// A long but active response must not hit a fixed total-duration deadline.
// Keep a watchdog only for a stalled request; cancellation remains immediate.
function createReplyWatchdog(onTimeout,{milliseconds=10*60*1000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let timer,closed=false;
  function touch(){if(closed)return;clearTimer(timer);timer=setTimer(()=>{closed=true;onTimeout();},milliseconds);timer?.unref?.();}
  touch();
  return {touch,close(){closed=true;clearTimer(timer);}};
}
function checkContinuation(chunk,previous){
  if(!chunk.trim())throw new Error('이어 받을 답변이 오지 않아 중지했어요. 받은 내용은 화면에 남아 있어요.');
  if(previous&&chunk.trim()===previous.trim())throw new Error('같은 답변이 반복되어 자동 이어받기를 중지했어요. 받은 내용은 화면에 남아 있어요.');
}
module.exports={CONTINUE_PROMPT,CONTINUE_PROGRESS,checkContext,checkContinuation,createReplyWatchdog};
