import type { PromptImagePayload, ProviderId } from "../types/provider";

function escapeForJS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function withRetry(
  findInputCode: string,
  fillAndSendCode: string,
  maxRetries = 10,
  interval = 600,
): string {
  return `(function(){
  var _tries=0;
  function _attempt(){
    var el = ${findInputCode};
    if(!el){
      if(++_tries<${maxRetries}){ setTimeout(_attempt,${interval}); }
      else { console.log('[nayai-desk] gave up finding input after '+${maxRetries}+' tries'); }
      return;
    }
    console.log('[nayai-desk] found input element:', el.tagName, el.id||el.className);
    ${fillAndSendCode}
  }
  _attempt();
})();`;
}

function fillTextarea(escaped: string): string {
  return `
    el.focus();
    var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set
      ||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(setter){setter.call(el,'${escaped}');}else{el.value='${escaped}';}
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));`;
}

/**
 * For ProseMirror / contenteditable editors (ChatGPT, Gemini etc.)
 * Strategy: clipboard paste simulation > insertText > innerHTML fallback
 */
function fillContentEditable(escaped: string): string {
  return `
    el.focus();
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain','${escaped}');
      var pe = new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
      var handled = !el.dispatchEvent(pe);
      if(!handled && !el.textContent.trim()){
        el.innerHTML='<p>${escaped}</p>';
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'${escaped}'}));
      }
    } catch(e) {
      el.innerHTML='<p>${escaped}</p>';
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }
    console.log('[nayai-desk] filled content:', el.textContent?.substring(0,30));`;
}

function clickSend(selectorCode: string, delay = 500): string {
  return `
    setTimeout(function(){
      var btn=${selectorCode};
      console.log('[nayai-desk] send button:', btn?.tagName, btn?.disabled);
      if(btn&&!btn.disabled){btn.click();console.log('[nayai-desk] clicked send');}
      else{
        el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        console.log('[nayai-desk] simulated Enter key');
      }
    },${delay});`;
}

function buildImagePasteScript(images: PromptImagePayload[]): string {
  if (images.length === 0) return "";
  const serialized = escapeForJS(JSON.stringify(images));
  return `
    (function(){
      var __nayaiImages = JSON.parse('${serialized}');
      if (!__nayaiImages.length) return;

      function __nayaiDataUrlToFile(item, index) {
        try {
          var parts = (item.dataUrl || '').split(',');
          if (parts.length < 2) return null;
          var header = parts[0] || '';
          var mime = item.mimeType || (header.match(/data:([^;]+)/) || [])[1] || 'image/png';
          var bin = atob(parts[1]);
          var len = bin.length;
          var bytes = new Uint8Array(len);
          for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          var name = item.name || ('pasted-image-' + (index + 1) + '.png');
          return new File([bytes], name, { type: mime });
        } catch (err) {
          console.log('[nayai-desk] failed to rebuild image file', err);
          return null;
        }
      }

      function __nayaiDispatchPaste(target, files) {
        if (!target || !files.length) return;
        try {
          var dt = new DataTransfer();
          files.forEach(function(file) {
            if (file) dt.items.add(file);
          });
          if (!dt.files.length) return;
          var evt;
          try {
            evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
          } catch (err) {
            evt = new Event('paste', { bubbles: true, cancelable: true });
          }
          try {
            Object.defineProperty(evt, 'clipboardData', { value: dt });
          } catch (err) {
            evt.clipboardData = dt;
          }
          target.dispatchEvent(evt);
        } catch (err) {
          console.log('[nayai-desk] failed to dispatch image paste', err);
        }
      }

      var files = __nayaiImages.map(function(item, index) {
        return __nayaiDataUrlToFile(item, index);
      }).filter(Boolean);
      if (!files.length) return;

      var target = null;
      [
        el,
        document.activeElement,
        el && el.closest ? el.closest('form') : null,
        el && el.parentElement ? el.parentElement : null,
        document.querySelector('main form'),
        document.querySelector('[contenteditable="true"]'),
        document.querySelector('textarea'),
      ].forEach(function(candidate) {
        if (target || !candidate) return;
        target = candidate;
      });
      if (el && el.focus) el.focus();
      if (target) __nayaiDispatchPaste(target, files);
      console.log('[nayai-desk] pasted images:', files.length);
    })();`;
}

function withTextFill(
  escaped: string,
  contentEditableCode: string,
  plainTextCode: string,
): string {
  return `
    if('${escaped}'.trim()){
      if(el.getAttribute && el.getAttribute('contenteditable')==='true'){
        ${contentEditableCode}
      } else {
        ${plainTextCode}
      }
    } else if (el.focus) {
      el.focus();
    }`;
}

