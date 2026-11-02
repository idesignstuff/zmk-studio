/** Which operating system's conventions to use for modifier labels. */
export type ModifierPlatform = "mac" | "win" | "linux";

/** A per-layer choice: a specific platform, or "auto" to infer one. */
export type ModifierPlatformSetting = ModifierPlatform | "auto";

export const PLATFORM_NAMES: Record<ModifierPlatform, string> = {
  mac: "Mac",
  win: "Windows",
  linux: "Linux",
};

/** Best guess at the OS Studio is running on. */
export const detectPlatform = (): ModifierPlatform => {
  if (typeof navigator === "undefined") {
    return "win";
  }

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = `${nav.userAgentData?.platform ?? ""} ${
    nav.platform ?? ""
  } ${nav.userAgent ?? ""}`;

  if (/mac|iphone|ipad/i.test(platform)) return "mac";
  if (/win/i.test(platform)) return "win";
  if (/linux|x11|cros/i.test(platform)) return "linux";
  return "win";
};

/**
 * Infer a platform from a layer's name, so a keymap with e.g. "Win" and
 * "Mac" base layers labels each correctly with no configuration. The name is
 * stored on the keyboard, so this also works on any computer.
 */
export const platformFromLayerName = (
  name: string | undefined
): ModifierPlatform | undefined => {
  if (!name) return undefined;
  if (/\b(mac|macos|osx|apple)\b|⌘/i.test(name)) return "mac";
  if (/\b(win|windows|pc)\b|⊞/i.test(name)) return "win";
  if (/\b(linux|lin|gnome|kde)\b/i.test(name)) return "linux";
  return undefined;
};

/**
 * Resolve the platform for a layer: an explicit per-layer choice wins, then a
 * hint in the layer name, then the detected OS.
 */
export const resolvePlatform = (
  setting: ModifierPlatformSetting | undefined,
  layerName: string | undefined,
  detected: ModifierPlatform
): ModifierPlatform =>
  setting && setting !== "auto"
    ? setting
    : platformFromLayerName(layerName) ?? detected;

const isPlatformSetting = (v: unknown): v is ModifierPlatformSetting =>
  v === "auto" || v === "mac" || v === "win" || v === "linux";

/** Per-keyboard, per-layer platform choices, keyed by device then layer ID. */
export type PlatformOverrides = Record<
  string,
  Record<string, ModifierPlatformSetting>
>;

export const deserializePlatformOverrides = (
  value: string
): PlatformOverrides => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {};

    const result: PlatformOverrides = {};
    for (const [device, layers] of Object.entries(parsed)) {
      if (!layers || typeof layers !== "object") continue;
      result[device] = {};
      for (const [layer, setting] of Object.entries(layers)) {
        if (isPlatformSetting(setting)) result[device][layer] = setting;
      }
    }
    return result;
  } catch {
    return {};
  }
};

/** A stable key for a device, preferring its serial number over its name. */
export const deviceKey = (
  name: string | undefined,
  serialNumber: Uint8Array | undefined
): string | undefined => {
  if (serialNumber && serialNumber.some((b) => b !== 0)) {
    return [...serialNumber]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return name || undefined;
};
