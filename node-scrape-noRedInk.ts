import axios from "axios";
import puppeteer, { Page, Browser } from "puppeteer";

import {
  AppCourse,
  AppLevel,
  AppTopic,
  LevelMasteryRecord,
  StudentAccount,
  TopicMasteryRecord,
} from "../sdk/learningAppImport";

export default class NoRedInk {
  baseUrl = "https://www.noredink.com/";
  assignmentLisnks: string[] = [];
  courseIds: string[] = [];
  languageCourseIds: string[] = [];
  writingCourseIds: string[] = [];
  appTopicsGlobal: AppTopic[] = [];
  page: Page | null = null;
  browser: Browser | null = null;
  username: string | null = null;
  password: string | null = null;
  credentialId: string | null = null;

  constructor(username: string, password: string, credentialId: string) {
    this.username = username;
    this.password = password;
    this.credentialId = credentialId;
  }

  async login(): Promise<void> {
    try {
      if (!this.username || !this.password || !this.credentialId) {
        throw new Error("Missing Crendials");
      }

      const browser: Browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
      });
      const page: Page = await browser.newPage();
      let loginFlage = false;
      for (let index = 0; index < 5; index++) {
        await page.goto(this.baseUrl, { timeout: 0 });

        await page.waitForSelector("#navbar-login__container");
        await page.click("#navbar-login__container");

        await page.waitForSelector("#log_in_with_password");
        await page.click("#log_in_with_password");

        await page.waitForSelector("#Nri-Ui-TextInput-Email-or-username");
        await page.type("#Nri-Ui-TextInput-Email-or-username", this.username, {
          delay: 100,
        });
        await page.type("#Nri-Ui-TextInput-Password", this.password, {
          delay: 100,
        });
        await page.click("#navbar-login-menu > div > form > button");
        try {
          await page.waitForSelector("._bc723aea");
          loginFlage = true;
          break;
        } catch (err) {
          console.log(`${index + 1} - login retry..`);
        }
      }
      if (!loginFlage) {
        throw new Error("Unable to process with login");
      } else {
        console.log("Successfully LogedIn.");
        this.page = page;
        this.browser = browser;
      }
    } catch (err) {
      console.error({
        Error_Code: "noredink_000",
        Error_Type: "Login Error.",
        Error: err,
      });
      throw err;
    }
  }

  async courses(): Promise<AppCourse[]> {
    console.log("> Fetching Courses.");
    try {
      if (!this.page) {
        throw new Error("Missing Browser Page.");
      }
      await this.page.waitForSelector("div._f0652e25 > section > div");
      const headers = await this.page.$$("div._f0652e25 > section > div");
      const data = [];
      for (let header of headers) {
        const courseName = await header.$eval("h3", (v: any) =>
          v.textContent.replace("Premium", "")
        );
        const courseUrl = await header.$eval(
          "div > div._9db503dd.Page-Teach-TeacherDashboard-Courses-courseActions > a:nth-child(2)",
          (v: any) => v.href
        );
        const arrayId = courseUrl.split("/");
        const courseId = arrayId[arrayId.length - 2];
        let subjectKeys: string;
        let Writing = courseName.includes("Writing");
        if (Writing) {
          let link = await header.$eval(
            "div > div._9db503dd.Page-Teach-TeacherDashboard-Courses-courseActions > a:nth-child(2)",
            (v: any) => v.href
          );
          subjectKeys = "Writing";
          this.writingCourseIds.push(courseId);
          this.assignmentLisnks.push((link = link));
        } else {
          this.languageCourseIds.push(courseId);
          subjectKeys = "Language";
        }
        this.courseIds.push(courseId);
        data.push({
          credentialId: this.credentialId,
          courseName,
          courseId,
          subjectKeys,
        });
      }
      return data;
    } catch (err) {
      console.error({
        Error_Code: "noredink_001",
        Error_Type: "Unable to fetch the courses.",
        Error: err,
      });
    }
  }

  async appTopicsLevels(): Promise<{
    appTopics: AppTopic[];
    appLevels: AppLevel[];
  }> {
    console.log("> Fetching App Topics & Levels.");
    try {
      if (!this.page) {
        throw new Error("Missing Browser Page.");
      }
      // Tpics and Levels for languages
      const appTopics: AppTopic[] = [];
      const appLevels: AppLevel[] = [];
      const response = await axios.get(`${this.baseUrl}curriculum/api/library`);
      const topicsLevels = response.data;
      for (let index = 0; index < topicsLevels.length; index++) {
        const element = topicsLevels[index];
        const topicId = element.id.toString();
        const gradeLevel = Math.min(...element.gradeLevels).toString();
        const topicName = element.name;
        const topicOrder = index + 1;
        let topics = element.topics;
        let hasLevels = false;

        for (let i = 0; i < topics.length; i++) {
          const data = topics[i];
          if (data.passage == false) {
            hasLevels = true;
            const levelName = data.name;
            const levelId = data.id.toString();
            const levelOrder = i + 1;
            const levelTopicId = topicId;
            appLevels.push({
              credentialId: this.credentialId,
              levelName,
              levelId,
              gradeLevel,
              levelOrder,
              commonCoreStandardCode: "",
              topicId: levelTopicId,
            });
          }
        }

        if (hasLevels) {
          this.languageCourseIds.map((cid) => {
            appTopics.push({
              credentialId: "dummyId",
              topicName,
              topicId,
              topicOrder,
              courseId: cid,
            });
          });
        }
      }

      // Tpics and Levels for Writing
      for (const link of this.assignmentLisnks) {
        await this.page.goto(`${link}`, { timeout: 0 });
        let asiignments = await this.page.$$eval(
          "#assignments-page-elm-flags",
          (el) => el.map((x) => x.getAttribute("data-flags"))
        );
        const asiignmentsData = JSON.parse(asiignments[0]);
        const pageState = asiignmentsData.pageState;
        const getAssignments = pageState.assignments;

        const courses = asiignmentsData.courses;
        const gradeIndices = courses.find(
          ({ id }) => id === pageState.courseId
        );
        const gradeData = gradeIndices.grade_indices;
        const gradeLevels = Math.min(...gradeData).toString();

        for (let i = 0; i < getAssignments.length; i++) {
          if (
            getAssignments[i].type == "Quick Write" ||
            getAssignments[i].type == "Guided Draft"
          ) {
            appTopics.push({
              credentialId: this.credentialId,
              topicName: getAssignments[i].name.toString(),
              topicId: getAssignments[i].id.toString(),
              topicOrder: i,
              courseId: getAssignments[i].course_id.toString(),
            });
            appLevels.push({
              credentialId: this.credentialId,
              levelName: getAssignments[i].name.toString(),
              levelId: getAssignments[i].id.toString(),
              gradeLevel: gradeLevels,
              levelOrder: 1,
              commonCoreStandardCode: "",
              topicId: getAssignments[i].id.toString(),
            });
          }
        }
      }
      this.appTopicsGlobal = appTopics;
      return { appTopics, appLevels };
    } catch (err) {
      console.error({
        Error_Code: "noredink_002",
        Error_Type: "Unable to fetch the App topics & Levels.",
        Error: err,
      });
    }
  }

  async students(): Promise<StudentAccount[]> {
    console.log("> Fetching Students.");
    try {
      if (!this.page) {
        throw new Error("Missing Browser Page.");
      }
      const studentsData: StudentAccount[] = [];
      for (const courseId of this.courseIds) {
        await this.page.goto(
          `${this.baseUrl}teach/classes/api/classes/${courseId}`,
          { timeout: 0 }
        );
        const stdData = await this.page.$("body > pre");
        let stds = await this.page.evaluate(
          (el: any) => el.textContent,
          stdData
        );
        stds = JSON.parse(stds);
        if (stds) {
          const students = stds.students;
          for (let index = 0; index < students.length; index++) {
            const studentKeys = students[index].username;
            const studentId = students[index].id.toString();
            const classId = courseId;
            let findId = studentsData.find(
              (find: any) => find.studentId === studentId
            );
            if (!findId) {
              studentsData.push({
                credentialId: this.credentialId,
                studentKeys,
                studentId,
                classId,
              });
            }
          }
        }
      }
      return studentsData;
    } catch (err) {
      console.error({
        Error_Code: "noredink_003",
        Error_Type: "Unable to fetch the students record.",
        Error: err,
      });
    }
  }

  async topicMastery(): Promise<TopicMasteryRecord[]> {
    console.log("> Fetching Topic Mastery Record.");
    try {
      if (!this.page) {
        throw new Error("Missing Browser Page.");
      }
      const TopicMasteryRecord: TopicMasteryRecord[] = [];
      for (const courseId of this.courseIds) {
        await this.page.goto(
          `${this.baseUrl}teach/courses/${courseId}/gradebook`,
          { timeout: 0 }
        );
        const greadbooksUrl = [];
        if (await this.page.waitForSelector("._7f5e3840", { timeout: 5000 })) {
          const topicsUrl = await this.page.$$("._7f5e3840 th");
          for (const topic of topicsUrl) {
            const greadbooksUrlTopic = await topic.$eval(
              "._1ce2f26f a",
              (v: any) => v.href
            );
            const topicText = await topic.$eval(
              "div > div:nth-child(1) > span",
              (v: any) => v.textContent
            );
            if (topicText == "Quick Write" || topicText == "Guided Draft") {
              greadbooksUrl.push(greadbooksUrlTopic);
            }
          }

          let attr: any = await this.page.$$eval(
            "#courses-gradebook-elm-flags",
            (el) => el.map((x: any) => x.getAttribute("data-flags"))
          );
          if (attr && attr.length > 0) {
            const attrData = JSON.parse(attr[0]);
            const tasks: any = attrData.tasks;
            const results = [];
            for (const task of tasks) {
              if (task.type == "Quick Write" || task.type == "Guided Draft") {
                results.push(task.results);
              }
            }

            const rsultFilterData = [];
            for (const result of results) {
              for (const obj of result) {
                if (
                  obj.completion.tag == "scored" &&
                  obj.completion.score >= 0.5
                ) {
                  rsultFilterData.push(obj);
                }
              }
            }

            for (const url of greadbooksUrl) {
              await this.page.goto(`${url}`, { timeout: 0 });
              const urlArr = url.split("/");
              let gradeTopicData = null;
              if (urlArr.includes("guided_drafts")) {
                const coursesGuidedDrafts = await this.page.$$eval(
                  "#teach-courses-guided-drafts-elm-flags",
                  (el: any) => el.map((x) => x.getAttribute("data-flags"))
                );
                if (coursesGuidedDrafts && coursesGuidedDrafts.length > 0) {
                  gradeTopicData = JSON.parse(coursesGuidedDrafts[0]);
                }
              }
              if (urlArr.includes("quick_writes")) {
                const quickWritesClass = await this.page.$$eval(
                  "#teach-quick-writes-class-elm-flags",
                  (el: any) => el.map((x) => x.getAttribute("data-flags"))
                );
                if (quickWritesClass && quickWritesClass.length > 0) {
                  gradeTopicData = JSON.parse(quickWritesClass[0]);
                }
              }
              if (
                gradeTopicData &&
                gradeTopicData.assignment &&
                gradeTopicData.assignment.id &&
                gradeTopicData.statesById &&
                gradeTopicData.students
              ) {
                for (const filter of rsultFilterData) {
                  let userId = filter.userId;
                  let date = filter.due;
                  let passFail: number;
                  if (filter.completion.score >= 0.5) {
                    passFail = 1;
                  } else {
                    passFail = 0;
                  }

                  let topicId = gradeTopicData.assignment.id;
                  const statesById = gradeTopicData.statesById;
                  const gradeById = gradeTopicData.students;
                  let gradeResult = gradeById.find(({ id }) => id === userId);
                  let grade: any;
                  if (gradeResult) {
                    grade = gradeResult.grade;
                  }
                  let findStd: string[];
                  for (const ar of statesById) {
                    for (let i = 0; i < ar.length; i++) {
                      if (ar[i] === userId) {
                        findStd = ar;
                      }
                    }
                  }
                  if (findStd) {
                    if (findStd[1] == "graded") {
                      TopicMasteryRecord.push({
                        credentialId: this.credentialId,
                        date: date,
                        topicId: topicId.toString(),
                        studentId: userId.toString(),
                        activityUnitsAttempted: 1,
                        activityUnitsCorrect: passFail,
                        appReportedTimeMinutes: grade,
                      });
                    }
                    if (findStd[1] == "submitted") {
                      TopicMasteryRecord.push({
                        credentialId: this.credentialId,
                        date: date,
                        topicId: topicId.toString(),
                        studentId: userId.toString(),
                        activityUnitsAttempted: 1,
                        activityUnitsCorrect: 0,
                        appReportedTimeMinutes: 0,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
      return TopicMasteryRecord;
    } catch (err) {
      console.error({
        Error_Code: "noredink_004",
        Error_Type: "Unable to fetch the Topic Mastry record.",
        Error: err,
      });
    }
  }

  async levelMastery(): Promise<LevelMasteryRecord[]> {
    console.log("> Fetching Level Mastery Record.");
    try {
      if (!this.page) {
        throw new Error("Missing Browser Page.");
      }
      let date = new Date().toISOString();
      date = date.split("T")[0];
      const levelMastery: LevelMasteryRecord[] = [];
      for (const languageCourseIds of this.languageCourseIds) {
        for (const objTopic of this.appTopicsGlobal) {
          if (languageCourseIds == objTopic.courseId) {
            await this.page.goto(
              `${this.baseUrl}teach/courses/${objTopic.courseId}/learning_paths/${objTopic.topicId}`,
              { timeout: 0 }
            );
            let attr = await this.page.$$eval(
              "#teach-learning-paths-show-flags",
              (el: any) => el.map((x: any) => x.getAttribute("data-page"))
            );
            let topicId = objTopic.topicId;
            if (attr && attr.length > 0) {
              const attrData = JSON.parse(attr[0]);
              const students = attrData.students;
              for (const student of students) {
                const topics = student.topics;
                for (const topic of topics) {
                  let questionsAnswered = topic.questionsAnswered;
                  let questionsAnsweredCorrectly =
                    topic.questionsAnsweredCorrectly;
                  let masteryPercentage = topic.completion * 100;
                  if (
                    (questionsAnswered != undefined ||
                      questionsAnswered != 0) &&
                    (questionsAnsweredCorrectly != undefined ||
                      questionsAnsweredCorrectly != 0) &&
                    masteryPercentage != 0
                  ) {
                    levelMastery.push({
                      credentialId: this.credentialId,
                      levelId: topic.id.toString(),
                      masteryPercentage: masteryPercentage,
                      date: date,
                      topicId: topicId,
                      studentId: student.id.toString(),
                      activityUnitsAttempted: questionsAnswered,
                      activityUnitsCorrect: questionsAnsweredCorrectly,
                      appReportedTimeMinutes: 0,
                    });
                  }
                }
              }
            }
          }
        }
      }

      for (const writingCourseId of this.writingCourseIds) {
        await this.page.goto(
          `${this.baseUrl}teach/courses/${writingCourseId}/gradebook`,
          { timeout: 0 }
        );
        let attr: any = await this.page.$$eval(
          "#courses-gradebook-elm-flags",
          (el) => el.map((x: any) => x.getAttribute("data-flags"))
        );
        if (attr && attr.length > 0) {
          const attrData = JSON.parse(attr[0]);
          const tasks: any = attrData.tasks;
          if (tasks && tasks.length > 0) {
            for (const task of tasks) {
              if (task.type == "Quick Write" || task.type == "Guided Draft") {
                const taskResults = task.results;
                if (taskResults && taskResults.length > 0) {
                  for (const taskResult of taskResults) {
                    if (taskResult.completion.tag == "scored") {
                      let scoreValue: number;
                      if (taskResult.completion.score >= 0.5) {
                        scoreValue = 1;
                      } else {
                        scoreValue = 0;
                      }
                      const courseId = task.course_id;
                      const topicId = task.id;
                      const levelId = task.id;
                      const studentId = taskResult.userId;
                      let assignmentData = null;
                      if (task.type == "Quick Write") {
                        await this.page.goto(
                          `${this.baseUrl}teach/courses/${courseId}/quick_writes/${topicId}`,
                          { timeout: 0 }
                        );
                        const quickWritesClass = await this.page.$$eval(
                          "#teach-quick-writes-class-elm-flags",
                          (el: any) =>
                            el.map((x) => x.getAttribute("data-flags"))
                        );
                        if (quickWritesClass && quickWritesClass.length > 0) {
                          assignmentData = JSON.parse(quickWritesClass[0]);
                        }
                      }
                      if (task.type == "Guided Draft") {
                        await this.page.goto(
                          `${this.baseUrl}teach/courses/${courseId}/guided_drafts/${topicId}`,
                          { timeout: 0 }
                        );
                        const coursesGuidedDrafts = await this.page.$$eval(
                          "#teach-courses-guided-drafts-elm-flags",
                          (el: any) =>
                            el.map((x) => x.getAttribute("data-flags"))
                        );
                        if (
                          coursesGuidedDrafts &&
                          coursesGuidedDrafts.length > 0
                        ) {
                          assignmentData = JSON.parse(coursesGuidedDrafts[0]);
                        }
                      }
                      if (assignmentData) {
                        if (
                          assignmentData.students &&
                          assignmentData.students.length > 0 &&
                          assignmentData.statesById &&
                          assignmentData.statesById.length > 0
                        ) {
                          let findStdudent = assignmentData.students.find(
                            ({ id }) => id === studentId
                          );
                          let findStdudentState: string[];
                          for (const ar of assignmentData.statesById) {
                            for (let i = 0; i < ar.length; i++) {
                              if (ar[i] === studentId) {
                                findStdudentState = ar;
                              }
                            }
                          }
                          if (findStdudent && findStdudentState) {
                            if (findStdudentState[1] == "graded") {
                              levelMastery.push({
                                credentialId: this.credentialId,
                                levelId: levelId.toString(),
                                masteryPercentage: findStdudent.grade,
                                date: date,
                                topicId: topicId.toString(),
                                studentId: studentId.toString(),
                                activityUnitsAttempted: 1,
                                activityUnitsCorrect: scoreValue,
                                appReportedTimeMinutes: 0,
                              });
                            }
                            if (findStdudentState[1] == "submitted") {
                              levelMastery.push({
                                credentialId: this.credentialId,
                                levelId: levelId.toString(),
                                masteryPercentage: 0,
                                date: date,
                                topicId: topicId.toString(),
                                studentId: studentId.toString(),
                                activityUnitsAttempted: 1,
                                activityUnitsCorrect: 0,
                                appReportedTimeMinutes: 0,
                              });
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      return levelMastery;
    } catch (err) {
      console.error({
        Error_Code: "noredink_005",
        Error_Type: "Unable to fetch the Level Mastery record.",
        Error: err,
      });
    }
  }

  async destroy() {
    console.log("> Close the browser.");
    try {
      await this.browser.close();
    } catch (err) {
      console.error({
        Error_Code: "noredink_006",
        Error_Type: "Browser Close Error",
        Error: err,
      });
    }
  }
}