const scripts: Record<ProviderId, (prompt: string, images: PromptImagePayload[]) => string> = {
  gpt: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    return withRetry(
      `document.querySelector('#prompt-textarea[contenteditable="true"]')||document.querySelector('#prompt-textarea')||document.querySelector('div.ProseMirror[contenteditable="true"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('textarea')`,
      `
      ${pasteImages}
      ${withTextFill(e, fillContentEditable(e), fillTextarea(e))}
      ${clickSend(`document.querySelector('[data-testid="send-button"]:not([disabled])')||document.querySelector('button[aria-label*="Send"]:not([disabled])')||document.querySelector('button[aria-label*="发送"]:not([disabled])')`, images.length > 0 ? 1800 : 600)}`,
    );
  },

  gemini: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    const eForExec = e.replace(/\\n/g, "\\\\n");
    const fillGeminiContentEditable = `
    el.focus();
    var text = '${eForExec}'.replace(/\\\\n/g, '\\n');
    var done = false;
    if (document.execCommand) {
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        document.execCommand('insertText', false, text);
        done = el.textContent && el.textContent.indexOf(text.substring(0, 20)) >= 0;
      } catch (err) {}
    }
    if (!done) {
      try {
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        var pe = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(pe);
        if (!el.textContent || !el.textContent.trim()) {
          el.innerHTML = '<p>' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '</p><p>') + '</p>';
        }
      } catch (err) {
        el.innerHTML = '<p>' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
      }
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: el.textContent || '' }));
    if (el.parentElement) el.parentElement.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(function () {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: el.textContent || '' }));
      if (el.parentElement) el.parentElement.dispatchEvent(new Event('input', { bubbles: true }));
    }, 0);`;
    const findGeminiInput = `document.querySelector('rich-textarea .ql-editor.new-input-ui')||document.querySelector('rich-textarea .ql-editor[contenteditable="true"]')||document.querySelector('rich-textarea .ql-editor')||document.querySelector('div.ql-editor.new-input-ui[contenteditable="true"]')||document.querySelector('div.ql-editor[contenteditable="true"][role="textbox"]')||document.querySelector('div[aria-label="为 Gemini 输入提示"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('textarea')`;
    const sendGemini = `
    setTimeout(function(){
      el.focus();
      var btn = document.querySelector('button.send-button') || document.querySelector('button[aria-label="发送"]') || document.querySelector('.send-button-container button');
      if (btn && btn.getAttribute('aria-disabled') !== 'true') {
        btn.click();
      } else {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }, ${images.length > 0 ? 2400 : 1500});`;
    return withRetry(
      findGeminiInput,
      `
      ${pasteImages}
      if ('${e}'.trim()) {
        if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
          ${fillGeminiContentEditable}
        } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          ${fillTextarea(e)}
        } else {
          ${fillGeminiContentEditable}
        }
      } else if (el.focus) {
        el.focus();
      }
      ${sendGemini}`,
    );
  },

  doubao: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    return withRetry(
      `document.querySelector('textarea[data-testid="chat_input_input"]')||document.querySelector('textarea')`,
      `
      ${pasteImages}
      if('${e}'.trim()){
        ${fillTextarea(e)}
      } else if (el.focus) {
        el.focus();
      }
      ${clickSend(`document.getElementById('flow-end-msg-send')||document.querySelector('[data-testid="send-button"]')||document.querySelector('button.send-btn')`, images.length > 0 ? 1800 : 300)}`,
    );
  },

  deepseek: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    return withRetry(
      `document.querySelector('textarea#chat-input')||document.querySelector('textarea')`,
      `
      ${pasteImages}
      if('${e}'.trim()){
        ${fillTextarea(e)}
      } else if (el.focus) {
        el.focus();
      }
      ${clickSend(`document.querySelector('div[role="button"][class*="send"]')||document.querySelector('[data-testid="send-button"]')||document.querySelector('button[class*="send"]')`, images.length > 0 ? 1800 : 400)}`,
    );
  },

  qwen: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    const eForExec = e.replace(/\\n/g, "\\\\n");
    const findQwenInput = `document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[placeholder="向千问提问"]')||document.querySelector('div[data-placeholder="向千问提问"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea')||document.querySelector('input[type="text"]')`;
    const fillQwenEditable = `
    el.focus();
    var text = '${eForExec}'.replace(/\\\\n/g, '\\n');
    var done = false;
    if (document.execCommand) {
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        document.execCommand('insertText', false, text);
        done = true;
      } catch (err) {}
    }
    if (!done) {
      try {
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (err) {
        el.innerHTML = '<p>' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: el.textContent || '' }));
    if (el.parentElement) el.parentElement.dispatchEvent(new Event('input', { bubbles: true }));`;
    return withRetry(
      findQwenInput,
      `
      ${pasteImages}
      if ('${e}'.trim()) {
        if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'button')) {
          ${fillTextarea(e)}
        } else {
          ${fillQwenEditable}
        }
      } else if (el.focus) {
        el.focus();
      }
      setTimeout(function(){
        el.focus();
        var btn = document.querySelector('button[aria-label*="发送"]') || document.querySelector('button[class*="send"]');
        if (btn && !btn.disabled) btn.click();
        else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      }, ${images.length > 0 ? 2200 : 1000});`,
    );
  },

  grok: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    return withRetry(
      `document.querySelector('textarea')`,
      `
      ${pasteImages}
      if('${e}'.trim()){
        ${fillTextarea(e)}
      } else if (el.focus) {
        el.focus();
      }
      ${clickSend(`document.querySelector('button[aria-label="Send"]')||document.querySelector('button[type="submit"]')||document.querySelector('button[class*="send"]')`, images.length > 0 ? 1800 : 400)}`,
    );
  },

  claude: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    const findClaudeInput = `document.querySelector('div.ProseMirror[contenteditable="true"]')||document.querySelector('fieldset div[contenteditable="true"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea')`;
    return withRetry(
      findClaudeInput,
      `
      ${pasteImages}
      ${withTextFill(e, fillContentEditable(e), fillTextarea(e))}
      ${clickSend(`document.querySelector('button[aria-label="Send Message"]:not([disabled])')||document.querySelector('button[aria-label*="Send"]:not([disabled])')||document.querySelector('button[data-testid*="send"]:not([disabled])')||document.querySelector('fieldset button[type="button"]:not([disabled]):last-of-type')`, images.length > 0 ? 2000 : 600)}`,
    );
  },

  kimi: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    const findKimiInput = `document.querySelector('div[data-testid="msh-chatinput-editor"][contenteditable="true"]')||document.querySelector('div.chat-input-editor[contenteditable="true"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea')`;
    return withRetry(
      findKimiInput,
      `
      ${pasteImages}
      ${withTextFill(e, fillContentEditable(e), fillTextarea(e))}
      ${clickSend(`document.querySelector('[data-testid="msh-chatinput-send-button"]:not([disabled])')||document.querySelector('button[aria-label*="发送"]:not([disabled])')||document.querySelector('button[class*="send-button"]:not([disabled])')||document.querySelector('button[class*="send"]:not([disabled])')`, images.length > 0 ? 1800 : 500)}`,
    );
  },

  ernie: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    const findErnieInput = `document.querySelector('textarea#chat-input')||document.querySelector('textarea[placeholder*="请输入"]')||document.querySelector('textarea[placeholder*="输入"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea')`;
    return withRetry(
      findErnieInput,
      `
      ${pasteImages}
      if ('${e}'.trim()) {
        if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
          ${fillContentEditable(e)}
        } else {
          ${fillTextarea(e)}
        }
      } else if (el.focus) {
        el.focus();
      }
      ${clickSend(`document.querySelector('button[class*="sendBtn"]:not([disabled])')||document.querySelector('button[class*="send-btn"]:not([disabled])')||document.querySelector('button[aria-label*="发送"]:not([disabled])')||document.querySelector('button[class*="send"]:not([disabled])')`, images.length > 0 ? 1800 : 500)}`,
    );
  },

  perplexity: (prompt, images) => {
    const e = escapeForJS(prompt);
    const pasteImages = buildImagePasteScript(images);
    const findPerplexityInput = `document.querySelector('textarea[placeholder*="Ask"]')||document.querySelector('textarea[placeholder*="Follow"]')||document.querySelector('textarea')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[contenteditable="true"]')`;
    return withRetry(
      findPerplexityInput,
      `
      ${pasteImages}
      if ('${e}'.trim()) {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          ${fillTextarea(e)}
        } else {
          ${fillContentEditable(e)}
        }
      } else if (el.focus) {
        el.focus();
      }
      ${clickSend(`document.querySelector('button[aria-label="Submit"]:not([disabled])')||document.querySelector('button[aria-label*="Submit"]:not([disabled])')||document.querySelector('button[data-testid*="submit"]:not([disabled])')||document.querySelector('button[type="submit"]:not([disabled])')||document.querySelector('form button:last-child:not([disabled])')`, images.length > 0 ? 1800 : 500)}`,
    );
  },
};

export function getInjectionScript(
  providerId: ProviderId,
  prompt: string,
  images: PromptImagePayload[] = [],
): string {
  return scripts[providerId](prompt, images);
}

/** 登录状态信号会通过 URL hash 回传到父进程 —— 这个 key 需和 webviewManager pollAllUrls 里的解析保持一致 */
export const LOGIN_HASH_KEY = "__nay_login";

