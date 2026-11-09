// Names people give projects and threads. Characters with no width (zero-width space, non-joiner,
// joiner, word joiner and the byte-order mark) are taken out: they make two names look the same
// while they differ, and a name of only them looks empty in the sidebar.
const INVISIBLE = /[​-‍⁠﻿]/g;

export function cleanName(value: string): string {
  return value.replace(INVISIBLE, "").trim();
}
