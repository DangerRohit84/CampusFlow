// resume/vector/index.ts — barrel for vector PDF templates (SRP split).
// New code imports templates from here; resumeVectorPdf.ts dispatches via this barrel.
export type { JsPDFInstance } from './shared';
export { loadJsPDF, safeName, createBaseHelpers, parseSkillRows, drawBulletWithBold } from './shared';
export { renderClassic } from './classic';
export { renderModern } from './modern';
export { renderMinimal } from './minimal';
export { renderSourceSplit } from './sourceSplit';
export { renderCompact } from './compact';
export { renderCustom } from './custom';
