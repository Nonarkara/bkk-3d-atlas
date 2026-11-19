// The hash target, without the '#' and without a leading path slash.
//
// A share link that silently does nothing is worse than one that works:
// setActiveArea() no-ops on an unknown id without a word, so a visitor who
// typed "#/yaowarat-chinatown" landed on the opening view and concluded the
// link was broken. The atlas's own links carry no slash, but a person
// typing one — or another site building a path-style hash — should still be
// understood.
export function hashTarget(hash) {
  return (hash || "").replace(/^#/, "").replace(/^\/+/, "").trim();
}
