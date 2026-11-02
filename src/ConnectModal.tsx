import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { AvailableDevice } from "./tauri/index";
import { Bluetooth, RefreshCw } from "lucide-react";
import { Key, ListBox, ListBoxItem, Selection } from "react-aria-components";
import { useModalRef } from "./misc/useModalRef";
import { ExternalLink } from "./misc/ExternalLink";
import { GenericModal } from "./GenericModal";

export type TransportFactory = {
  label: string;
  isWireless?: boolean;
  connect?: () => Promise<RpcTransport>;
  pick_and_connect?: {
    list: () => Promise<Array<AvailableDevice>>;
    connect: (dev: AvailableDevice) => Promise<RpcTransport>;
  };
  /**
   * Devices that can be connected without a browser chooser, e.g. serial
   * ports the user has already granted access to.
   */
  known?: {
    list: () => Promise<Array<AvailableDevice>>;
    connect: (dev: AvailableDevice) => Promise<RpcTransport>;
    /** Call the callback when the list may have changed; returns cleanup. */
    subscribe?: (onChange: () => void) => () => void;
  };
};

export interface ConnectModalProps {
  open?: boolean;
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
}

function deviceList(
  open: boolean,
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void
) {
  const [devices, setDevices] = useState<
    Array<[TransportFactory, AvailableDevice]>
  >([]);
  const [selectedDev, setSelectedDev] = useState(new Set<Key>());
  const [refreshing, setRefreshing] = useState(false);

  async function LoadEm() {
    setRefreshing(true);
    let entries: Array<[TransportFactory, AvailableDevice]> = [];
    for (const t of transports.filter((t) => t.pick_and_connect)) {
      const devices = await t.pick_and_connect?.list();
      if (!devices) {
        continue;
      }

      entries.push(
        ...devices.map<[TransportFactory, AvailableDevice]>((d) => {
          return [t, d];
        })
      );
    }

    setDevices(entries);
    setRefreshing(false);
  }

  useEffect(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
  }, [transports, open, setDevices]);

  const onRefresh = useCallback(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
  }, [setDevices]);

  const onSelect = useCallback(
    async (keys: Selection) => {
      if (keys === "all") {
        return;
      }
      const dev = devices.find(([_t, d]) => keys.has(d.id));
      if (dev) {
        dev[0]
          .pick_and_connect!.connect(dev[1])
          .then(onTransportCreated)
          .catch((e) => alert(e));
      }
    },
    [devices, onTransportCreated]
  );

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto]">
        <label>Select A Device:</label>
        <button
          className="p-1 rounded hover:bg-base-300 disabled:bg-base-100 disabled:opacity-75"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            className={`size-5 transition-transform ${
              refreshing ? "animate-spin" : ""
            }`}
          />
        </button>
      </div>
      <ListBox
        aria-label="Device"
        // Remount when a lone device appears so it starts focused, letting
        // Enter connect to it.
        key={devices.length === 1 ? "single" : "multiple"}
        autoFocus={devices.length === 1 ? "first" : undefined}
        items={devices}
        onSelectionChange={onSelect}
        selectionMode="single"
        selectedKeys={selectedDev}
        className="flex flex-col gap-1 pt-1"
      >
        {([t, d]) => (
          <ListBoxItem
            className={({ isFocused }) =>
              `grid grid-cols-[1em_1fr] rounded hover:bg-base-300 cursor-pointer px-1 ${
                isFocused ? "bg-base-300" : ""
              }`
            }
            id={d.id}
            aria-label={d.label}
          >
            {t.isWireless && (
              <Bluetooth className="w-4 justify-center content-center h-full" />
            )}
            <span className="col-start-2">{d.label}</span>
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
}

interface KnownDeviceItemsProps {
  open: boolean;
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
}

/**
 * List items for devices that can be connected without the browser's
 * chooser. When there is exactly one, it is preselected so Enter connects.
 */
const KnownDeviceItems = ({
  open,
  transports,
  onTransportCreated,
}: KnownDeviceItemsProps) => {
  const [knownDevices, setKnownDevices] = useState<
    Array<[TransportFactory, AvailableDevice]>
  >([]);
  const singleKnownRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let ignore = false;
    const load = async () => {
      const entries: Array<[TransportFactory, AvailableDevice]> = [];
      for (const t of transports.filter((t) => t.known)) {
        try {
          const devices = await t.known!.list();
          entries.push(
            ...devices.map<[TransportFactory, AvailableDevice]>((d) => [t, d])
          );
        } catch (e) {
          console.error("Failed to list known devices", e);
        }
      }
      if (!ignore) {
        setKnownDevices(entries);
      }
    };

    load();
    const unsubscribes = transports.map((t) => t.known?.subscribe?.(load));

    return () => {
      ignore = true;
      unsubscribes.forEach((u) => u?.());
    };
  }, [transports, open]);

  // Only preselect when exactly one device is available.
  const singleKnown = knownDevices.length === 1;
  useEffect(() => {
    if (open && singleKnown) {
      singleKnownRef.current?.focus();
    }
  }, [open, singleKnown]);

  const connectKnown = async (t: TransportFactory, d: AvailableDevice) => {
    try {
      onTransportCreated(await t.known!.connect(d));
    } catch (e) {
      console.error(e);
      if (e instanceof Error && !(e instanceof UserCancelledError)) {
        alert(e.message);
      }
    }
  };

  if (knownDevices.length === 0) {
    return null;
  }

  return (
    <>
      {knownDevices.map(([t, d]) => (
        <li key={`${t.label}-${d.id}`} className="list-none">
          <button
            ref={singleKnown ? singleKnownRef : undefined}
            type="button"
            className={`w-full flex justify-between gap-4 rounded px-2 py-1 text-left ${
              singleKnown
                ? "bg-primary text-primary-content"
                : "bg-base-300 hover:bg-primary hover:text-primary-content"
            }`}
            onClick={() => connectKnown(t, d)}
          >
            <span>{d.label}</span>
            <span className="opacity-70">{t.label}</span>
          </button>
        </li>
      ))}
    </>
  );
};

