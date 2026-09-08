const lti = require("ltijs").Provider;
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const LTI_ENCRYPTION_KEY = process.env.LTI_ENCRYPTION_KEY || "canvas-lti-test-secret-key-2026";
const QUESTION_BANK = JSON.parse(fs.readFileSync(path.join(__dirname, "question_bank.json"), "utf8"));

lti.setup(LTI_ENCRYPTION_KEY, { url: MONGODB_URI }, {
  appRoute: "/lti/launch", loginRoute: "/lti/login", keysetRoute: "/lti/keys",
  cookies: { secure: true, sameSite: "None" }, devMode: false, tokenMaxAge: 60
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#39;"}[c]));
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
    let prompt, correct;
    if (type === "enToZh") { prompt = item.word; correct = item.meaning; }
    else if (type === "zhToEn") { prompt = item.meaning; correct = item.word; }
    else { prompt = item.contextBlank; correct = item.correctAnswer || item.word; }
    const options = shuffle([correct, ...distractors.map(x => type === "enToZh" ? x.meaning : type === "zhToEn" ? x.word : (x.correctAnswer || x.word))]);
    return { number: index + 1, id: item.id, type, prompt, options, correct, item };
  });
}
function renderQuiz(ltik, questions) {
  const payload = encodeURIComponent(JSON.stringify(questions));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TOEFL Junior List 1</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px;line-height:1.5}section{border:1px solid #ddd;border-radius:10px;padding:16px;margin:14px 0}label{display:block;padding:8px;border-radius:6px}button{padding:12px 22px;font-size:16px}small{color:#666}</style></head><body><h1>TOEFL Junior 词汇练习 · List 1</h1><p>共 ${questions.length} 题。每题 2 分，满分 100 分。</p><form id="quiz"><input type="hidden" name="questions" value="${payload}">${questions.map(q => `<section><b>${q.number}. ${q.type === "enToZh" ? "英译中" : q.type === "zhToEn" ? "中译英" : "语境题"}</b><p>${escapeHtml(q.prompt)}</p>${q.options.map((o,i)=>`<label><input required type="radio" name="q${q.number}" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`).join("")}</section>`).join("")}<button type="submit">提交并评分</button></form><div id="result"></div><script>const form=document.getElementById('quiz');form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const questions=JSON.parse(decodeURIComponent(fd.get('questions')));const answers=questions.map(q=>fd.get('q'+q.number));const r=await fetch('/submit-quiz?ltik=${encodeURIComponent(ltik)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions,answers})});document.body.innerHTML=await r.text();});</script></body></html>`;
}

lti.onUnregisteredPlatform((req,res)=>res.status(400).send({status:400,error:"UNREGISTERED_PLATFORM"}));
lti.onConnect((token, req, res)=>lti.redirect(res, "/quiz"));
lti.app.get("/quiz", (req,res)=>res.send(renderQuiz(res.locals.ltik, makeQuestions())));

lti.app.post("/submit-quiz", async (req,res)=>{
  try {
    const idtoken = res.locals.token;
    const { questions, answers } = req.body || {};
    const score = questions.reduce((n,q,i)=>n + (answers[i] === q.correct ? 1 : 0), 0);
    const percent = Math.round(score / questions.length * 100);
    let lineItemId = idtoken.platformContext?.endpoint?.lineitem;
    if (!lineItemId) {
      const response = await lti.Grade.getLineItems(idtoken, { resourceLinkId: true });
      const lineItems = response.lineItems || [];
      if (lineItems.length) lineItemId = lineItems[0].id;
      else lineItemId = (await lti.Grade.createLineItem(idtoken, { scoreMaximum:100, label:"TOEFL Junior List 1", tag:"toefl-junior-l1", resourceLinkId:idtoken.platformContext.resource.id })).id;
    }
    await lti.Grade.submitScore(idtoken, lineItemId, { userId:idtoken.user, scoreGiven:percent, scoreMaximum:100, activityProgress:"Completed", gradingProgress:"FullyGraded" });
    const wrong = questions.map((q,i)=>({q,a:answers[i]})).filter(x=>x.a !== x.q.correct);
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>练习结果</title></head><body style="font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:24px"><h1>练习完成</h1><h2>得分：${percent} / 100</h2><p>成绩已提交到 Canvas Gradebook。</p>${wrong.length ? `<h2>错题反馈</h2>${wrong.map(x=>`<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0"><b>${x.q.number}. ${escapeHtml(x.q.prompt)}</b><p>你的答案：${escapeHtml(x.a || "未作答")}</p><p>正确答案：${escapeHtml(x.q.correct)}</p><p>中文释义：${escapeHtml(x.q.item.meaning)}</p>${x.q.item.contextFull ? `<p>完整句：${escapeHtml(x.q.item.contextFull)}</p>` : ""}<p>${escapeHtml(x.q.item.explanation || "")}</p></div>`).join("")}` : "<p>全部答对，太棒了！</p>"}</body></html>`);
  } catch (error) { console.error(error); res.status(500).send(`<h1>提交失败</h1><pre>${escapeHtml(error.message)}</pre>`); }
});

const start = async()=>{try{await lti.deploy({serverless:false,port:PORT});await lti.registerPlatform({url:"https://canvas.instructure.com",name:"Wisdom House Academy Canvas",clientId:"223820000000000006",authenticationEndpoint:"https://sso.canvaslms.com/api/lti/authorize_redirect",accesstokenEndpoint:"https://sso.canvaslms.com/login/oauth2/token",authConfig:{method:"JWK_SET",key:"https://sso.canvaslms.com/api/lti/security/jwks"}});console.log("Canvas platform registered successfully.");}catch(e){console.error(e);process.exit(1);}};start();
