import type { INotificationService } from "../types";
import { TeamsNotificationService } from "./TeamsNotificationService";
import { SlackNotificationService } from "./SlackNotificationService";
import { MultiChannelNotificationService } from "./MultiChannelNotificationService";

export interface NotificationChannels {
  service: INotificationService;
  /** Which channels are connected, e.g. ["teams", "slack"]. */
  names: Array<"teams" | "slack">;
}

const isUrl = (v: string | null | undefined): v is string => !!v && v.trim().startsWith("https://");

/**
 * Builds the reminder sender from the configured webhook URLs: Teams, Slack, or
 * both (every reminder then goes to each connected channel). Returns null when
 * neither is set, so callers can fall back to the mock sender.
 */
export function buildNotificationChannels(urls: {
  teamsUrl?: string | null;
  slackUrl?: string | null;
}): NotificationChannels | null {
  const services: INotificationService[] = [];
  const names: NotificationChannels["names"] = [];
  if (isUrl(urls.teamsUrl)) {
    services.push(new TeamsNotificationService(urls.teamsUrl.trim()));
    names.push("teams");
  }
  if (isUrl(urls.slackUrl)) {
    services.push(new SlackNotificationService(urls.slackUrl.trim()));
    names.push("slack");
  }
  if (services.length === 0) return null;
  return { service: services.length === 1 ? services[0] : new MultiChannelNotificationService(services), names };
}
