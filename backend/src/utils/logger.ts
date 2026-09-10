import pino from "pino";
import { config } from "../config.js";

export const log = pino({
  level: config.logLevel,
  base: { service: "oc-controller" },
});
