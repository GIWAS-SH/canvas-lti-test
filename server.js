const lti = require("ltijs").Provider;

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const LTI_ENCRYPTION_KEY =
  process.env.LTI_ENCRYPTION_KEY || "canvas-lti-test-secret-key-2026";

lti.setup(
  LTI_ENCRYPTION_KEY,
  {
    url: MONGODB_URI
  },
  {
    appRoute: "/lti/launch",
    loginRoute: "/lti/login",
    keysetRoute: "/lti/keys",
    cookies: {
      secure: true,
      sameSite: "None"
    },
    devMode: false,
    tokenMaxAge: 60
  }
);

// 普通 LTI Launch
lti.onUnregisteredPlatform((req, res) => {
  console.log("=== UNREGISTERED PLATFORM DEBUG ===");

  console.log("METHOD:", req.method);
  console.log("URL:", req.originalUrl);
  console.log("BODY:", JSON.stringify(req.body));
  console.log("QUERY:", JSON.stringify(req.query));

  console.log("ISS:", req.body?.iss || req.query?.iss);
  console.log("CLIENT_ID:", req.body?.client_id || req.query?.client_id);
  console.log("DEPLOYMENT_ID:", req.body?.deployment_id || req.query?.deployment_id);

  return res.status(400).send({
    status: 400,
    error: "Bad Request",
    details: {
      message: "UNREGISTERED_PLATFORM"
    }
  });
});
lti.onConnect((token, req, res) => {
  return lti.redirect(res, "/grade-test");
});
// Gradebook test page
lti.app.get("/grade-test", async (req, res) => {
  const ltik = res.locals.ltik;

  return res.send(`
    <html>
      <head>
        <title>Canvas Gradebook Test</title>
      </head>
      <body style="font-family: Arial, sans-serif; padding: 40px;">
        <h1>Canvas Gradebook Test</h1>

        <p>LTI 1.3 launch successful!</p>

        <p>
          This test will send a score of <strong>80/100</strong>
          to the Canvas Gradebook.
        </p>

        <form method="POST" action="/grade-test?ltik=${encodeURIComponent(ltik)}">
          <button
            type="submit"
            style="padding: 12px 24px; font-size: 16px;"
          >
            Submit 80/100 to Canvas
          </button>
        </form>
      </body>
    </html>
  `);
});


// Send test grade to Canvas
lti.app.post("/grade-test", async (req, res) => {
  try {
    const idtoken = res.locals.token;

    console.log("=== GRADE TEST ===");
    console.log("User ID:", idtoken.user);
    console.log("Platform:", idtoken.iss);
    console.log(
      "Line Item:",
      idtoken.platformContext?.endpoint?.lineitem
    );

    let lineItemId =
      idtoken.platformContext?.endpoint?.lineitem;

    // If Canvas did not provide a line item,
    // find the line item associated with this resource.
    if (!lineItemId) {
      const response = await lti.Grade.getLineItems(
        idtoken,
        { resourceLinkId: true }
      );

      const lineItems = response.lineItems || [];

      if (lineItems.length === 0) {
        console.log("No line item found. Creating one.");

        const newLineItem = {
          scoreMaximum: 100,
          label: "LTI Grade Test",
          tag: "grade-test",
          resourceLinkId: idtoken.platformContext.resource.id
        };

        const lineItem =
          await lti.Grade.createLineItem(
            idtoken,
            newLineItem
          );

        lineItemId = lineItem.id;
      } else {
        lineItemId = lineItems[0].id;
      }
    }

    // Send 80/100 to Canvas
    const gradeObj = {
      userId: idtoken.user,
      scoreGiven: 80,
      scoreMaximum: 100,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded"
    };

    console.log("Sending grade:", gradeObj);
    console.log("Line Item ID:", lineItemId);

    const result = await lti.Grade.submitScore(
      idtoken,
      lineItemId,
      gradeObj
    );

    console.log("Grade submitted successfully:", result);

    return res.send(`
      <html>
        <head>
          <title>Grade Submitted</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Grade Submitted Successfully!</h1>

          <p>
            Score sent to Canvas:
            <strong>80 / 100</strong>
          </p>

          <p>
            Please return to Canvas and check the Gradebook.
          </p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error("=== GRADE SUBMISSION ERROR ===");
    console.error(error);

    return res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Grade Submission Failed</h1>
          <pre>${error.message}</pre>
        </body>
      </html>
    `);
  }
});

// LTI Deep Linking
lti.onDeepLinking((token, req, res) => {
  console.log("Deep Linking request received.");
  console.log("User:", token.userInfo?.name || "Unknown");

  return res.send(`
    <html>
      <head>
        <title>Canvas LTI Deep Linking Test</title>
      </head>
      <body>
        <h1>LTI Deep Linking is working!</h1>
        <p>Hello, ${token.userInfo?.name || "Student"}!</p>
        <p>Canvas successfully sent a Deep Linking request to our LTI tool.</p>
      </body>
    </html>
  `);
});

const start = async () => {
  try {
    await lti.deploy({
      serverless: false,
      port: PORT
    });

    await lti.registerPlatform({
      url: "https://canvas.instructure.com",
      name: "Wisdom House Academy Canvas",
      clientId: "223820000000000006",
      authenticationEndpoint:
        "https://sso.canvaslms.com/api/lti/authorize_redirect",
      accesstokenEndpoint:
        "https://sso.canvaslms.com/login/oauth2/token",
      authConfig: {
        method: "JWK_SET",
        key:
          "https://sso.canvaslms.com/api/lti/security/jwks"
      }
    });

    console.log("Canvas platform registered successfully.");
  } catch (error) {
    console.error("LTI provider failed to start:", error);
    process.exit(1);
  }
};

start();
