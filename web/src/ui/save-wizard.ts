/**
 * U46: the "Open your save" wizard, a view of the save viewer (save.html#open). The Save dropdown's "Open your own
 * save" / "Choose another file" / "Open your save" (save-source.ts) lead here instead of opening the file dialog.
 *
 * Routes (hash, like #hero=<id>): #open is step 1, two big choices (PC, Mobile); #open=pc and #open=mobile show that
 * platform's numbered steps and a "Pick a file" button (the shared file chooser, save-file.ts chooseSave). Back and
 * the "← PC or mobile" link go back to step 1. A file loaded from here sends the page to #overview (save-viewer.ts).
 *
 * Mobile: the phone's app folder is private, but the game's bug report mails the current slot's save (Options, "Bug
 * Report" row: decompiled/scene.OptionsOverlay.lua, obj.SupportEmailer.lua getGameFiles), so the player sends it to
 * themselves. Folders: docs/tooling/save-loader/save-loader.md.
 */
import { el } from "./dom.ts";

export type Platform = "pc" | "mobile";
export const PLATFORMS: Platform[] = ["pc", "mobile"];

/** The wizard's hash (save.html#open) and the link to it from any page. */
export const OPEN_HASH = "#open";
export const OPEN_HREF = `save.html${OPEN_HASH}`;
export const platformHash = (p: Platform | null): string => (p ? `${OPEN_HASH}=${p}` : OPEN_HASH);

/**
 * The wizard's state from the page's hash: undefined when the hash is not the wizard, null for step 1 (no platform
 * chosen yet, or an unknown one), else the chosen platform.
 */
export function wizardRoute(hash: string): Platform | null | undefined {
  const m = /^#open(?:=(\w*))?$/i.exec(hash);
  if (!m) return undefined;
  const p = (m[1] ?? "").toLowerCase();
  return (PLATFORMS as string[]).includes(p) ? (p as Platform) : null;
}

/** A piece of a step: plain text, or a file name / folder shown as code. */
export type Part = string | { code: string };
export interface Step {
  text: Part[];
  /** Labelled lines under the step (one folder per system). */
  list?: [label: string, value: string][];
}
export interface PlatformSteps {
  label: string;
  icon: string;
  /** Under the label on step 1's big button. */
  sub: string;
  steps: Step[];
  /** Short muted lines under the steps. */
  notes: string[];
}

export const PICK_LABEL = "📂 Pick a file";

export const WIZARD: Record<Platform, PlatformSteps> = {
  pc: {
    label: "PC", icon: "💻", sub: "Windows, Steam Deck, Mac",
    steps: [
      { text: ["Copy your system's save folder:"], list: [
        ["Windows", "%APPDATA%\\Retora\\Merchant\\Documents"],
        ["Steam Deck / Linux (Proton)", "<Steam library>/steamapps/compatdata/346750/pfx/drive_c/users/steamuser/AppData/Roaming/Retora/Merchant/Documents"],
        ["macOS", "~/Library/Application Support/Merchant/Documents"],
      ] },
      { text: ["Tap Pick a file and paste the folder in the dialog's address bar."] },
      { text: ["Choose ", { code: "PlayerData.txt" }, " (slot 1) or ", { code: "Slot2Data.txt" }, " … ", { code: "Slot5Data.txt" }, "."] },
    ],
    notes: ["Chrome and Edge reopen that folder next time."],
  },
  mobile: {
    label: "Mobile", icon: "📱", sub: "Android, iPhone, iPad",
    steps: [
      { text: ["In the game, open Options and tap the button of the \"Bug Report\" row."] },
      { text: ["Your mail app opens with the save attached. Change the recipient to your own address and send it (or save the attachment)."] },
      { text: ["Open that email on this device, tap Pick a file and choose ", { code: "PlayerData.txt" }, " (or ", { code: "SlotNData.txt" }, ")."] },
    ],
    notes: ["Only the slot you are playing is attached: switch slots in the game to send another.", "Not tested on every mail app."],
  },
};

/** A step's text, as plain text (tests, tooltips). */
export const partsText = (parts: Part[]): string => parts.map((p) => (typeof p === "string" ? p : p.code)).join("");

const parts = (ps: Part[]) => ps.map((p) => (typeof p === "string" ? p : el("code", {}, p.code)));

export interface WizardActions {
  /** Open the file dialog (save-source.ts: the remembered-folder picker or the plain input). */
  pick: () => void;
  /** Load the example save, offered on step 1. */
  example?: () => void;
}

/** The wizard for `platform` (null: step 1, the two choices). */
export function saveWizard(platform: Platform | null, actions: WizardActions): HTMLElement {
  if (!platform) {
    const choices = el("div", { class: "wiz-choices" }, ...PLATFORMS.map((p) => el("a", { class: "wiz-choice", href: platformHash(p) },
      el("span", { class: "wiz-icon", "aria-hidden": "true" }, WIZARD[p].icon),
      el("span", { class: "wiz-label" }, WIZARD[p].label), el("span", { class: "wiz-sub" }, WIZARD[p].sub))));
    const ex = actions.example;
    const extra = ex ? [el("button", { type: "button", class: "secondary wiz-example", title: "Load an anonymised real save" }, "🧪 Example save")] : [];
    if (ex) extra[0].addEventListener("click", () => ex());
    return el("section", { class: "save-wizard", "aria-label": "Open your save", "data-step": "platform" },
      el("h2", { class: "wiz-title" }, "Open your save"), choices, ...extra);
  }
  const w = WIZARD[platform];
  const steps = el("ol", { class: "wiz-steps" }, ...w.steps.map((s) => el("li", {}, ...parts(s.text),
    ...(s.list ? [el("ul", { class: "wiz-paths" }, ...s.list.map(([label, value]) => el("li", {}, el("strong", {}, `${label}: `), el("code", {}, value))))] : []))));
  const pick = el("button", { type: "button", class: "primary wiz-pick" }, PICK_LABEL);
  pick.addEventListener("click", () => actions.pick());
  return el("section", { class: "save-wizard", "aria-label": `Open your save: ${w.label}`, "data-step": platform },
    el("nav", { class: "hero-nav wiz-nav", "aria-label": "Open your save" },
      el("a", { href: OPEN_HASH, class: "secondary-link" }, "← PC or mobile")),
    el("h2", { class: "wiz-title" }, `${w.icon} ${w.label}`), steps, pick,
    ...w.notes.map((n) => el("p", { class: "muted small wiz-note" }, n)));
}
