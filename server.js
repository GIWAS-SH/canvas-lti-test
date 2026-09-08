const lti = require("ltijs").Provider;

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// LTI setup
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

// When Canvas launches the tool
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

// Start LTI provider
const start = async () => {
  try {
    await lti.deploy({
      serverless: false,
      port: PORT
    });

    console.log("LTI provider started successfully.");
  } catch (error) {
    console.error("LTI provider failed to start:", error);
    process.exit(1);
  }
};

start();
