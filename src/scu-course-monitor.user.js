// ==UserScript==
// @name         SCU Course Monitor
// @namespace    scu-course-monitor
// @version      0.1.0
// @description  四川大学自由选课页面课余量监控
// @match        https://*.scu.edu.cn/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = window.SCU_COURSE_MONITOR_CONFIG || {
    mode: "notify",
    queryWaitTime: 1800,
    roundWaitTime: 5000,
    groups: [{ id: "A", time: "示例时间", courses: [{ kch: "课程号", kxh: "课序号", name: "课程名称" }] }]
  };
  const state = { stopped: false, timer: null };
  const iframe = document.getElementById("ifra") || document.getElementById("iframe-xk") || document.querySelector("iframe");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const stop = () => {
    state.stopped = true;
    if (state.timer) clearTimeout(state.timer);
    console.log("SCU Course Monitor 已停止。");
  };
  window.stopCourseMonitor = stop;
  window.__courseMonitorStop = stop;
  window.resumeCourseMonitor = () => { state.stopped = false; monitorLoop(); };
  window.courseMonitorStatus = () => ({ ...state, config: CONFIG });

  if (!iframe) {
    console.warn("未找到选课 iframe，请确认当前位于四川大学自由选课页面。");
    return;
  }
  const doc = iframe.contentWindow.document;
  const setValue = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const findRow = course => [...doc.querySelectorAll("#xirxkxkbody tr")].find(row => {
    const text = row.innerText || "";
    return text.includes(`${course.kch}_${course.kxh}`) || (text.includes(course.kch) && text.includes(course.kxh));
  });
  const available = row => {
    const match = (row.innerText || "").match(/(?:课余量|余量|剩余)\s*[:：]?\s*(\d+)/);
    return match ? Number(match[1]) : null;
  };
  async function check(course) {
    const input = doc.getElementById("kch");
    const button = doc.getElementById("queryButton");
    if (!input || !button) throw new Error("找不到课程号输入框或查询按钮。");
    setValue(input, course.kch);
    button.click();
    await sleep(CONFIG.queryWaitTime);
    const row = findRow(course);
    const seats = row && available(row);
    console.log(`${course.kch}_${course.kxh} ${course.name || ""}：`, seats);
    if (seats > 0) {
      row.style.backgroundColor = "yellow";
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      alert(`发现课余量：${course.name || course.kch}\n当前余量：${seats}`);
      stop();
      return true;
    }
    return false;
  }
  async function monitorLoop() {
    if (state.stopped) return;
    for (const group of CONFIG.groups || []) {
      for (const course of group.courses || []) {
        if (state.stopped || await check(course)) return;
      }
    }
    state.timer = setTimeout(monitorLoop, CONFIG.roundWaitTime);
  }
  monitorLoop().catch(error => { console.error("监控脚本发生错误：", error); stop(); });
  console.log("SCU Course Monitor 已启动。停止：stopCourseMonitor()。");
})();

