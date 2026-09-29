/** The Timeline's zoom buttons, and the range of days it holds at once. Shared by its page and the view. */
export type TimelineZoom = "day" | "week" | "month" | "quarter";
export const TIMELINE_ZOOMS: TimelineZoom[] = ["day", "week", "month", "quarter"];
/** The days the timeline holds at once (36 weeks, from a Monday), and how many come before the day it opens on. */
export const TIMELINE_DAYS = 252;
export const TIMELINE_LEAD = 84;
