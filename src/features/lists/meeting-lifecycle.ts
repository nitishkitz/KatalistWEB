/** Scheduled end time closes the upcoming window, regardless of attendance. */
export function isUpcomingMeeting(meeting: { endsAt: string }, now: number): boolean {
  return Date.parse(meeting.endsAt) > now;
}
