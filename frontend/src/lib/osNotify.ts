export type OsNotifyResult = "sent" | "denied" | "unavailable" | "failed";

type NotifyOptions = {
  id: string;
  title: string;
  body?: string;
};

type RuntimeNotify = {
  InitializeNotifications?: () => Promise<void>;
  IsNotificationAvailable?: () => Promise<boolean>;
  CheckNotificationAuthorization?: () => Promise<boolean>;
  RequestNotificationAuthorization?: () => Promise<boolean>;
  SendNotification?: (options: NotifyOptions) => Promise<void>;
};

let gate: Promise<"granted" | "denied" | "unavailable"> | null = null;

function runtimeNotify(): RuntimeNotify | null {
  if (typeof window === "undefined") {
    return null;
  }
  const rt = (window as Window & { runtime?: RuntimeNotify }).runtime;
  if (!rt?.SendNotification) {
    return null;
  }
  return rt;
}

export function resetOsNotificationsForTests(): void {
  gate = null;
}

// ensureOsNotifications initializes the Wails notification service once per
// session and asks the OS for permission a single time when it is still unset.
export function ensureOsNotifications(): Promise<"granted" | "denied" | "unavailable"> {
  if (!gate) {
    gate = resolveAuth();
  }
  return gate;
}

async function resolveAuth(): Promise<"granted" | "denied" | "unavailable"> {
  const rt = runtimeNotify();
  if (!rt?.SendNotification) {
    return "unavailable";
  }
  try {
    if (rt.IsNotificationAvailable && !(await rt.IsNotificationAvailable())) {
      return "unavailable";
    }
    await rt.InitializeNotifications?.();
  } catch {
    return "unavailable";
  }
  try {
    const allowed = rt.CheckNotificationAuthorization ? await rt.CheckNotificationAuthorization() : true;
    if (allowed) {
      return "granted";
    }
    if (!rt.RequestNotificationAuthorization) {
      return "denied";
    }
    return (await rt.RequestNotificationAuthorization()) ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function sendOsNotification(options: NotifyOptions): Promise<OsNotifyResult> {
  const auth = await ensureOsNotifications();
  if (auth !== "granted") {
    return auth;
  }
  const rt = runtimeNotify();
  if (!rt?.SendNotification) {
    return "unavailable";
  }
  try {
    await rt.SendNotification({ id: options.id, title: options.title, body: options.body });
    return "sent";
  } catch {
    return "failed";
  }
}
