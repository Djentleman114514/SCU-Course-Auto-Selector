/*
 * SCU 课程数据解析测试
 *
 * 使用方式：
 * 1. 登录四川大学选课系统，进入“自由选课”页面。
 * 2. 先在页面中查询任意课程，让课程列表显示出来。
 * 3. 将本文件完整复制到浏览器 Console 后运行。
 *
 * 此脚本只读取当前表格并打印数据：不会查询、勾选、提交或修改选课状态。
 */

(() => {
  "use strict";

  // 留空 []：解析当前表格中的所有课程。
  // 填入课程号：仅显示指定课程，例如 ["603508020", "106588020"]。
  const TEST_COURSE_NUMBERS = [];

  const weekdayNames = {
    1: "星期一",
    2: "星期二",
    3: "星期三",
    4: "星期四",
    5: "星期五",
    6: "星期六",
    7: "星期日"
  };

  const iframe =
    top.document.getElementById("ifra") ||
    top.document.getElementById("iframe-xk") ||
    top.document.querySelector("iframe");
  const doc = iframe?.contentDocument;
  const tbody = doc?.getElementById("xirxkxkbody");

  if (!tbody) {
    console.error("未找到课程列表。请确认你位于自由选课页面，并先查询一门课程。");
    return;
  }

  const wanted = new Set(TEST_COURSE_NUMBERS.map(value => String(value).trim()));
  const parseRow = row => {
    const checkbox = row.querySelector('input[type="checkbox"][name="kcId"]');
    if (!checkbox?.value) return null;

    try {
      const data = JSON.parse(checkbox.value);
      return {
        id: checkbox.id,
        kch: String(data.kch || ""),
        kxh: String(data.kxh || ""),
        name: data.kcm || "",
        availableSeats: Number(data.bkskyl),
        selectedSeats: Number(data.bkskrl),
        weekText: data.zcsm || "",
        weekMask: String(data.skzc || ""),
        weekday: Number(data.skxq),
        weekdayText: weekdayNames[Number(data.skxq)] || `未知星期(${data.skxq})`,
        startPeriod: Number(data.skjc),
        endPeriod: Number(data.cxjc),
        location: [data.kkxqm, data.jxlm, data.jasm].filter(Boolean).join(" / "),
        raw: data
      };
    } catch (error) {
      console.warn("无法解析一条课程数据：", error, checkbox);
      return null;
    }
  };

  const sections = [...tbody.querySelectorAll("tr")]
    .map(parseRow)
    .filter(Boolean)
    .filter(section => wanted.size === 0 || wanted.has(section.kch));

  const hasOverlappingWeeks = (leftWeeks, rightWeeks) =>
    leftWeeks.length === rightWeeks.length &&
    [...leftWeeks].some((week, index) => week === "1" && rightWeeks[index] === "1");

  const hasTimeConflict = (left, right) =>
    left.weekday === right.weekday &&
    left.startPeriod <= right.endPeriod &&
    right.startPeriod <= left.endPeriod &&
    hasOverlappingWeeks(left.weekMask, right.weekMask);

  const conflicts = [];
  for (let leftIndex = 0; leftIndex < sections.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sections.length; rightIndex += 1) {
      const left = sections[leftIndex];
      const right = sections[rightIndex];
      if (hasTimeConflict(left, right)) {
        conflicts.push({
          left: `${left.kch}_${left.kxh} ${left.name}`,
          right: `${right.kch}_${right.kxh} ${right.name}`,
          time: `${left.weekText} / ${left.weekdayText} / ${left.startPeriod}~${left.endPeriod}节`
        });
      }
    }
  }

  const printable = sections.map(section => ({
    课程: `${section.kch}_${section.kxh}`,
    名称: section.name,
    课余量: section.availableSeats,
    已选人数: section.selectedSeats,
    周次: section.weekText,
    星期: section.weekdayText,
    节次: `${section.startPeriod}~${section.endPeriod}`,
    地点: section.location
  }));

  console.log(`解析完成：${sections.length} 个班次。`);
  console.table(printable);

  if (conflicts.length > 0) {
    console.log(`检测到 ${conflicts.length} 组时间冲突：`);
    console.table(conflicts);
  } else {
    console.log("当前结果中未检测到时间冲突。");
  }

  // 方便在 Console 中继续查看完整原始字段。
  window.__scuCourseParseTest = { sections, conflicts };
  console.log("完整数据：window.__scuCourseParseTest");
})();

