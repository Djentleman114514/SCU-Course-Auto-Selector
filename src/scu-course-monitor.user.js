// ==UserScript==
// @name         SCU Course Monitor
// @namespace    scu-course-monitor
// @version      0.2.0
// @description  四川大学自由选课页面课余量监控
// @match        https://*.scu.edu.cn/*
// @grant        none
// ==/UserScript==

// ============================================================================
// 用户课程配置：只修改本区内容，不需要修改下方监控逻辑。
//
// 每一项只填写课程号，例如 "106588020"。
// 课序号、课程名称、课余量和上课时间会从选课页面自动读取。
//
// 同一课程号有多个班时，脚本会把页面显示的每个班都作为候选项。
// 脚本按“星期 + 起始节次”自动分组：例如周四 10~11 节和周四 10~12 节
// 属于同一组；后续自动选课成功一门后，将停止该组的其他候选课程。
//
// 可直接在下面新增或删除课程号。
// ============================================================================
const SCU_COURSE_MONITOR_CONFIG = {
  queryWaitTime: 1800, // 每次查询后等待页面返回结果的时间（毫秒）
  roundWaitTime: 5000, // 全部课程查完后，下一轮开始前的等待时间（毫秒）
  courseNumbers: [
    "请填写课程号"
    // ,"第二门课程号"
    // ,"第三门课程号"
  ]
};

(() => {
  "use strict";

  const CONFIG = SCU_COURSE_MONITOR_CONFIG;
  const state = { stopped: false, timer: null };
  const iframe = document.getElementById("ifra") || document.getElementById("iframe-xk") || document.querySelector("iframe");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const courseNumbers = [...new Set((CONFIG.courseNumbers || []).map(value => String(value).trim()))];
  const invalidCourses = courseNumbers.filter(courseNumber =>
    !/^\d+$/.test(courseNumber) || courseNumber.includes("请填写")
  );

  if (courseNumbers.length === 0 || invalidCourses.length > 0) {
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
  const parseCourseRow = row => {
    const checkbox = row.querySelector('input[type="checkbox"][name="kcId"]');
    if (!checkbox?.value) return null;

    try {
      const data = JSON.parse(checkbox.value);
      if (!data.kch || !data.kxh) return null;
      return {
        row,
        checkbox,
        id: `${data.kch}_${data.kxh}_${data.zxjxjhh || ""}`,
        kch: String(data.kch),
        kxh: String(data.kxh),
        name: data.kcm || "未命名课程",
        availableSeats: Number(data.bkskyl),
        weeks: String(data.skzc || ""),
        weekText: data.zcsm || "周次未知",
        weekday: Number(data.skxq),
        startPeriod: Number(data.skjc),
        periodCount: Number(data.cxjc),
        // cxjc 表示连续上课的节数，不是结束节次。
        endPeriod: Number(data.skjc) + Number(data.cxjc) - 1
      };
    } catch (error) {
      console.warn("无法解析课程行数据：", error);
      return null;
    }
  };

  // 用户主动将同一时段的课程作为备选项。本项目按星期和起始节次分组，
  // 不再根据周次或结束节次推断是否可以同时选课。
  const timeGroupKey = section => `${section.weekday}:${section.startPeriod}`;

  async function check(courseNumber) {
    const input = doc.getElementById("kch");
    const button = doc.getElementById("queryButton");
    if (!input || !button) throw new Error("找不到课程号输入框或查询按钮。");
    setValue(input, courseNumber);
    button.click();
    await sleep(CONFIG.queryWaitTime);
    const candidates = [...doc.querySelectorAll("#xirxkxkbody tr")]
      .map(parseCourseRow)
      .filter(candidate => candidate?.kch === courseNumber);
    const availableCandidates = candidates.filter(candidate => candidate.availableSeats > 0);

    console.log(`${courseNumber}：找到 ${candidates.length} 个班，${availableCandidates.length} 个有余量。`);
    if (availableCandidates.length > 0) {
      const candidate = availableCandidates[0];
      candidate.row.style.backgroundColor = "yellow";
      candidate.row.scrollIntoView({ behavior: "smooth", block: "center" });
      console.log("可选班次：", candidate);
      alert(
        `发现课余量：${candidate.name} (${candidate.kch}_${candidate.kxh})\n` +
        `当前余量：${candidate.availableSeats}\n` +
        `上课时间：${candidate.weekText} / 星期${candidate.weekday} / ${candidate.startPeriod}~${candidate.endPeriod}节`
      );
      stop();
      return true;
    }
    return false;
  }
  async function monitorLoop() {
    if (state.stopped) return;
    for (const courseNumber of courseNumbers) {
      if (state.stopped || await check(courseNumber)) return;
    }
    state.timer = setTimeout(monitorLoop, CONFIG.roundWaitTime);
  }
  monitorLoop().catch(error => { console.error("监控脚本发生错误：", error); stop(); });
  console.log("SCU Course Monitor 已启动。停止：stopCourseMonitor()。");
})();
