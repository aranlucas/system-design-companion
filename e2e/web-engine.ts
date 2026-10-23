import { surfaceOf, web } from "@e2e-dev/web";
import { requiredValue } from "../src/shared/required-value.ts";

export const engine = web({ viewport: { width: 1280, height: 800 } });

export const live = requiredValue(surfaceOf(engine), "web engine surface");
