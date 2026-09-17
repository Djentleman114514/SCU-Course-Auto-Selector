/*
 * SCU 课程数据解析测试
 *
 * 使用方式：
 * 1. 登录四川大学选课系统，进入“自由选课”页面。
 * 2. 先在页面中查询任意课程，让课程列表显示出来。
 * 3. 将本文件完整复制到浏览器 Console 后运行。
 *
 * 此脚本只读取当前表格并打印数据：不会查询、勾选、提交或修改选课状态。
 * 它会按同一天内“节次区间重叠”打印自动分组结果。
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
        periodCount: Number(data.cxjc),
        // cxjc 表示连续上课的节数，不是结束节次。
        endPeriod: Number(data.skjc) + Number(data.cxjc) - 1,
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

  const buildTimeGroups = sourceSections => {
    const sectionsByWeekday = new Map();
    for (const section of sourceSections) {
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
            key: `${section.weekday}:${section.startPeriod}-${section.endPeriod}`,
            weekdayText: section.weekdayText,
            startPeriod: section.startPeriod,
            endPeriod: section.endPeriod,
            sections: []
          };
          groups.push(currentGroup);
        } else {
          currentGroup.endPeriod = Math.max(currentGroup.endPeriod, section.endPeriod);
          currentGroup.key = `${section.weekday}:${currentGroup.startPeriod}-${currentGroup.endPeriod}`;
        }
        currentGroup.sections.push(section);
      }
    }
    return groups;
  };

  const timeGroups = buildTimeGroups(sections);

  const printable = sections.map(section => ({
    课程: `${section.kch}_${section.kxh}`,
    名称: section.name,
    课余量: section.availableSeats,
    已选人数: section.selectedSeats,
    周次: section.weekText,
    星期: section.weekdayText,
    节次: `${section.startPeriod}~${section.endPeriod}（连续 ${section.periodCount} 节）`,
    地点: section.location
  }));

  console.log(`解析完成：${sections.length} 个班次。`);
  console.table(printable);

  const printableGroups = timeGroups.map(group => ({
    分组: group.key,
    时段: `${group.weekdayText} / 第 ${group.startPeriod}~${group.endPeriod} 节`,
    候选班次: group.sections.map(section => `${section.kch}_${section.kxh} ${section.name}`).join(" | "),
    班次数量: group.sections.length
  }));
  console.log(`自动分为 ${timeGroups.length} 个时段组：`);
  console.table(printableGroups);

  // 方便在 Console 中继续查看完整原始字段。
  window.__scuCourseParseTest = { sections, timeGroups };
  console.log("完整数据：window.__scuCourseParseTest");
})();