export function getLoginDetectScript(providerId: ProviderId): string {
  // 返回 true 表示能在页面上找到输入框/编辑器锚点（对话已就绪），false 为未登录或还没加载
  const detectors: Record<ProviderId, string> = {
    gpt: `!!document.querySelector('#prompt-textarea, div.ProseMirror[contenteditable="true"]')`,
    gemini: `!!(document.querySelector('rich-textarea .ql-editor')||document.querySelector('div.ql-editor.new-input-ui[contenteditable="true"]')||document.querySelector('div[aria-label="为 Gemini 输入提示"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('textarea'))`,
    doubao: `!!document.querySelector('textarea[data-testid="chat_input_input"], textarea')`,
    deepseek: `!!document.querySelector('textarea#chat-input, textarea')`,
    qwen: `!!(document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[placeholder="向千问提问"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea'))`,
    grok: `!!document.querySelector('textarea')`,
    claude: `!!(document.querySelector('div.ProseMirror[contenteditable="true"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea'))`,
    kimi: `!!(document.querySelector('div[data-testid="msh-chatinput-editor"][contenteditable="true"]')||document.querySelector('div.chat-input-editor[contenteditable="true"]')||document.querySelector('div[contenteditable="true"][role="textbox"]')||document.querySelector('textarea'))`,
    ernie: `!!(document.querySelector('textarea#chat-input')||document.querySelector('textarea[placeholder*="请输入"]')||document.querySelector('textarea[placeholder*="输入"]')||document.querySelector('div[contenteditable="true"]')||document.querySelector('textarea'))`,
    perplexity: `!!(document.querySelector('textarea[placeholder*="Ask"]')||document.querySelector('textarea[placeholder*="Follow"]')||document.querySelector('textarea')||document.querySelector('div[contenteditable="true"]'))`,
  };
  // 把探测结果写进 URL hash 里（history.replaceState 不会触发导航/重载），
  // 父进程的 URL 轮询会把该 hash 解析成 loginStatus 并写回 store。
  return `(function(){
    try {
      var ready = ${detectors[providerId]};
      var state = ready ? 'ready' : 'needs_login';
      var url = new URL(window.location.href);
      var rawHash = url.hash ? url.hash.substring(1) : '';
      var parts = rawHash.split('&').filter(function(s){ return s && s.indexOf('${LOGIN_HASH_KEY}=') !== 0; });
      parts.push('${LOGIN_HASH_KEY}=' + state);
      url.hash = parts.join('&');
      // 如果 hash 完全没变就不写，避免重复触发 hashchange
      if ('#' + parts.join('&') !== window.location.hash) {
        history.replaceState(history.state, '', url.toString());
      }
    } catch(e) { /* ignore */ }
  })()`;
}

type HideChromeSelectors = {
  topBar: string[];
  inputArea: string[];
  extra?: string[];
};

/** 各站点顶栏/输入框/辅助提示的选择器。只写能精确命中目标的规则，避免误伤整页。 */
const HIDE_CHROME_SELECTORS: Record<
  ProviderId,
  HideChromeSelectors
> = {
  gpt: {
    topBar: ["header", "[data-testid='header']", "[data-testid='top-bar']"],
    inputArea: ["main form", "[data-testid='composer']", "[data-testid='message-input-wrapper']"],
    extra: ["footer", "[class*='disclaimer']", "[class*='cookie']"],
  },
  gemini: {
    topBar: ["header", "nav", "[class*='header']", "[class*='toolbar']"],
    inputArea: ["chat-input-area", ".input-area-container", "[class*='chat-input']", "[class*='input-area']", "rich-textarea", "[class*='composer']"],
    extra: ["footer", "[class*='disclaimer']", "[class*='banner']", "[class*='hero-header']"],
  },
  doubao: {
    // 精准命中：豆包使用 Tailwind `h-[var(--header-height)]`（顶栏高度 CSS 变量）
    // 和 CSS Modules `input-content-container-xxx` / `input-guidance-xxx`（输入框）
    topBar: [
      "header",
      "[data-testid='header']",
      "[class*='--header-height' i]",
      "[class*='layout-header' i]",
      "[class*='page-header' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[class*='nav-bar' i]",
      "[class*='top-tool' i]",
      "[class*='toptool' i]",
    ],
    inputArea: [
      "[data-testid*='chat_input' i]",
      "[data-testid*='chat-input' i]",
      "[class*='input-content-container' i]",
      "[class*='input-guidance' i]",
      "[class*='chat-input' i]",
      "[class*='chatinput' i]",
      "[class*='input-wrapper' i]",
      "[class*='inputwrapper' i]",
      "[class*='send-box' i]",
      "[class*='sendbox' i]",
      "[class*='composer' i]",
      "[class*='input-area' i]",
      "[class*='inputarea' i]",
    ],
    extra: ["[class*='role-card' i]", "[class*='intro-card' i]", "[class*='banner' i]", "[class*='suggestion' i]"],
  },
  deepseek: {
    topBar: [
      "header",
      "[class*='Header_' i]",
      "[class*='header' i]",
      "[class*='navbar' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[class*='greeting' i]",
      "[class*='quickmode' i]",
      "[class*='quick-mode' i]",
      "[class*='tool_' i]",
      "[class*='tools_' i]",
      ".header",
    ],
    inputArea: [
      "[class*='Input_container' i]",
      "[class*='chat-input' i]",
      "[class*='chatinput' i]",
      "[class*='send-box' i]",
      "[class*='sendbox' i]",
      "[class*='input-wrapper' i]",
      "[class*='inputwrapper' i]",
      "[class*='inputbox' i]",
      "[class*='composer' i]",
      "[class*='prompt-input' i]",
      "[class*='promptinput' i]",
      "[class*='message-input' i]",
      "[class*='messageinput' i]",
      "[class*='ds-input' i]",
      "form[class*='input' i]",
      ".chat-input-wrapper",
    ],
  },
  qwen: {
    // 精准命中：千问顶栏没明显标识，但内容区锚点 #qianwen-main-area / #qianwen-left-panel 已知
    // 输入框容器用 `bg-capsule` class（千问私有主题色）
    topBar: [
      "header",
      "[class*='header' i]",
      "[class*='navbar' i]",
      "[class*='nav-bar' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[class*='app-bar' i]",
      "[class*='appbar' i]",
      "[class*='model-switch' i]",
      "[class*='modelswitch' i]",
      "[class*='model-select' i]",
      "[class*='modelselect' i]",
      "[class*='model-picker' i]",
      "[class*='modelpicker' i]",
    ],
    inputArea: [
      "[class*='bg-capsule' i]",
      "[class*='chat-input' i]",
      "[class*='chatinput' i]",
      "[class*='input-box' i]",
      "[class*='inputbox' i]",
      "[class*='input-wrapper' i]",
      "[class*='inputwrapper' i]",
      "[class*='send-container' i]",
      "[class*='sendcontainer' i]",
      "[class*='send-area' i]",
      "[class*='sendarea' i]",
      "[class*='composer' i]",
      "[class*='input-area' i]",
      "[class*='inputarea' i]",
      "[class*='question-bar' i]",
      "[class*='questionbar' i]",
      "[class*='ask-bar' i]",
      "[class*='message-editor' i]",
      "[class*='bottom-container' i]",
      "[class*='bottomcontainer' i]",
    ],
  },
  grok: {
    // 精准命中：Grok 顶栏用 Tailwind gradient `from-surface-` + `h-16 top-0 absolute z-10`
    topBar: [
      "header",
      "nav",
      "[class*='from-surface' i]",
      "[class*='h-16' i][class*='top-0' i][class*='z-10' i]",
      "[class*='header' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[class*='app-bar' i]",
      "[class*='appbar' i]",
      "[class*='nav-bar' i]",
      "[class*='navbar' i]",
      "[class*='auth-buttons' i]",
      "[class*='authbuttons' i]",
      "[class*='sign-in' i]",
      "[class*='signin' i]",
      "[data-testid*='topbar' i]",
    ],
    inputArea: [
      "form",
      "[class*='composer' i]",
      "[class*='bottom-bar' i]",
      "[class*='bottombar' i]",
      "[class*='message-input' i]",
    ],
  },
  claude: {
    topBar: [
      "header",
      "nav",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[data-testid*='header' i]",
      "[data-testid*='topbar' i]",
    ],
    inputArea: [
      "fieldset",
      "[class*='input-container' i]",
      "[class*='inputcontainer' i]",
      "[class*='composer' i]",
      "[class*='message-input' i]",
      "[class*='chat-input' i]",
    ],
    extra: ["[class*='disclaimer' i]", "[class*='footer' i]"],
  },
  kimi: {
    topBar: [
      "header",
      "nav",
      "[class*='header' i]",
      "[class*='nav-bar' i]",
      "[class*='navbar' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
    ],
    inputArea: [
      "[data-testid*='chatinput' i]",
      "[data-testid*='chat-input' i]",
      "[class*='chat-input' i]",
      "[class*='chatinput' i]",
      "[class*='input-container' i]",
      "[class*='inputcontainer' i]",
      "[class*='send-box' i]",
      "[class*='sendbox' i]",
      "[class*='composer' i]",
      "[class*='message-input' i]",
    ],
    extra: ["[class*='banner' i]", "[class*='guide' i]"],
  },
  ernie: {
    topBar: [
      "header",
      "[class*='header' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[class*='nav-bar' i]",
      "[class*='navbar' i]",
    ],
    inputArea: [
      "[class*='chat-input' i]",
      "[class*='chatinput' i]",
      "[class*='input-container' i]",
      "[class*='inputcontainer' i]",
      "[class*='send-area' i]",
      "[class*='sendarea' i]",
      "[class*='input-wrap' i]",
      "[class*='inputwrap' i]",
      "[class*='composer' i]",
    ],
    extra: ["[class*='banner' i]"],
  },
  perplexity: {
    topBar: [
      "header",
      "nav",
      "[class*='header' i]",
      "[class*='top-bar' i]",
      "[class*='topbar' i]",
      "[class*='nav-bar' i]",
      "[class*='navbar' i]",
    ],
    inputArea: [
      "form",
      "[class*='composer' i]",
      "[class*='search-bar' i]",
      "[class*='searchbar' i]",
      "[class*='input-area' i]",
      "[class*='inputarea' i]",
      "[class*='ask-input' i]",
      "[class*='askinput' i]",
      "[class*='message-input' i]",
    ],
    extra: ["[class*='footer' i]", "[class*='banner' i]"],
  },
};

