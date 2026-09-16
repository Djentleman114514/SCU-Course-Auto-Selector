// ==UserScript==
// @name         SCU Course Monitor
// @namespace    scu-course-monitor
// @version      0.3.0
// @description  四川大学自由选课页面课余量监控（模拟选择版）
// @match        https://*.scu.edu.cn/*
// @grant        none
// ==/UserScript==

// ============================================================================
// 用户课程配置：只修改本区内容，不需要修改下方监控逻辑。
//
// 每一项只填写课程号，例如 "106588020"。数组顺序即优先级：同一时段内
// 有多门课时，模拟版会优先计划选择排在前面的课程号。
//
// 课序号、课程名称、课余量和上课时间会从选课页面自动读取。
// 同一天内节次区间重叠的候选课会自动归入同一个时段组。
//
// 当前是“模拟选择版”：只打印计划选择的课程和将停止的同组候选课，
// 不会勾选任何课程，也不会提交选课请求。
// ============================================================================
const SCU_COURSE_MONITOR_CONFIG = {
  queryWaitTime: 1800,
  roundWaitTime: 5000,
  courseNumbers: [
    "请填写课程号"
    // ,"第二门课程号"
    // ,"第三门课程号"
  ]
};

(() => {
  "use strict";

  try {
    window.__scuCourseMonitor?.stop?.();
  } catch (_) {}

  const CONFIG = SCU_COURSE_MONITOR_CONFIG;
  const weekdayNames = {
    1: "星期一", 2: "星期二", 3: "星期三", 4: "星期四",
    5: "星期五", 6: "星期六", 7: "星期日"
  };
  const courseNumbers = [...new Set(
    (CONFIG.courseNumbers || []).map(value => String(value).trim())
  )];
  const invalidCourseNumbers = courseNumbers.filter(courseNumber =>
    !/^\d+$/.test(courseNumber) || courseNumber.includes("请填写")
  );
  const state = {
    stopped: false,
    roundRunning: false,
    roundNumber: 0,
    timer: null,
    lastPlan: null
  };
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  if (courseNumbers.length === 0 || invalidCourseNumbers.length > 0) {
    console.error("课程配置未完成。请先填写脚本顶部的 SCU_COURSE_MONITOR_CONFIG。");
    return;
  }

  const getContext = () => {
    const iframe =
      top.document.getElementById("ifra") ||
      top.document.getElementById("iframe-xk") ||
      top.document.querySelector("iframe");
    const doc = iframe?.contentDocument;
    const input = doc?.getElementById("kch");
    const queryButton = doc?.getElementById("queryButton");
    const tbody = doc?.getElementById("xirxkxkbody");
    return input && queryButton && tbody ? { doc, input, queryButton, tbody } : null;
  };

  const findAvailableOnlyCheckbox = doc => {
    const boxes = [...doc.querySelectorAll('input[type="checkbox"]')]
      .filter(checkbox => checkbox.name !== "kcId");
    return boxes.find(checkbox => {
      let node = checkbox;
      for (let level = 0; level < 5 && node; level += 1) {
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, "");
        if (text.includes("有课余量的课程")) return true;
        node = node.parentElement;
      }
      return false;
    });
  };

  const ensureAvailableOnlyChecked = async () => {
    const context = getContext();
    const checkbox = context && findAvailableOnlyCheckbox(context.doc);
    if (!checkbox) throw new Error("未找到“有课余量的课程”筛选框。");
    if (!checkbox.checked) {
      console.log("☑️ 正在开启“有课余量的课程”筛选。");
      checkbox.click();
      await sleep(600);
    }
    if (!checkbox.checked) throw new Error("无法确认“有课余量的课程”筛选已开启。");
  };

  const setInputValue = (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const parseCourseRow = (row, priority, resultOrder) => {
    const checkbox = row.querySelector('input[type="checkbox"][name="kcId"]');
    if (!checkbox?.value) return null;
    try {
      const data = JSON.parse(checkbox.value);
      const startPeriod = Number(data.skjc);
      const periodCount = Number(data.cxjc);
      if (!data.kch || !data.kxh || !startPeriod || !periodCount) return null;
      return {
        id: checkbox.id,
        kch: String(data.kch),
        kxh: String(data.kxh),
        name: data.kcm || "未命名课程",
        availableSeats: Number(data.bkskyl),
        weekText: data.zcsm || "周次未知",
        weekday: Number(data.skxq),
        weekdayText: weekdayNames[Number(data.skxq)] || `未知星期(${data.skxq})`,
        startPeriod,
        periodCount,
        endPeriod: startPeriod + periodCount - 1,
        priority,
        resultOrder
      };
    } catch (error) {
      console.warn("无法解析课程行数据：", error);
      return null;
    }
  };

  // 同一天内，节次区间有重叠的课程合并为同一个时段组。
  const buildTimeGroups = sections => {
    const sectionsByWeekday = new Map();
    for (const section of sections) {
      const sameDay = sectionsByWeekday.get(section.weekday) || [];
      sameDay.push(section);
      sectionsByWeekday.set(section.weekday, sameDay);
    }

    const groups = [];
    for (const sameDay of sectionsByWeekday.values()) {
      const ordered = [...sameDay].sort((left, right) =>
        left.startPeriod - right.startPeriod || left.endPeriod - right.endPeriod
      );
      let currentGroup = null;
      for (const section of ordered) {
        if (!currentGroup || section.startPeriod > currentGroup.endPeriod) {
          currentGroup = {
            weekday: section.weekday,
            weekdayText: section.weekdayText,
            startPeriod: section.startPeriod,
            endPeriod: section.endPeriod,
            sections: []
          };
          groups.push(currentGroup);
        } else {
          currentGroup.endPeriod = Math.max(currentGroup.endPeriod, section.endPeriod);
        }
        currentGroup.sections.push(section);
      }
    }

    return groups
      .sort((left, right) => left.weekday - right.weekday || left.startPeriod - right.startPeriod)
      .map(group => ({
        ...group,
        key: `${group.weekday}:${group.startPeriod}-${group.endPeriod}`,
        selected: [...group.sections].sort((left, right) =>
          left.priority - right.priority || left.resultOrder - right.resultOrder
        )[0]
      }));
  };

  const queryAvailableSections = async (courseNumber, priority) => {
    const context = getContext();
    if (!context) throw new Error("找不到课程号输入框、查询按钮或课程列表。");
    console.log(`🔎 查询 ${courseNumber}…`);
    setInputValue(context.input, courseNumber);
    context.queryButton.click();
    await sleep(CONFIG.queryWaitTime);

    const refreshedContext = getContext();
    if (!refreshedContext) throw new Error("查询后未找到课程列表。");
    const sections = [...refreshedContext.tbody.querySelectorAll("tr")]
      .map((row, resultOrder) => parseCourseRow(row, priority, resultOrder))
      .filter(section => section?.kch === courseNumber && section.availableSeats > 0);
    console.log(`${courseNumber}：本轮有余量班次 ${sections.length} 个。`);
    return sections;
  };

  const summarizeSection = section =>
    `${section.kch}_${section.kxh} ${section.name}（余量 ${section.availableSeats}）`;

  const printSimulationPlan = groups => {
    if (groups.length === 0) {
      console.log("本轮没有配置课程出现余量，继续监控。\n");
      return;
    }
    console.log(`\n🧪 第 ${state.roundNumber} 轮模拟选择计划：${groups.length} 个时段组。`);
    console.table(groups.map((group, index) => ({
      分组: `组 ${index + 1}`,
      时段: `${group.weekdayText} / 第 ${group.startPeriod}~${group.endPeriod} 节`,
      将选择: summarizeSection(group.selected),
      将停止的同组候选: group.sections
        .filter(section => section.id !== group.selected.id)
        .map(summarizeSection)
        .join(" | ") || "无",
      候选数量: group.sections.length
    })));
    console.log("🧪 模拟模式：以上内容仅为计划，不会勾选或提交课程。\n");
  };

  const scheduleNextRound = delay => {
    if (state.stopped || state.roundRunning) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      runRound().catch(error => {
        console.error("监控异常：", error);
        scheduleNextRound(CONFIG.roundWaitTime);
      });
    }, delay);
  };

  async function runRound() {
    if (state.stopped || state.roundRunning) return;
    state.roundRunning = true;
    state.roundNumber += 1;
    try {
      await ensureAvailableOnlyChecked();
      console.log(`\n========== 第 ${state.roundNumber} 轮模拟监控 ==========`);
      const sections = [];
      const missingCourseNumbers = [];
      for (const [priority, courseNumber] of courseNumbers.entries()) {
        if (state.stopped) return;
        const matches = await queryAvailableSections(courseNumber, priority);
        if (matches.length === 0) missingCourseNumbers.push(courseNumber);
        sections.push(...matches);
      }
      const groups = buildTimeGroups(sections);
      state.lastPlan = { groups, missingCourseNumbers, generatedAt: new Date().toISOString() };
      printSimulationPlan(groups);
      if (missingCourseNumbers.length > 0) {
        console.log("本轮未发现余量的课程号：", missingCourseNumbers.join("、"));
      }
    } finally {
      state.roundRunning = false;
      if (!state.stopped) scheduleNextRound(CONFIG.roundWaitTime);
    }
  }

  const stopMonitor = () => {
    state.stopped = true;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    console.log("🛑 已停止模拟监控。");
  };
  const resumeMonitor = () => {
    if (!state.stopped && (state.roundRunning || state.timer)) {
      console.log("模拟监控正在运行，无需恢复。");
      return;
    }
    state.stopped = false;
    console.log("▶️ 已恢复模拟监控。");
    scheduleNextRound(0);
  };

  window.stopCourseMonitor = stopMonitor;
  window.__courseMonitorStop = stopMonitor;
  window.resumeCourseMonitor = resumeMonitor;
  window.courseMonitorStatus = () => ({ ...state, config: CONFIG });
  window.__scuCourseMonitor = {
    stop: stopMonitor,
    resume: resumeMonitor,
    status: window.courseMonitorStatus
  };

  console.log("🧪 SCU Course Monitor 模拟选择版已启动。");
  console.log("🧪 只会打印选课计划，不会勾选或提交课程。");
  console.log("停止：stopCourseMonitor()；恢复：resumeCourseMonitor()；状态：courseMonitorStatus()");
  scheduleNextRound(0);
})();
