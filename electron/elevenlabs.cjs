const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const { sanitizeSettings } = require('./core.cjs');
const SAMPLE_TEXT = '안녕하세요, 박주임이에요. 오늘도 곁에서 편안하게 이야기 나눠요.';
const clean = (value, max = 200) => typeof value === 'string' ? value.slice(0, max) : '';

function voiceError(error) {
  // Never forward raw SDK errors: they can contain request headers or bodies.
  if (error?.name === 'AbortError') return '음성 생성을 중지했어요.';
  return ({
    401:'ElevenLabs API 키를 확인해 주세요.',
    403:'이 키의 음성 생성·목소리 조회 권한과 요금제를 확인해 주세요.',
    404:'선택한 목소리나 음성 모델을 사용할 수 없어요. 목록을 새로 불러와 주세요.',
    422:'목소리나 모델 설정을 확인해 주세요.',
    429:'ElevenLabs 크레딧 또는 요청 한도를 확인한 뒤 다시 시도해 주세요.'
  })[error?.statusCode || error?.status] || 'ElevenLabs에 연결하지 못했어요. 인터넷 연결과 API 사용 상태를 확인해 주세요.';
}

function createElevenLabs({ key = () => '', allowEnvironment = true, clientFactory = apiKey => new ElevenLabsClient({ apiKey: apiKey || undefined }) } = {}) {
  const client = () => {
    const apiKey = key();
    if (!apiKey && !(allowEnvironment && process.env.ELEVENLABS_API_KEY)) throw new Error('설정에서 ElevenLabs API 키를 연결해 주세요.');
    return clientFactory(apiKey);
  };
  async function voices(input = {}) {
    const search = clean(input.search, 100).trim();
    const nextPageToken = clean(input.nextPageToken, 1000) || undefined;
    const sdk = client();
    try {
      const response = await sdk.voices.search({ search:search || undefined, nextPageToken, pageSize:100, includeTotalCount:false }, { timeoutInSeconds:25, maxRetries:0 });
      const items = (response.voices || []).map(voice => ({
        id:clean(voice.voiceId,100), name:clean(voice.name,120), description:clean(voice.description,300),
        language:clean(voice.labels?.language,40), gender:clean(voice.labels?.gender,40),
        korean:voice.labels?.language === 'ko' || /korean|한국/i.test(voice.labels?.language || '') || (voice.verifiedLanguages || []).some(item => item.language === 'ko')
      })).filter(item => /^[a-zA-Z0-9_-]+$/.test(item.id));
      items.sort((a,b) => Number(b.korean)-Number(a.korean) || a.name.localeCompare(b.name,'ko'));
      return { voices:items, nextPageToken:response.hasMore ? clean(response.nextPageToken,1000) : '' };
    } catch (error) { throw new Error(voiceError(error)); }
  }
  async function synthesize(text, input, signal) {
    const settings = sanitizeSettings(input);
    if (!settings.elevenLabsVoiceId) throw new Error('설정에서 목소리를 선택하고 저장해 주세요.');
    const limit = settings.elevenLabsModel === 'eleven_v3' ? 5000 : 10000;
    if (typeof text !== 'string' || !text.trim() || text.length > limit) throw new Error(`이 음성 모델은 한 번에 ${limit.toLocaleString('ko-KR')}자까지 읽을 수 있어요.`);
    const sdk = client();
    try {
      const voiceSettings = { stability:settings.voiceStability, similarityBoost:0.75 };
      // v3 accepts the Natural/Creative/Robust stability presets only.
      if (settings.elevenLabsModel === 'eleven_v3') voiceSettings.stability = settings.voiceStability < .25 ? 0 : settings.voiceStability > .75 ? 1 : .5;
      const audio = await sdk.textToSpeech.convert(settings.elevenLabsVoiceId, {
        text:text.trim(), modelId:settings.elevenLabsModel, languageCode:settings.elevenLabsModel === 'eleven_multilingual_v2' ? undefined : 'ko',
        outputFormat:'mp3_44100_128', voiceSettings
      }, { abortSignal:signal, timeoutInSeconds:60, maxRetries:0 });
      const chunks = []; let size = 0;
      for await (const chunk of audio) {
        if (signal?.aborted) throw new DOMException('Aborted','AbortError');
        size += chunk.length;
        if (size > 24 * 1024 * 1024) throw new Error('Audio exceeded limit');
        chunks.push(Buffer.from(chunk));
      }
      if (!size) throw new Error('Empty audio');
      return Buffer.concat(chunks);
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted','AbortError');
      throw new Error(voiceError(error));
    }
  }
  return { voices, synthesize };
}
module.exports = { createElevenLabs, voiceError, SAMPLE_TEXT };
