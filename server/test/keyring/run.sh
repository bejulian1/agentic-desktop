#!/bin/bash
# Runs inside dbus-run-session (runde14-secret-service.test.ts). Never on the user's own bus.
set -u
case "${DBUS_SESSION_BUS_ADDRESS:-}" in
  ""|"$OUTER_BUS"|*/run/user/*) echo "Ikke en privat buss. Avbryter." >&2; exit 3 ;;
esac
case "$HOME" in /tmp/*) ;; *) echo "HOME er ikke midlertidig. Avbryter." >&2; exit 3 ;; esac

has_secrets() {
  gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.NameHasOwner org.freedesktop.secrets 2>/dev/null | grep -q true
}
wait_for_secrets() {
  for _ in $(seq 1 100); do has_secrets && return 0; sleep 0.05; done
  echo "gnome-keyring-daemon kom ikke på bussen" >&2; return 1
}
stop() {
  # Only the daemon this script started, by its PID.
  if ps -o pid=,cmd= -p "$1" | grep -q gnome-keyring-daemon; then kill "$1"; wait "$1" 2>/dev/null; fi
}

"$NODE" "$PROBE" none || exit 1

printf '%s' "$KEYRING_PASSWORD" | gnome-keyring-daemon --foreground --unlock --components=secrets --control-directory="$XDG_RUNTIME_DIR/k1" >/dev/null 2>&1 &
KR=$!
wait_for_secrets || { stop $KR; exit 1; }
"$NODE" "$PROBE" full; status=$?
stop $KR
[ $status -eq 0 ] || exit 1

# The same keyring, now without the password: locked, and with no one to ask for it.
gnome-keyring-daemon --foreground --components=secrets --control-directory="$XDG_RUNTIME_DIR/k2" </dev/null >/dev/null 2>&1 &
KR=$!
wait_for_secrets || { stop $KR; exit 1; }
"$NODE" "$PROBE" locked; status=$?
stop $KR
exit $status
