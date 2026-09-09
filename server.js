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

function makeQuestions(mode, listNumber) {
  const config = MODES[mode];
  if (!config) throw new Error("未知测试类型：" + mode);

  const listQuestions = QUESTION_BANK.filter(
  item => Number(item.list) === Number(listNumber)
);

if (listQuestions.length === 0) {
  throw new Error("没有找到 List " + listNumber + " 的题目。");
}

const selected = shuffle(listQuestions).slice(
  0,
  Math.min(config.count, listQuestions.length)
);
  return selected.map((item, index) => {
    const distractors = shuffle(
  listQuestions.filter(x => x.id !== item.id)
).slice(0, 3);
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

async function resolveLineItem(idtoken, mode, listNumber) {
  const config = MODES[mode];

  if (!config) {
    throw new Error("未知测试类型：" + mode);
  }

  if (!listNumber) {
    throw new Error("没有收到有效的 List 编号");
  }

  const expectedLabel = `TOEFL Junior List ${listNumber} - ${config.label}`;

  console.log("[AGS] 查找成绩项目:", {
    mode,
    listNumber,
    label: config.label,
    expectedLabel
  });

  const response = await lti.Grade.getLineItems(idtoken, {
    resourceLinkId: true
  });

  const lineItems = response.lineItems || [];

  console.log(
    "[AGS] 当前 Resource Link 的 Line Items:",
    lineItems.map(x => ({
      id: x.id,
      label: x.label,
      tag: x.tag,
      scoreMaximum: x.scoreMaximum
    }))
  );

  // 优先寻找当前 Assignment 对应的成绩项目
  let lineItem = lineItems.find(
    x => x.label === expectedLabel
  );

  // 如果当前 Resource Link 已经有成绩项目，但名称不完全一致，
  // 且只有一个项目，则直接使用它，避免误创建成绩项目。
  if (!lineItem && lineItems.length === 1) {
    lineItem = lineItems[0];

    console.log("[AGS] 当前 Resource Link 只有一个成绩项目，直接使用:", {
      id: lineItem.id,
      label: lineItem.label
    });
  }

  // 只有当前 Resource Link 完全没有成绩项目时，才创建新的项目
  if (!lineItem) {
    const tag = `toefl-junior-l${listNumber}-${mode}`;

    lineItem = await lti.Grade.createLineItem(idtoken, {
      scoreMaximum: 100,
      label: expectedLabel,
      tag,
      resourceLinkId: idtoken.platformContext.resource.id
    });

    console.log("[AGS] 已创建独立成绩项目:", lineItem);
  }

  console.log("[AGS] 最终使用 Line Item:", {
    id: lineItem.id,
    label: lineItem.label,
    tag: lineItem.tag,
    scoreMaximum: lineItem.scoreMaximum
  });

  return lineItem.id;
}

async function submitCanvasGrade(idtoken, scoreGiven, mode, listNumber) {
  if (!idtoken) {
    throw new Error("没有取得 Canvas LTI token");
  }

  if (!idtoken.user) {
    throw new Error("LTI token 中没有 Canvas userId");
  }

  const lineItemId = await resolveLineItem(
    idtoken,
    mode,
    listNumber
  );

  const result = await lti.Grade.submitScore(idtoken, lineItemId, {
    userId: idtoken.user,
    scoreGiven,
    scoreMaximum: 100,
    activityProgress: "Completed",
    gradingProgress: "FullyGraded"
  });

  console.log("[AGS] Canvas 成绩提交成功:", {
    userId: idtoken.user,
    scoreGiven,
    lineItemId,
    result
  });

  return {
    lineItemId,
    result
  };
}

function detectMode(idtoken, req) {
  const text = [
    idtoken?.platformContext?.resource?.title,
    idtoken?.platformContext?.resource?.description,
    req?.query?.assignment_name,
    req?.query?.title
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("中译英") || text.includes("中文到英文") || text.includes("zh-to-en")) return "zhToEn";
  if (text.includes("语境") || text.includes("context")) return "context";
  if (text.includes("英译中") || text.includes("英文到中文") || text.includes("en-to-zh")) return "enToZh";
  return null;
}

function detectListNumber(idtoken, req) {
  const text = [
    idtoken?.platformContext?.resource?.title,
    idtoken?.platformContext?.resource?.description,
    req?.query?.assignment_name,
    req?.query?.title
  ].filter(Boolean).join(" ");

  const match = text.match(/List\s*(\d+)/i);

  if (!match) {
    throw new Error("无法识别当前 Assignment 的 List 编号：" + text);
  }

  return Number(match[1]);
}

function renderQuiz(ltik, mode, questions) {
  const config = MODES[mode];
  const payload = encodeURIComponent(JSON.stringify(questions));
  const questionHtml = questions.map(q => `<section><b>${q.number}. ${escapeHtml(config.label)}</b><p>${escapeHtml(q.prompt)}</p>${q.options.map(o => `<label style="display:block;padding:8px"><input type="radio" name="q${q.number}" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`).join("")}</section>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(config.label)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px;line-height:1.5}section{border:1px solid #ddd;border-radius:10px;padding:16px;margin:14px 0}button{padding:12px 22px;font-size:16px}.submit-bar{position:sticky;bottom:12px;background:#fff;border:1px solid #ccc;border-radius:10px;padding:12px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.12);z-index:10}.submit-bar button{width:min(100%,360px);font-weight:bold}.notice{background:#eef6ff;border:1px solid #9cc8f5;padding:12px;border-radius:8px}</style></head><body><h1>TOEFL Junior List 1 · ${questions[0]?.item?.list || ""} · ${escapeHtml(config.label)}</h1><p>${config.count} 题，满分 100 分。</p><p class="notice">${escapeHtml(config.description)}提交前如果有未答题，系统会提示你。</p><form id="quiz"><input type="hidden" name="questions" value="${payload}">${questionHtml}<div class="submit-bar"><button type="submit">提交并评分</button></div></form><script>const form=document.getElementById('quiz');form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const questions=JSON.parse(decodeURIComponent(fd.get('questions')));const answers=questions.map(q=>fd.get('q'+q.number));const unanswered=answers.filter(a=>!a).length;if(unanswered>0){const ok=confirm('还有 '+unanswered+' 道题未作答。\\n\\n确定仍然提交吗？');if(!ok)return;}const r=await fetch('/submit-quiz?ltik=${encodeURIComponent(ltik)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'${mode}',questions,answers})});document.body.innerHTML=await r.text();});</script></body></html>`;
}

lti.app.use((req, res, next) => {
  console.log("[HTTP REQUEST]", {
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    contentType: req.headers["content-type"],
    referer: req.headers.referer || ""
  });
  next();
});

lti.app.use(express.json());
lti.app.use(express.urlencoded({ extended: true }));
lti.onUnregisteredPlatform((req, res) => res.status(400).send({ status: 400, error: "UNREGISTERED_PLATFORM" }));
lti.onConnect((token, req, res) => lti.redirect(res, "/quiz"));
lti.app.get("/quiz", (req, res) => {
  const idtoken = res.locals.token;

  const mode = detectMode(idtoken, req);
  const listNumber = detectListNumber(idtoken, req);

  if (!mode) {
    return res.status(400).send(
      "无法识别当前 Canvas 作业对应的测试类型。请检查作业名称是否包含：英译中、中译英或语境题。"
    );
  }

  console.log("[QUIZ] 当前 List:", listNumber, "测试类型:", mode);

  res.send(
    renderQuiz(
      res.locals.ltik || req.query.ltik || "",
      mode,
      makeQuestions(mode, listNumber)
    )
  );
});
lti.app.get("/quiz/start", (req, res) => res.redirect("/quiz"));

lti.app.post("/submit-quiz", async (req, res) => {
  try {
    const idtoken = res.locals.token;
    const { mode, questions, answers } = req.body || {};
    if (!MODES[mode]) throw new Error("没有收到有效的测试类型");
    if (!Array.isArray(questions) || !Array.isArray(answers) || questions.length === 0) throw new Error("没有收到有效的题目或答案");

    const correctCount = questions.reduce((n, q, i) => n + (answers[i] === q.correct ? 1 : 0), 0);
    const percent = Math.round(correctCount / questions.length * 100);
    console.log("[QUIZ]", MODES[mode].label, correctCount + "/" + questions.length, "=", percent);
    const listNumber = Number(questions[0]?.item?.list);

if (!listNumber) {
  throw new Error("无法从题目中识别 List 编号");
}

const submitted = await submitCanvasGrade(
  idtoken,
  percent,
  mode,
  listNumber
);

    const feedback = questions.map((q, i) => {
      const right = answers[i] === q.correct;
      return `<div style="border:1px solid ${right ? '#9c9' : '#e99'};background:${right ? '#f5fff5' : '#fff5f5'};border-radius:8px;padding:12px;margin:10px 0"><b>${q.number}. ${escapeHtml(q.prompt)}</b><p>你的答案：${escapeHtml(answers[i] || "未作答")}</p><p>正确答案：${escapeHtml(q.correct)}</p><p>中文释义：${escapeHtml(q.item.meaning)}</p>${q.item.contextFull ? `<p>完整句：${escapeHtml(q.item.contextFull)}</p>` : ""}</div>`;
    }).join("");

    res.send(resultPage("测试完成", `<h2>${escapeHtml(MODES[mode].label)}：${percent} / 100</h2><p style="color:green"><strong>成绩已成功提交到 Canvas Gradebook。</strong></p><h2>答题反馈</h2>${feedback}`, "", res.locals.ltik || req.query.ltik || ""));
  } catch (error) {
    console.error("[AGS] 正式提交失败");
    console.error("[AGS] 状态码:", error.response?.statusCode);
    console.error("[AGS] Canvas 返回正文:", error.response?.body);
    console.error("[AGS] Canvas 返回头:", error.response?.headers);
    console.error("[AGS] 错误信息:", error.message);

    res.status(500).send(`
  <html>
    <head>
      <meta charset="UTF-8">
      <title>提交失败</title>
    </head>
    <body style="font-family: Arial, sans-serif; padding: 30px;">
      <h2>成绩提交失败</h2>
      <p>服务器处理成绩时发生错误，请稍后重试。</p>
      <p>错误信息：${escapeHtml(error.stack || error.message)}</p>
    </body>
  </html>
`);
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
