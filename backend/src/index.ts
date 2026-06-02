import { app } from "./app";
import { logger } from "./middleware/logger";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;

app.listen(PORT, () => {
  logger.info(`dim-capture backend listening on port ${PORT}`);
});
