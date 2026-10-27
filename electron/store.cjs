const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS, sanitizeSettings } = require('./core.cjs');
const {providerInfo}=require('./providers.cjs');
async function createStore(directory, safeStorage) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'settings.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  let settings;
  try { settings = sanitizeSettings(data.settings, DEFAULTS); } catch { settings = { ...DEFAULTS }; }
  const write = () => { const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify({ settings, encryptedKey:data.encryptedKey||'', encryptedElevenLabsKey:data.encryptedElevenLabsKey||'',encryptedGeminiKey:data.encryptedGeminiKey||'',encryptedOpenAIKey:data.encryptedOpenAIKey||'' }, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); };
  const secrets = {};
  for (const field of ['encryptedKey','encryptedElevenLabsKey','encryptedGeminiKey','encryptedOpenAIKey']) {
    secrets[field] = '';
    if (data[field]) try {
      const decrypt = safeStorage.decryptStringAsync || safeStorage.decryptString;
      const decrypted = await decrypt.call(safeStorage, Buffer.from(data[field], 'base64'));
      // Electron's async API returns { result, shouldReEncrypt }; its legacy
      // synchronous API returns the string directly. SDKs must receive a string.
      const value = typeof decrypted === 'string' ? decrypted : decrypted?.result;
      if (typeof value !== 'string') throw new Error('Invalid decrypted credential');
      secrets[field] = value;
    } catch { /* A key from another Windows account cannot be decrypted. */ }
  }
  let queue = Promise.resolve();
  return {
    get: () => ({ ...settings, hasKey:!!secrets.encryptedKey,hasGeminiKey:!!secrets.encryptedGeminiKey,hasOpenAIKey:!!secrets.encryptedOpenAIKey,hasSelectedKey:!!secrets[providerInfo(settings.aiProvider).keyField],hasElevenLabsKey:!!secrets.encryptedElevenLabsKey }),
    key: () => secrets.encryptedKey,
    keyFor:provider=>secrets[providerInfo(provider).keyField],
    elevenLabsKey: () => secrets.encryptedElevenLabsKey,
    save(input) {
      const operation = queue.then(async () => {
      const next = sanitizeSettings(input, settings);
      const nextData = { ...data }, nextSecrets = { ...secrets };
      for (const [field, key, clear, pattern, message] of [
        ['encryptedKey','apiKey','clearKey',/^sk-ant-[\w-]{12,}$/, 'Claude API 키 형식을 확인해 주세요. sk-ant-로 시작합니다.'],
        ['encryptedGeminiKey','geminiApiKey','clearGeminiKey',/^[\w-]{20,512}$/, 'Gemini API 키 형식을 확인해 주세요.'],
        ['encryptedOpenAIKey','openaiApiKey','clearOpenAIKey',/^[\w-]{20,512}$/, 'GPT(OpenAI) API 키 형식을 확인해 주세요.'],
        ['encryptedElevenLabsKey','elevenLabsApiKey','clearElevenLabsKey',/^[\w-]{20,256}$/, 'ElevenLabs API 키 형식을 확인해 주세요.']
      ]) {
        if (input[clear] === true) { nextData[field] = ''; nextSecrets[field] = ''; }
        else if (typeof input[key] === 'string' && input[key].trim()) {
          if (!pattern.test(input[key].trim())) throw new Error(message);
          const available = safeStorage.isAsyncEncryptionAvailable || safeStorage.isEncryptionAvailable;
          if (!await available.call(safeStorage)) throw new Error('운영체제의 암호화 저장소를 사용할 수 없어요.');
          const encrypt = safeStorage.encryptStringAsync || safeStorage.encryptString;
          nextData[field] = (await encrypt.call(safeStorage, input[key].trim())).toString('base64');
          nextSecrets[field] = input[key].trim();
        }
      }
      const previousSettings = settings, previousData = data;
      settings = next; data = nextData;
      try { write(); } catch (error) { settings = previousSettings; data = previousData; throw error; }
      Object.assign(secrets, nextSecrets);
      return this.get();
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
module.exports = { createStore };
