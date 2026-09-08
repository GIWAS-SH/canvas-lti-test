const lti = require("ltijs").Provider;
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const LTI_ENCRYPTION_KEY = process.env.LTI_ENCRYPTION_KEY || "canvas-lti-test-secret-key-2026";

const QUESTION_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "question_bank.json"), "utf8"));
const QUESTION_BANK = Array.isArray(QUESTION_DATA) ? QUESTION_DATA : QUESTION_DATA.words;
if (!Array.isArray(QUESTION_BANK) || QUESTION_BANK.length === 0) {
  throw new Error("question_bank.json 中没有找到有效的 words 题库数组");
}

lti.setup(LTI_ENCRYPTION_KEY, {
  url: MONGODB_URI
}, {
  appRoute: "/lti/launch",
  loginRoute: "/lti/login",
  keysetRoute: "/lti/keys",
  cookies: { secure: true, sameSite: "None" },
  devMode: false,
  tokenMaxAge: 60
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeQuestions() {
  const selected = shuffle(QUESTION_BANK).slice(0, Math.min(50, QUESTION_BANK.length));
  return selected.map((item, index) => {
    const type = ["enToZh", "zhToEn", "context"][index % 3];
    const distractors = shuffle(QUESTION_BANK.filter(x => x.id !== item.id)).slice(0, 3);
    let prompt;
    let correct;

    if (type === "enToZh") {
      prompt = item.word;
      correct = item.meaning;
    } else if (type === "zhToEn") {
      prompt = item.meaning;
      correct = item.word;
    } else {
      prompt = item.contextBlank || item.contextFull || item.word;
      correct = item.correctAnswer || item.word;
    }

    const options = shuffle([
      correct,
      ...distractors.map(x =>
        type === "enToZh"
          ? x.meaning
          : type === "zhToEn"
            ? x.word
            : (x.correctAnswer || x.word)
      )
    ]);

    return {
      number: index + 1,
      id: item.id,
      type,
      prompt,
      options,
      correct,
      item
    };
  });
}

async function resolveLineItem(idtoken) {
  let lineItemId = idtoken.platformContext?.endpoint?.lineitem;
  console.log("[AGS] endpoint.lineitem:", lineItemId || "不存在");

  if (!lineItemId) {
    console.log("[AGS] 正在查询当前 Resource Link 的 Line Item...");
    const response = await lti.Grade.getLineItems(idtoken, { resourceLinkId: true });
    const lineItems = response.lineItems || [];
    console.log("[AGS] 查询到 Line Items 数量:", lineItems.length);

    if (lineItems.length > 0) {
      lineItemId = lineItems[0].id;
      console.log("[AGS] 使用已有 Line Item:", lineItemId);
    } else {
      console.log("[AGS] 没有找到 Line Item，正在创建...");
      const created = await lti.Grade.createLineItem(idtoken, {
        scoreMaximum: 100,
        label: "TOEFL Junior List 1",
        tag: "toefl-junior-l1",
        resourceLinkId: idtoken.platformContext.resource.id
      });
      lineItemId = created.id;
      console.log("[AGS] 创建成功，Line Item:", lineItemId);
    }
  }

  return lineItemId;
}

async function submitCanvasGrade(idtoken, scoreGiven, label) {
  if (!idtoken) throw new Error("没有取得 Canvas LTI token");
  if (!idtoken.user) throw new Error("LTI token 中没有 Canvas userId");

  console.log("[AGS] 开始提交成绩");
  console.log("[AGS] userId:", idtoken.user);
  console.log("[AGS] scoreGiven:", scoreGiven);
  console.log("[AGS] scoreMaximum: 100");

  const lineItemId = await resolveLineItem(idtoken);
  console.log("[AGS] 最终使用 Line Item:", lineItemId);

  const result = await lti.Grade.submitScore(idtoken, lineItemId, {
    userId: idtoken.user,
    scoreGiven,
    scoreMaximum: 100,
    activityProgress: "Completed",
    gradingProgress: "FullyGraded"
  });

  console.log("[AGS] Canvas 成绩提交成功:", result);
  return { lineItemId, result, label };
}

function renderQuiz(ltik, questions) {
  const payload = encodeURIComponent(JSON.stringify(questions));
  const questionHtml = questions.map(q => `
    <section>
      <b>${q.number}. ${q.type === "enToZh" ? "英译中" : q.type === "zhToEn" ? "中译英" : "语境题"}</b>
      <p>${escapeHtml(q.prompt)}</p>
      ${q.options.map((o, i) => `
        <label>
          <input type="radio" name="q${q.number}" value="${escapeHtml(o)}">
          ${escapeHtml(o)}
        </label>
      `).join("")}
    </section>
  `).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TOEFL Junior List 1</title>
<style>
body{font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px;line-height:1.5}
section{border:1px solid #ddd;border-radius:10px;padding:16px;margin:14px 0}
label{display:block;padding:8px;border-radius:6px}
button{padding:12px 22px;font-size:16px;margin:8px 8px 8px 0}
.notice{background:#fff8df;border:1px solid #e6c85c;padding:12px;border-radius:8px}
</style></head><body>
<h1>TOEFL Junior 词汇练习 · List 1</h1>
<p>共 ${questions.length} 题。每题 2 分，满分 100 分。</p>
<p class="notice">可以先完成答题，也可以点击下面的测试按钮，直接测试 Canvas 成绩提交功能。</p>
<form method="post" action="/grade-test?ltik=${encodeURIComponent(ltik)}">
  <button type="submit">不做题，测试 Canvas 成绩提交（80/100）</button>
</form>
<form id="quiz">
<input type="hidden" name="questions" value="${payload}">
${questionHtml}
<button type="submit">提交并评分</button>
</form>
<script>
const form = document.getElementById('quiz');
form.addEventListener('submit', async e => {
  e.preventDefault();

  const fd = new FormData(form);
  const questions = JSON.parse(decodeURIComponent(fd.get('questions')));
  const answers = questions.map(q => fd.get('q' + q.number));
  const unanswered = answers.filter(a => !a).length;

  if (unanswered > 0) {
    const ok = confirm(
      '还有 ' + unanswered + ' 道题未作答。\\n\\n确定仍然提交吗？'
    );
    if (!ok) return;
  }

  const r = await fetch('/submit-quiz?ltik=${encodeURIComponent(ltik)}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions, answers })
  });

  document.body.innerHTML = await r.text();
});
</script>
</body></html>`;
}

function resultPage(title, message, details = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px;line-height:1.5"><h1>${escapeHtml(title)}</h1><p>${message}</p>${details}<p><a href="/quiz">返回练习</a></p></body></html>`;
}

lti.app.use(express.json());
lti.app.use(express.urlencoded({ extended: true }));
lti.onUnregisteredPlatform((req, res) => res.status(400).send({ status: 400, error: "UNREGISTERED_PLATFORM" }));
lti.onConnect((token, req, res) => lti.redirect(res, "/quiz"));
lti.app.get("/quiz", (req, res) => res.send(renderQuiz(res.locals.ltik, makeQuestions())));

lti.app.post("/grade-test", async (req, res) => {
  try {
    const idtoken = res.locals.token;
    const submitted = await submitCanvasGrade(idtoken, 80, "AGS 独立测试");
    res.send(resultPage(
      "Canvas 成绩测试完成",
      `<strong>已成功向 Canvas 提交 80 / 100。</strong><br>Line Item：${escapeHtml(submitted.lineItemId)}`,
      "<p>请现在打开 Canvas 的成绩簿，检查该活动是否出现 80 分。</p>"
    ));
  } catch (error) {
    console.error("[AGS] 独立测试失败:", error);
    res.status(500).send(resultPage(
      "Canvas 成绩测试失败",
      "没有成功提交成绩。请把 Render 日志中以 [AGS] 开头的内容发给我。",
      `<pre>${escapeHtml(error.stack || error.message)}</pre>`
    ));
  }
});

lti.app.post("/submit-quiz", async (req, res) => {
  try {
    const idtoken = res.locals.token;
    const { questions, answers } = req.body || {};

    if (!Array.isArray(questions) || !Array.isArray(answers)) {
      throw new Error("服务器没有收到有效的 questions 或 answers。请确认 express.json() 已启用。");
    }
    if (questions.length === 0) throw new Error("题目数量为 0。");

    const score = questions.reduce((n, q, i) => n + (answers[i] === q.correct ? 1 : 0), 0);
    const percent = Math.round(score / questions.length * 100);
    console.log("[QUIZ] 答题结果:", score + "/" + questions.length, "=", percent);

    const submitted = await submitCanvasGrade(idtoken, percent, "TOEFL Junior List 1");
    const rows = questions.map((q, i) => ({ q, a: answers[i] }));
    const wrong = rows.filter(x => x.a !== x.q.correct);

    const feedback = rows.map(x => {
      const isWrong = x.a !== x.q.correct;
      return `<div style="border:1px solid ${isWrong ? '#e99' : '#9c9'};border-radius:8px;padding:12px;margin:10px 0;background:${isWrong ? '#fff5f5' : '#f5fff5'}"><b>${x.q.number}. ${escapeHtml(x.q.prompt)}</b><p>你的答案：${escapeHtml(x.a || "未作答")}</p><p>正确答案：${escapeHtml(x.q.correct)}</p><p>中文释义：${escapeHtml(x.q.item.meaning)}</p>${x.q.item.contextFull ? `<p>完整句：${escapeHtml(x.q.item.contextFull)}</p>` : ""}<p>${escapeHtml(x.q.item.explanation || "")}</p></div>`;
    }).join("");

    res.send(resultPage(
      "练习完成",
      `<h2>得分：${percent} / 100</h2><p style="color:green"><strong>成绩已成功提交到 Canvas Gradebook。</strong></p><p>Line Item：${escapeHtml(submitted.lineItemId)}</p><h2>答题反馈（${wrong.length} 道错题）</h2>${feedback}`
    ));
  } catch (error) {
    console.error("[AGS] 正式提交失败:", error);
    res.status(500).send(resultPage(
      "提交失败",
      "成绩没有成功提交到 Canvas。请把 Render 日志中以 [AGS] 开头的内容发给我。",
      `<pre>${escapeHtml(error.stack || error.message)}</pre>`
    ));
  }
});

const start = async () => {
  try {
    await lti.deploy({ serverless: false, port: PORT });
    await lti.registerPlatform({
      url: "https://canvas.instructure.com",
      name: "Wisdom House Academy Canvas",
      clientId: "223820000000000006",
      authenticationEndpoint: "https://sso.canvaslms.com/api/lti/authorize_redirect",
      accesstokenEndpoint: "https://sso.canvaslms.com/login/oauth2/token",
      authConfig: {
        method: "JWK_SET",
        key: "https://sso.canvaslms.com/api/lti/security/jwks"
      }
    });
    console.log("Canvas platform registered successfully.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
start();
