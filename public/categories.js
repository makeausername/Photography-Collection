export const SUBJECT_CATEGORIES = Object.freeze(['山川湖海', '星空银河', '朝霞晚霞', '云海雾景', '人像写真']);

// Existing categories remain accessible until the photographer reclassifies those works.
export function orderedCategories(works = []) {
  return [...new Set([...SUBJECT_CATEGORIES, ...works.map(work => work.category).filter(Boolean)])];
}
