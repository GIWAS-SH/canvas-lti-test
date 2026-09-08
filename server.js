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
    devMode: false
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
  return res.send(`
    <html>
      <head>
        <title>Canvas LTI Test</title>
      </head>
      <body>
        <h1>Canvas LTI Test</h1>
        <h2>LTI 1.3 launch successful!</h2>
        <p>Hello, ${token.userInfo?.name || "Student"}!</p>
      </body>
    </html>
  `);
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
