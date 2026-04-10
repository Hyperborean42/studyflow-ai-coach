/**
 * Shared utilities for calendar event styling. Both Dashboard and Planning
 * use these — keeping them in sync prevents the "vrij" events falling through
 * to default grey on Dashboard only.
 */

export function getEventColor(type: string): string {
  switch (type) {
    case "studie":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
    case "toets":
    case "examen":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
    case "afspraak":
      return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300";
    case "vrij":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300";
  }
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  studie: "Studieblok",
  toets: "Toets",
  examen: "Examen",
  afspraak: "Afspraak",
  vrij: "Vrij",
};
