// Ponte minimo verso l'SDK della Mini App (caricato da index.html). Tutto opzionale:
// fuori da Telegram, in sviluppo, ogni funzione degrada a no-op.

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string } };
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | undefined = window.Telegram?.WebApp;

export function initTelegram(): void {
  tg?.ready();
  tg?.expand();
}

export const initData = (): string => tg?.initData ?? "";

export const haptic = {
  tap: () => tg?.HapticFeedback?.impactOccurred("light"),
  success: () => tg?.HapticFeedback?.notificationOccurred("success"),
  warning: () => tg?.HapticFeedback?.notificationOccurred("warning"),
};
