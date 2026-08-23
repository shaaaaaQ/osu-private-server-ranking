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
};
