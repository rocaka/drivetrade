export type AppScreen = "home" | "checklist" | "journal" | "rules" | "stats" | "academy" | "market";
export type AcademyView = "map" | "practice" | "exams" | "report";
export type MarketView = "market" | "account" | "review";
export type TrainingDestination =
  | { page: "academy"; view?: AcademyView; reviewSeed?: string }
  | { page: "market"; view?: MarketView };
export type AppLocation = { screen: AppScreen; training: TrainingDestination };
const screens: AppScreen[] = [
  "home",
  "checklist",
  "journal",
  "rules",
  "stats",
  "academy",
  "market",
];
const academyViews: AcademyView[] = ["map", "practice", "exams", "report"];
const marketViews: MarketView[] = ["market", "account", "review"];
export function readAppLocation(url: URL): AppLocation {
  const screen = screens.includes(url.searchParams.get("screen") as AppScreen)
    ? (url.searchParams.get("screen") as AppScreen)
    : "home";
  const view = url.searchParams.get("view");
  if (screen === "market")
    return {
      screen,
      training: {
        page: "market",
        view: marketViews.includes(view as MarketView) ? (view as MarketView) : "market",
      },
    };
  const review = url.searchParams.get("review");
  return {
    screen,
    training: {
      page: "academy",
      view: academyViews.includes(view as AcademyView) ? (view as AcademyView) : "map",
      ...(review && review.length <= 200 ? { reviewSeed: review } : {}),
    },
  };
}
export function appLocationFor(target: AppScreen | TrainingDestination): AppLocation {
  if (typeof target !== "string") return { screen: target.page, training: target };
  return {
    screen: target,
    training:
      target === "market" ? { page: "market", view: "market" } : { page: "academy", view: "map" },
  };
}
export function appLocationUrl(current: URL, location: AppLocation): URL {
  const url = new URL(current);
  if (location.screen === "home") url.searchParams.delete("screen");
  else url.searchParams.set("screen", location.screen);
  url.searchParams.delete("view");
  url.searchParams.delete("review");
  if (location.screen === "market" && location.training.page === "market")
    url.searchParams.set("view", location.training.view ?? "market");
  if (location.screen === "academy" && location.training.page === "academy") {
    url.searchParams.set("view", location.training.view ?? "map");
    if (location.training.reviewSeed) url.searchParams.set("review", location.training.reviewSeed);
  }
  return url;
}
