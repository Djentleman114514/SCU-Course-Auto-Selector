/*
 * SCU 批量课程时段分类测试
 *
 * 此脚本会依次查询配置中的课程号，并按同一天内节次区间重叠的规则自动分组。
 * 它会改变页面当前的查询结果，但不会勾选、提交或修改任何选课状态。
 *
 * 脚本会确认并自动关闭“有课余量的课程”筛选，以取得全部班次进行完整分类。
 */

(() => {
  "use strict";

  const COURSE_NUMBERS = [
    "305972020",
    "105267020",
    "304515020",
    "909045020",
    "104016020",
    "102038020",
    "104212020",
    "105304020",
    "108058020",
    "302050010"
  ];
  const QUERY_WAIT_TIME = 1800;

  const weekdayNames = {
    1: "星期一", 2: "星期二", 3: "星期三", 4: "星期四",
    5: "星期五", 6: "星期六", 7: "星期日"
  };
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const iframe =
    top.document.getElementById("ifra") ||
    top.document.getElementById("iframe-xk") ||
    top.document.querySelector("iframe");
  const doc = iframe?.contentDocument;
  const tbody = doc?.getElementById("xirxkxkbody");
  const input = doc?.getElementById("kch");
  const queryButton = doc?.getElementById("queryButton");

  if (!tbody || !input || !queryButton) {
    console.error("未找到自由选课页面的课程列表、课程号输入框或查询按钮。");
    return;
  }

  const findAvailableOnlyCheckbox = () => {
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

  const setInputValue = (element, value) => {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const parseRow = row => {
    const checkbox = row.querySelector('input[type="checkbox"][name="kcId"]');
    if (!checkbox?.value) return null;
    try {
      const data = JSON.parse(checkbox.value);
      const startPeriod = Number(data.skjc);
      const periodCount = Number(data.cxjc);
      return {
        id: checkbox.id,
        kch: String(data.kch || ""),
        kxh: String(data.kxh || ""),
        name: data.kcm || "",
        availableSeats: Number(data.bkskyl),
        weekText: data.zcsm || "",
        weekday: Number(data.skxq),
        weekdayText: weekdayNames[Number(data.skxq)] || `未知星期(${data.skxq})`,
        startPeriod,
        periodCount,
        endPeriod: startPeriod + periodCount - 1,
        location: [data.kkxqm, data.jxlm, data.jasm].filter(Boolean).join(" / ")
      };
    } catch (error) {
      console.warn("无法解析一条课程数据：", error, checkbox);
      return null;
    }
  };

  const buildTimeGroups = sections => {
    const byWeekday = new Map();
    for (const section of sections) {
      const sameDay = byWeekday.get(section.weekday) || [];
      sameDay.push(section);
      byWeekday.set(section.weekday, sameDay);
    }

    const groups = [];
    for (const sameDay of byWeekday.values()) {
      const ordered = [...sameDay].sort((left, right) =>
        left.startPeriod - right.startPeriod || left.endPeriod - right.endPeriod
      );
      let group = null;
      for (const section of ordered) {
        if (!group || section.startPeriod > group.endPeriod) {
          group = {
            weekdayText: section.weekdayText,
            startPeriod: section.startPeriod,
            endPeriod: section.endPeriod,
            sections: []
          };
          groups.push(group);
        } else {
          group.endPeriod = Math.max(group.endPeriod, section.endPeriod);
        }
        group.sections.push(section);
      }
    }
    return groups;
  };

  async function run() {
    const availableOnlyCheckbox = findAvailableOnlyCheckbox();
    if (!availableOnlyCheckbox) {
      console.error("未找到“有课余量的课程”筛选框，请确认当前位于自由选课页面。");
      return;
    }
    if (availableOnlyCheckbox.checked) {
      console.log("正在关闭“有课余量的课程”筛选，以读取全部班次…");
      availableOnlyCheckbox.click();
      await sleep(600);
    }
    if (availableOnlyCheckbox.checked) {
      console.error("无法确认“有课余量的课程”筛选已关闭，测试停止。");
      return;
    }

    const sections = [];
    const missingCourseNumbers = [];

    for (const courseNumber of COURSE_NUMBERS) {
      console.log(`正在查询 ${courseNumber}…`);
      setInputValue(input, courseNumber);
      queryButton.click();
      await sleep(QUERY_WAIT_TIME);

      const matches = [...tbody.querySelectorAll("tr")]
        .map(parseRow)
        .filter(section => section?.kch === courseNumber);
      if (matches.length === 0) {
        missingCourseNumbers.push(courseNumber);
        console.warn(`${courseNumber}：未找到可解析的班次。`);
      } else {
        sections.push(...matches);
        console.log(`${courseNumber}：读取到 ${matches.length} 个班次。`);
      }
    }

    const groups = buildTimeGroups(sections);
    console.log(`分类完成：${sections.length} 个班次，${groups.length} 个时段组。`);
    console.table(sections.map(section => ({
      课程: `${section.kch}_${section.kxh}`,
      名称: section.name,
      课余量: section.availableSeats,
      周次: section.weekText,
      星期: section.weekdayText,
      节次: `${section.startPeriod}~${section.endPeriod}`,
      地点: section.location
    })));
    console.table(groups.map((group, index) => ({
      分组: `组 ${index + 1}`,
      时段: `${group.weekdayText} / 第 ${group.startPeriod}~${group.endPeriod} 节`,
      候选班次: group.sections.map(section => `${section.kch}_${section.kxh} ${section.name}`).join(" | "),
      班次数量: group.sections.length
    })));
    if (missingCourseNumbers.length > 0) {
      console.warn("未找到班次的课程号：", missingCourseNumbers);
    }

    window.__scuCourseClassificationTest = { sections, groups, missingCourseNumbers };
    console.log("完整结果：window.__scuCourseClassificationTest");
  }

  run().catch(error => console.error("分类测试失败：", error));
})();