const HIDE_CHROME_STYLE_ID = "__nayai_desk_hide_chrome";
const FORCE_LIGHT_STYLE_ID = "__nayai_desk_force_light";

/**
 * 强制模型网页使用浅色模式。策略：
 *  1. 在 documentElement/body 上设置 color-scheme: light（影响浏览器默认控件）
 *  2. 注入 meta name="color-scheme" content="light"（影响 CSS prefers-color-scheme）
 *  3. 写入多家常用的 localStorage key（theme / darkMode / appearance 等都设为 light/false）
 *  4. 移除 html/body 上常见的 dark/dark-theme class，加上 light，写 data-theme=light
 *  5. DOMContentLoaded 和 0.5/1.5/3s 延迟再重试，覆盖 SPA hydrate 后的重设
 * 不百分百保证所有站点都切浅色（部分站点有独立状态机），但能覆盖绝大多数情况。
 */
export function getForceLightScript(enabled: boolean): string {
  if (!enabled) {
    return `(function(){
      try {
        document.documentElement.style.colorScheme = '';
        var m = document.querySelector('meta[name="color-scheme"][data-nayai="1"]');
        if (m && m.parentNode) m.parentNode.removeChild(m);
        var s = document.getElementById("${FORCE_LIGHT_STYLE_ID}");
        if (s && s.parentNode) s.parentNode.removeChild(s);
      } catch(e) {}
    })();`;
  }
  return `(function(){
    function _apply(){
      try {
        var root = document.documentElement;
        var body = document.body;
        if (root && root.style) root.style.colorScheme = 'light';
        if (body && body.style) body.style.colorScheme = 'light';

        // meta color-scheme
        var meta = document.querySelector('meta[name="color-scheme"][data-nayai="1"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'color-scheme');
          meta.setAttribute('data-nayai', '1');
          (document.head || document.documentElement).appendChild(meta);
        }
        meta.setAttribute('content', 'light');

        // localStorage: 常见 theme key 全部设为 light/false
        var setLight = function(k, v){ try { localStorage.setItem(k, v); } catch(e) {} };
        var lightValueKeys = ['theme','appearance','color-mode','colorMode','themeMode','app-theme','__theme','ui-theme','oai-theme','chatgpt-theme','prefers-color-scheme','color_scheme','tongyi-theme','qwen-theme'];
        lightValueKeys.forEach(function(k){ setLight(k,'light'); });
        ['darkMode','isDarkMode','dark-mode','isDark','dark','gds_dark_mode','use_dark_mode','darkTheme','dark_theme'].forEach(function(k){ setLight(k,'false'); });

        // DOM class: 移除常见 dark，加 light + data-theme
        if (root && root.classList){
          ['dark','dark-theme','theme-dark','mode-dark','dark-mode','is-dark','gds-dark'].forEach(function(c){ root.classList.remove(c); });
          root.classList.add('light');
          root.setAttribute('data-theme','light');
          root.setAttribute('data-color-mode','light');
          root.setAttribute('data-mode','light');
        }
        if (body && body.classList){
          ['dark','dark-theme','theme-dark','mode-dark','dark-mode','is-dark'].forEach(function(c){ body.classList.remove(c); });
          body.classList.add('light');
        }
      } catch(e) { /* ignore */ }
    }
    _apply();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _apply, { once: true });
    }
    setTimeout(_apply, 400);
    setTimeout(_apply, 1500);
    setTimeout(_apply, 3500);
  })();`;
}

