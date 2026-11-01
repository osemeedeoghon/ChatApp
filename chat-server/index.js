const { loadConfig } = require("./src/config");
const { createChatServer } = require("./src/server");

const config = loadConfig();
const { httpServer } = createChatServer(config);

httpServer.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});