function simpleDevicePicker(
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void,
  open: boolean
) {
  const [availableDevices, setAvailableDevices] = useState<
    AvailableDevice[] | undefined
  >(undefined);
  const [selectedTransport, setSelectedTransport] = useState<
    TransportFactory | undefined
  >(undefined);

  useEffect(() => {
    if (!selectedTransport) {
      setAvailableDevices(undefined);
      return;
    }

    let ignore = false;

    if (selectedTransport.connect) {
      async function connectTransport() {
        try {
          const transport = await selectedTransport?.connect?.();

          if (!ignore) {
            if (transport) {
              onTransportCreated(transport);
            }
            setSelectedTransport(undefined);
          }
        } catch (e) {
          if (!ignore) {
            console.error(e);
            if (e instanceof Error && !(e instanceof UserCancelledError)) {
              alert(e.message);
            }
            setSelectedTransport(undefined);
          }
        }
      }

      connectTransport();
    } else {
      async function loadAvailableDevices() {
        const devices = await selectedTransport?.pick_and_connect?.list();

        if (!ignore) {
          setAvailableDevices(devices);
        }
      }

      loadAvailableDevices();
    }

    return () => {
      ignore = true;
    };
  }, [selectedTransport]);

  // Connecting a device the browser hasn't granted access to yet opens the
  // browser's own chooser.
  let connections = transports.map((t) => (
    <li key={t.label} className="list-none">
      <button
        className="w-full flex justify-between gap-4 rounded px-2 py-1 text-left hover:bg-base-300"
        type="button"
        onClick={async () => setSelectedTransport(t)}
      >
        <span>Add a {t.label} device…</span>
      </button>
    </li>
  ));
  return (
    <div>
      <p className="text-sm">Select a device.</p>
      <ul className="flex flex-col gap-1 pt-2">
        <KnownDeviceItems
          open={open}
          transports={transports}
          onTransportCreated={onTransportCreated}
        />
        {connections}
      </ul>
      {selectedTransport && availableDevices && (
        <ul>
          {availableDevices.map((d) => (
            <li
              key={d.id}
              className="m-1 p-1"
              onClick={async () => {
                onTransportCreated(
                  await selectedTransport!.pick_and_connect!.connect(d)
                );
                setSelectedTransport(undefined);
              }}
            >
              {d.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function noTransportsOptionsPrompt() {
  return (
    <div className="m-4 flex flex-col gap-2">
      <p>
        Your browser is not supported. ZMK Studio uses either{" "}
        <ExternalLink href="https://caniuse.com/web-serial">
          Web Serial
        </ExternalLink>{" "}
        or{" "}
        <ExternalLink href="https://caniuse.com/web-bluetooth">
          Web Bluetooth
        </ExternalLink>{" "}
        (Linux only) to connect to ZMK devices.
      </p>

      <div>
        <p>To use ZMK Studio, either:</p>
        <ul className="list-disc list-inside">
          <li>
            Use a browser that supports the above web technologies, e.g.
            Chrome/Edge, or
          </li>
          <li>
            Download our{" "}
            <ExternalLink href="/download">
              cross platform application
            </ExternalLink>
            .
          </li>
        </ul>
      </div>
    </div>
  );
}

function connectOptions(
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void,
  open?: boolean
) {
  const useSimplePicker = useMemo(
    () => transports.every((t) => !t.pick_and_connect),
    [transports]
  );

  return useSimplePicker
    ? simpleDevicePicker(transports, onTransportCreated, open || false)
    : deviceList(open || false, transports, onTransportCreated);
}

export const ConnectModal = ({
  open,
  transports,
  onTransportCreated,
}: ConnectModalProps) => {
  const dialog = useModalRef(open || false, false, false);

  const haveTransports = useMemo(() => transports.length > 0, [transports]);

  return (
    <GenericModal ref={dialog} className="max-w-xl">
      <h1 className="text-xl">Welcome to ZMK Studio</h1>
      {haveTransports
        ? connectOptions(transports, onTransportCreated, open)
        : noTransportsOptionsPrompt()}
    </GenericModal>
  );
};
