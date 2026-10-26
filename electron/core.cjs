const DEFAULTS = Object.freeze({ model: 'claude-sonnet-5-5', roam: true, alwaysOnTop: true, speak: true, speed: 22, scale: 1, startAtLogin: false, nickname: '', systemPrompt: '' });
const SYSTEM_PROMPT = `당신은 바탕화면을 산책하는 작은 동료 '박주임'입니다. 한국어로 자연스럽고 따뜻한 존댓말을 사용합니다. 과한 감탄이나 이모지는 피하고, 기본 답변은 짧고 실용적인 2~5문장으로 합니다. 사회복지 실무, 글쓰기, 일상 업무를 함께 고민합니다. 사용자가 길게 설명해 달라고 하면 충분히 설명합니다. 실제 인물이나 기관의 직원인 척하지 않습니다. 컴퓨터 화면, 파일, 마이크를 스스로 보고 듣거나 조작할 수 있다고 말하지 않습니다. 사용자가 입력한 메시지만 볼 수 있습니다. 개인정보 입력을 먼저 요구하지 않습니다.`;
function sanitizeSettings(input = {}, previous = DEFAULTS) {
  const result = { ...previous };
  for (const name of ['roam', 'alwaysOnTop', 'speak', 'startAtLogin']) if (typeof input[name] === 'boolean') result[name] = input[name];
  for (const [name, min, max] of [['speed', 8, 60], ['scale', 0.7, 1.4]]) if (Number.isFinite(input[name])) result[name] = Math.min(max, Math.max(min, input[name]));
  for (const [name, max] of [['model', 100], ['nickname', 40], ['systemPrompt', 4000]]) if (typeof input[name] === 'string') result[name] = input[name].trim().slice(0, max);
  if (!/^[a-zA-Z0-9._-]+$/.test(result.model)) throw new Error('모델 ID를 확인해 주세요.');
  return result;
}
function clampPosition(point, area, size) {
  return { x: Math.round(Math.min(Math.max(point.x, area.x), area.x + Math.max(0, area.width - size.width))), y: Math.round(Math.min(Math.max(point.y, area.y), area.y + Math.max(0, area.height - size.height))) };
}
function chatBounds(pet, area, size = { width: 380, height: 490 }) {
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  const x = pet.x - width - 8 >= area.x ? pet.x - width - 8 : pet.x + pet.width + 8;
  return { ...clampPosition({ x, y: pet.y + pet.height - height }, area, { width, height }), width, height };
}
function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) throw new Error('대화는 최근 40개 메시지까지 보낼 수 있어요.');
  let total = 0;
  const clean = messages.map((m, index) => {
    if (!m || m.role !== (index % 2 ? 'assistant' : 'user') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000) throw new Error('대화 내용을 확인해 주세요.');
    total += m.content.length;
    return { role: m.role, content: m.content.trim() };
  });
  if (total > 60000 || clean.at(-1).role !== 'user') throw new Error('대화가 길어졌어요. 새 대화를 시작해 주세요.');
  return clean;
}
module.exports = { DEFAULTS, SYSTEM_PROMPT, sanitizeSettings, clampPosition, chatBounds, validateMessages };
