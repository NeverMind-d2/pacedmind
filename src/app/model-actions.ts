"use server";

import { refresh } from "next/cache";
import { guardAction } from "@/server/guard";
import { MODE } from "@/server/supabase";
import * as repo from "@/server/repo";
import { refreshAgentModels, thisDevice } from "@/server/devices";
import { deviceOnline, type AgentId } from "@/lib/types";

/** Ask this computer live; other computers supply only their most recent report. */
export async function taskModelsAction(agent: AgentId, deviceId: string | null) {
  await guardAction();
  if (agent !== "claude" && agent !== "codex") throw new Error("Unknown agent");
  const me = MODE === "desktop" ? await thisDevice() : null;
  const devices = (await repo.listDevices()).filter((d) => !d.revokedAt && d.id !== me?.id);
  if (me) devices.unshift(me);
  const selected = deviceId !== null ? devices.find((d) => d.id === deviceId)
    : me ?? devices.find((d) => d.isDefault) ?? devices.find(deviceOnline) ?? devices[0];
  const local = !!selected && selected.id === me?.id;
  const catalog = local ? await refreshAgentModels(agent) : selected?.agents[agent].models;
  if (local) refresh();
  return {
    devices: devices.map((d) => ({ id: d.id, name: d.name })),
    deviceId: selected?.id ?? null, name: selected?.name ?? null,
    local, online: local || (!!selected && deviceOnline(selected)), catalog: catalog ?? null,
  };
}
