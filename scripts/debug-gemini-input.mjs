/**
 * 在 Gemini 页面上调试输入框选择器与填充逻辑
 * 运行: node scripts/debug-gemini-input.mjs
 * 需先登录 gemini.google.com（脚本会打开浏览器，你手动登录后按回车继续）
 */
import { chromium } from "playwright";

const GEMINI_URL = "https://gemini.google.com/app";
const TEST_PROMPT = "hello from debug";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("打开 Gemini...");
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 15000 });

  // 自动等待输入框出现（最多 60 秒，便于你在此间登录）
  console.log("\n等待输入框出现（最多 60 秒，若未登录请先在浏览器中登录）...");
  const inputSelectors = [
    "rich-textarea .ql-editor.new-input-ui",
    "rich-textarea .ql-editor",
    "div.ql-editor.new-input-ui[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    "div[aria-label='为 Gemini 输入提示']",
  ];

  let found = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const sel of inputSelectors) {
      const el = await page.$(sel);
      if (el) {
        console.log("  找到输入框:", sel);
        found = sel;
        await el.dispose();
        break;
      }
    }
    if (found) break;
    await page.waitForTimeout(1500);
  }
  if (!found) {
    console.log("  超时未找到输入框，尝试用 .ql-editor...");
    found = ".ql-editor";
  }

  // 检测页面结构
  const info = await page.evaluate(() => {
    const rich = document.querySelector("rich-textarea");
    const editor = document.querySelector(".ql-editor");
    const sendBtn = document.querySelector("button.send-button");
    return {
      hasRichTextarea: !!rich,
      richChildCount: rich ? rich.children.length : 0,
      hasQlEditor: !!editor,
      editorClass: editor ? editor.className : null,
      editorContentEditable: editor ? editor.getAttribute("contenteditable") : null,
      sendButton: sendBtn
        ? { ariaDisabled: sendBtn.getAttribute("aria-disabled"), tag: sendBtn.tagName }
        : null,
    };
  });
  console.log("页面结构:", JSON.stringify(info, null, 2));

  // 策略1: Playwright 原生 focus + type
  console.log("\n策略1: Playwright 对 contenteditable 使用 focus + pressSequentially...");
  try {
    const loc = page.locator(found).first();
    await loc.waitFor({ state: "visible", timeout: 5000 });
    await loc.click();
    await page.keyboard.type(TEST_PROMPT, { delay: 50 });
    console.log("  已输入文字，等待 2 秒后尝试发送...");
    await page.waitForTimeout(2000);

    const sendBtn = page.locator("button.send-button, button[aria-label='发送']").first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    const ariaDisabled = await sendBtn.getAttribute("aria-disabled").catch(() => null);
    console.log("  发送按钮 visible:", sendVisible, "aria-disabled:", ariaDisabled);

    if (sendVisible && ariaDisabled !== "true") {
      await sendBtn.click();
      console.log("  已点击发送按钮");
    } else {
      await page.keyboard.press("Enter");
      console.log("  已按 Enter");
    }
  } catch (e) {
    console.log("  策略1 失败:", e.message);
  }

  await page.waitForTimeout(3000);
  console.log("\n调试结束，关闭浏览器...");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
