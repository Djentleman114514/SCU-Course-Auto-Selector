// ==UserScript==
// @name         SCU Course Monitor
// @namespace    scu-course-monitor
// @version      0.1.0
// @description  四川大学自由选课页面课余量监控
// @match        https://*.scu.edu.cn/*
// @grant        none
// ==/UserScript==

// ============================================================================
// 用户课程配置：只修改本区内容，不需要修改下方监控逻辑。
//
// kch  ：课程号，例如 "106588020"
// kxh  ：课序号，例如 "01"
// name ：课程名称，仅用于日志和提醒，建议按页面显示填写
// id   ：时间分组标识；不同上课时间请使用不同分组
// time ：上课时间说明，仅用于帮助你辨认分组
//
// 可复制 courses 中的对象添加同一时间段的备选课；
// 可复制整个 groups 中的对象添加另一个时间段。
// ============================================================================
const SCU_COURSE_MONITOR_CONFIG = {
  queryWaitTime: 1800, // 每次查询后等待页面返回结果的时间（毫秒）
  roundWaitTime: 5000, // 全部课程查完后，下一轮开始前的等待时间（毫秒）
  groups: [
    {
      id: "A",
      time: "例如：周一 8-9 节",
      courses: [
        {
          kch: "请填写课程号",
          kxh: "请填写课序号",
          name: "请填写课程名称"
        }
        // ,{ kch: "第二门课程号", kxh: "01", name: "第二门课程名称" }
      ]
    }
    // ,{
    //   id: "B",
    //   time: "例如：周四 3-4 节",
    //   courses: [
    //     { kch: "课程号", kxh: "课序号", name: "课程名称" }
    //   ]
    // }
  ]
};

(() => {
  "use strict";

  const CONFIG = SCU_COURSE_MONITOR_CONFIG;
  const state = { stopped: false, timer: null };
  const iframe = document.getElementById("ifra") || document.getElementById("iframe-xk") || document.querySelector("iframe");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const configuredCourses = (CONFIG.groups || []).flatMap(group =>
    (group.courses || []).map(course => ({ group, course }))
  );
  const invalidCourses = configuredCourses.filter(({ group, course }) =>
    !group.id || !course.kch || !course.kxh ||
    String(course.kch).includes("请填写") || String(course.kxh).includes("请填写")
  );

  if (configuredCourses.length === 0 || invalidCourses.length > 0) {
    console.error("课程配置未完成。请先填写脚本顶部的 SCU_COURSE_MONITOR_CONFIG。");
    return;
  }

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
