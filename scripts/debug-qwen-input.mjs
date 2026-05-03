/**
 * 通义千问页面调试：打开页面并检测输入框/发送按钮的 DOM
 * 运行: node scripts/debug-qwen-input.mjs
 */
import { chromium } from "playwright";

const QWEN_URL = "https://tongyi.aliyun.com/qianwen";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("打开通义千问...");
  await page.goto(QWEN_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

  // 等待可能的登录或页面加载，最多 45 秒
  console.log("等待输入区域出现（最多 45 秒，若未登录请先登录）...");
  await page.waitForTimeout(5000);

  // 采集所有可能的输入和按钮的 selector 与信息
  const result = await page.evaluate(() => {
    const info = {
      textareas: [],
      inputs: [],
      contenteditables: [],
      sendButtons: [],
      anyInputInView: null,
    };

    document.querySelectorAll("textarea").forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      info.textareas.push({
        index: i,
        className: el.className,
        id: el.id,
        placeholder: el.placeholder?.substring(0, 30),
        name: el.name,
        visible: rect.top < window.innerHeight && rect.bottom > 0,
      });
    });

    document.querySelectorAll("input[type='text'], input:not([type])").forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      info.inputs.push({
        index: i,
        className: el.className,
        id: el.id,
        placeholder: el.placeholder?.substring(0, 30),
        type: el.type,
        visible: rect.top < window.innerHeight && rect.bottom > 0,
      });
    });

    document.querySelectorAll("[contenteditable='true']").forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 20) return;
      info.contenteditables.push({
        index: i,
        tag: el.tagName,
        className: el.className?.substring(0, 80),
        role: el.getAttribute("role"),
        placeholder: el.getAttribute("data-placeholder") || el.getAttribute("placeholder") || "",
        visible: rect.top < window.innerHeight && rect.bottom > 0,
      });
    });

    document.querySelectorAll("button, [role='button'], [class*='send'], [class*='Send'], [class*='submit']").forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || "").trim().substring(0, 20);
      const isSend =
        /发送|Send|提交|submit/i.test(text) ||
        /send|submit/i.test(el.className || "") ||
        el.getAttribute("aria-label")?.includes("发送") ||
        el.getAttribute("aria-label")?.toLowerCase().includes("send");
      if (!isSend && !el.className?.match(/send|submit/i)) return;
      if (rect.width < 5 || rect.height < 5) return;
      info.sendButtons.push({
        index: i,
        tag: el.tagName,
        className: el.className?.substring(0, 60),
        id: el.id,
        text,
        ariaLabel: el.getAttribute("aria-label"),
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
        visible: rect.top < window.innerHeight && rect.bottom > 0,
      });
    });

    // 找一个最可能的主输入（在视口下半部分）
    const allCandidates = [];
    document.querySelectorAll("textarea, input[type='text'], input:not([type='button']):not([type='submit']), [contenteditable='true']").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.height < 15 || rect.width < 50) return;
      if (rect.top > window.innerHeight * 0.6) return;
      allCandidates.push({
        tag: el.tagName,
        class: el.className?.substring(0, 80),
        id: el.id,
        placeholder: el.placeholder || el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "",
      });
    });
    info.anyInputInView = allCandidates;

    return info;
  });

  console.log("\n=== 页面输入/按钮检测结果 ===\n");
  console.log("Textareas:", JSON.stringify(result.textareas, null, 2));
  console.log("\nInputs:", JSON.stringify(result.inputs, null, 2));
  console.log("\nContenteditables:", JSON.stringify(result.contenteditables, null, 2));
  console.log("\nSend 按钮:", JSON.stringify(result.sendButtons, null, 2));
  console.log("\n主输入候选 (anyInputInView):", JSON.stringify(result.anyInputInView, null, 2));

  // 尝试用第一个可见输入 + 第一个发送按钮执行一次输入
  const trySelectors = [
    ...result.anyInputInView?.map((c) => (c.tag === "TEXTAREA" ? `textarea${c.id ? "#" + c.id : ""}` : c.tag === "INPUT" ? `input${c.id ? "#" + c.id : ""}` : `[contenteditable="true"]`)) || [],
    "textarea",
    "input[type='text']",
    "div[contenteditable='true']",
  ];
  const firstInputSelector = result.textareas[0]?.className
    ? `textarea.${result.textareas[0].className.split(" ").filter(Boolean)[0]}`
    : result.inputs[0]?.className
      ? `input.${result.inputs[0].className.split(" ").filter(Boolean)[0]}`
      : result.contenteditables[0]
        ? "div[contenteditable='true']"
        : "textarea";

  console.log("\n尝试输入测试，selector: div[contenteditable='true'][role='textbox']");
  try {
    const loc = page.locator("div[contenteditable='true'][role='textbox']").first();
    await loc.waitFor({ state: "visible", timeout: 8000 });
    await loc.click();
    await page.keyboard.type("hello 千问 test", { delay: 60 });
    await page.waitForTimeout(2000);

    // 输入后再扫一次按钮
    const buttonsAfter = await page.evaluate(() => {
      const list = [];
      document.querySelectorAll("button, [role='button'], a[class*='send'], a[class*='Send']").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) return;
        const text = (el.textContent || "").trim().substring(0, 30);
        list.push({
          tag: el.tagName,
          class: (el.className || "").substring(0, 70),
          text,
          ariaLabel: el.getAttribute("aria-label"),
          disabled: el.disabled || el.getAttribute("aria-disabled"),
        });
      });
      return list;
    });
    console.log("输入后页面上的按钮:", JSON.stringify(buttonsAfter, null, 2));

    const btn = page.locator("button[class*='send'], button[class*='Send'], button[type='submit'], [role='button'][class*='send'], [aria-label*='发送']").first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      console.log("已点击发送按钮");
    } else {
      await page.keyboard.press("Enter");
      console.log("已按 Enter 发送");
    }
  } catch (e) {
    console.log("输入/发送失败:", e.message);
  }

  await page.waitForTimeout(4000);
  console.log("\n调试结束，关闭浏览器...");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
