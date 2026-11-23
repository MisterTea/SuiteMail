const DEVICE_SETTINGS = new Set([
  "theme",
  "color_theme",
  "reading_pane_position",
  "email_density",
  "font_size",
  "inbox_view_mode",
  "reduce_motion",
  "sidebar_nav_config",
  "sidebar_collapsed",
  "contact_sidebar_visible",
  "task_sidebar_visible",
  "email_list_width",
  "read_filter",
  "calendar_view",
  "notifications_enabled",
  "smart_notifications",
  "notify_categories",
]);

export function isDeviceSetting(key: string): boolean {
  return DEVICE_SETTINGS.has(key) || key.startsWith("mail_notification_schedule:");
}

export function syncableSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !isDeviceSetting(key)));
}
