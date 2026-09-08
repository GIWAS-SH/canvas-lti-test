const lti = require("ltijs").Provider;

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

lti.setup(
  "canvas-lti-test-secret-key-2026",
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

lti.onConnect((token, req, res) => {
  return res.send(`
    <html>
      <head>
        <title>Canvas LTI Test</title>
      </head>
      <body>
        <h1>Canvas LTI Test</h1>
        <p>LTI 1.3 launch successful!</p>
        <p>Hello, ${token.userInfo?.name || "Student"}!</p>
      </body>
    </html>
  `);
});

const start = async () => {
  try {
    // 1. Start LTI provider and connect to MongoDB
    await lti.deploy({
      serverless: false,
      port: PORT
    });

    // 2. Register Wisdom House Academy Canvas
    await lti.registerPlatform({
      url: "https://canvas.instructure.com",
      name: "Wisdom House Academy Canvas",
      clientId: "22382000000000006",
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