// ---------------------------------------------------------------------------
// 对话同步脚本：重命名 / 查找并切换 / 新建对话
// ---------------------------------------------------------------------------

function withRetryGeneric(
  bodyCode: string,
  maxRetries = 15,
  interval = 800,
): string {
  return `(function(){
  var _tries=0;
  function _attempt(){
    ${bodyCode}
  }
  _attempt();
  function _retry(){ if(++_tries<${maxRetries}) setTimeout(_attempt,${interval}); else console.log('[nayai-desk] gave up after '+${maxRetries}+' tries'); }
})();`;
}

/**
 * 匹配标题的工具函数（注入到页面内执行）。
 * 用前 20 个字符做前缀匹配，兼容站点截断标题的情况。
 */
function matchTitleFn(): string {
  return `
  function _matchTitle(txt, wanted){
    if(!txt) return false;
    txt=txt.trim(); wanted=wanted.trim();
    if(!txt||!wanted) return false;
    var a=txt.substring(0,20), b=wanted.substring(0,20);
    return a===b || txt.startsWith(wanted) || wanted.startsWith(txt);
  }`;
}

/**
 * 查找并切换到匹配标题的对话，未找到则自动新建。
 * 在各站点侧栏 DOM 中扫描对话列表，用前缀匹配。
 * 为适应 webview 重建后页面需要加载时间，默认 retry 20次 × 1.5s = 30秒。
 */
