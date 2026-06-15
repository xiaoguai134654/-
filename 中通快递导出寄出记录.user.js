// ==UserScript==
// @name         中通快递 - 导出寄出快递记录
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  选择下单时间范围后，自动采集全部寄出快递列表并导出CSV
// @author       Codex
// @match        https://www.zto.com/myExpress
// @match        https://www.zto.com/myExpress*
// @icon         https://www.zto.com/favicon.ico
// @grant        GM_download
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  //  配置
  // ============================================================
  const CONFIG = {
    MIN_DELAY: 300,
    MAX_DELAY: 800,
    RENDER_TIMEOUT: 8000,
    FILE_NAME: "中通寄件记录_" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".csv",
  };

  // ============================================================
  //  日期工具
  // ============================================================
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function today() { return new Date(); }
  function yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d; }
  function dayBefore() { const d = new Date(); d.setDate(d.getDate() - 2); return d; }

  const PRESETS = [
    {
      label: "今天",
      getRange: () => {
        const d = today();
        return { start: fmtDate(d) + " 00:00:00", end: fmtDate(d) + " 23:59:59" };
      },
    },
    {
      label: "昨天",
      getRange: () => {
        const d = yesterday();
        return { start: fmtDate(d) + " 00:00:00", end: fmtDate(d) + " 23:59:59" };
      },
    },
    {
      label: "前天",
      getRange: () => {
        const d = dayBefore();
        return { start: fmtDate(d) + " 00:00:00", end: fmtDate(d) + " 23:59:59" };
      },
    },
    {
      label: "近7天",
      getRange: () => {
        const s = new Date(); s.setDate(s.getDate() - 6);
        const e = today();
        return { start: fmtDate(s) + " 00:00:00", end: fmtDate(e) + " 23:59:59" };
      },
    },
    {
      label: "近30天",
      getRange: () => {
        const s = new Date(); s.setDate(s.getDate() - 29);
        const e = today();
        return { start: fmtDate(s) + " 00:00:00", end: fmtDate(e) + " 23:59:59" };
      },
    },
  ];

  // ============================================================
  //  样式
  // ============================================================
  GM_addStyle(`
    #zto-export-btn {
      position: fixed; z-index: 99999;
      bottom: 120px; right: 20px;
      padding: 12px 20px;
      background: #ff6a00; color: #fff;
      border: none; border-radius: 8px;
      font-size: 15px; font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(255,106,0,.35);
      transition: transform .15s, box-shadow .15s;
      white-space: nowrap; user-select: none;
    }
    #zto-export-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(255,106,0,.45); }
    #zto-export-btn.is-running { background: #999; cursor: not-allowed; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
    #zto-export-progress {
      position: fixed; z-index: 99999;
      bottom: 175px; right: 20px;
      background: rgba(0,0,0,.75); color: #fff;
      padding: 10px 16px; border-radius: 6px;
      font-size: 13px; line-height: 1.6;
      min-width: 180px; text-align: center;
      display: none; pointer-events: none;
    }
    #zto-export-progress.show { display: block; }

    /* 日期选择面板 */
    #zto-date-panel {
      position: fixed; z-index: 100000;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,.35);
      display: none; align-items: center; justify-content: center;
    }
    #zto-date-panel.show { display: flex; }
    #zto-date-panel .panel-box {
      background: #fff; border-radius: 12px;
      padding: 28px 32px 24px;
      width: 420px; max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,.25);
    }
    #zto-date-panel .panel-title {
      font-size: 17px; font-weight: 700; margin-bottom: 16px;
      color: #333; text-align: center;
    }
    #zto-date-panel .preset-row {
      display: flex; gap: 8px; flex-wrap: wrap;
      margin-bottom: 16px; justify-content: center;
    }
    #zto-date-panel .preset-btn {
      padding: 6px 14px; border: 1px solid #ddd;
      border-radius: 6px; background: #f7f7f7;
      cursor: pointer; font-size: 13px; color: #555;
      transition: all .15s;
    }
    #zto-date-panel .preset-btn:hover { border-color: #ff6a00; color: #ff6a00; }
    #zto-date-panel .preset-btn.active { background: #ff6a00; color: #fff; border-color: #ff6a00; }

    #zto-date-panel .custom-row {
      display: flex; align-items: center; gap: 10px;
      justify-content: center; margin-bottom: 18px;
    }
    #zto-date-panel .custom-row label { font-size: 13px; color: #666; }
    #zto-date-panel .custom-row input[type="date"] {
      padding: 6px 10px; border: 1px solid #ddd;
      border-radius: 6px; font-size: 14px; color: #333;
      outline: none;
    }
    #zto-date-panel .custom-row input[type="date"]:focus { border-color: #ff6a00; }

    #zto-date-panel .action-row {
      display: flex; gap: 12px; justify-content: center;
    }
    #zto-date-panel .action-row button {
      padding: 8px 28px; border-radius: 8px;
      font-size: 15px; font-weight: 600; cursor: pointer;
      border: none; transition: all .15s;
    }
    #zto-date-panel .btn-cancel { background: #f0f0f0; color: #666; }
    #zto-date-panel .btn-cancel:hover { background: #e0e0e0; }
    #zto-date-panel .btn-confirm { background: #ff6a00; color: #fff; }
    #zto-date-panel .btn-confirm:hover { background: #e65c00; }
    #zto-date-panel .btn-confirm:disabled { background: #ccc; cursor: not-allowed; }
  `);

  // ============================================================
  //  工具函数
  // ============================================================

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function randomDelay() {
    return sleep(CONFIG.MIN_DELAY + Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY));
  }

  async function waitForList(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (document.querySelectorAll(".order-list > .order-item-bg").length > 0) return true;
      await sleep(200);
    }
    return false;
  }

  function isNextDisabled() {
    const btn = document.querySelector(".pagination-cont .btn-next");
    if (!btn) return true;
    return btn.classList.contains("is-disabled") || btn.getAttribute("aria-disabled") === "true" || btn.disabled;
  }

  // ============================================================
  //  设置页面日期范围
  // ============================================================

  function setDateOnPage(startStr, endStr) {
    const inputs = document.querySelectorAll(".el-range-input");
    if (inputs.length < 2) return false;
    const startInput = inputs[0];
    const endInput = inputs[1];

    try {
      // 使用 native value setter 绕过 Vue 的响应式系统
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;

      nativeSetter.call(startInput, startStr);
      startInput.dispatchEvent(new Event("input", { bubbles: true }));

      nativeSetter.call(endInput, endStr);
      endInput.dispatchEvent(new Event("input", { bubbles: true }));

      // 触发 change + blur 让 Element UI 组件确认值
      startInput.dispatchEvent(new Event("change", { bubbles: true }));
      endInput.dispatchEvent(new Event("change", { bubbles: true }));
      startInput.dispatchEvent(new Event("blur", { bubbles: true }));
      endInput.dispatchEvent(new Event("blur", { bubbles: true }));

      return true;
    } catch (e) {
      console.warn("[中通导出] 原生 setter 失败:", e);
      // 降级方案：聚焦后手动输入
      try {
        startInput.focus();
        startInput.value = startStr;
        startInput.dispatchEvent(new Event("input", { bubbles: true }));
        endInput.focus();
        endInput.value = endStr;
        endInput.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      } catch (e2) {
        console.error("[中通导出] 设置日期失败:", e2);
        return false;
      }
    }
  }

  // ============================================================
  //  数据提取
  // ============================================================

  function extractPageData() {
    const items = document.querySelectorAll(".order-list > .order-item-bg");
    const pageData = [];

    for (const item of items) {
      try {
        const billCodeEl = item.querySelector(".item-header .bill-code");
        const headerTimeEl = item.querySelector(".item-header .header-time");

        const billCodeText = billCodeEl ? billCodeEl.textContent.trim() : "";
        const headerTimeText = headerTimeEl ? headerTimeEl.textContent.trim() : "";

        const waybillNo = billCodeText.replace(/^运单号[：:]\s*/, "").trim();
        const orderTime = headerTimeText.replace(/^下单时间[：:]\s*/, "").trim();

        const body = item.querySelector(".item-body");
        let senderCity = "", senderName = "", status = "", receiverCity = "", receiverName = "";

        if (body) {
          const left = body.querySelector(".left");
          const center = body.querySelector(".center");
          const right = body.querySelector(".right");

          if (left) {
            senderCity = ((left.querySelector(".city") || {}).textContent || "").trim();
            senderName = ((left.querySelector(".name") || {}).textContent || "").trim();
          }
          if (center) {
            status = ((center.querySelector(".bill-status") || {}).textContent || "").trim();
          }
          if (right) {
            receiverCity = ((right.querySelector(".city") || {}).textContent || "").trim();
            receiverName = ((right.querySelector(".name") || {}).textContent || "").trim();
          }
        }

        if (!waybillNo) continue;

        pageData.push({
          运单号: waybillNo,
          寄件下单时间: orderTime,
          收件人姓名: receiverName,
          收件手机号: "",
          收件详细地址: "",
          包裹始发地: senderCity,
          目的地: receiverCity,
          物流当前状态: status,
          签收时间: "",
          派送员信息: "",
          寄件人: senderName,
        });
      } catch (e) {
        console.warn("[中通导出] 跳过异常条目:", e);
      }
    }
    return pageData;
  }

  // ============================================================
  //  翻页采集
  // ============================================================

  async function collectAllPages(progressEl) {
    const allData = [];
    const seen = new Set();
    let page = 1;

    function updateProgress() {
      progressEl.textContent = "📦 采集进度\n当前第 " + page + " 页  |  已采集 " + allData.length + " 条";
    }

    while (true) {
      const ready = await waitForList(CONFIG.RENDER_TIMEOUT);
      if (!ready) {
        console.warn("[中通导出] 第 " + page + " 页列表未渲染");
        alert("⚠️ 第 " + page + " 页加载失败，请手动检查页面后点击确定继续");
        break;
      }

      const pageRecords = extractPageData();
      for (const rec of pageRecords) {
        if (!seen.has(rec.运单号)) {
          seen.add(rec.运单号);
          allData.push(rec);
        }
      }
      updateProgress();

      if (isNextDisabled()) break;

      const nextBtn = document.querySelector(".pagination-cont .btn-next");
      if (!nextBtn) {
        alert("⚠️ 未找到翻页按钮，请手动翻页后点击确定继续");
        break;
      }

      await randomDelay();
      nextBtn.click();
      page++;
    }

    return allData;
  }

  // ============================================================
  //  CSV 导出
  // ============================================================

  function exportCSV(data) {
    if (data.length === 0) { alert("⚠️ 没有采集到任何快递数据"); return; }

    const fields = [
      "运单号", "寄件下单时间", "收件人姓名", "收件手机号", "收件详细地址",
      "包裹始发地", "目的地", "物流当前状态", "签收时间", "派送员信息", "寄件人",
    ];

    function esc(v) {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r"))
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

    const header = fields.join(",");
    const rows = data.map(r => fields.map(f => esc(r[f] || "")).join(","));
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    if (typeof GM_download !== "undefined") {
      GM_download({ url: URL.createObjectURL(blob), name: CONFIG.FILE_NAME, saveAs: true });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = CONFIG.FILE_NAME;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }
  }

  // ============================================================
  //  主流程
  // ============================================================

  function main() {
    // ---- 创建日期选择面板 ----
    const panel = document.createElement("div");
    panel.id = "zto-date-panel";
    panel.innerHTML =
      '<div class="panel-box">' +
        '<div class="panel-title">📅 选择下单时间范围</div>' +
        '<div class="preset-row" id="zto-preset-row"></div>' +
        '<div class="custom-row">' +
          '<label>自定义：</label>' +
          '<input type="date" id="zto-date-start">' +
          '<span style="color:#999"> — </span>' +
          '<input type="date" id="zto-date-end">' +
        "</div>" +
        '<div class="action-row">' +
          '<button class="btn-cancel" id="zto-date-cancel">取消</button>' +
          '<button class="btn-confirm" id="zto-date-confirm">✅ 确认并导出</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(panel);

    // 注入预设按钮
    const presetRow = document.getElementById("zto-preset-row");
    const presetBtns = [];
    PRESETS.forEach((p, i) => {
      const btn = document.createElement("button");
      btn.className = "preset-btn";
      btn.textContent = p.label;
      btn.dataset.index = i;
      presetRow.appendChild(btn);
      presetBtns.push(btn);
    });

    // ---- 创建导出按钮 ----
    const btn = document.createElement("button");
    btn.id = "zto-export-btn";
    btn.textContent = "📋 导出全部寄出快递";
    document.body.appendChild(btn);

    // ---- 进度浮窗 ----
    const progress = document.createElement("div");
    progress.id = "zto-export-progress";
    document.body.appendChild(progress);

    // ---- 状态变量 ----
    let selectedRange = null; // { start, end }

    // ---- 预设按钮点击 ----
    presetBtns.forEach((pbtn) => {
      pbtn.addEventListener("click", function () {
        presetBtns.forEach((b) => b.classList.remove("active"));
        this.classList.add("active");
        const idx = parseInt(this.dataset.index);
        selectedRange = PRESETS[idx].getRange();
        // 同步到自定义输入框
        document.getElementById("zto-date-start").value = selectedRange.start.slice(0, 10);
        document.getElementById("zto-date-end").value = selectedRange.end.slice(0, 10);
      });
    });

    // ---- 自定义日期输入 ----
    document.getElementById("zto-date-start").addEventListener("change", syncCustomRange);
    document.getElementById("zto-date-end").addEventListener("change", syncCustomRange);

    function syncCustomRange() {
      presetBtns.forEach((b) => b.classList.remove("active"));
      const s = document.getElementById("zto-date-start").value;
      const e = document.getElementById("zto-date-end").value;
      if (s && e) {
        selectedRange = { start: s + " 00:00:00", end: e + " 23:59:59" };
      } else {
        selectedRange = null;
      }
    }

    // ---- 面板控制 ----
    function showPanel() { panel.classList.add("show"); }
    function hidePanel() { panel.classList.remove("show"); }

    document.getElementById("zto-date-cancel").addEventListener("click", hidePanel);
    panel.addEventListener("click", function (e) { if (e.target === this) hidePanel(); });

    // ---- 导出按钮点击 ----
    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-running")) return;

      // 检查是否在"我寄的"
      const activeTab = document.querySelector(".subpage-tab-item.active");
      if (!activeTab || activeTab.textContent.trim() !== "我寄的") {
        alert('⚠️ 当前不是"我寄的"视图\n请先点击页面上方的"我寄的"标签。');
        return;
      }

      // 显示日期选择面板
      selectedRange = null;
      presetBtns.forEach((b) => b.classList.remove("active"));
      document.getElementById("zto-date-start").value = "";
      document.getElementById("zto-date-end").value = "";
      showPanel();
    });

    // ---- 确认并导出 ----
    document.getElementById("zto-date-confirm").addEventListener("click", async function () {
      if (!selectedRange) {
        alert("⚠️ 请先选择时间范围（点击预设按钮或自定义日期）");
        return;
      }
      hidePanel();

      btn.classList.add("is-running");
      btn.textContent = "⏳ 设置日期…";
      progress.classList.add("show");
      progress.textContent = "⏳ 设置日期范围…";

      // 1. 清空原有日期（点击清空按钮）
      try {
        // 先点击日期输入框打开弹窗
        const datePicker = document.querySelector(".search-date-picker");
        if (datePicker) datePicker.click();
        await sleep(300);

        // 点击"清空"按钮
        const clearBtn = document.querySelector('[class*="el-picker-panel"] .el-date-range-picker__header + button');
        // 直接用内容匹配找清空按钮
        const allBtns = document.querySelectorAll(".el-picker-panel button");
        for (const b of allBtns) {
          if (b.textContent.trim() === "清空") { b.click(); break; }
        }
        await sleep(200);

        // 按 Escape 关闭弹窗
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(300);
      } catch (e) {
        // 忽略清空失败
      }

      // 2. 设置日期
      const ok = setDateOnPage(selectedRange.start, selectedRange.end);
      if (!ok) {
        alert("⚠️ 自动设置日期失败，请手动选择日期范围后重试。");
        btn.classList.remove("is-running");
        btn.textContent = "📋 导出全部寄出快递";
        progress.classList.remove("show");
        return;
      }

      await sleep(300);

      // 3. 点击"查询"
      progress.textContent = "⏳ 查询列表中…";
      const queryBtn = document.querySelector(".z-search-btn");
      if (queryBtn) {
        queryBtn.click();
        await sleep(500);
      }

      // 4. 等待列表刷新
      const listReady = await waitForList(CONFIG.RENDER_TIMEOUT);
      if (!listReady) {
        alert("⚠️ 筛选后未加载出列表数据，请检查日期范围是否有误。");
        btn.classList.remove("is-running");
        btn.textContent = "📋 导出全部寄出快递";
        progress.classList.remove("show");
        return;
      }

      // 5. 全量采集
      btn.textContent = "⏳ 采集中…";
      try {
        const allData = await collectAllPages(progress);
        progress.textContent = "✅ 采集完成！共 " + allData.length + " 条记录";
        btn.textContent = "✅ 导出完成";
        exportCSV(allData);
      } catch (err) {
        console.error("[中通导出] 采集失败:", err);
        progress.textContent = "❌ 采集出错，查看控制台";
        alert("❌ 采集过程中出错，请查看浏览器控制台(F12)获取详情。");
      } finally {
        setTimeout(function () {
          btn.classList.remove("is-running");
          btn.textContent = "📋 导出全部寄出快递";
          progress.classList.remove("show");
        }, 5000);
      }
    });

    console.log("[中通导出] v2.0 已注入，点击橙色按钮选择日期后开始导出");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
