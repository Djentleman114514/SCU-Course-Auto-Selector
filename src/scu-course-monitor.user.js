// ==UserScript==
// @name         SCU Course Monitor - Basic Flow
// @namespace    scu-course-monitor
// @version      0.4.0-basic
// @description  四川大学自由选课页面基础选课流程（无分组）
// @match        https://*.scu.edu.cn/*
// @grant        none
// ==/UserScript==

// ============================================================================
// 用户课程配置：不需要填写课程号，也不需要修改本区内容。
//
// 运行后，脚本会用弹窗逐门询问课程号。输入一门后按 Enter 继续输入下一门；
// 留空或点击“取消”后，脚本按输入顺序开始监控。
//
// 成功选到一门课后，脚本会自动保存剩余课程。回到自由选课页面重新运行脚本，
// 即可继续监控，无需重新输入。
// 本分支不做课程时间分组；每个课程号都被视为独立目标。
// ============================================================================
const SCU_COURSE_MONITOR_CONFIG = {
  queryWaitTime: 1800,
  roundWaitTime: 5000,
  beforeSubmitWaitTime: 400,
  submitResponseTimeout: 15000
};

(() => {
  "use strict";

  try {
    window.__scuCourseMonitor?.stop?.();
  } catch (_) {}

  const CONFIG = SCU_COURSE_MONITOR_CONFIG;
  const SUBMIT_URL_KEY = "/student/courseSelect/selectCourse/checkInputCodeAndSubmit";
  const STORAGE_KEY = "scu_basic_course_flow_remaining_v1";
  const formatTarget = target => target.kxh ? `${target.kch}_${target.kxh}` : target.kch;
  const collectCourses = () => {
    const collected = [];
    let number = 1;

    while (true) {
      const input = window.prompt(
        `请输入第 ${number} 门课程的课程号（例如 105267020）。\n` +
        "输入后按 Enter 继续添加下一门；留空或点击取消后开始监控。\n\n" +
        `当前已输入：${collected.map(formatTarget).join("、") || "无"}`
      );
      if (input === null || input.trim() === "") break;

      const kch = input.trim();
      if (!/^\d+$/.test(kch)) {
        alert("请输入纯数字的课程号（例如 105267020）。");
        continue;
      }
      const sequenceInput = window.prompt(
        `课程号 ${kch} 的课序号（可选，例如 01）。\n若任意班次均可，直接留空或点击取消。`
      );
      const kxh = sequenceInput === null ? "" : sequenceInput.trim();
      if (kxh && !/^\d+$/.test(kxh)) {
        alert("课序号应为纯数字（例如 01）；请重新输入这门课程。");
        continue;
      }
      const target = kxh ? { kch, kxh } : { kch };
      if (collected.some(item => item.kch === kch && (item.kxh || "") === kxh)) {
        alert(`课程 ${formatTarget(target)} 已输入，无需重复添加。`);
        continue;
      }
      collected.push(target);
      number += 1;
    }

    return collected;
  };
  const normalizeCourses = values => Array.isArray(values) ? values
    .map(value => typeof value === "string" ? { kch: value } : value)
    .map(value => ({ kch: String(value?.kch || "").trim(), kxh: String(value?.kxh || "").trim() }))
    .filter(value => /^\d+$/.test(value.kch) && (!value.kxh || /^\d+$/.test(value.kxh)))
    .map(value => value.kxh ? value : { kch: value.kch }) : [];
  const loadSavedCourses = () => {
    try {
      const raw = top.sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw && JSON.parse(raw);
      return normalizeCourses(parsed?.courses || parsed?.courseNumbers);
    } catch (_) {
      return [];
    }
  };
  const saveCourses = courses => {
    try {
      if (courses.length === 0) {
        top.sessionStorage.removeItem(STORAGE_KEY);
      } else {
        top.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          courses,
          updatedAt: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.warn("剩余课程保存失败：", error);
    }
  };
  const savedCourses = loadSavedCourses();
  const continueSavedCourses = savedCourses.length > 0 && window.confirm(
    `检测到上次未完成的课程：\n${savedCourses.map(formatTarget).join("、")}\n\n` +
    "点击“确定”继续监控这些课程；点击“取消”重新输入课程号。"
  );
  const courses = continueSavedCourses ? savedCourses : collectCourses();
  const state = {
    stopped: false,
    roundRunning: false,
    submitInProgress: false,
    manualPause: false,
    roundNumber: 0,
    timer: null,
    submitTimer: null,
    pending: null
  };
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  if (courses.length === 0) {
    if (savedCourses.length > 0 && !continueSavedCourses) {
      saveCourses([]);
    }
    console.error("未输入课程号，脚本未启动。");
    return;
  }

  saveCourses(courses);

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

  const parseCourseRow = row => {
    const checkbox = row.querySelector('input[type="checkbox"][name="kcId"]');
    if (!checkbox?.value) return null;
    try {
      const data = JSON.parse(checkbox.value);
      if (!data.kch || !data.kxh) return null;
      return {
        row,
        checkbox,
        id: checkbox.id,
        kch: String(data.kch),
        kxh: String(data.kxh),
        name: data.kcm || "未命名课程",
        availableSeats: Number(data.bkskyl)
      };
    } catch (error) {
      console.warn("无法解析课程行数据：", error);
      return null;
    }
  };

  const clearSubmitTimer = () => {
    if (state.submitTimer) clearTimeout(state.submitTimer);
    state.submitTimer = null;
  };

  const uncheckPending = () => {
    if (!state.pending) return;
    const context = getContext();
    const checkbox = context?.doc.getElementById(state.pending.checkboxId);
    if (checkbox?.checked) {
      checkbox.click();
      console.log(`↩️ 已取消勾选：${state.pending.target}`);
    }
  };

  const scheduleNextRound = delay => {
    if (state.stopped || state.roundRunning || state.submitInProgress || state.manualPause) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      runRound().catch(error => {
        console.error("监控异常：", error);
      });
    }, delay);
  };

  const handleSubmitFailure = message => {
    console.warn(`⚠️ 选课未成功：${message}`);
    clearSubmitTimer();
    uncheckPending();
    state.pending = null;
    state.submitInProgress = false;
    state.manualPause = false;
    scheduleNextRound(3000);
  };

  const installAjaxHooks = () => {
    const jq = top.jQuery || top.$;
    if (!jq) throw new Error("未找到页面 jQuery，无法确认提交结果。");
    const eventTarget = jq(top.document);
    eventTarget.off("ajaxSuccess.scuBasicCourseFlow");
    eventTarget.off("ajaxError.scuBasicCourseFlow");

    eventTarget.on("ajaxSuccess.scuBasicCourseFlow", (_event, _xhr, settings, data) => {
      if (!String(settings?.url || "").includes(SUBMIT_URL_KEY) || !state.pending) return;
      clearSubmitTimer();
      let payload = data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) {}
      }
      const result = payload && typeof payload === "object" ? String(payload.result ?? "") : "";
      const pending = state.pending;

      if (result === "ok") {
        const remainingCourses = courses.filter(course => !(
          course.kch === pending.course.kch && (course.kxh || "") === (pending.course.kxh || "")
        ));
        saveCourses(remainingCourses);
        state.pending = null;
        state.submitInProgress = false;
        state.stopped = true;
        console.log(`✅ 选课成功：${pending.target} ${pending.name}`);
        alert(
          `选课成功：\n${pending.target} ${pending.name}\n\n` +
          (remainingCourses.length > 0
            ? `已自动保存剩余课程：${remainingCourses.map(formatTarget).join("、")}\n` +
              "回到自由选课页面后重新运行脚本，即可继续监控。"
            : "所有输入课程均已完成，已自动清空本次保存进度。")
        );
      } else {
        handleSubmitFailure(result || "服务器未返回成功结果");
      }
    });

    eventTarget.on("ajaxError.scuBasicCourseFlow", (_event, _xhr, settings) => {
      if (!String(settings?.url || "").includes(SUBMIT_URL_KEY) || !state.pending) return;
      handleSubmitFailure("网络请求失败");
    });
  };

  const captchaIsMissing = () => {
    const area = top.document.getElementById("yzm_area");
    const input = top.document.getElementById("submitCode");
    const required = area && top.getComputedStyle(area).display !== "none";
    return required && !input?.value.trim();
  };

  async function selectAndSubmit(candidate, course) {
    if (state.stopped || state.submitInProgress || state.manualPause) return;
    const context = getContext();
    if (!context) throw new Error("提交前未找到课程列表。");

    const checked = [...context.doc.querySelectorAll('input[type="checkbox"][name="kcId"]:checked')];
    if (checked.some(checkbox => checkbox !== candidate.checkbox)) {
      state.manualPause = true;
      alert("检测到页面上已有其他课程被勾选。为避免误提交，脚本已暂停。");
      return;
    }
    if (candidate.checkbox.disabled) {
      console.warn(`${candidate.kch}_${candidate.kxh} 当前不可勾选。`);
      return;
    }
    if (!candidate.checkbox.checked) candidate.checkbox.click();
    await sleep(250);

    const finalChecked = [...context.doc.querySelectorAll('input[type="checkbox"][name="kcId"]:checked')];
    if (finalChecked.length !== 1 || finalChecked[0] !== candidate.checkbox) {
      state.manualPause = true;
      alert("自动勾选状态异常，脚本已暂停。");
      return;
    }

    candidate.row.style.backgroundColor = "yellow";
    candidate.row.scrollIntoView({ behavior: "smooth", block: "center" });
    state.pending = {
      checkboxId: candidate.id,
      course,
      target: `${candidate.kch}_${candidate.kxh}`,
      name: candidate.name
    };

    if (captchaIsMissing()) {
      state.manualPause = true;
      alert(
        `已勾选：${state.pending.target} ${state.pending.name}\n\n` +
        "当前系统要求验证码。请填写后手动提交；提交结果仍会由脚本确认。"
      );
      return;
    }

    if (typeof top.tijiao !== "function") {
      state.manualPause = true;
      alert("未找到页面的提交函数 tijiao()，脚本已暂停。");
      return;
    }

    state.submitInProgress = true;
    await sleep(CONFIG.beforeSubmitWaitTime);
    console.log(`🚀 提交：${state.pending.target} ${state.pending.name}`);
    try {
      top.tijiao();
    } catch (error) {
      handleSubmitFailure(`调用提交函数失败：${error.message || error}`);
      return;
    }

    clearSubmitTimer();
    state.submitTimer = setTimeout(() => {
      if (!state.pending) return;
      state.submitInProgress = false;
      state.manualPause = true;
      alert(
        `已发起提交：${state.pending.target}\n\n` +
        "15 秒内未捕获到明确结果。请查看页面提示；确认后可调用 resumeCourseMonitor()。"
      );
    }, CONFIG.submitResponseTimeout);
  }

  const queryAvailableCandidates = async course => {
    const context = getContext();
    if (!context) throw new Error("找不到课程号输入框、查询按钮或课程列表。");
    console.log(`🔎 查询 ${formatTarget(course)}…`);
    setInputValue(context.input, course.kch);
    context.queryButton.click();
    await sleep(CONFIG.queryWaitTime);

    const refreshedContext = getContext();
    if (!refreshedContext) throw new Error("查询后未找到课程列表。");
    const candidates = [...refreshedContext.tbody.querySelectorAll("tr")]
      .map(parseCourseRow)
      .filter(candidate => candidate?.kch === course.kch && candidate.availableSeats > 0 &&
        (!course.kxh || candidate.kxh === course.kxh));
    console.log(`${formatTarget(course)}：有余量班次 ${candidates.length} 个。`);
    return candidates;
  };

  async function runRound() {
    if (state.stopped || state.roundRunning || state.submitInProgress || state.manualPause) return;
    state.roundRunning = true;
    state.roundNumber += 1;
    try {
      await ensureAvailableOnlyChecked();
      console.log(`\n========== 第 ${state.roundNumber} 轮基础监控 ==========`);
      for (const course of courses) {
        if (state.stopped || state.manualPause) return;
        const candidates = await queryAvailableCandidates(course);
        if (candidates.length > 0) {
          await selectAndSubmit(candidates[0], course);
          return;
        }
      }
      console.log("本轮未发现目标课程余量。\n");
    } finally {
      state.roundRunning = false;
      if (!state.stopped && !state.submitInProgress && !state.manualPause) {
        scheduleNextRound(CONFIG.roundWaitTime);
      }
    }
  }

  const stopMonitor = () => {
    state.stopped = true;
    if (state.timer) clearTimeout(state.timer);
    clearSubmitTimer();
    const jq = top.jQuery || top.$;
    if (jq) {
      jq(top.document).off("ajaxSuccess.scuBasicCourseFlow");
      jq(top.document).off("ajaxError.scuBasicCourseFlow");
    }
    console.log("🛑 已停止基础选课流程。");
  };

  const resumeMonitor = () => {
    if (state.pending) uncheckPending();
    clearSubmitTimer();
    state.pending = null;
    state.submitInProgress = false;
    state.manualPause = false;
    state.stopped = false;
    console.log("▶️ 已恢复基础选课流程。");
    scheduleNextRound(0);
  };

  const resetCourseMonitorProgress = () => {
    try {
      top.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    stopMonitor();
    alert("已清空保存的剩余课程。请重新运行脚本并输入新的课程号。");
  };

  try {
    installAjaxHooks();
  } catch (error) {
    console.error("无法启动基础选课流程：", error);
    return;
  }

  window.stopCourseMonitor = stopMonitor;
  window.__courseMonitorStop = stopMonitor;
  window.resumeCourseMonitor = resumeMonitor;
  window.reset = resetCourseMonitorProgress;
  window.resetCourseMonitorProgress = resetCourseMonitorProgress;
  window.courseMonitorStatus = () => ({ ...state, config: CONFIG });
  window.__scuCourseMonitor = {
    stop: stopMonitor,
    resume: resumeMonitor,
    reset: resetCourseMonitorProgress,
    status: window.courseMonitorStatus
  };

  console.log("🚀 SCU Course Monitor 基础选课流程已启动（无分组）。");
  console.log("🚀 发现第一门有余量课程后将自动勾选并提交，然后停止。");
  console.log("停止：stopCourseMonitor()；恢复：resumeCourseMonitor()；重新输入课程：reset()");
  scheduleNextRound(0);
})();
