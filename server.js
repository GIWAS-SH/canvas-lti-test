const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Canvas LTI Test</title>
      </head>
      <body>
        <h1>Canvas LTI Test</h1>
        <p>The test server is running successfully.</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
