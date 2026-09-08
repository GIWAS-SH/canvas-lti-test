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

lti.setup(LTI_ENCRYPTION_KEY, { url: MONGODB_URI }, {
  appRoute: "/lti/launch",
  loginRoute: "/lti/login",
  keysetRoute: "/lti/keys",
  cookies: { secure: true, sameSite: "None" },
  devMode: false,
  tokenMaxAge: 60
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
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

const MODES = {
  enToZh: { label: "英译中", count: 50, description: "看英文，选择正确的中文释义。" },
  zhToEn: { label: "中译英", count: 50, description: "看中文，选择正确的英文单词。" },
  context: { label: "语境题", count: 20, description: "根据句子语境，选择最合适的单词。" }
};

function makeQuestions(mode) {
  const config = MODES[mode];
  if (!config) throw new Error("未知测试类型：" + mode);

  const selected = shuffle(QUESTION_BANK).slice(0, Math.min(config.count, QUESTION_BANK.length));
  return selected.map((item, index) => {
    const distractors = shuffle(QUESTION_BANK.filter(x => x.id !== item.id)).slice(0, 3);
    let prompt;
    let correct;

    if (mode === "enToZh") {
      prompt = item.word;
      correct = item.meaning;
    } else if (mode === "zhToEn") {
      prompt = item.meaning;
      correct = item.word;
    } else {
      prompt = item.contextBlank || item.contextFull || item.word;
      correct = item.correctAnswer || item.word;
    }

    const options = shuffle([
      correct,
      ...distractors.map(x => mode === "enToZh" ? x.meaning : mode === "zhToEn" ? x.word : (x.correctAnswer || x.word))
    ]);

    return { number: index + 1, id: item.id, mode, prompt, options, correct, item };
  });
}

async function resolveLineItem(idtoken, mode) {
  let lineItemId = idtoken.platformContext?.endpoint?.lineitem;
  console.log("[AGS] endpoint.lineitem:", lineItemId || "不存在");

  if (!lineItemId) {
    const response = await lti.Grade.getLineItems(idtoken, { resourceLinkId: true });
    const lineItems = response.lineItems || [];
    console.log("[AGS] 当前 Resource Link 的 Line Items 数量:", lineItems.length);
    if (lineItems.length > 0) {
      lineItemId = lineItems[0].id;
    } else {
      const config = MODES[mode] || MODES.enToZh;
      const created = await lti.Grade.createLineItem(idtoken, {
        scoreMaximum: 100,
        label: "TOEFL Junior List 1 - " + config.label,
        tag: "toefl-junior-l1-" + mode,
        resourceLinkId: idtoken.platformContext.resource.id
      });
      lineItemId = created.id;
    }
  }

  console.log("[AGS] 最终使用 Line Item:", lineItemId);
  return lineItemId;
}

async function submitCanvasGrade(idtoken, scoreGiven, mode) {
  if (!idtoken) throw new Error("没有取得 Canvas LTI token");
  if (!idtoken.user) throw new Error("LTI token 中没有 Canvas userId");

  const lineItemId = await resolveLineItem(idtoken, mode);
  const result = await lti.Grade.submitScore(idtoken, lineItemId, {
    userId: idtoken.user,
    scoreGiven,
    scoreMaximum: 100,
    activityProgress: "Completed",
    gradingProgress: "FullyGraded"
  });

  console.log("[AGS] Canvas 成绩提交成功:", { userId: idtoken.user, scoreGiven, lineItemId, result });
  return { lineItemId, result };
}

function resultPage(title, message, details = "", ltik = "") {
  const returnUrl = "/quiz" + (ltik ? "?ltik=" + encodeURIComponent(ltik) : "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px;line-height:1.5}a{display:inline-block;margin-top:18px}</style></head><body><h1>${escapeHtml(title)}</h1><div>${message}</div>${details}<p><a href="${returnUrl}">返回测试选择</a></p></body></html>`;
}

function renderModeSelector(ltik) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TOEFL Junior List 1</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:auto;padding:24px;line-height:1.5}.card{border:1px solid #ddd;border-radius:12px;padding:18px;margin:14px 0}button{padding:12px 20px;font-size:16px;cursor:pointer}.muted{color:#666}.notice{background:#fff8df;border:1px solid #e6c85c;padding:12px;border-radius:8px}</style></head><body><h1>TOEFL Junior 词汇练习 · List 1</h1><p class="notice">请选择一种测试。每次测试独立评分，成绩会提交到 Canvas Gradebook。</p>${Object.entries(MODES).map(([mode, config]) => `<div class="card"><h2>${config.label} · ${config.count} 题</h2><p class="muted">${config.description}</p><form method="get" action="/quiz/start"><input type="hidden" name="mode" value="${mode}"><input type="hidden" name="ltik" value="${escapeHtml(ltik)}"><button type="submit">开始${config.label}</button></form></div>`).join("")}</body></html>`;
}

function renderQuiz(ltik, mode, questions) {
  const config = MODES[mode];
  const payload = encodeURIComponent(JSON.stringify(questions));
  const questionHtml = questions.map(q => `<section><b>${q.number}. ${escapeHtml(config.label)}</b><p>${escapeHtml(q.prompt)}</p>${q.options.map(o => `<label style="display:block;padding:8px"><input type="radio" name="q${q.number}" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`).join("")}</section>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(config.label)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px;line-height:1.5}section{border:1px solid #ddd;border-radius:10px;padding:16px;margin:14px 0}button{padding:12px 22px;font-size:16px}.notice{background:#eef6ff;border:1px solid #9cc8f5;padding:12px;border-radius:8px}</style></head><body><h1>TOEFL Junior List 1 · ${escapeHtml(config.label)}</h1><p>${config.count} 题，满分 100 分。</p><p class="notice">${escapeHtml(config.description)}提交前如果有未答题，系统会提示你。</p><form id="quiz"><input type="hidden" name="questions" value="${payload}">${questionHtml}<button type="submit">提交并评分</button></form><script>const form=document.getElementById('quiz');form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const questions=JSON.parse(decodeURIComponent(fd.get('questions')));const answers=questions.map(q=>fd.get('q'+q.number));const unanswered=answers.filter(a=>!a).length;if(unanswered>0){const ok=confirm('还有 '+unanswered+' 道题未作答。\\n\\n确定仍然提交吗？');if(!ok)return;}const r=await fetch('/submit-quiz?ltik=${encodeURIComponent(ltik)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'${mode}',questions,answers})});document.body.innerHTML=await r.text();});</script></body></html>`;
}

lti.app.use(express.json());
lti.app.use(express.urlencoded({ extended: true }));
lti.onUnregisteredPlatform((req, res) => res.status(400).send({ status: 400, error: "UNREGISTERED_PLATFORM" }));
lti.onConnect((token, req, res) => lti.redirect(res, "/quiz"));
lti.app.get("/quiz", (req, res) => res.send(renderModeSelector(res.locals.ltik || req.query.ltik || "")));
lti.app.get("/quiz/start", (req, res) => {
  const mode = req.query.mode;
  res.send(renderQuiz(res.locals.ltik || req.query.ltik, mode, makeQuestions(mode)));
});

lti.app.post("/submit-quiz", async (req, res) => {
  try {
    const idtoken = res.locals.token;
    const { mode, questions, answers } = req.body || {};
    if (!MODES[mode]) throw new Error("没有收到有效的测试类型");
    if (!Array.isArray(questions) || !Array.isArray(answers) || questions.length === 0) throw new Error("没有收到有效的题目或答案");

    const correctCount = questions.reduce((n, q, i) => n + (answers[i] === q.correct ? 1 : 0), 0);
    const percent = Math.round(correctCount / questions.length * 100);
    console.log("[QUIZ]", MODES[mode].label, correctCount + "/" + questions.length, "=", percent);
    const submitted = await submitCanvasGrade(idtoken, percent, mode);

    const feedback = questions.map((q, i) => {
      const right = answers[i] === q.correct;
      return `<div style="border:1px solid ${right ? '#9c9' : '#e99'};background:${right ? '#f5fff5' : '#fff5f5'};border-radius:8px;padding:12px;margin:10px 0"><b>${q.number}. ${escapeHtml(q.prompt)}</b><p>你的答案：${escapeHtml(answers[i] || "未作答")}</p><p>正确答案：${escapeHtml(q.correct)}</p><p>中文释义：${escapeHtml(q.item.meaning)}</p>${q.item.contextFull ? `<p>完整句：${escapeHtml(q.item.contextFull)}</p>` : ""}</div>`;
    }).join("");

    res.send(resultPage("测试完成", `<h2>${escapeHtml(MODES[mode].label)}：${percent} / 100</h2><p style="color:green"><strong>成绩已成功提交到 Canvas Gradebook。</strong></p><p>Line Item：${escapeHtml(submitted.lineItemId)}</p><h2>答题反馈</h2>${feedback}`, "", res.locals.ltik || req.query.ltik || ""));
  } catch (error) {
    console.error("[AGS] 正式提交失败:", error);
    res.status(500).send(resultPage("提交失败", "成绩没有成功提交到 Canvas。", `<pre>${escapeHtml(error.stack || error.message)}</pre>`, res.locals.ltik || req.query.ltik || ""));
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
      authConfig: { method: "JWK_SET", key: "https://sso.canvaslms.com/api/lti/security/jwks" }
    });
    console.log("Canvas platform registered successfully.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
start();