const findChatScripts: Record<ProviderId, (title: string) => string> = {
  gpt: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var nav = document.querySelector('nav');
      if(!nav){ _retry(); return; }
      var items = nav.querySelectorAll('a[href^="/c/"], li a');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] gpt: switched to:', target.textContent); return; }
      console.log('[nayai-desk] gpt: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('a[data-testid="create-new-chat-button"]')||document.querySelector('nav a[href="/"]');
      if(btn){ btn.click(); console.log('[nayai-desk] gpt: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  gemini: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('[class*="conversation-list"], [class*="history"], nav, aside');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('a[class*="conversation"], a[data-test-id*="conversation"], a[href*="/app/"]');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] gemini: switched to:', target.textContent); return; }
      console.log('[nayai-desk] gemini: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('button[aria-label="New chat"]')||document.querySelector('a[aria-label="New chat"]')||document.querySelector('button.new-chat')||document.querySelector('a[href="/app"]');
      if(btn){ btn.click(); console.log('[nayai-desk] gemini: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  doubao: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('[class*="session-list"], [class*="chat-list"], nav, aside');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('[class*="session-item"], [class*="chat-item"], [class*="conversation"] a');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] doubao: switched to:', target.textContent); return; }
      console.log('[nayai-desk] doubao: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('[data-testid="new_chat_button"]')||document.querySelector('button[class*="new-chat"]')||document.querySelector('[class*="new-session"]')||document.querySelector('a[href="/chat/"]');
      if(btn){ btn.click(); console.log('[nayai-desk] doubao: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  deepseek: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('[class*="sidebar"], nav, aside');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('[class*="chat-item"], [class*="session-item"], .sidebar a, nav a');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] deepseek: switched to:', target.textContent); return; }
      console.log('[nayai-desk] deepseek: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('a[class*="new-chat"]')||document.querySelector('div[class*="new-chat"]')||document.querySelector('a[href="/"]');
      if(btn){ btn.click(); console.log('[nayai-desk] deepseek: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  qwen: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('[class*="session-list"], [class*="chat-list"], nav, aside');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('[class*="session-item"], [class*="chat-item"], [class*="history-item"]');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] qwen: switched to:', target.textContent); return; }
      console.log('[nayai-desk] qwen: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('[class*="new-chat"]')||document.querySelector('[class*="new-session"]')||document.querySelector('a[href="/qianwen"]');
      if(btn){ btn.click(); console.log('[nayai-desk] qwen: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  grok: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var nav = document.querySelector('nav');
      if(!nav){ _retry(); return; }
      var items = nav.querySelectorAll('a, [class*="conversation-item"], [class*="chat-item"]');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] grok: switched to:', target.textContent); return; }
      console.log('[nayai-desk] grok: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('a[href="/"]')||document.querySelector('button[class*="new"]');
      if(btn){ btn.click(); console.log('[nayai-desk] grok: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  claude: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('nav, aside, [data-testid*="sidebar"], [class*="Sidebar"]');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('a[href^="/chat/"], nav a, aside a, [data-testid*="conversation"] a');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] claude: switched to:', target.textContent); return; }
      console.log('[nayai-desk] claude: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('a[href="/new"]')||document.querySelector('button[aria-label*="New"]')||document.querySelector('a[aria-label*="New"]');
      if(btn){ btn.click(); console.log('[nayai-desk] claude: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  kimi: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('nav, aside, [class*="history"], [class*="session-list"], [class*="sidebar"]');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('a[href^="/chat/"], [class*="history-item"], [class*="session-item"], [class*="chat-item"]');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] kimi: switched to:', target.textContent); return; }
      console.log('[nayai-desk] kimi: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('button[class*="new-chat"]')||document.querySelector('[class*="new-chat"]')||document.querySelector('a[href="/chat"]')||document.querySelector('a[href="/"]');
      if(btn){ btn.click(); console.log('[nayai-desk] kimi: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  ernie: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('[class*="session-list"], [class*="history"], [class*="sidebar"], nav, aside');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('[class*="session-item"], [class*="history-item"], [class*="chat-item"], nav a');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] ernie: switched to:', target.textContent); return; }
      console.log('[nayai-desk] ernie: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('[class*="newChat"]')||document.querySelector('[class*="new-chat"]')||document.querySelector('button[class*="add"]');
      if(btn){ btn.click(); console.log('[nayai-desk] ernie: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
  perplexity: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      ${matchTitleFn()}
      var sidebar = document.querySelector('nav, aside, [class*="sidebar"], [class*="history"]');
      if(!sidebar){ _retry(); return; }
      var items = document.querySelectorAll('a[href^="/search/"], [class*="conversation"] a, nav a, aside a');
      var target = null;
      for(var i=0;i<items.length;i++){
        if(_matchTitle(items[i].textContent, '${t}')){ target=items[i]; break; }
      }
      if(target){ target.click(); console.log('[nayai-desk] perplexity: switched to:', target.textContent); return; }
      console.log('[nayai-desk] perplexity: no match in', items.length, 'items, creating new chat');
      var btn=document.querySelector('a[aria-label*="New Thread"]')||document.querySelector('a[href="/"]')||document.querySelector('button[aria-label*="New"]');
      if(btn){ btn.click(); console.log('[nayai-desk] perplexity: created new chat'); }
      else { _retry(); }
    `, 20, 1500);
  },
};

/**
 * 新建一个空对话（点站点的「新建」按钮）。
 */
const newChatScripts: Record<ProviderId, () => string> = {
  gpt: () => withRetryGeneric(`
    var btn=document.querySelector('a[data-testid="create-new-chat-button"]')||document.querySelector('nav a[href="/"]');
    if(btn){ btn.click(); console.log('[nayai-desk] gpt: new chat'); } else { _retry(); }
  `),
  gemini: () => withRetryGeneric(`
    var btn=document.querySelector('button[aria-label="New chat"]')||document.querySelector('a[aria-label="New chat"]')||document.querySelector('button.new-chat')||document.querySelector('a[href="/app"]');
    if(btn){ btn.click(); console.log('[nayai-desk] gemini: new chat'); } else { _retry(); }
  `),
  doubao: () => withRetryGeneric(`
    var btn=document.querySelector('[data-testid="new_chat_button"]')||document.querySelector('button[class*="new-chat"]')||document.querySelector('[class*="new-session"]')||document.querySelector('a[href="/chat/"]');
    if(btn){ btn.click(); console.log('[nayai-desk] doubao: new chat'); } else { _retry(); }
  `),
  deepseek: () => withRetryGeneric(`
    var btn=document.querySelector('a[class*="new-chat"]')||document.querySelector('div[class*="new-chat"]')||document.querySelector('a[href="/"]');
    if(btn){ btn.click(); console.log('[nayai-desk] deepseek: new chat'); } else { _retry(); }
  `),
  qwen: () => withRetryGeneric(`
    var btn=document.querySelector('[class*="new-chat"]')||document.querySelector('[class*="new-session"]')||document.querySelector('a[href="/qianwen"]');
    if(btn){ btn.click(); console.log('[nayai-desk] qwen: new chat'); } else { _retry(); }
  `),
  grok: () => withRetryGeneric(`
    var btn=document.querySelector('a[href="/"]')||document.querySelector('button[class*="new"]');
    if(btn){ btn.click(); console.log('[nayai-desk] grok: new chat'); } else { _retry(); }
  `),
  claude: () => withRetryGeneric(`
    var btn=document.querySelector('a[href="/new"]')||document.querySelector('button[aria-label*="New"]')||document.querySelector('a[aria-label*="New"]');
    if(btn){ btn.click(); console.log('[nayai-desk] claude: new chat'); } else { _retry(); }
  `),
  kimi: () => withRetryGeneric(`
    var btn=document.querySelector('button[class*="new-chat"]')||document.querySelector('[class*="new-chat"]')||document.querySelector('a[href="/chat"]')||document.querySelector('a[href="/"]');
    if(btn){ btn.click(); console.log('[nayai-desk] kimi: new chat'); } else { _retry(); }
  `),
  ernie: () => withRetryGeneric(`
    var btn=document.querySelector('[class*="newChat"]')||document.querySelector('[class*="new-chat"]')||document.querySelector('button[class*="add"]');
    if(btn){ btn.click(); console.log('[nayai-desk] ernie: new chat'); } else { _retry(); }
  `),
  perplexity: () => withRetryGeneric(`
    var btn=document.querySelector('a[aria-label*="New Thread"]')||document.querySelector('a[href="/"]')||document.querySelector('button[aria-label*="New"]');
    if(btn){ btn.click(); console.log('[nayai-desk] perplexity: new chat'); } else { _retry(); }
  `),
};

/**
 * 重命名当前活跃对话。
 * 策略：hover 侧栏当前对话 → 打开菜单 → 重命名 → 填入标题 → 确认。
 * 各站点 DOM 差异大，采用多级 fallback。
 */
const renameChatScripts: Record<ProviderId, (title: string) => string> = {
  gpt: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('nav a[aria-current="page"]') || document.querySelector('nav li.bg-token-sidebar-surface-secondary a') || document.querySelector('nav li[class*="active"] a');
      if(!active){
        var firstLink = document.querySelector('nav a[href^="/c/"]');
        if(firstLink) active = firstLink;
      }
      if(!active){ _retry(); return; }
      var li = active.closest('li') || active.parentElement;
      li.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = li.querySelector('button[aria-label*="Options"]') || li.querySelector('button[data-testid*="options"]') || li.querySelector('button[class*="more"]') || li.querySelector('button:last-child');
        if(!menuBtn){ console.log('[nayai-desk] gpt: no menu button'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var renameItem = null;
          var menuItems = document.querySelectorAll('[role="menuitem"], [data-testid*="rename"]');
          for(var i=0;i<menuItems.length;i++){
            if((menuItems[i].textContent||'').match(/rename|重命名|Rename/i)){ renameItem=menuItems[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] gpt: no rename item'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = document.querySelector('nav input[type="text"]') || document.querySelector('[data-testid*="rename"] input') || li.querySelector('input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              input.dispatchEvent(new Event('change',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] gpt: renamed to', '${t}');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  gemini: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('a[class*="selected"]') || document.querySelector('a[aria-current="page"]') || document.querySelector('[class*="conversation"][class*="active"]');
      if(!active){
        var first = document.querySelector('a[href*="/app/"]');
        if(first) active = first;
      }
      if(!active){ _retry(); return; }
      var menuBtn = active.querySelector('button[aria-label*="more"]') || active.querySelector('button[aria-label*="More"]') || active.querySelector('button[class*="menu"]');
      if(!menuBtn && active.parentElement) menuBtn = active.parentElement.querySelector('button');
      if(!menuBtn){ console.log('[nayai-desk] gemini: no menu'); _retry(); return; }
      menuBtn.click();
      setTimeout(function(){
        var renameItem = null;
        var items = document.querySelectorAll('[role="menuitem"], button[class*="rename"], [class*="menu-item"]');
        for(var i=0;i<items.length;i++){
          if((items[i].textContent||'').match(/rename|重命名|Rename/i)){ renameItem=items[i]; break; }
        }
        if(!renameItem){ console.log('[nayai-desk] gemini: no rename'); return; }
        renameItem.click();
        setTimeout(function(){
          var input = document.querySelector('input[aria-label*="rename"], input[class*="rename"]') || document.activeElement;
          if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
            input.focus(); input.select();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, '${t}');
            input.dispatchEvent(new Event('input',{bubbles:true}));
            setTimeout(function(){
              var confirmBtn = document.querySelector('button[aria-label*="Save"], button[aria-label*="confirm"], button[class*="save"]');
              if(confirmBtn) confirmBtn.click();
              else { input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); }
              console.log('[nayai-desk] gemini: renamed');
            },300);
          }
        },400);
      },400);
    `, 12, 1500);
  },
  doubao: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('[class*="session-item"][class*="active"]') || document.querySelector('[class*="chat-item"][class*="active"]') || document.querySelector('[class*="selected"]') || document.querySelector('[class*="session-item"]') || document.querySelector('[class*="chat-item"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('[class*="more"], [class*="action"] button, button[class*="menu"]');
        if(!menuBtn){ console.log('[nayai-desk] doubao: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[class*="dropdown-item"], [role="menuitem"], [class*="menu-item"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/重命名|rename|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] doubao: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = active.querySelector('input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] doubao: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  deepseek: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('[class*="chat-item"][class*="active"], [class*="session"][class*="active"], .sidebar a[class*="active"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('[class*="more"], [class*="action"] button, svg[class*="more"]');
        if(menuBtn && menuBtn.tagName === 'svg') menuBtn = menuBtn.closest('button') || menuBtn.parentElement;
        if(!menuBtn){ console.log('[nayai-desk] deepseek: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], [class*="menu-item"], [class*="dropdown-item"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/重命名|rename|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] deepseek: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = active.querySelector('input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] deepseek: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  qwen: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('[class*="session-item"][class*="active"], [class*="chat-item"][class*="active"], [class*="selected"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('[class*="more"], [class*="action"] button, button[class*="menu"]');
        if(!menuBtn){ console.log('[nayai-desk] qwen: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], [class*="menu-item"], [class*="dropdown-item"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/重命名|rename|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] qwen: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = active.querySelector('input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] qwen: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  grok: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('nav a[aria-current="page"], [class*="conversation"][class*="active"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('button[aria-label*="more"], button[aria-label*="More"], button[class*="menu"]');
        if(!menuBtn){ console.log('[nayai-desk] grok: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], button[class*="rename"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/rename|重命名|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] grok: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = document.querySelector('input[aria-label*="rename"], input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] grok: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  claude: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('nav a[aria-current="page"], aside a[aria-current="page"], a[class*="selected"], a[href^="/chat/"][class*="active"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('button[aria-label*="more"], button[aria-label*="Menu"], button[class*="menu"]') || (active.parentElement && active.parentElement.querySelector('button'));
        if(!menuBtn){ console.log('[nayai-desk] claude: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], button[class*="rename"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/rename|重命名|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] claude: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = document.querySelector('input[aria-label*="rename"], input[type="text"]') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] claude: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  kimi: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('[class*="history-item"][class*="active"], [class*="session-item"][class*="active"], [class*="chat-item"][class*="active"], [class*="selected"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('[class*="more"], [class*="action"] button, button[class*="menu"]');
        if(!menuBtn){ console.log('[nayai-desk] kimi: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], [class*="menu-item"], [class*="dropdown-item"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/重命名|rename|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] kimi: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = active.querySelector('input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] kimi: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  ernie: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('[class*="session-item"][class*="active"], [class*="chat-item"][class*="active"], [class*="selected"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('[class*="more"], [class*="action"] button, button[class*="menu"]');
        if(!menuBtn){ console.log('[nayai-desk] ernie: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], [class*="menu-item"], [class*="dropdown-item"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/重命名|rename|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] ernie: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = active.querySelector('input') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] ernie: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
  perplexity: (title) => {
    const t = escapeForJS(title);
    return withRetryGeneric(`
      var active = document.querySelector('a[href^="/search/"][class*="active"], a[class*="selected"], [class*="conversation"][class*="active"]');
      if(!active){ _retry(); return; }
      active.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      setTimeout(function(){
        var menuBtn = active.querySelector('button[aria-label*="more"], button[aria-label*="More"], button[class*="menu"]') || (active.parentElement && active.parentElement.querySelector('button'));
        if(!menuBtn){ console.log('[nayai-desk] perplexity: no menu'); _retry(); return; }
        menuBtn.click();
        setTimeout(function(){
          var items = document.querySelectorAll('[role="menuitem"], button[class*="rename"]');
          var renameItem = null;
          for(var i=0;i<items.length;i++){
            if((items[i].textContent||'').match(/rename|重命名|Rename/i)){ renameItem=items[i]; break; }
          }
          if(!renameItem){ console.log('[nayai-desk] perplexity: no rename'); return; }
          renameItem.click();
          setTimeout(function(){
            var input = document.querySelector('input[type="text"]') || document.activeElement;
            if(input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')){
              input.focus(); input.select();
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${t}');
              input.dispatchEvent(new Event('input',{bubbles:true}));
              setTimeout(function(){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); },200);
              console.log('[nayai-desk] perplexity: renamed');
            }
          },400);
        },400);
      },300);
    `, 12, 1500);
  },
};

export function getFindChatScript(providerId: ProviderId, title: string): string {
  return findChatScripts[providerId](title);
}

export function getNewChatScript(providerId: ProviderId): string {
  return newChatScripts[providerId]();
}

export function getRenameChatScript(providerId: ProviderId, title: string): string {
  return renameChatScripts[providerId](title);
}

const HIDE_CHROME_OBSERVER_KEY = "__nayaiHideChromeObserver";
const HIDE_CHROME_TIMERS_KEY = "__nayaiHideChromeTimers";
const HIDE_CHROME_ENABLED_KEY = "__nayaiHideChromeEnabled";
const HIDE_CHROME_ATTR = "data-nayai-hidden";

/**
 * 生成"隐藏网页顶栏/输入区"脚本。
 * 策略三层叠加：
 *  1) CSS 规则（基于已知 class 前缀，快速命中）。
 *  2) JS 启发式扫描：按 position + 尺寸规则识别顶栏、按 textarea/contenteditable 锚点识别输入框父容器。
 *     —— 覆盖 Tailwind / CSS Modules hash 导致 CSS 匹配失败的场景。
 *  3) MutationObserver 监听 DOM 变动，对后续 React 挂载的节点继续处理。
 *
 * 顶栏用 display:none 完全隐藏；输入框父容器用 opacity:0 + pointer-events:none
 * （保留尺寸 + 节点可交互 + 发送脚本可 focus/click）——这样 JS 注入依然能正常发送消息。
 *
 * 开关关闭时：彻底清空 observer、所有 pending timers、启发式样式 —— 避免"关后 3 秒又被隐藏"的 bug。
 */
export function getHideChromeScript(
  providerId: ProviderId,
  enabled: boolean,
): string {
  // 统一的清理脚本（disable 或重新 enable 前都要先跑一次）
  const cleanupCode = `
    window["${HIDE_CHROME_ENABLED_KEY}"] = false;
    var oldStyle=document.getElementById("${HIDE_CHROME_STYLE_ID}");
    if(oldStyle)oldStyle.remove();
    if(window["${HIDE_CHROME_OBSERVER_KEY}"]){
      try{ window["${HIDE_CHROME_OBSERVER_KEY}"].disconnect(); }catch(_){ }
      window["${HIDE_CHROME_OBSERVER_KEY}"]=null;
    }
    if(window["${HIDE_CHROME_TIMERS_KEY}"] && window["${HIDE_CHROME_TIMERS_KEY}"].length){
      window["${HIDE_CHROME_TIMERS_KEY}"].forEach(function(t){ try{ clearTimeout(t); }catch(_){ } });
    }
    window["${HIDE_CHROME_TIMERS_KEY}"]=[];
    // 清除启发式隐藏残留
    document.querySelectorAll('[${HIDE_CHROME_ATTR}]').forEach(function(el){
      el.removeAttribute('${HIDE_CHROME_ATTR}');
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('height');
      el.style.removeProperty('max-height');
      el.style.removeProperty('min-height');
      el.style.removeProperty('overflow');
      el.style.removeProperty('padding');
      el.style.removeProperty('margin');
      el.style.removeProperty('border');
    });
  `;

  if (!enabled) {
    return `(function(){${cleanupCode}})();`;
  }

  const {
    topBar,
    inputArea,
    extra = [],
  } = HIDE_CHROME_SELECTORS[providerId];
  const topSelectors = topBar.join(", ");
  const inputSelectors = inputArea.join(", ");
  const extraSelectors = extra.join(", ");
  // CSS 层 1：顶栏 + extra 用 display:none
  const hideFullSel = [topSelectors, extraSelectors].filter(Boolean).join(", ");
  // CSS 层 1：输入框用 opacity 策略（保留尺寸 + 可交互）
  const opacitySel = inputSelectors;
  const cssParts: string[] = [];
  if (hideFullSel) cssParts.push(`${hideFullSel}{ display:none !important; }`);
  if (opacitySel) {
    cssParts.push(
      `${opacitySel}{ ` +
        `opacity:0 !important;` +
        `pointer-events:none !important;` +
        ` }`,
    );
  }
  const css = cssParts.join(" ");
  const escaped = css.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
  return `(function(){
  // 先做一次完整清理（确保 re-enable 时没有前次残留）
  ${cleanupCode}
  window["${HIDE_CHROME_ENABLED_KEY}"] = true;

  // ==== 层 1：CSS 规则 ====
  var styleEl=document.createElement("style");
  styleEl.id="${HIDE_CHROME_STYLE_ID}";
  styleEl.textContent="${escaped}";
  (document.head || document.documentElement).appendChild(styleEl);

  // ==== 层 2+3：JS 启发式 + MutationObserver ====
  function markHidden(el, kind){
    if(el.getAttribute("${HIDE_CHROME_ATTR}")) return;
    el.setAttribute("${HIDE_CHROME_ATTR}", kind);
    if(kind === "top" || kind === "extra"){
      el.style.setProperty("display","none","important");
    } else {
      // input: opacity 方案，保留尺寸 + 可 focus/click，UI 不可见但 JS 注入能继续发送
      el.style.setProperty("opacity","0","important");
      el.style.setProperty("pointer-events","none","important");
    }
  }

  function scan(){
    if(!window["${HIDE_CHROME_ENABLED_KEY}"]) return;
    try {
      var vw = window.innerWidth || document.documentElement.clientWidth;
      var vh = window.innerHeight || document.documentElement.clientHeight;

      // 2a. 顶栏启发式：
      //   - 位置：top:0 (±6)
      //   - 高度 24~96, 宽度 >= 40% 视口
      //   - 兼容 sticky/fixed/absolute 以及某些 SPA 用 relative 布局的顶栏（只要 rect.top ~= 0）
      //   - 跳过 modal/drawer 等深嵌套弹层
      var topCandidates = document.body ? document.body.querySelectorAll("*") : [];
      for (var i=0;i<topCandidates.length;i++){
        var el = topCandidates[i];
        if(el.getAttribute("${HIDE_CHROME_ATTR}")) continue;
        var cs = window.getComputedStyle(el);
        if(cs.display === "none") continue;
        if(cs.visibility === "hidden") continue;
        var r = el.getBoundingClientRect();
        if(r.top < -6 || r.top > 6) continue;
        if(r.height < 24 || r.height > 96) continue;
        if(r.width < vw * 0.4) continue;
        // 排除主内容容器（子节点过多，不是顶栏）
        if(el.children.length > 30) continue;
        // 排除：深度 > 12 层的嵌套（很可能是 popup/menu 而非顶栏）
        var depth = 0; var p = el;
        while(p && p !== document.body){ depth++; p = p.parentElement; if(depth > 14) break; }
        if(depth > 14) continue;
        markHidden(el, "top");
      }

      // 2b. 输入区启发式：以 textarea / [contenteditable=true] 为锚，沿祖先链找"最靠近 anchor 的输入容器"。
      //     目标容器特征：高度 40~360，宽度 >= 40% 视口，bottom 在视口下半。
      //     取"最内层"满足条件的容器，避免误伤包含消息区的大容器。
      var anchors = document.querySelectorAll("textarea, [contenteditable='true']");
      for (var j=0;j<anchors.length;j++){
        var a = anchors[j];
        var ar = a.getBoundingClientRect();
        if(ar.bottom < vh * 0.35) continue;
        if(ar.width < 100) continue;
        var cur = a.parentElement;
        var target = null;
        var hops = 0;
        while(cur && cur !== document.body && hops < 12){
          var rr = cur.getBoundingClientRect();
          if(rr.height >= 40 && rr.height <= 360 && rr.width >= vw * 0.4 && rr.bottom >= vh * 0.45){
            target = cur;
            break; // 取最内层，避免把消息区容器也包进去
          }
          cur = cur.parentElement;
          hops++;
        }
        if(target) markHidden(target, "input");
      }
    } catch(e){ console.warn("[nayai-desk] hideChrome scan error", e); }
  }

  function pushTimer(ms){
    var t = setTimeout(function(){
      // 从列表里移除自己
      if(window["${HIDE_CHROME_TIMERS_KEY}"]){
        var idx = window["${HIDE_CHROME_TIMERS_KEY}"].indexOf(t);
        if(idx >= 0) window["${HIDE_CHROME_TIMERS_KEY}"].splice(idx, 1);
      }
      scan();
    }, ms);
    if(!window["${HIDE_CHROME_TIMERS_KEY}"]) window["${HIDE_CHROME_TIMERS_KEY}"] = [];
    window["${HIDE_CHROME_TIMERS_KEY}"].push(t);
  }

  // 立即跑 + 延迟跑（应对 SPA 延迟渲染）
  scan();
  pushTimer(300);
  pushTimer(900);
  pushTimer(2000);
  pushTimer(4000);

  // MutationObserver：对后续 DOM 新增节点继续处理（节流 200ms）
  var throttleTimer = null;
  window["${HIDE_CHROME_OBSERVER_KEY}"] = new MutationObserver(function(){
    if(!window["${HIDE_CHROME_ENABLED_KEY}"]) return;
    if(throttleTimer) return;
    throttleTimer = setTimeout(function(){
      if(window["${HIDE_CHROME_TIMERS_KEY}"]){
        var idx = window["${HIDE_CHROME_TIMERS_KEY}"].indexOf(throttleTimer);
        if(idx >= 0) window["${HIDE_CHROME_TIMERS_KEY}"].splice(idx, 1);
      }
      throttleTimer = null;
      scan();
    }, 200);
    if(!window["${HIDE_CHROME_TIMERS_KEY}"]) window["${HIDE_CHROME_TIMERS_KEY}"] = [];
    window["${HIDE_CHROME_TIMERS_KEY}"].push(throttleTimer);
  });
  function startObserve(){
    if(!window["${HIDE_CHROME_ENABLED_KEY}"]) return;
    if(document.body){
      window["${HIDE_CHROME_OBSERVER_KEY}"].observe(document.body, { childList: true, subtree: true });
    } else {
      pushTimer(100);
      setTimeout(startObserve, 100);
    }
  }
  startObserve();
})();`;
}
