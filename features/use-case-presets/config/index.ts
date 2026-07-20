import { archivePreset } from "./archive-preset";
import { emailPreset } from "./email-preset";
import { presentationPreset } from "./presentation-preset";
import { printPreset } from "./print-preset";
import { smartphonePreset } from "./smartphone-preset";
import { socialPreset } from "./social-preset";
import { webPreset } from "./web-preset";

export const USE_CASE_PRESETS = [
  webPreset,
  emailPreset,
  socialPreset,
  smartphonePreset,
  printPreset,
  archivePreset,
  presentationPreset,
] as const;
