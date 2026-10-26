const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS, sanitizeSettings } = require('./core.cjs');
async function createStore(directory, safeStorage) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'settings.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  let settings;
  try { settings = sanitizeSettings(data.settings, DEFAULTS); } catch { settings = { ...DEFAULTS }; }
  const write = () => { const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify({ settings, encryptedKey: data.encryptedKey || '' }, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); };
  let plaintext = '';
  if (data.encryptedKey) try {
    const decrypt = safeStorage.decryptStringAsync || safeStorage.decryptString;
    plaintext = await decrypt.call(safeStorage, Buffer.from(data.encryptedKey, 'base64'));
  } catch { /* A key from another Windows account cannot be decrypted. */ }
  let queue = Promise.resolve();
  return {
    get: () => ({ ...settings, hasKey: !!plaintext }), key: () => plaintext,
    save(input) {
      const operation = queue.then(async () => {
      const next = sanitizeSettings(input, settings);
      let encryptedKey = data.encryptedKey;
      let nextPlaintext = plaintext;
      if (input.clearKey === true) { encryptedKey = ''; nextPlaintext = ''; }
      else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
        if (!/^sk-ant-[\w-]{12,}$/.test(input.apiKey.trim())) throw new Error('Claude API 키 형식을 확인해 주세요. sk-ant-로 시작합니다.');
        const available = safeStorage.isAsyncEncryptionAvailable || safeStorage.isEncryptionAvailable;
        if (!await available.call(safeStorage)) throw new Error('운영체제의 암호화 저장소를 사용할 수 없어요.');
        const encrypt = safeStorage.encryptStringAsync || safeStorage.encryptString;
        encryptedKey = (await encrypt.call(safeStorage, input.apiKey.trim())).toString('base64');
        nextPlaintext = input.apiKey.trim();
      }
      const previousSettings = settings, previousData = data.encryptedKey;
      settings = next; data.encryptedKey = encryptedKey;
      try { write(); } catch (error) { settings = previousSettings; data.encryptedKey = previousData; throw error; }
      plaintext = nextPlaintext;
      return this.get();
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
module.exports = { createStore };
