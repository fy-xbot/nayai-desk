import type { ProviderId } from "../types/provider";

export const ANSWER_HASH_KEY = "__nay_answer";

/**
 * 生成回答提取脚本。注入到 webview 后，脚本会：
 * 1. 查找最后一条 assistant 回答元素
 * 2. 提取纯文本（截断到 maxLen）
 * 3. base64 编码后写入 URL hash（#__nay_answer=<base64>）
 *
 * 前端 pollAllUrls 检测到该 hash key 后解码并存入 scoreStore。
 */
export function getExtractionScript(
  providerId: ProviderId,
  maxLen = 8000,
): string {
  const extractorCode = extractors[providerId];
  return `(function(){
  try {
    var text = (function(){ ${extractorCode} })();
    if (!text || typeof text !== 'string') text = '';
    text = text.trim();
    if (text.length > ${maxLen}) text = text.substring(0, ${maxLen});
    var encoded = btoa(unescape(encodeURIComponent(text)));
    var url = new URL(window.location.href);
    var rawHash = url.hash ? url.hash.substring(1) : '';
    var parts = rawHash.split('&').filter(function(s){
      return s && s.indexOf('${ANSWER_HASH_KEY}=') !== 0;
    });
    parts.push('${ANSWER_HASH_KEY}=' + encoded);
    url.hash = parts.join('&');
    history.replaceState(history.state, '', url.toString());
    console.log('[nayai-desk] extracted answer length:', text.length);
  } catch(e) {
    console.log('[nayai-desk] extraction error:', e);
    var url2 = new URL(window.location.href);
    var rawHash2 = url2.hash ? url2.hash.substring(1) : '';
    var parts2 = rawHash2.split('&').filter(function(s){
      return s && s.indexOf('${ANSWER_HASH_KEY}=') !== 0;
    });
    parts2.push('${ANSWER_HASH_KEY}=');
    url2.hash = parts2.join('&');
    history.replaceState(history.state, '', url2.toString());
  }
})()`;
}

/**
 * 生成清除 hash 中 __nay_answer 的脚本（提取完成后调用）。
 */
export function getClearAnswerHashScript(): string {
  return `(function(){
  try {
    var url = new URL(window.location.href);
    var rawHash = url.hash ? url.hash.substring(1) : '';
    var parts = rawHash.split('&').filter(function(s){
      return s && s.indexOf('${ANSWER_HASH_KEY}=') !== 0;
    });
    url.hash = parts.length ? parts.join('&') : '';
    history.replaceState(history.state, '', url.toString());
  } catch(e) {}
})()`;
}

/* ─── 各 provider 的最后一条回答提取逻辑 ─── */

const extractors: Record<ProviderId, string> = {
  gpt: `
    // ChatGPT: 回答在 [data-message-author-role="assistant"] 容器内
    var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!msgs.length) msgs = document.querySelectorAll('div[class*="markdown"]');
    if (!msgs.length) msgs = document.querySelectorAll('article');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  gemini: `
    // Gemini: 回答在 message-content 或 model-response 容器
    var msgs = document.querySelectorAll('message-content');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="model-response"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="response-container"]');
    if (!msgs.length) msgs = document.querySelectorAll('.markdown');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  claude: `
    // Claude: 回答在 [data-is-streaming] 或 .font-claude-message 容器
    var msgs = document.querySelectorAll('[data-is-streaming]');
    if (!msgs.length) msgs = document.querySelectorAll('.font-claude-message');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="claude-message"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="assistant-message"]');
    if (!msgs.length) {
      // fallback: 找所有 markdown 块，取最后一个
      msgs = document.querySelectorAll('.markdown, [class*="markdown"]');
    }
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  deepseek: `
    // DeepSeek: 回答在 .ds-markdown 或 [class*="answer"] 容器
    var msgs = document.querySelectorAll('.ds-markdown');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="answer"]');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  doubao: `
    // 豆包: 回答在 [data-testid*="receive"] 或 markdown 容器
    var msgs = document.querySelectorAll('[data-testid*="receive"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="receive-msg"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown-body"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="message-content"]');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  kimi: `
    // Kimi: 回答在 [data-testid*="message-content"] 或 markdown 容器
    var msgs = document.querySelectorAll('[data-testid*="msh-message-content"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="message-content"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown"]');
    // Kimi 的用户消息和 AI 消息交替出现，取最后一个偶数索引（AI 回复）
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  qwen: `
    // 通义千问: 回答在 [class*="message--ai"] 或 markdown 容器
    var msgs = document.querySelectorAll('[class*="message--ai"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="assistant"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown-body"]');
    if (!msgs.length) msgs = document.querySelectorAll('.markdown');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  ernie: `
    // 文心一言: 回答在 [class*="robot"] 或 markdown 容器
    var msgs = document.querySelectorAll('[class*="robot"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="assistant"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="message-content"]');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  perplexity: `
    // Perplexity: 回答在 [class*="prose"] 或 answer 容器
    var msgs = document.querySelectorAll('[class*="prose"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="answer"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown"]');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,

  grok: `
    // Grok: 回答在 [class*="message"] 容器
    var msgs = document.querySelectorAll('[class*="assistant"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="response"]');
    if (!msgs.length) msgs = document.querySelectorAll('[class*="markdown"]');
    if (!msgs.length) msgs = document.querySelectorAll('article');
    var last = msgs[msgs.length - 1];
    return last ? last.innerText : '';
  `,
};
