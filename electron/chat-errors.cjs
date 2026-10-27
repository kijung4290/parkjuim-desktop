function chatError(error, { cancelled = false, timedOut = false } = {}) {
  if (timedOut) return 'Claude 응답 시간이 길어졌어요. 잠시 뒤 다시 보내 주세요.';
  if (cancelled) return '답변을 중지했어요.';
  const status = error?.status;
  const detail = error?.error?.error || error?.error || {};
  const message = typeof detail.message === 'string' ? detail.message : '';
  if (status === 400 && /credit|balance|billing|payment/i.test(message)) return 'Claude API 크레딧이 부족해요. Claude Platform의 결제·크레딧을 확인해 주세요. Claude 구독과 API 결제는 별개예요.';
  if (status === 400 && /web_search|web search/i.test(message)) return 'Claude API 계정이나 선택한 모델에서 웹 검색을 사용할 수 없어요. 계정 권한을 확인하거나 웹 검색을 끄고 다시 보내 주세요.';
  if (status === 400 && /pdf|image|document/i.test(message)) return '첨부 파일을 처리하지 못했어요. PDF 암호를 해제하거나 파일·이미지를 줄여 다시 첨부해 주세요.';
  if (status === 400) return 'Claude 요청 설정을 사용할 수 없어요. 설정에서 모델과 API 계정의 워크스페이스를 확인해 주세요. (400)';
  if (status === 401) return 'Claude API 키가 올바르지 않아요. 설정에서 키를 다시 연결해 주세요. (401)';
  if (status === 403) return '이 Claude API 키의 모델·워크스페이스 사용 권한을 확인해 주세요. (403)';
  if (status === 404) return '이 Claude 모델을 사용할 수 없어요. 설정의 모델 ID를 확인해 주세요. (404)';
  if (status === 413) return '대화가 너무 길어졌어요. 새 대화를 시작해 주세요. (413)';
  if (status === 429) return 'Claude API 요청 한도에 도달했어요. 잠시 뒤 다시 보내 주세요. (429)';
  if (status >= 500) return `Claude 서버가 잠시 응답하지 못했어요. 잠시 뒤 다시 보내 주세요. (${status})`;
  if (error?.name === 'APIConnectionTimeoutError') return 'Claude 연결 시간이 초과됐어요. 인터넷 연결을 확인하고 다시 보내 주세요.';
  if (error?.name === 'APIConnectionError') return 'Claude 서버에 연결하지 못했어요. 인터넷·VPN·방화벽 설정을 확인해 주세요.';
  // Do not forward SDK messages, headers, request bodies or credentials.
  return '앱에서 Claude 요청을 처리하지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 보내 주세요.';
}
module.exports = { chatError };
