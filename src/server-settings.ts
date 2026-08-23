export const ADAPTER_IDS = ["bancho.py", "ripple", "akatsuki"] as const;

export type AdapterId = typeof ADAPTER_IDS[number];

export type ServerSetting = {
  id: string;
  domain: string;
  name: string;
  timezone: string;
  myUserId?: string;
  // Optional so settings written by versions before per-server toggles remain enabled.
  enabled?: boolean;
  // Optional so settings written by versions before adapter support remain valid.
  adapter?: AdapterId;
  apiEndpoint?: string;
  userProfileUrlTemplate?: string;
};

export function defaultUserProfileUrlTemplate(domain: string): string {
  return `https://osu.${domain}/users/{userId}`;
}

export function userProfileUrl(
  domain: string,
  template: string | undefined,
  userId: number,
): string | null {
  const source = template ?? defaultUserProfileUrlTemplate(domain);
  if ((source.match(/\{userId\}/g) ?? []).length !== 1) return null;
  const value = source.replace("{userId}", encodeURIComponent(String(userId)));
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
