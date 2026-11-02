import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import type { AvailableDevice } from "../tauri/index";

/**
 * Web Serial helpers for reconnecting to ports the user has already granted
 * access to, so Studio can offer them directly instead of always opening the
 * browser's port chooser.
 */

const NAMES_STORAGE_KEY = "knownDeviceNames";

/** Same label format the ts-client serial transport uses ("vid:pid"). */
const portLabel = (port: SerialPort): string => {
  const info = port.getInfo();
  return (
    (info.usbVendorId?.toLocaleString() || "") +
    ":" +
    (info.usbProductId?.toLocaleString() || "")
  );
};

const loadNames = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(NAMES_STORAGE_KEY) || "{}"
    );
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
};

/**
 * Remember the device name reported over RPC for a transport, so the known
 * device list can show "My Keyboard" rather than a USB vendor/product ID.
 */
export const rememberDeviceName = (transportLabel: string, name: string) => {
  if (!transportLabel || !name) {
    return;
  }
  const names = loadNames();
  if (names[transportLabel] !== name) {
    names[transportLabel] = name;
    localStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(names));
  }
};

let knownPorts: SerialPort[] = [];

/** List the currently attached serial ports the user has already granted. */
export const listKnownSerialDevices = async (): Promise<AvailableDevice[]> => {
  if (!navigator.serial?.getPorts) {
    return [];
  }

  knownPorts = await navigator.serial.getPorts();
  const names = loadNames();

  return knownPorts.map((port, i) => {
    const label = portLabel(port);
    return { id: i.toString(), label: names[label] || `USB device ${label}` };
  });
};

/** Call `onChange` whenever a serial port is attached or detached. */
export const subscribeToSerialDeviceChanges = (onChange: () => void) => {
  if (!navigator.serial) {
    return () => {};
  }
  navigator.serial.addEventListener("connect", onChange);
  navigator.serial.addEventListener("disconnect", onChange);
  return () => {
    navigator.serial.removeEventListener("connect", onChange);
    navigator.serial.removeEventListener("disconnect", onChange);
  };
};

/**
 * Open a previously granted port. Mirrors the ts-client serial transport's
 * `connect()`, minus the `requestPort()` chooser.
 */
export const connectKnownSerialDevice = async (
  dev: AvailableDevice
): Promise<RpcTransport> => {
  const port = knownPorts[parseInt(dev.id)];
  if (!port) {
    throw new Error("The selected device is no longer available.");
  }

  await port.open({ baudRate: 12500 }).catch((e) => {
    if (e instanceof DOMException && e.name === "NetworkError") {
      throw new Error(
        "Failed to open the serial port. Check the permissions of the device and verify it is not in use by another process."
      );
    }
    throw e;
  });

  const abortController = new AbortController();
  const signal = abortController.signal;
  const onAbort = async () => {
    signal.removeEventListener("abort", onAbort);
    await port.writable?.close();
    await port.readable?.cancel();
    await port.close();
  };
  signal.addEventListener("abort", onAbort);

  return {
    label: portLabel(port),
    abortController,
    readable: port.readable!,
    writable: port.writable!,
  };
};
