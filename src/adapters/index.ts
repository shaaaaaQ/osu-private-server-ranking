import type { AdapterId } from "../server-settings";
import { akatsukiAdapter } from "./akatsuki";
import { banchoPyAdapter } from "./bancho-py";
import { rippleAdapter } from "./ripple";
import type { ServerAdapter } from "./types";

export const adapters: readonly ServerAdapter[] = [banchoPyAdapter, rippleAdapter, akatsukiAdapter];

const adapterById = new Map<AdapterId, ServerAdapter>(adapters.map((adapter) => [adapter.id, adapter]));

export function getAdapter(id: unknown): ServerAdapter {
  return adapterById.get(id as AdapterId) ?? banchoPyAdapter;
}
