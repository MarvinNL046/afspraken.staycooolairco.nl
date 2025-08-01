import { SALES_TEAM_CONFIG } from './constants';

/**
 * Sales Team Validation Service
 * 
 * CRITICAL: This service ensures that ONLY sales team appointments
 * are created and managed by this application. Other teams' appointments
 * in the shared calendar must be ignored.
 */

/**
 * Validates that an appointment belongs to the sales team
 * @param colorId - The Google Calendar color ID
 * @returns true if the appointment is for the sales team
 */
export function isSalesTeamAppointment(colorId: string | null | undefined): boolean {
  return colorId === SALES_TEAM_CONFIG.CALENDAR_COLOR_ID;
}

/**
 * Validates that a calendar event belongs to the sales team
 * @param event - Google Calendar event object
 * @returns true if the event is for the sales team
 */
export function isSalesTeamCalendarEvent(event: any): boolean {
  return event.colorId === SALES_TEAM_CONFIG.CALENDAR_COLOR_ID;
}

/**
 * Filters a list of appointments to only include sales team appointments
 * @param appointments - Array of appointments from database
 * @returns Only appointments with the sales team color
 */
export function filterSalesTeamAppointments<T extends { colorId?: string | null }>(
  appointments: T[]
): T[] {
  return appointments.filter(apt => isSalesTeamAppointment(apt.colorId));
}

/**
 * Ensures an appointment has the correct sales team color
 * @param appointmentData - Appointment data object
 * @returns The appointment data with the sales team color enforced
 */
export function ensureSalesTeamColor<T extends object>(appointmentData: T): T & { colorId: string } {
  return {
    ...appointmentData,
    colorId: SALES_TEAM_CONFIG.CALENDAR_COLOR_ID
  };
}

/**
 * Validates availability checking parameters
 * @throws Error if trying to check availability for non-sales team
 */
export function validateSalesTeamContext(colorId?: string): void {
  if (colorId && colorId !== SALES_TEAM_CONFIG.CALENDAR_COLOR_ID) {
    throw new Error(
      `This system manages only ${SALES_TEAM_CONFIG.TEAM_NAME} appointments. ` +
      `Requested color ID ${colorId} is not allowed.`
    );
  }
}

/**
 * Gets a descriptive message about the sales team filter
 * @returns Informative message about the filtering
 */
export function getSalesTeamFilterMessage(): string {
  return `Alleen afspraken voor ${SALES_TEAM_CONFIG.TEAM_NAME} (${SALES_TEAM_CONFIG.CALENDAR_COLOR_NAME}) worden getoond.`;
}